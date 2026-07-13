import { CURRENCY_OPTIONS } from "./tenant.js";
import { getSupabaseClient, isBackendConfigured } from "./supabase-client.js";

const CLIENT_SELECT_WITH_BRAND = "id, client_id, role, status, password_reset_required, clients(id, company_name, logo_data_url, brand_color, timezone, currency, currency_symbol, credit_limit_email_enabled, credit_limit_sms_enabled, created_at)";
const CLIENT_SELECT_LEGACY = "id, client_id, role, status, password_reset_required, clients(id, company_name, logo_data_url, timezone, currency, currency_symbol, created_at)";

function mapClient(row) {
  if (!row) return null;

  return {
    id: row.id,
    companyName: row.company_name,
    logoDataUrl: row.logo_data_url || "",
    brandColor: row.brand_color || "#0B1F3A",
    timezone: row.timezone || "Africa/Lagos",
    currency: row.currency || "NGN",
    currencySymbol: row.currency_symbol || "₦",
    creditLimitEmailEnabled: row.credit_limit_email_enabled === true,
    creditLimitSmsEnabled: row.credit_limit_sms_enabled === true,
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
    phoneNumber: row.phone_number || "",
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
    role: row.role,
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

function mapWorkspaceMessage(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    fromAccountId: row.from_account_id || "",
    fromUserId: row.from_user_id || "",
    fromName: row.from_name || "Team member",
    fromEmail: row.from_email || "",
    fromRole: row.from_role || "",
    toAccountId: row.to_account_id || "",
    toUserId: row.to_user_id || "",
    toName: row.to_name || "Team member",
    toEmail: row.to_email || "",
    toRole: row.to_role || "",
    body: row.body || "",
    audience: row.audience || "direct",
    readAt: row.read_at || "",
    createdAt: row.created_at
  };
}

function mapFeatureModule(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    moduleKey: row.module_key,
    enabled: row.enabled !== false,
    updatedAt: row.updated_at
  };
}

function mapCreditLimit(row, accountByMembershipId = new Map()) {
  const account = accountByMembershipId.get(row.membership_id);

  return {
    id: row.id,
    clientId: row.client_id,
    partyType: row.party_type === "sales_rep" ? "Sales Representative" : "Supermarket",
    partyName: row.party_name,
    repUserId: account?.userId || "",
    limit: Number(row.limit_amount || 0),
    balance: Number(row.balance_amount || 0),
    previousLimit: Number(row.previous_limit_amount || 0),
    discountPercent: Number(row.discount_percent || 0),
    paymentPeriodDays: Number(row.payment_period_days ?? 14),
    latePenaltyPercent: Number(row.late_penalty_percent || 0),
    changedBy: row.changed_by_name || "Manager",
    changedAt: row.changed_at
  };
}

function mapCreditLimitHistory(row) {
  return {
    id: row.id,
    creditLimitId: row.credit_limit_id,
    clientId: row.client_id,
    partyType: row.party_type === "sales_rep" ? "Sales Representative" : "Supermarket",
    partyName: row.party_name,
    previousLimit: Number(row.previous_limit_amount || 0),
    nextLimit: Number(row.new_limit_amount || 0),
    discountPercent: Number(row.discount_percent || 0),
    paymentPeriodDays: Number(row.payment_period_days ?? 14),
    latePenaltyPercent: Number(row.late_penalty_percent || 0),
    changedBy: row.changed_by_name || "Manager",
    reason: "Credit review",
    changedAt: row.changed_at
  };
}

function mapPlatformClient(row) {
  return {
    id: row.client_id || row.id,
    companyName: row.company_name || "Unnamed company",
    documentBusinessName: row.documentBusinessName || row.document_business_name || row.company_name || "Unnamed company",
    dateFormat: row.dateFormat || row.date_format || "DD/MM/YYYY",
    brandColor: row.brand_color || row.brandColor || "#0B1F3A",
    timezone: row.timezone || "Africa/Lagos",
    currencySymbol: row.currency_symbol || "₦",
    createdAt: row.created_at,
    accountCount: Number(row.account_count || 0),
    activeAccountCount: Number(row.active_account_count || 0),
    inviteCount: Number(row.invite_count || 0),
    activityCount: Number(row.activity_count || 0),
    lastActivityAt: row.last_activity_at || ""
  };
}

