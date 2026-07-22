import { CURRENCY_OPTIONS } from "./tenant.js";
import { getSupabaseClient, isBackendConfigured } from "./supabase-client.js";
import { classifyAppFailure } from "./error-classification.js";

const CLIENT_SELECT_WITH_BRAND = "id, client_id, role, status, password_reset_required, clients(id, company_name, logo_data_url, brand_color, timezone, currency, currency_symbol, credit_limit_email_enabled, credit_limit_sms_enabled, sku_format, invoice_format, packaging_types, packaging_defaults, created_at)";
const CLIENT_SELECT_LEGACY = "id, client_id, role, status, password_reset_required, clients(id, company_name, logo_data_url, timezone, currency, currency_symbol, created_at)";
const ACCOUNT_SELECT_WITH_IMAGE = "id, client_id, user_id, email, phone_number, staff_image_url, name, role, status, password_reset_required, created_at";
const ACCOUNT_SELECT_LEGACY = "id, client_id, user_id, email, phone_number, name, role, status, password_reset_required, created_at";

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
    skuFormat: row.sku_format || "SKU-{0000}",
    invoiceFormat: row.invoice_format || "INV-{0000}",
    packagingTypes: Array.isArray(row.packaging_types) ? row.packaging_types : ["piece"],
    packagingDefaults: row.packaging_defaults && typeof row.packaging_defaults === "object" ? row.packaging_defaults : { piece: 1 },
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
    staffImageUrl: row.staff_image_url || "",
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

function mapPackagingChangeRequest(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    requestedByUserId: row.requested_by_user_id || "",
    requestedBy: row.requested_by_name || "Store Keeper",
    packagingTypes: Array.isArray(row.packaging_types) ? row.packaging_types : ["piece"],
    packagingDefaults: row.packaging_defaults && typeof row.packaging_defaults === "object" ? row.packaging_defaults : { piece: 1 },
    status: row.status || "pending",
    reviewNote: row.review_note || "",
    reviewedBy: row.reviewed_by_name || "",
    requestedAt: row.requested_at,
    reviewedAt: row.reviewed_at || ""
  };
}

