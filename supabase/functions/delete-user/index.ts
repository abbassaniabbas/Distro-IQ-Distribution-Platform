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
    return jsonResponse({ error: "Supabase function environment is not configured" }, 500);
  }

  let payload: { clientId?: string; membershipId?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Account details could not be read" }, 400);
  }

  const clientId = String(payload?.clientId || "").trim();
  const membershipId = String(payload?.membershipId || "").trim();
  if (!uuidPattern.test(clientId) || !uuidPattern.test(membershipId)) {
    return jsonResponse({ error: "Choose a valid staff account" }, 400);
  }

  const authorization = req.headers.get("Authorization") || "";
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } }
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  const callerUserId = callerData.user?.id;
  if (callerError || !callerUserId) return jsonResponse({ error: "Authentication required" }, 401);

  const { data: callerMembership, error: callerMembershipError } = await adminClient
    .from("memberships")
    .select("id, name, email, role, status, password_reset_required")
    .eq("client_id", clientId)
    .eq("user_id", callerUserId)
    .maybeSingle();

  if (callerMembershipError) return jsonResponse({ error: "CEO access could not be verified" }, 500);
  if (
    !callerMembership ||
    callerMembership.role !== "ceo" ||
    callerMembership.status !== "active" ||
    callerMembership.password_reset_required
  ) {
    return jsonResponse({ error: "Only the active CEO can delete staff accounts" }, 403);
  }

  const { data: target, error: targetError } = await adminClient
    .from("memberships")
    .select("id, user_id, name, email, role")
    .eq("client_id", clientId)
    .eq("id", membershipId)
    .maybeSingle();

  if (targetError) return jsonResponse({ error: "The staff account could not be read" }, 500);
  if (!target) return jsonResponse({ error: "Staff account not found" }, 404);
  if (target.user_id === callerUserId) return jsonResponse({ error: "You cannot delete the account you are using" }, 400);
  if (["ceo", "manager"].includes(target.role)) return jsonResponse({ error: "A CEO account cannot be deleted here" }, 400);

  const { error: inviteByMembershipError } = await adminClient
    .from("invites")
    .delete()
    .eq("client_id", clientId)
    .eq("membership_id", membershipId);
  if (inviteByMembershipError) return jsonResponse({ error: "The staff invitation could not be removed" }, 500);

  const { error: inviteByEmailError } = await adminClient
    .from("invites")
    .delete()
    .eq("client_id", clientId)
    .eq("email", target.email);
  if (inviteByEmailError) return jsonResponse({ error: "The staff invitation could not be removed" }, 500);

  if (target.user_id) {
    const { data: otherMemberships, error: otherMembershipsError } = await adminClient
      .from("memberships")
      .select("id")
      .eq("user_id", target.user_id)
      .neq("id", membershipId)
      .limit(1);
    if (otherMembershipsError) return jsonResponse({ error: "Linked company access could not be checked" }, 500);

    if (otherMemberships?.length) {
      const { error } = await adminClient.from("memberships").delete().eq("id", membershipId).eq("client_id", clientId);
      if (error) return jsonResponse({ error: "The staff membership could not be deleted" }, 500);
    } else {
      const { error } = await adminClient.auth.admin.deleteUser(target.user_id);
      if (error) return jsonResponse({ error: "The staff login could not be deleted" }, 500);
    }
  } else {
    const { error } = await adminClient.from("memberships").delete().eq("id", membershipId).eq("client_id", clientId);
    if (error) return jsonResponse({ error: "The staff membership could not be deleted" }, 500);
  }

  await adminClient.from("activity_logs").insert({
    client_id: clientId,
    action_type: "deleted",
    record_type: "account",
    record_label: target.email,
    actor_user_id: callerUserId,
    actor_name: callerMembership.name,
    actor_email: callerMembership.email,
    summary: `Deleted staff account for ${target.name}`
  });

  return jsonResponse({ ok: true, membershipId });
});
