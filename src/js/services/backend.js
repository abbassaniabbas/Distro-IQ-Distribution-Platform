import { CURRENCY_OPTIONS } from "./tenant.js";
import { getSupabaseClient, isBackendConfigured } from "./supabase-client.js";

const CLIENT_SELECT_WITH_BRAND = "id, client_id, role, status, clients(id, company_name, logo_data_url, brand_color, timezone, currency, currency_symbol, created_at)";
const CLIENT_SELECT_LEGACY = "id, client_id, role, status, clients(id, company_name, logo_data_url, timezone, currency, currency_symbol, created_at)";

function mapClient(row) {
  if (!row) return null;

  return {
    id: row.id,
    companyName: row.company_name,
    logoDataUrl: row.logo_data_url || "",
    brandColor: row.brand_color || "#D9A21B",
    timezone: row.timezone,
    currency: row.currency,
    currencySymbol: row.currency_symbol || "₦",
    createdAt: row.created_at
  };
}

function mapAccount(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    temporaryPassword: "",
    passwordResetRequired: Boolean(row.password_reset_required),
    createdAt: row.created_at
  };
}

function mapInvite(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    accountId: row.membership_id,
    to: row.email,
    subject: row.subject || "DistroIQ invite",
    resetLink: row.redirect_to || "",
    temporaryPassword: "",
    status: row.status,
    createdAt: row.created_at
  };
}

function mapActivityLog(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    actionType: row.action_type,
    recordType: row.record_type,
    recordLabel: row.record_label || "",
    actorUserId: row.actor_user_id || "",
    actorName: row.actor_name || "Team member",
    actorEmail: row.actor_email || "",
    summary: row.summary || "",
    createdAt: row.created_at
  };
}

function throwIfBackendMissing() {
  if (!isBackendConfigured()) {
    throw new Error("Supabase is not configured.");
  }
}

function isSchemaCacheError(error, fieldName) {
  const message = String(error?.message || "").toLowerCase();
  const details = String(error?.details || "").toLowerCase();
  const hint = String(error?.hint || "").toLowerCase();
  const text = `${message} ${details} ${hint}`;

  return (
    error?.code === "PGRST202" ||
    error?.code === "PGRST204" ||
    text.includes("schema cache") ||
    text.includes(fieldName.toLowerCase())
  );
}

async function loadMembershipRows(supabase, userId) {
  const query = (selectList) =>
    supabase
      .from("memberships")
      .select(selectList)
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1);

  const result = await query(CLIENT_SELECT_WITH_BRAND);

  if (!result.error) {
    return result;
  }

  if (!isSchemaCacheError(result.error, "brand_color")) {
    return result;
  }

  return query(CLIENT_SELECT_LEGACY);
}

async function recordWorkspaceActivity({ clientId, actionType, recordType, recordLabel = "", summary }) {
  if (!clientId) return;

  try {
    const supabase = await getSupabaseClient();
    const { error } = await supabase.rpc("record_activity", {
      p_client_id: clientId,
      p_action_type: actionType,
      p_record_type: recordType,
      p_record_label: recordLabel,
      p_summary: summary
    });

    if (error) {
      console.warn("Activity log was not recorded:", error.message);
    }
  } catch (error) {
    console.warn("Activity log was not recorded:", error.message);
  }
}

export async function loadWorkspace() {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError) {
    throw new Error(authError.message);
  }

  if (!authData.user?.id) {
    throw new Error("A signed-in Supabase user is required.");
  }

  const { data: membershipRows, error: membershipError } = await loadMembershipRows(supabase, authData.user.id);

  if (membershipError) {
    throw new Error(membershipError.message);
  }

  const activeMembership = membershipRows?.find((item) => ["active", "invited"].includes(item.status));
  const client = mapClient(activeMembership?.clients);

  if (!client) {
    return {
      client: null,
      accounts: [],
      invites: []
    };
  }

  const [
    { data: accountRows, error: accountError },
    { data: inviteRows, error: inviteError },
    { data: activityRows, error: activityError }
  ] = await Promise.all([
    supabase
      .from("memberships")
      .select("id, client_id, user_id, email, name, role, status, password_reset_required, created_at")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("invites")
      .select("id, client_id, membership_id, email, subject, redirect_to, status, created_at")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("activity_logs")
      .select("id, client_id, action_type, record_type, record_label, actor_user_id, actor_name, actor_email, summary, created_at")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
  ]);

  if (accountError) {
    throw new Error(accountError.message);
  }

  if (inviteError) {
    throw new Error(inviteError.message);
  }

  if (activityError) {
    console.warn("Activity log could not be loaded:", activityError.message);
  }

  return {
    client,
    accounts: (accountRows || []).map(mapAccount),
    invites: (inviteRows || []).map(mapInvite),
    activityLogs: activityError ? [] : (activityRows || []).map(mapActivityLog)
  };
}