function normalizePlatformConsole(data) {
  if (Array.isArray(data)) {
    const clients = data.map(mapPlatformClient);

    return {
      stats: {},
      clients,
      users: [],
      featureModules: [],
      emailTemplates: [],
      documentSequences: [],
      auditLogs: [],
      healthEvents: [],
      platformAdmins: []
    };
  }

  const value = data || {};

  return {
    stats: value.stats || {},
    clients: Array.isArray(value.clients) ? value.clients.map(mapPlatformClient) : [],
    users: Array.isArray(value.users) ? value.users : [],
    featureModules: Array.isArray(value.featureModules) ? value.featureModules : [],
    emailTemplates: Array.isArray(value.emailTemplates) ? value.emailTemplates : [],
    documentSequences: Array.isArray(value.documentSequences) ? value.documentSequences : [],
    auditLogs: Array.isArray(value.auditLogs) ? value.auditLogs : [],
    healthEvents: Array.isArray(value.healthEvents) ? value.healthEvents : [],
    platformAdmins: Array.isArray(value.platformAdmins) ? value.platformAdmins : []
  };
}

function throwIfBackendMissing() {
  if (!isBackendConfigured()) {
    throw new Error("Supabase is not configured.");
  }
}

async function readEdgeFunctionError(error) {
  const response = error?.context;

  if (!response) {
    return "";
  }

  try {
    const body = typeof response.clone === "function" ? response.clone() : response;
    const contentType = response.headers?.get?.("content-type") || "";

    if (contentType.includes("application/json") && typeof body.json === "function") {
      const data = await body.json();
      return String(data?.error || data?.message || JSON.stringify(data) || "");
    }

    if (typeof body.text === "function") {
      return (await body.text()).trim();
    }
  } catch {
    return "";
  }

  return "";
}

function friendlyEdgeFunctionMessage(message, fallback = "The request could not be completed.") {
  const raw = String(message || "").trim();
  const lower = raw.toLowerCase();

  if (!raw) {
    return fallback;
  }

  if (lower === "missing invite fields" || lower.includes("redirectto")) {
    return "The invite service on Supabase is outdated. Deploy the updated invite-user function, then try again.";
  }

  if (lower.includes("only managers can invite users") || lower.includes("only ceos and managers can invite users")) {
    return "Only an active CEO or Manager can add team members for this company.";
  }

  if (lower.includes("supabase function environment")) {
    return "The invite service is missing its Supabase environment settings.";
  }

  if (lower.includes("password_reset_required")) {
    return "Your Supabase database is missing the password-change field. Run the updated schema, then try again.";
  }

  if (lower.includes("credit limit email service is not configured")) {
    return "The credit-limit email service is not ready yet.";
  }

  if (lower.includes("already invited for this company")) {
    return "This email already has access for this company.";
  }

  if (lower.includes("user already registered") || lower.includes("already been registered")) {
    return "This email already exists in Supabase Auth. Use another email or ask the Bex Lab Super Admin to reset it.";
  }

  return raw;
}

