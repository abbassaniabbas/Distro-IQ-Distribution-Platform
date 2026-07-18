import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Backend configuration error: factory deletion is not configured" }, 500);
  }

  let payload: { clientId?: string; confirmationName?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Request error: factory details could not be read" }, 400);
  }

  const clientId = String(payload?.clientId || "").trim();
  const confirmationName = String(payload?.confirmationName || "").trim();
  if (!uuidPattern.test(clientId) || !confirmationName) {
    return jsonResponse({ error: "Validation error: enter the factory name exactly" }, 400);
  }

  const authorization = req.headers.get("Authorization") || "";
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } }
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  const callerUserId = callerData.user?.id;
  if (callerError || !callerUserId) {
    return jsonResponse({ error: "Authentication error: sign in again before deleting the factory" }, 401);
  }

  const { data: callerMembership, error: callerMembershipError } = await adminClient
    .from("memberships")
    .select("id, role, status, password_reset_required")
    .eq("client_id", clientId)
    .eq("user_id", callerUserId)
    .maybeSingle();

  if (callerMembershipError) {
    return jsonResponse({ error: "Database error: CEO access could not be verified" }, 500);
  }
  if (
    !callerMembership ||
    callerMembership.role !== "ceo" ||
    callerMembership.status !== "active" ||
    callerMembership.password_reset_required
  ) {
    return jsonResponse({ error: "Authorization error: only the active CEO can delete this factory" }, 403);
  }

  const { data: factory, error: factoryError } = await adminClient
    .from("clients")
    .select("id, company_name")
    .eq("id", clientId)
    .maybeSingle();

  if (factoryError) return jsonResponse({ error: "Database error: the factory could not be read" }, 500);
  if (!factory) return jsonResponse({ error: "Database error: factory not found" }, 404);
  if (confirmationName !== String(factory.company_name || "").trim()) {
    return jsonResponse({ error: "Validation error: enter the factory name exactly" }, 400);
  }

  const { data: memberships, error: membershipsError } = await adminClient
    .from("memberships")
    .select("user_id")
    .eq("client_id", clientId);

  if (membershipsError) {
    return jsonResponse({ error: "Database error: linked staff accounts could not be read" }, 500);
  }

  const linkedUserIds = [...new Set((memberships || [])
    .map((membership) => String(membership.user_id || ""))
    .filter((userId) => uuidPattern.test(userId)))];

  let sharedUserIds = new Set<string>();
  if (linkedUserIds.length) {
    const { data: otherMemberships, error: otherMembershipsError } = await adminClient
      .from("memberships")
      .select("user_id")
      .in("user_id", linkedUserIds)
      .neq("client_id", clientId);

    if (otherMembershipsError) {
      return jsonResponse({ error: "Database error: shared company access could not be checked" }, 500);
    }
    sharedUserIds = new Set((otherMemberships || []).map((membership) => String(membership.user_id || "")));
  }

  if (linkedUserIds.length) {
    const { data: platformAdmins, error: platformAdminsError } = await adminClient
      .from("platform_admins")
      .select("user_id")
      .in("user_id", linkedUserIds);

    if (platformAdminsError) {
      return jsonResponse({ error: "Database error: protected platform access could not be checked" }, 500);
    }
    (platformAdmins || []).forEach((platformAdmin) => sharedUserIds.add(String(platformAdmin.user_id || "")));
  }

  const authenticationUsersToDelete = linkedUserIds
    .filter((userId) => !sharedUserIds.has(userId))
    .sort((left, right) => Number(left === callerUserId) - Number(right === callerUserId));

  const { error: deleteFactoryError } = await adminClient
    .from("clients")
    .delete()
    .eq("id", clientId);

  if (deleteFactoryError) {
    return jsonResponse({ error: "Database error: the factory and its records could not be deleted" }, 500);
  }

  const failedAuthenticationDeletes: string[] = [];
  for (const userId of authenticationUsersToDelete) {
    let { error } = await adminClient.auth.admin.deleteUser(userId);
    if (error) ({ error } = await adminClient.auth.admin.deleteUser(userId));
    if (error) failedAuthenticationDeletes.push(userId);
  }

  return jsonResponse({
    ok: true,
    deletedMemberships: memberships?.length || 0,
    deletedAuthenticationUsers: authenticationUsersToDelete.length - failedAuthenticationDeletes.length,
    preservedSharedAuthenticationUsers: sharedUserIds.size,
    authenticationCleanupComplete: failedAuthenticationDeletes.length === 0,
    failedAuthenticationDeletes: failedAuthenticationDeletes.length
  });
});