export async function createWorkspace(payload) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const currency = CURRENCY_OPTIONS.find((item) => item.value === payload.currency) || CURRENCY_OPTIONS[0];
  let { data, error } = await supabase.rpc("create_client_workspace", {
    p_company_name: payload.companyName.trim(),
    p_logo_data_url: payload.logoDataUrl || "",
    p_brand_color: payload.brandColor || "#D9A21B",
    p_timezone: payload.timezone,
    p_currency: currency.value,
    p_currency_symbol: currency.symbol
  });

  if (error && isSchemaCacheError(error, "p_brand_color")) {
    const legacyResult = await supabase.rpc("create_client_workspace", {
      p_company_name: payload.companyName.trim(),
      p_logo_data_url: payload.logoDataUrl || "",
      p_timezone: payload.timezone,
      p_currency: currency.value,
      p_currency_symbol: currency.symbol
    });

    data = legacyResult.data;
    error = legacyResult.error;
  }

  if (error) {
    throw new Error(error.message);
  }

  await recordWorkspaceActivity({
    clientId: data?.id,
    actionType: "created",
    recordType: "company",
    recordLabel: payload.companyName.trim(),
    summary: "Created factory workspace"
  });

  return loadWorkspace();
}

export async function updateWorkspaceSettings({ client, payload }) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const currency = CURRENCY_OPTIONS.find((item) => item.value === payload.currency) || CURRENCY_OPTIONS[0];
  let { error } = await supabase
    .from("clients")
    .update({
      company_name: payload.companyName.trim(),
      logo_data_url: payload.logoDataUrl || "",
      brand_color: payload.brandColor || "#D9A21B",
      timezone: payload.timezone,
      currency: currency.value,
      currency_symbol: currency.symbol
    })
    .eq("id", client.id);

  if (error && isSchemaCacheError(error, "brand_color")) {
    const legacyResult = await supabase
      .from("clients")
      .update({
        company_name: payload.companyName.trim(),
        logo_data_url: payload.logoDataUrl || "",
        timezone: payload.timezone,
        currency: currency.value,
        currency_symbol: currency.symbol
      })
      .eq("id", client.id);

    error = legacyResult.error;
  }

  if (error) {
    throw new Error(error.message);
  }

  await recordWorkspaceActivity({
    clientId: client.id,
    actionType: "updated",
    recordType: "company",
    recordLabel: payload.companyName.trim(),
    summary: "Updated factory settings"
  });

  return loadWorkspace();
}

export async function updateMyMembershipProfile({ clientId, userId, name }) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const { error } = await supabase
    .from("memberships")
    .update({
      name: name.trim()
    })
    .eq("client_id", clientId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  await recordWorkspaceActivity({
    clientId,
    actionType: "updated",
    recordType: "account",
    recordLabel: name.trim(),
    summary: "Updated profile details"
  });

  return loadWorkspace();
}

export async function inviteAccount({ client, name, email, role }) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("invite-user", {
    body: {
      clientId: client.id,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role,
      redirectTo: `${window.location.origin}/#/reset-password`
    }
  });

  if (error) {
    throw new Error(error.message);
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  await recordWorkspaceActivity({
    clientId: client.id,
    actionType: "invited",
    recordType: "account",
    recordLabel: email.trim().toLowerCase(),
    summary: `Invited ${name.trim()}`
  });

  return loadWorkspace();
}

export async function activateCurrentMembership(clientId) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const { error } = await supabase.rpc("activate_my_membership", {
    p_client_id: clientId
  });

  if (error) {
    throw new Error(error.message);
  }

  await recordWorkspaceActivity({
    clientId,
    actionType: "completed",
    recordType: "account",
    recordLabel: "Account setup",
    summary: "Completed account setup"
  });

  return loadWorkspace();
}

export async function recordActivity(payload) {
  throwIfBackendMissing();
  await recordWorkspaceActivity(payload);
}
