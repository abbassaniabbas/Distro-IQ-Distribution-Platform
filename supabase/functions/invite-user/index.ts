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
  redirectTo: string;
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
  const payload = (await req.json()) as InvitePayload;
  const normalizedEmail = payload.email?.trim().toLowerCase();
  const displayName = payload.name?.trim();

  if (!payload.clientId || !displayName || !normalizedEmail || !payload.role || !payload.redirectTo) {
    return jsonResponse({ error: "Missing invite fields" }, 400);
  }

  if (!validRoles.has(payload.role)) {
    return jsonResponse({ error: "Choose a valid role" }, 400);
  }

  const { data: allowed, error: roleError } = await callerClient.rpc("is_client_admin", {
    p_client_id: payload.clientId
  });

  if (roleError || !allowed) {
    return jsonResponse({ error: "Only Managers can invite users" }, 403);
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
    return jsonResponse({ error: createUserError.message }, 400);
  }

  const { error: resetEmailError } = await adminClient.auth.resetPasswordForEmail(normalizedEmail, {
    redirectTo: payload.redirectTo
  });

  if (resetEmailError) {
    return jsonResponse({ error: resetEmailError.message }, 400);
  }

  const { data: callerData } = await callerClient.auth.getUser();
  const invitedUserId = userData.user?.id;

  const { data: membership, error: membershipError } = await adminClient
    .from("memberships")
    .upsert(
      {
        client_id: payload.clientId,
        user_id: invitedUserId,
        email: normalizedEmail,
        name: displayName,
        role: payload.role,
        status: "invited",
        password_reset_required: true
      },
      {
        onConflict: "client_id,email"
      }
    )
    .select("id")
    .single();

  if (membershipError) {
    return jsonResponse({ error: membershipError.message }, 400);
  }

  const { error: inviteInsertError } = await adminClient.from("invites").insert({
    client_id: payload.clientId,
    membership_id: membership.id,
    email: normalizedEmail,
    name: displayName,
    role: payload.role,
    subject: `You're invited to DistroIQ`,
    redirect_to: payload.redirectTo,
    status: "sent",
    invited_by: callerData.user?.id
  });

  if (inviteInsertError) {
    return jsonResponse({ error: inviteInsertError.message }, 400);
  }

  return jsonResponse({
    ok: true,
    userId: invitedUserId,
    membershipId: membership.id,
    temporaryPasswordCreated: true
  });
});
