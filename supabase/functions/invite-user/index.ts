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
  phoneNumber: string;
  role: "sales_rep" | "store_keeper" | "admin";
  redirectTo?: string;
};

const validRoles = new Set([
  "sales_rep",
  "store_keeper",
  "admin"
]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^[+0-9().\s-]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxRequestBytes = 16 * 1024;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

async function invitationFingerprint(payload: {
  clientId: string;
  displayName: string;
  normalizedEmail: string;
  phoneNumber: string;
  role: string;
}) {
  const canonicalRequest = JSON.stringify([
    payload.clientId,
    payload.displayName,
    payload.normalizedEmail,
    payload.phoneNumber,
    payload.role
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalRequest)
  );

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function generateTemporaryPassword(secret: string, fingerprint: string) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`distroiq-staff-invite-v1:${fingerprint}`)
  );
  const bytes = new Uint8Array(signature).slice(0, 18);
  const body = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");

  return `Distro-${body}7!`;
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function internalError(context: string, error: unknown) {
  console.error(`[invite-user] ${context}`, error);
  return jsonResponse({ error: "The team member could not be created" }, 500);
}

async function findAuthUserByEmail(adminClient: any, normalizedEmail: string) {
  const perPage = 1000;

  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });

    if (error) {
      return { user: null, error };
    }

    const users = data?.users || [];
    const user = users.find((candidate: any) => (
      String(candidate.email || "").trim().toLowerCase() === normalizedEmail
    ));

    if (user) {
      return { user, error: null };
    }

    if (users.length < perPage) {
      break;
    }
  }

  return { user: null, error: null };
}

function membershipMatchesRequest(membership: any, request: {
  displayName: string;
  normalizedEmail: string;
  phoneNumber: string;
  role: string;
}) {
  return membership?.status === "invited"
    && membership?.password_reset_required === true
    && cleanText(membership?.email).toLowerCase() === request.normalizedEmail
    && cleanText(membership?.name) === request.displayName
    && cleanText(membership?.phone_number).replace(/\s+/g, " ") === request.phoneNumber
    && cleanText(membership?.role) === request.role
    && Boolean(membership?.user_id);
}