function mapSharedProductImage(row) {
  return {
    productId: String(row.sku || ""),
    imageUrl: String(row.image_url || ""),
    remoteSynced: true
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
    changedBy: row.changed_by_name || "CEO",
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
    changedBy: row.changed_by_name || "CEO",
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

function sharedImageFailure(error, fallback) {
  const failure = classifyAppFailure({ error, configured: isBackendConfigured() });
  return new Error(`${failure.label}: ${fallback}${failure.detail ? ` ${failure.detail}` : ""}`);
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

export function friendlyEdgeFunctionMessage(
  message,
  fallback = "The request could not be completed.",
  { serviceLabel = "backend service", online } = {}
) {
  const raw = String(message || "").trim();
  const lower = raw.toLowerCase();
  const isOnline = typeof online === "boolean"
    ? online
    : (typeof navigator === "undefined" || navigator.onLine !== false);

  if (!raw) {
    return fallback;
  }

  if (lower.includes("requested function was not found") || lower.includes("function not found") || lower.includes("not_found")) {
    return `Backend deployment error: The ${serviceLabel} is not deployed in Supabase.`;
  }

  if (lower.includes("failed to send a request") || lower.includes("failed to fetch")) {
    return isOnline
      ? `Backend error: The ${serviceLabel} could not be reached. Check its Supabase deployment and try again.`
      : "Network error: Check your internet connection and try again.";
  }

  if (lower === "missing invite fields" || lower.includes("redirectto")) {
    return "The invite service on Supabase is outdated. Deploy the updated invite-user function, then try again.";
  }

  if (lower.includes("only managers can invite users") || lower.includes("only ceos and managers can invite users")) {
    return "Only the active CEO can add team members for this company.";
  }

  if (lower.includes("supabase function environment")) {
    return `Backend configuration error: The ${serviceLabel} is missing its Supabase environment settings.`;
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

async function edgeFunctionErrorMessage(error, fallback, options) {
  const functionMessage = await readEdgeFunctionError(error);
  return friendlyEdgeFunctionMessage(functionMessage || error?.message, fallback, options);
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

  if (!["brand_color", "sku_format", "invoice_format", "packaging_types", "packaging_defaults"].some((field) => isSchemaCacheError(result.error, field))) {
    return result;
  }

  return query(CLIENT_SELECT_LEGACY);
}

async function loadWorkspaceAccountRows(supabase, clientId) {
  const query = (selectList) => supabase
    .from("memberships")
    .select(selectList)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  const result = await query(ACCOUNT_SELECT_WITH_IMAGE);
  if (!result.error || !isSchemaCacheError(result.error, "staff_image_url")) return result;

  // Older workspaces can open while the optional staff-image migration is
  // pending. Accounts simply render without a photo until the column exists.
  return query(ACCOUNT_SELECT_LEGACY);
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
    { data: packagingRequestRows, error: packagingRequestError },
    { data: messageRows, error: messageError },
    { data: productImageRows, error: productImageError },
    { data: operationalActivityCollectionRows, error: operationalActivityCollectionError },
    { data: operationalActivityRows, error: operationalActivityError }
  ] = await Promise.all([
    loadWorkspaceAccountRows(supabase, client.id),
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
    supabase
      .from("packaging_change_requests")
      .select("id, client_id, requested_by_user_id, requested_by_name, packaging_types, packaging_defaults, status, review_note, reviewed_by_name, requested_at, reviewed_at")
      .eq("client_id", client.id)
      .order("requested_at", { ascending: false }),
    supabase.rpc("get_my_workspace_messages", {
      p_client_id: client.id
    }),
    supabase
      .from("stock_products")
      .select("sku, image_url")
      .eq("client_id", client.id),
    supabase
      .from("workspace_operational_collections")
      .select("collection_name")
      .eq("client_id", client.id)
      .eq("collection_name", "activityLogs"),
    supabase
      .from("workspace_operational_records")
      .select("record_data, updated_at")
      .eq("client_id", client.id)
      .eq("collection_name", "activityLogs")
      .order("updated_at", { ascending: false })
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

  if (packagingRequestError) {
    console.warn("Packaging approval requests could not be loaded:", packagingRequestError.message);
  }

  if (messageError) {
    console.warn("Messages could not be loaded:", messageError.message);
  }

  if (productImageError) {
    console.warn("Shared stock pictures could not be loaded:", productImageError.message);
  }

  const operationalActivityInitialized = !operationalActivityCollectionError && Boolean(operationalActivityCollectionRows?.length);
  if (operationalActivityInitialized && operationalActivityError) {
    console.warn("Synchronized activity records could not be loaded:", operationalActivityError.message);
  }

  const accounts = (accountRows || []).map(mapAccount);
  const accountByMembershipId = new Map(accounts.map((account) => [account.id, account]));

  return {
    client,
    accounts,
    invites: (inviteRows || []).map(mapInvite),
    featureModules: featureModuleError ? [] : (featureModuleRows || []).map(mapFeatureModule),
    activityLogs: operationalActivityInitialized
      ? (operationalActivityError ? [] : (operationalActivityRows || []).map((row) => row.record_data).filter(Boolean))
      : (activityError ? [] : (activityRows || []).map(mapActivityLog)),
    creditLimits: creditLimitError ? undefined : (creditLimitRows || []).map((row) => mapCreditLimit(row, accountByMembershipId)),
    creditLimitHistory: creditHistoryError ? undefined : (creditHistoryRows || []).map(mapCreditLimitHistory),
    packagingChangeRequests: packagingRequestError ? undefined : (packagingRequestRows || []).map(mapPackagingChangeRequest),
    messages: messageError ? [] : (messageRows || []).map(mapWorkspaceMessage),
    productImages: productImageError ? undefined : (productImageRows || []).map(mapSharedProductImage)
  };
}

export async function loadSharedProductImages(clientId) {
  throwIfBackendMissing();
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("stock_products")
    .select("sku, image_url")
    .eq("client_id", clientId);

  if (error) throw sharedImageFailure(error, "Shared stock pictures could not be loaded.");
  return (data || []).map(mapSharedProductImage);
}

export async function loadOperationalWorkspace(clientId) {
  throwIfBackendMissing();
  const supabase = await getSupabaseClient();
  const [recordsResult, collectionsResult] = await Promise.all([
    supabase
      .from("workspace_operational_records")
      .select("collection_name, record_id, record_data, updated_at")
      .eq("client_id", clientId),
    supabase
      .from("workspace_operational_collections")
      .select("collection_name, updated_at")
      .eq("client_id", clientId)
  ]);

  if (recordsResult.error) {
    throw new Error(`${classifyAppFailure({ error: recordsResult.error, configured: true }).label}: Operational records could not be loaded. ${recordsResult.error.message}`);
  }
  if (collectionsResult.error) {
    throw new Error(`${classifyAppFailure({ error: collectionsResult.error, configured: true }).label}: Operational collection status could not be loaded. ${collectionsResult.error.message}`);
  }

  return {
    records: (recordsResult.data || []).map((row) => ({
      collection: String(row.collection_name || ""),
      id: String(row.record_id || ""),
      data: row.record_data && typeof row.record_data === "object" ? row.record_data : {},
      updatedAt: row.updated_at || ""
    })),
    initializedCollections: (collectionsResult.data || []).map((row) => String(row.collection_name || "")).filter(Boolean)
  };
}

export async function syncOperationalWorkspace({ clientId, operationId, actionType, records = [], deleted = [], touchedCollections = [] }) {
  throwIfBackendMissing();
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.rpc("sync_workspace_operational_records", {
    p_client_id: clientId,
    p_operation_id: operationId,
    p_action_type: actionType,
    p_records: records,
    p_deleted: deleted,
    p_touched_collections: touchedCollections
  });

  if (error) {
    const failure = classifyAppFailure({ error, configured: true });
    throw new Error(`${failure.label}: Operational changes could not be saved. ${error.message}`);
  }

  return data || {};
}

export async function resetWorkspaceData({ clientId, scope }) {
  throwIfBackendMissing();
  const supportedScopes = new Set(["adjustments", "customers", "finance", "activity", "factory"]);
  const normalizedScope = String(scope || "").trim().toLowerCase();
  if (!clientId || !supportedScopes.has(normalizedScope)) {
    throw new Error("Choose a valid company data reset option.");
  }

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.rpc("reset_workspace_data", {
    p_client_id: clientId,
    p_scope: normalizedScope
  });

  if (error) {
    const failure = classifyAppFailure({ error, configured: true });
    throw new Error(`${failure.label}: Company data could not be cleared. ${error.message}`);
  }

  return data || { scope: normalizedScope };
}

export async function saveSharedProductImage({ clientId, sku, previousSku = "", name, unit = "piece", status = "active", imageUrl = "" }) {
  throwIfBackendMissing();
  const supabase = await getSupabaseClient();
  const candidateSkus = [...new Set([previousSku, sku].map((value) => String(value || "").trim()).filter(Boolean))];
  const { data: existingRows, error: readError } = await supabase
    .from("stock_products")
    .select("id, sku")
    .eq("client_id", clientId)
    .in("sku", candidateSkus);

  if (readError) throw sharedImageFailure(readError, "The shared stock picture record could not be checked.");

  const existingRow = (existingRows || []).find((row) => row.sku === previousSku) || existingRows?.[0];
  const expectedImageUrl = String(imageUrl || "");
  const verifySavedRow = (row) => {
    if (!row || String(row.sku || "") !== String(sku) || String(row.image_url || "") !== expectedImageUrl) {
      throw new Error("Database error: The stock picture was not confirmed after saving.");
    }
    return mapSharedProductImage(row);
  };

  if (existingRow) {
    const { data: savedRow, error } = await supabase
      .from("stock_products")
      .update({
        sku: String(sku),
        name: String(name || sku),
        unit: String(unit || "piece"),
        status: String(status || "active"),
        image_url: expectedImageUrl,
        updated_at: new Date().toISOString()
      })
      .eq("id", existingRow.id)
      .eq("client_id", clientId)
      .select("sku, image_url")
      .single();
    if (error) throw sharedImageFailure(error, "The stock picture could not be shared.");
    return verifySavedRow(savedRow);
  }

  const { data: savedRow, error } = await supabase
    .from("stock_products")
    .insert({
      client_id: clientId,
      sku: String(sku),
      name: String(name || sku),
      unit: String(unit || "piece"),
      status: String(status || "active"),
      image_url: expectedImageUrl
    })
    .select("sku, image_url")
    .single();

  if (error) {
    if (String(error.code || "") === "23505") {
      const { data: retryRow, error: retryError } = await supabase
        .from("stock_products")
        .update({ image_url: expectedImageUrl, name: String(name || sku), updated_at: new Date().toISOString() })
        .eq("client_id", clientId)
        .eq("sku", String(sku))
        .select("sku, image_url")
        .single();
      if (!retryError) return verifySavedRow(retryRow);
    }
    throw sharedImageFailure(error, "The stock picture could not be shared.");
  }

  return verifySavedRow(savedRow);
}

export async function purgeSharedProductImages({ clientId, skus = [] }) {
  throwIfBackendMissing();
  const normalizedSkus = [...new Set(
    (Array.isArray(skus) ? skus : [skus])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
  if (!clientId || !normalizedSkus.length) return { cleared: 0, deleted: 0 };

  const supabase = await getSupabaseClient();
  const { error: clearError } = await supabase
    .from("stock_products")
    .update({ image_url: "", updated_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .in("sku", normalizedSkus);

  if (clearError) {
    throw sharedImageFailure(clearError, "The past stock picture data could not be cleared.");
  }

  const { data: deletedRows, error: deleteError } = await supabase
    .from("stock_products")
    .delete()
    .eq("client_id", clientId)
    .in("sku", normalizedSkus)
    .select("sku");

  // Older installations did not grant DELETE on this compatibility table,
  // and legacy foreign keys can retain its non-image product shell. The
  // image data has already been erased above, so neither condition may revive
  // a deleted stock picture when its SKU is reused.
  if (deleteError && !["23503", "42501"].includes(String(deleteError.code || ""))) {
    throw sharedImageFailure(deleteError, "The past stock picture record could not be deleted.");
  }

  return {
    cleared: normalizedSkus.length,
    deleted: Array.isArray(deletedRows) ? deletedRows.length : 0
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
    throw new Error(await edgeFunctionErrorMessage(error, "The platform admin request could not be completed.", { serviceLabel: "platform administration service" }));
  }

  if (data?.error) {
    throw new Error(friendlyEdgeFunctionMessage(data.error, undefined, { serviceLabel: "platform administration service" }));
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
      credit_limit_sms_enabled: payload.creditLimitSmsEnabled === true,
      sku_format: payload.skuFormat || "SKU-{0000}",
      invoice_format: payload.invoiceFormat || "INV-{0000}"
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

export async function updatePackagingSettings({ clientId, packagingTypes, packagingDefaults }) {
  throwIfBackendMissing();
  const supabase = await getSupabaseClient();
  const { error } = await supabase.rpc("update_packaging_settings", {
    p_client_id: clientId,
    p_packaging_types: packagingTypes,
    p_packaging_defaults: packagingDefaults
  });
  if (error) throw new Error(error.message);

  const { data: savedSettings, error: confirmationError } = await supabase
    .from("clients")
    .select("packaging_types, packaging_defaults")
    .eq("id", clientId)
    .single();

  if (confirmationError) {
    console.warn("Saved packaging settings could not be reloaded:", confirmationError.message);
  }

  await recordWorkspaceActivity({
    clientId,
    actionType: "updated",
    recordType: "company",
    recordLabel: "Sales packaging",
    summary: "Updated factory packaging options"
  });

  return {
    packagingTypes: Array.isArray(savedSettings?.packaging_types)
      ? savedSettings.packaging_types
      : packagingTypes,
    packagingDefaults: savedSettings?.packaging_defaults && typeof savedSettings.packaging_defaults === "object"
      ? savedSettings.packaging_defaults
      : packagingDefaults
  };
}

export async function requestPackagingSettingsChange({ clientId, packagingTypes, packagingDefaults }) {
  throwIfBackendMissing();
  const supabase = await getSupabaseClient();
  const { error } = await supabase.rpc("request_packaging_settings_change", {
    p_client_id: clientId,
    p_packaging_types: packagingTypes,
    p_packaging_defaults: packagingDefaults
  });
  if (error) throw new Error(error.message);
  return loadWorkspace();
}

export async function reviewPackagingSettingsChange({ clientId, requestId, decision, note = "" }) {
  throwIfBackendMissing();
  const supabase = await getSupabaseClient();
  const { error } = await supabase.rpc("review_packaging_settings_change", {
    p_client_id: clientId,
    p_request_id: requestId,
    p_decision: decision,
    p_review_note: note
  });
  if (error) throw new Error(error.message);
  return loadWorkspace();
}

export async function deleteWorkspace({ clientId, confirmationName }) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("delete-workspace", {
    body: { clientId, confirmationName }
  });

  if (error) {
    const functionMessage = await readEdgeFunctionError(error);
    const rawMessage = String(functionMessage || error.message || "").trim();
    const lowerMessage = rawMessage.toLowerCase();
    if (lowerMessage.includes("failed to send a request") || lowerMessage.includes("failed to fetch")) {
      throw new Error("Network error: the factory deletion service could not be reached. Check your connection and try again.");
    }
    throw new Error(rawMessage || "Backend error: the factory could not be deleted.");
  }
  if (data?.error) {
    throw new Error(String(data.error));
  }

  return data;
}

export async function updateMyMembershipProfile({ clientId, name, phoneNumber, staffImageUrl = "" }) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const { error } = await supabase.rpc("update_my_membership_profile", {
    p_client_id: clientId,
    p_name: name.trim(),
    p_phone_number: String(phoneNumber || "").trim(),
    p_staff_image_url: String(staffImageUrl || "")
  });

  if (error) {
    if (isSchemaCacheError(error, "update_my_membership_profile")) {
      throw new Error("Database setup error: the profile update function is outdated. Apply supabase/staff-image-column-migration.sql and try again.");
    }
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

export async function inviteAccount({ client, name, email, phoneNumber, role, staffImageUrl = "" }) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const normalizedEmail = email.trim().toLowerCase();
  const inviteBody = {
    clientId: client.id,
    name: name.trim(),
    email: normalizedEmail,
    phoneNumber: String(phoneNumber || "").trim(),
    role
  };
  let result = await supabase.functions.invoke("invite-user", { body: inviteBody });
  const isTransientFetchFailure = result.error && (
    result.error.name === "FunctionsFetchError" ||
    /failed to (send a request|fetch)/i.test(String(result.error.message || ""))
  );

  if (isTransientFetchFailure) {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 650));
    result = await supabase.functions.invoke("invite-user", { body: inviteBody });
  }

  const { data, error } = result;

  if (error) {
    throw new Error(await edgeFunctionErrorMessage(error, "The team member could not be created.", { serviceLabel: "staff invitation service" }));
  }

  if (data?.error) {
    throw new Error(friendlyEdgeFunctionMessage(data.error, undefined, { serviceLabel: "staff invitation service" }));
  }

  await recordWorkspaceActivity({
    clientId: client.id,
    actionType: "invited",
    recordType: "account",
    recordLabel: normalizedEmail,
    summary: `Created temporary access for ${name.trim()}`
  });

  let workspace = await loadWorkspace();
  const temporaryPassword = data?.temporaryPassword || "";

  if (!temporaryPassword) {
    throw new Error("The invite service did not return a temporary password. Deploy the updated invite-user function, then try again.");
  }

  let staffImageWarning = "";
  const createdAccount = workspace.accounts.find((account) => account.email === normalizedEmail);
  if (staffImageUrl && createdAccount?.id) {
    const { error: staffImageError } = await supabase.rpc("set_membership_staff_image", {
      p_client_id: client.id,
      p_membership_id: createdAccount.id,
      p_staff_image_url: String(staffImageUrl)
    });
    if (staffImageError) {
      staffImageWarning = "Staff access was created, but the profile image could not be saved.";
    } else {
      workspace = await loadWorkspace();
    }
  }

  return {
    ...workspace,
    staffImageWarning,
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

export async function setMembershipActiveStatus({ clientId, membershipId, active }) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const { error } = await supabase.rpc("set_membership_active_status", {
    p_client_id: clientId,
    p_membership_id: membershipId,
    p_active: Boolean(active)
  });

  if (error) {
    throw new Error(error.message);
  }

  await recordWorkspaceActivity({
    clientId,
    actionType: active ? "reactivated" : "deactivated",
    recordType: "account",
    recordLabel: membershipId,
    summary: active ? "Activated team account" : "Deactivated team account"
  });

  return loadWorkspace();
}

export async function setMembershipRole({ clientId, membershipId, role }) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const { error } = await supabase.rpc("set_membership_role", {
    p_client_id: clientId,
    p_membership_id: membershipId,
    p_role: role
  });

  if (error) {
    throw new Error(error.message);
  }

  await recordWorkspaceActivity({
    clientId,
    actionType: "updated",
    recordType: "account",
    recordLabel: membershipId,
    summary: `Changed staff role to ${role}`
  });

  return loadWorkspace();
}

export async function deleteMembershipAccount({ clientId, membershipId }) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("delete-user", {
    body: { clientId, membershipId }
  });

  if (error) {
    throw new Error(await edgeFunctionErrorMessage(error, "The staff account could not be deleted.", { serviceLabel: "staff account deletion service" }));
  }
  if (data?.error) {
    throw new Error(friendlyEdgeFunctionMessage(data.error, "The staff account could not be deleted.", { serviceLabel: "staff account deletion service" }));
  }

  return loadWorkspace();
}

export async function saveRepresentativeCreditLimit(payload) {
  throwIfBackendMissing();

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("credit-limit-notification", {
    body: payload
  });

  if (error) {
    throw new Error(await edgeFunctionErrorMessage(error, "The credit-limit email could not be sent.", { serviceLabel: "credit-limit notification service" }));
  }

  if (data?.error) {
    throw new Error(friendlyEdgeFunctionMessage(data.error, "The credit-limit email could not be sent.", { serviceLabel: "credit-limit notification service" }));
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
