import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type InvitePayload = {
  clientId: string;
  name: string;
  email: string;
  role: "sales_rep" | "manager" | "store_keeper" | "accountant" | "ceo";
  redirectTo?: string;
};

const validRoles = new Set([
  "sales_rep",
  "manager",
  "store_keeper",
  "accountant",
  "ceo"
]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const body = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");

  return `Distro-${body}!`;
}

async function cleanupPartialInvite(adminClient: any, userId?: string, membershipId?: string) {
  if (membershipId) {
    await adminClient.from("invites").delete().eq("membership_id", membershipId);
    await adminClient.from("memberships").delete().eq("id", membershipId);
  }

  if (userId) {
    await adminClient.auth.admin.deleteUser(userId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase function environment is not configured" }, 500);
  }

  const authorization = req.headers.get("Authorization") || "";
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: authorization
      }
    }
  });

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  let payload: InvitePayload;

  try {
    payload = (await req.json()) as InvitePayload;
  } catch {
    return jsonResponse({ error: "Invite details could not be read" }, 400);
  }

  const normalizedEmail = payload.email?.trim().toLowerCase();
  const displayName = payload.name?.trim();
  const missingFields = [
    !payload.clientId && "client ID",
    !displayName && "full name",
    !normalizedEmail && "email",
    !payload.role && "role"
  ].filter(Boolean);

  if (missingFields.length) {
    return jsonResponse({ error: `Missing invite fields: ${missingFields.join(", ")}` }, 400);
  }

  if (!validRoles.has(payload.role)) {
    return jsonResponse({ error: "Choose a valid role" }, 400);
  }

  const { data: allowed, error: roleError } = await callerClient.rpc("is_client_admin", {
    p_client_id: payload.clientId
  });

  if (roleError || !allowed) {
    return jsonResponse({ error: "Only CEOs and Managers can invite users" }, 403);
  }

  const { data: existingMembership, error: existingMembershipError } = await adminClient
    .from("memberships")
    .select("id")
    .eq("client_id", payload.clientId)
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (existingMembershipError) {
    return jsonResponse({ error: existingMembershipError.message }, 400);
  }

  if (existingMembership) {
    return jsonResponse({ error: "This email is already invited for this company" }, 409);
  }

  const temporaryPassword = generateTemporaryPassword();
  const { data: userData, error: createUserError } = await adminClient.auth.admin.createUser({
    email: normalizedEmail,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: {
      full_name: displayName,
      client_id: payload.clientId,
      role: payload.role
    }
  });

  if (createUserError) {
    const status = createUserError.message.toLowerCase().includes("already") ? 409 : 400;
    return jsonResponse({ error: createUserError.message }, status);
  }

  const { data: callerData } = await callerClient.auth.getUser();
  const invitedUserId = userData.user?.id;

  if (!invitedUserId) {
    return jsonResponse({ error: "Could not create login access" }, 500);
  }

  const { data: membership, error: membershipError } = await adminClient
    .from("memberships")
    .insert({
      client_id: payload.clientId,
      user_id: invitedUserId,
      email: normalizedEmail,
      name: displayName,
      role: payload.role,
      status: "invited",
      password_reset_required: true
    })
    .select("id")
    .single();

  if (membershipError) {
    await cleanupPartialInvite(adminClient, invitedUserId);
    return jsonResponse({ error: membershipError.message }, 400);
  }

  const { error: inviteInsertError } = await adminClient.from("invites").insert({
    client_id: payload.clientId,
    membership_id: membership.id,
    email: normalizedEmail,
    name: displayName,
    role: payload.role,
    subject: `You're invited to DistroIQ`,
    redirect_to: "",
    status: "ready",
    invited_by: callerData.user?.id
  });

  if (inviteInsertError) {
    await cleanupPartialInvite(adminClient, invitedUserId, membership.id);
    return jsonResponse({ error: inviteInsertError.message }, 400);
  }

  return jsonResponse({
    ok: true,
    userId: invitedUserId,
    membershipId: membership.id,
    temporaryPassword,
    temporaryPasswordCreated: true
  });
});