async function ensureInviteRecord(adminClient: any, details: {
  clientId: string;
  membershipId: string;
  normalizedEmail: string;
  displayName: string;
  role: string;
  callerUserId: string;
}) {
  const { data: existingInvite, error: lookupError } = await adminClient
    .from("invites")
    .select("id")
    .eq("client_id", details.clientId)
    .eq("membership_id", details.membershipId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    return lookupError;
  }

  const inviteRecord = {
    email: details.normalizedEmail,
    name: details.displayName,
    role: details.role,
    subject: `You're invited to DistroIQ`,
    redirect_to: "",
    status: "ready"
  };

  if (existingInvite?.id) {
    const { error } = await adminClient
      .from("invites")
      .update(inviteRecord)
      .eq("id", existingInvite.id);

    return error;
  }

  const { error } = await adminClient.from("invites").insert({
    client_id: details.clientId,
    membership_id: details.membershipId,
    ...inviteRecord,
    invited_by: details.callerUserId
  });

  return error;
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
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return jsonResponse({ error: "Authentication required" }, 401);
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
    return jsonResponse({ error: "Invite details are too large" }, 413);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: authorization
      }
    }
  });

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: callerData, error: callerError } = await callerClient.auth.getUser();

  if (callerError || !callerData.user?.id) {
    return jsonResponse({ error: "Authentication required" }, 401);
  }
  const callerUserId = callerData.user.id;

  let payload: InvitePayload;

  try {
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > maxRequestBytes) {
      return jsonResponse({ error: "Invite details are too large" }, 413);
    }
    payload = JSON.parse(rawBody) as InvitePayload;
  } catch {
    return jsonResponse({ error: "Invite details could not be read" }, 400);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return jsonResponse({ error: "Invite details could not be read" }, 400);
  }

  const clientId = cleanText(payload.clientId);
  const normalizedEmail = cleanText(payload.email).toLowerCase();
  const displayName = cleanText(payload.name);
  const phoneNumber = cleanText(payload.phoneNumber).replace(/\s+/g, " ");
  const role = cleanText(payload.role);
  const missingFields = [
    !clientId && "client ID",
    !displayName && "full name",
    !normalizedEmail && "email",
    !phoneNumber && "phone number",
    !role && "role"
  ].filter(Boolean);

  if (missingFields.length) {
    return jsonResponse({ error: `Missing invite fields: ${missingFields.join(", ")}` }, 400);
  }

  if (!uuidPattern.test(clientId)) {
    return jsonResponse({ error: "Choose a valid company workspace" }, 400);
  }

  if (displayName.length < 2 || displayName.length > 120 || /[\u0000-\u001f\u007f]/.test(displayName)) {
    return jsonResponse({ error: "Full name must be between 2 and 120 characters" }, 400);
  }

  if (normalizedEmail.length > 254 || !emailPattern.test(normalizedEmail)) {
    return jsonResponse({ error: "Enter a valid email address" }, 400);
  }

  if (phoneNumber.length < 7 || phoneNumber.length > 32 || !phonePattern.test(phoneNumber)) {
    return jsonResponse({ error: "Enter a valid phone number" }, 400);
  }

  if (!validRoles.has(role)) {
    return jsonResponse({ error: "Choose a valid role" }, 400);
  }

  const { data: callerMembership, error: roleError } = await adminClient
    .from("memberships")
    .select("id, role, status, password_reset_required")
    .eq("client_id", clientId)
    .eq("user_id", callerUserId)
    .maybeSingle();

  if (roleError) {
    return internalError("caller membership lookup failed", roleError);
  }

  if (
    !callerMembership ||
    callerMembership.status !== "active" ||
    callerMembership.password_reset_required ||
    callerMembership.role !== "ceo"
  ) {
    return jsonResponse({ error: "Only the CEO can invite users" }, 403);
  }

  const { data: existingMembership, error: existingMembershipError } = await adminClient
    .from("memberships")
    .select("id, user_id, email, phone_number, name, role, status, password_reset_required")
    .eq("client_id", clientId)
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (existingMembershipError) {
    return internalError("existing membership lookup failed", existingMembershipError);
  }

  const requestDetails = {
    displayName,
    normalizedEmail,
    phoneNumber,
    role
  };
  const fingerprint = await invitationFingerprint({
    clientId,
    ...requestDetails
  });
  const temporaryPassword = await generateTemporaryPassword(serviceRoleKey, fingerprint);

  if (existingMembership) {
    if (!membershipMatchesRequest(existingMembership, requestDetails)) {
      return jsonResponse({ error: "This email is already invited for this company" }, 409);
    }

    const { error: retryUserError } = await adminClient.auth.admin.updateUserById(existingMembership.user_id, {
      password: temporaryPassword,
      user_metadata: {
        full_name: displayName,
        client_id: clientId,
        role
      }
    });

    if (retryUserError) {
      return internalError("pending invite password refresh failed", retryUserError);
    }

    const retryInviteError = await ensureInviteRecord(adminClient, {
      clientId,
      membershipId: existingMembership.id,
      normalizedEmail,
      displayName,
      role,
      callerUserId
    });

    if (retryInviteError) {
      return internalError("pending invite record refresh failed", retryInviteError);
    }

    return jsonResponse({
      ok: true,
      userId: existingMembership.user_id,
      membershipId: existingMembership.id,
      temporaryPassword,
      temporaryPasswordCreated: true,
      recovered: true
    });
  }

  const { user: existingAuthUser, error: existingAuthUserError } = await findAuthUserByEmail(adminClient, normalizedEmail);

  if (existingAuthUserError) {
    return internalError("authentication user lookup failed", existingAuthUserError);
  }

  if (existingAuthUser) {
    return jsonResponse({ error: "This email already has login access" }, 409);
  }

  const { data: userData, error: createUserError } = await adminClient.auth.admin.createUser({
    email: normalizedEmail,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: {
      full_name: displayName,
      client_id: clientId,
      role
    }
  });

  if (createUserError) {
    if (createUserError.message.toLowerCase().includes("already")) {
      return jsonResponse({ error: "This email already has login access" }, 409);
    }

    return internalError("authentication user creation failed", createUserError);
  }

  const invitedUserId = userData.user?.id;

  if (!invitedUserId) {
    return jsonResponse({ error: "Could not create login access" }, 500);
  }

  const { data: membership, error: membershipError } = await adminClient
    .from("memberships")
    .insert({
      client_id: clientId,
      user_id: invitedUserId,
      email: normalizedEmail,
      phone_number: phoneNumber,
      name: displayName,
      role,
      status: "invited",
      password_reset_required: true
    })
    .select("id")
    .single();

  if (membershipError) {
    await cleanupPartialInvite(adminClient, invitedUserId);
    return internalError("membership creation failed", membershipError);
  }

  const { error: inviteInsertError } = await adminClient.from("invites").insert({
    client_id: clientId,
    membership_id: membership.id,
    email: normalizedEmail,
    name: displayName,
    role,
    subject: `You're invited to DistroIQ`,
    redirect_to: "",
    status: "ready",
    invited_by: callerUserId
  });

  if (inviteInsertError) {
    await cleanupPartialInvite(adminClient, invitedUserId, membership.id);
    return internalError("invite record creation failed", inviteInsertError);
  }

  return jsonResponse({
    ok: true,
    userId: invitedUserId,
    membershipId: membership.id,
    temporaryPassword,
    temporaryPasswordCreated: true
  });
});