async function edgeFunctionErrorMessage(error, fallback) {
  const functionMessage = await readEdgeFunctionError(error);
  return friendlyEdgeFunctionMessage(functionMessage || error?.message, fallback);
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
  let client = mapClient(activeMembership?.clients);

  if (!client && activeMembership?.password_reset_required) {
    const { data: pendingClientRows, error: pendingClientError } = await supabase.rpc(
      "get_my_pending_workspace_identity",
      { p_client_id: activeMembership.client_id }
    );

    if (pendingClientError) {
      throw new Error(pendingClientError.message);
    }

    client = mapClient(Array.isArray(pendingClientRows) ? pendingClientRows[0] : pendingClientRows);
  }

  if (!client) {
    return {
      client: null,
      accounts: [],
      invites: [],
      featureModules: [],
      messages: []
    };
  }

  const [
    { data: accountRows, error: accountError },
    { data: inviteRows, error: inviteError },
    { data: featureModuleRows, error: featureModuleError },
    { data: activityRows, error: activityError },
    { data: creditLimitRows, error: creditLimitError },
    { data: creditHistoryRows, error: creditHistoryError },
    { data: messageRows, error: messageError }
  ] = await Promise.all([
    supabase
      .from("memberships")
      .select("id, client_id, user_id, email, phone_number, name, role, status, password_reset_required, created_at")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("invites")
      .select("id, client_id, membership_id, email, role, subject, redirect_to, status, created_at")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("platform_feature_modules")
      .select("id, client_id, module_key, enabled, updated_at")
      .eq("client_id", client.id),
    supabase
      .from("activity_logs")
      .select("id, client_id, action_type, record_type, record_label, actor_user_id, actor_name, actor_email, summary, created_at")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("credit_limits")
      .select("id, client_id, party_type, party_name, membership_id, limit_amount, balance_amount, previous_limit_amount, discount_percent, payment_period_days, late_penalty_percent, changed_by_name, changed_at")
      .eq("client_id", client.id)
      .order("changed_at", { ascending: false }),
    supabase
      .from("credit_limit_history")
      .select("id, client_id, credit_limit_id, party_type, party_name, previous_limit_amount, new_limit_amount, discount_percent, payment_period_days, late_penalty_percent, changed_by_name, changed_at")
      .eq("client_id", client.id)
      .order("changed_at", { ascending: false }),
    supabase.rpc("get_my_workspace_messages", {
      p_client_id: client.id
    })
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

  if (featureModuleError) {
    console.warn("Feature modules could not be loaded:", featureModuleError.message);
  }

  if (creditLimitError) {
    console.warn("Credit limits could not be loaded:", creditLimitError.message);
  }

  if (creditHistoryError) {
    console.warn("Credit limit history could not be loaded:", creditHistoryError.message);
  }

  if (messageError) {
    console.warn("Messages could not be loaded:", messageError.message);
  }

  const accounts = (accountRows || []).map(mapAccount);
  const accountByMembershipId = new Map(accounts.map((account) => [account.id, account]));

  return {
    client,
    accounts,
    invites: (inviteRows || []).map(mapInvite),
    featureModules: featureModuleError ? [] : (featureModuleRows || []).map(mapFeatureModule),
    activityLogs: activityError ? [] : (activityRows || []).map(mapActivityLog),
    creditLimits: creditLimitError ? undefined : (creditLimitRows || []).map((row) => mapCreditLimit(row, accountByMembershipId)),
    creditLimitHistory: creditHistoryError ? undefined : (creditHistoryRows || []).map(mapCreditLimitHistory),
    messages: messageError ? [] : (messageRows || []).map(mapWorkspaceMessage)
  };
}

export async function loadWorkspaceFeatureModules(clientId) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("platform_feature_modules")
    .select("id, client_id, module_key, enabled, updated_at")
    .eq("client_id", clientId);

  if (error) throw new Error(error.message);

  return (data || []).map(mapFeatureModule);
}

export async function loadPlatformOverview() {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  let { data, error } = await supabase.rpc("get_platform_console");

  if (error && isSchemaCacheError(error, "get_platform_console")) {
    const legacyResult = await supabase.rpc("get_platform_overview");
    data = legacyResult.data;
    error = legacyResult.error;
  }

  if (error) {
    const message = String(error.message || "");
    if (message.includes("get_platform") || error.code === "PGRST202") {
      const setupError = new Error("Platform console setup is not installed. Run the updated Supabase schema.");
      setupError.code = "platform_admin_setup_required";
      throw setupError;
    }

    const platformError = new Error(error.message);
    platformError.code = "platform_admin_required";
    throw platformError;
  }

  return normalizePlatformConsole(data);
}

export async function tryLoadPlatformOverview() {
  try {
    return await loadPlatformOverview();
  } catch {
    return null;
  }
}

async function invokePlatformAdmin(action, payload = {}) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("platform-admin", {
    body: {
      action,
      payload
    }
  });

  if (error) {
    throw new Error(await edgeFunctionErrorMessage(error, "The platform admin request could not be completed."));
  }

  if (data?.error) {
    throw new Error(friendlyEdgeFunctionMessage(data.error));
  }

  return data;
}

export async function provisionPlatformClient(payload) {
  await invokePlatformAdmin("provision-client", payload);
  return loadPlatformOverview();
}

export async function updatePlatformAccount(payload) {
  await invokePlatformAdmin("update-user", payload);
  return loadPlatformOverview();
}

export async function updatePlatformConfiguration(payload) {
  await invokePlatformAdmin("update-config", payload);
  return loadPlatformOverview();
}

export async function recordPlatformIntervention(payload) {
  await invokePlatformAdmin("record-intervention", payload);
  return loadPlatformOverview();
}

export async function triggerPlatformJob(payload) {
  await invokePlatformAdmin("trigger-job", payload);
  return loadPlatformOverview();
}

export async function exportPlatformClientData(payload) {
  const data = await invokePlatformAdmin("export-client-data", payload);

  return data.export || {};
}

export async function createWorkspace(payload) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const currency = CURRENCY_OPTIONS.find((item) => item.value === payload.currency) || CURRENCY_OPTIONS[0];
  let { data, error } = await supabase.rpc("create_client_workspace", {
    p_company_name: payload.companyName.trim(),
    p_logo_data_url: payload.logoDataUrl || "",
    p_brand_color: payload.brandColor || "#0B1F3A",
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
      brand_color: payload.brandColor || "#0B1F3A",
      timezone: payload.timezone,
      currency: currency.value,
      currency_symbol: currency.symbol,
      credit_limit_email_enabled: payload.creditLimitEmailEnabled === true,
      credit_limit_sms_enabled: payload.creditLimitSmsEnabled === true
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

export async function deleteWorkspace({ clientId }) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const { error } = await supabase
    .from("clients")
    .delete()
    .eq("id", clientId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateMyMembershipProfile({ clientId, name }) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const { error } = await supabase.rpc("update_my_membership_profile", {
    p_client_id: clientId,
    p_name: name.trim()
  });

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

export async function inviteAccount({ client, name, email, phoneNumber, role }) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const normalizedEmail = email.trim().toLowerCase();
  const { data, error } = await supabase.functions.invoke("invite-user", {
    body: {
      clientId: client.id,
      name: name.trim(),
      email: normalizedEmail,
      phoneNumber: String(phoneNumber || "").trim(),
      role
    }
  });

  if (error) {
    throw new Error(await edgeFunctionErrorMessage(error, "The team member could not be created."));
  }

  if (data?.error) {
    throw new Error(friendlyEdgeFunctionMessage(data.error));
  }

  await recordWorkspaceActivity({
    clientId: client.id,
    actionType: "invited",
    recordType: "account",
    recordLabel: normalizedEmail,
    summary: `Created temporary access for ${name.trim()}`
  });

  const workspace = await loadWorkspace();
  const temporaryPassword = data?.temporaryPassword || "";

  if (!temporaryPassword) {
    throw new Error("The invite service did not return a temporary password. Deploy the updated invite-user function, then try again.");
  }

  return {
    ...workspace,
    accounts: workspace.accounts.map((account) => (
      account.email === normalizedEmail
        ? { ...account, temporaryPassword }
        : account
    )),
    invites: workspace.invites.map((invite) => (
      invite.to === normalizedEmail
        ? { ...invite, temporaryPassword, status: "ready" }
        : invite
    ))
  };
}

export async function saveRepresentativeCreditLimit(payload) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("credit-limit-notification", {
    body: payload
  });

  if (error) {
    throw new Error(await edgeFunctionErrorMessage(error, "The credit-limit email could not be sent."));
  }

  if (data?.error) {
    throw new Error(friendlyEdgeFunctionMessage(data.error, "The credit-limit email could not be sent."));
  }

  return data;
}

export async function activateCurrentMembership(clientId, newPassword) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const { error } = await supabase.rpc("activate_my_membership", {
    p_client_id: clientId,
    p_new_password: newPassword
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

function workspaceMessageError(error) {
  const message = String(error?.message || "");

  if (message.includes("workspace_message") || message.includes("get_my_workspace_messages")) {
    return new Error("Messaging is not installed in Supabase yet. Run the updated supabase/schema.sql, then try again.");
  }

  return error instanceof Error ? error : new Error("The message could not be sent.");
}

export async function sendWorkspaceMessage({ clientId, recipientAccountId, sendToAllStaff, body }) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const { error } = await supabase.rpc("send_workspace_message", {
    p_client_id: clientId,
    p_body: String(body || "").trim(),
    p_recipient_membership_id: sendToAllStaff ? null : recipientAccountId,
    p_audience: sendToAllStaff ? "all_staff" : "direct"
  });

  if (error) throw workspaceMessageError(error);

  return loadWorkspace();
}

export async function markWorkspaceConversationRead({ clientId, peerAccountId }) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const { error } = await supabase.rpc("mark_my_workspace_conversation_read", {
    p_client_id: clientId,
    p_peer_membership_id: peerAccountId
  });

  if (error) throw workspaceMessageError(error);
}
