import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const tenantRoles = new Set(["sales_rep", "manager", "store_keeper", "accountant", "ceo"]);
const defaultModules = [
  "raw_materials",
  "finished_products",
  "equipment_tracking",
  "credit_control",
  "delivery_notes",
  "field_reports"
];

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

function currencySymbol(currency: string) {
  if (currency === "USD") return "$";
  if (currency === "GBP") return "£";
  return "₦";
}

function cleanEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

async function requirePlatformAdmin(callerClient: ReturnType<typeof createClient>) {
  const { data: userData, error: userError } = await callerClient.auth.getUser();

  if (userError || !userData.user) {
    throw new Error("Authentication required");
  }

  const { data: allowed, error: roleError } = await callerClient.rpc("is_platform_admin");

  if (roleError || !allowed) {
    throw new Error("Platform admin access required");
  }

  return userData.user;
}

async function writeAudit(adminClient: ReturnType<typeof createClient>, payload: Record<string, unknown>) {
  await adminClient.from("platform_audit_logs").insert({
    client_id: payload.clientId || null,
    action_type: payload.actionType || "updated",
    record_type: payload.recordType || "platform",
    record_label: payload.recordLabel || "",
    actor_user_id: payload.actorUserId || null,
    actor_name: payload.actorName || "Bex Lab Innovations",
    actor_email: payload.actorEmail || "",
    summary: payload.summary || "Platform action recorded"
  });
}

async function provisionInitialAccount({
  adminClient,
  caller,
  clientId,
  companyName,
  account,
  redirectTo
}: {
  adminClient: ReturnType<typeof createClient>;
  caller: { id: string; email?: string };
  clientId: string;
  companyName: string;
  account: Record<string, unknown>;
  redirectTo: string;
}) {
  const role = cleanText(account.role);
  const name = cleanText(account.name);
  const email = cleanEmail(account.email);

  if (!name || !email || !tenantRoles.has(role)) return null;

  const temporaryPassword = generateTemporaryPassword();
  const { data: createdUser, error: createUserError } = await adminClient.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: {
      full_name: name,
      client_id: clientId,
      role
    }
  });

  if (createUserError) {
    throw new Error(createUserError.message);
  }

  await adminClient.auth.resetPasswordForEmail(email, {
    redirectTo
  });

  const { data: membership, error: membershipError } = await adminClient
    .from("memberships")
    .insert({
      client_id: clientId,
      user_id: createdUser.user?.id,
      email,
      name,
      role,
      status: "invited",
      password_reset_required: true
    })
    .select("id")
    .single();

  if (membershipError) {
    throw new Error(membershipError.message);
  }

  await adminClient.from("invites").insert({
    client_id: clientId,
    membership_id: membership.id,
    email,
    name,
    role,
    subject: `You're invited to ${companyName} on DistroIQ`,
    redirect_to: redirectTo,
    status: "sent",
    invited_by: caller.id
  });

  return membership.id;
}

async function provisionClient(adminClient: ReturnType<typeof createClient>, caller: { id: string; email?: string }, payload: Record<string, unknown>) {
  const companyName = cleanText(payload.companyName);
  const documentBusinessName = cleanText(payload.documentBusinessName) || companyName;
  const currency = cleanText(payload.currency) || "NGN";

  if (!companyName) {
    throw new Error("Company name is required");
  }

  const { data: client, error: clientError } = await adminClient
    .from("clients")
    .insert({
      company_name: companyName,
      logo_data_url: payload.logoDataUrl || "",
      brand_color: payload.brandColor || "#0B1F3A",
      timezone: payload.timezone || "Africa/Lagos",
      currency,
      currency_symbol: currencySymbol(currency),
      date_format: payload.dateFormat || "DD/MM/YYYY",
      document_business_name: documentBusinessName,
      created_by: caller.id
    })
    .select("id")
    .single();

  if (clientError) {
    throw new Error(clientError.message);
  }

  const redirectTo = cleanText(payload.redirectTo) || `${new URL(payload.origin as string || "http://127.0.0.1:8080").origin}/#/reset-password`;
  const initialAccounts = Array.isArray(payload.initialAccounts) ? payload.initialAccounts as Array<Record<string, unknown>> : [];

  for (const account of initialAccounts) {
    await provisionInitialAccount({
      adminClient,
      caller,
      clientId: client.id,
      companyName,
      account,
      redirectTo
    });
  }

  for (const moduleKey of defaultModules) {
    await adminClient.from("platform_feature_modules").upsert(
      {
        client_id: client.id,
        module_key: moduleKey,
        enabled: true,
        updated_by: caller.id
      },
      {
        onConflict: "client_id,module_key"
      }
    );
  }

  await adminClient.from("platform_document_sequences").upsert(
    {
      client_id: client.id,
      sequence_key: "delivery_note",
      prefix: "DN",
      next_number: 1,
      updated_by: caller.id
    },
    {
      onConflict: "client_id,sequence_key"
    }
  );

  await writeAudit(adminClient, {
    clientId: client.id,
    actionType: "created",
    recordType: "client_deployment",
    recordLabel: companyName,
    actorUserId: caller.id,
    actorEmail: caller.email || "",
    summary: `Created ${companyName} deployment`
  });

  return {
    clientId: client.id
  };
}

async function updateUser(adminClient: ReturnType<typeof createClient>, caller: { id: string; email?: string }, payload: Record<string, unknown>) {
  const membershipId = cleanText(payload.membershipId);
  const actionType = cleanText(payload.actionType);
  const nextRole = cleanText(payload.role);
  const note = cleanText(payload.note);

  if (!membershipId) {
    throw new Error("Choose a user account");
  }

  const { data: membership, error: membershipError } = await adminClient
    .from("memberships")
    .select("id, client_id, user_id, email, name, role, status")
    .eq("id", membershipId)
    .single();

  if (membershipError || !membership) {
    throw new Error(membershipError?.message || "Account not found");
  }

  if (actionType === "update-role") {
    if (!tenantRoles.has(nextRole)) {
      throw new Error("Choose a valid role");
    }

    await adminClient.from("memberships").update({ role: nextRole }).eq("id", membershipId);
  }

  if (actionType === "reset-password") {
    await adminClient.auth.resetPasswordForEmail(membership.email);
    await adminClient.from("memberships").update({ password_reset_required: true }).eq("id", membershipId);
  }

  if (actionType === "force-reauth" && membership.user_id) {
    await adminClient.auth.admin.updateUserById(membership.user_id, {
      app_metadata: {
        force_reauth_at: new Date().toISOString()
      }
    });
  }

  if (actionType === "deactivate") {
    await adminClient.from("memberships").update({ status: "disabled" }).eq("id", membershipId);
    if (membership.user_id) {
      await adminClient.auth.admin.updateUserById(membership.user_id, {
        ban_duration: "876000h"
      });
    }
  }

  if (actionType === "reactivate") {
    await adminClient.from("memberships").update({ status: "active" }).eq("id", membershipId);
    if (membership.user_id) {
      await adminClient.auth.admin.updateUserById(membership.user_id, {
        ban_duration: "none"
      });
    }
  }

  if (actionType === "delete") {
    await adminClient.from("invites").delete().eq("membership_id", membershipId);
    await adminClient.from("memberships").delete().eq("id", membershipId);
    if (membership.user_id) {
      await adminClient.auth.admin.deleteUser(membership.user_id);
    }
  }

  await writeAudit(adminClient, {
    clientId: membership.client_id,
    actionType,
    recordType: "user_account",
    recordLabel: membership.email,
    actorUserId: caller.id,
    actorEmail: caller.email || "",
    summary: note || `${actionType} for ${membership.email}`
  });

  return {
    membershipId
  };
}

async function updateConfig(adminClient: ReturnType<typeof createClient>, caller: { id: string; email?: string }, payload: Record<string, unknown>) {
  const clientId = cleanText(payload.clientId);
  if (!clientId) {
    throw new Error("Choose a client deployment");
  }

  await adminClient
    .from("clients")
    .update({
      document_business_name: payload.documentBusinessName || undefined,
      brand_color: payload.brandColor || undefined
    })
    .eq("id", clientId);

  const modules = Array.isArray(payload.modules) ? payload.modules as Array<Record<string, unknown>> : [];

  for (const module of modules) {
    await adminClient.from("platform_feature_modules").upsert(
      {
        client_id: clientId,
        module_key: cleanText(module.key),
        enabled: Boolean(module.enabled),
        updated_by: caller.id,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "client_id,module_key"
      }
    );
  }

  await adminClient.from("platform_email_templates").upsert(
    {
      client_id: clientId,
      template_key: "default_invite",
      sender_name: payload.emailSenderName || "DistroIQ Operations",
      sender_email: payload.emailSenderEmail || "no-reply@distroiq.local",
      subject: "DistroIQ notification",
      body: "",
      updated_by: caller.id,
      updated_at: new Date().toISOString()
    },
    {
      onConflict: "client_id,template_key"
    }
  );

  await adminClient.from("platform_document_sequences").upsert(
    {
      client_id: clientId,
      sequence_key: "delivery_note",
      prefix: payload.documentPrefix || "DN",
      next_number: Number(payload.nextNumber || 1),
      updated_by: caller.id,
      updated_at: new Date().toISOString()
    },
    {
      onConflict: "client_id,sequence_key"
    }
  );

  await writeAudit(adminClient, {
    clientId,
    actionType: "configured",
    recordType: "platform_settings",
    recordLabel: "Modules and templates",
    actorUserId: caller.id,
    actorEmail: caller.email || "",
    summary: "Updated platform configuration"
  });

  return {
    clientId
  };
}

async function recordIntervention(adminClient: ReturnType<typeof createClient>, caller: { id: string; email?: string }, payload: Record<string, unknown>) {
  await writeAudit(adminClient, {
    clientId: payload.clientId,
    actionType: payload.actionType || "annotated",
    recordType: payload.recordType || "record",
    recordLabel: payload.recordLabel || "",
    actorUserId: caller.id,
    actorEmail: caller.email || "",
    summary: payload.note || "Platform data intervention recorded"
  });

  return {
    ok: true
  };
}

async function exportClientData(adminClient: ReturnType<typeof createClient>, caller: { id: string; email?: string }, payload: Record<string, unknown>) {
  const clientId = cleanText(payload.clientId);

  if (!clientId) {
    throw new Error("Choose a client deployment");
  }

  const { data: client, error: clientError } = await adminClient
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .single();

  if (clientError || !client) {
    throw new Error(clientError?.message || "Client deployment not found");
  }

  const tableNames = [
    "memberships",
    "invites",
    "activity_logs",
    "stock_categories",
    "stock_products",
    "stock_assignments",
    "stock_transactions",
    "credit_limits",
    "platform_feature_modules",
    "platform_email_templates",
    "platform_document_sequences",
    "platform_audit_logs",
    "platform_health_events"
  ];
  const tables: Record<string, unknown[]> = {
    clients: [client]
  };

  for (const tableName of tableNames) {
    const { data, error } = await adminClient
      .from(tableName)
      .select("*")
      .eq("client_id", clientId);

    if (error) {
      throw new Error(`Could not export ${tableName}: ${error.message}`);
    }

    tables[tableName] = data || [];
  }

  await writeAudit(adminClient, {
    clientId,
    actionType: "exported",
    recordType: "client_data",
    recordLabel: client.company_name || clientId,
    actorUserId: caller.id,
    actorEmail: caller.email || "",
    summary: `Exported all client tables for ${client.company_name || clientId}`
  });

  return {
    export: {
      clientId,
      companyName: client.company_name || "",
      generatedAt: new Date().toISOString(),
      tables
    }
  };
}

async function triggerJob(adminClient: ReturnType<typeof createClient>, caller: { id: string; email?: string }, payload: Record<string, unknown>) {
  const jobType = cleanText(payload.jobType) || "manual_job";
  const target = cleanText(payload.target);

  await adminClient.from("platform_health_events").insert({
    client_id: payload.clientId || null,
    service_name: "Platform jobs",
    event_type: jobType,
    status: "open",
    summary: target ? `${jobType} triggered for ${target}` : `${jobType} triggered`,
    metadata: {
      target
    },
    created_by: caller.id
  });

  await writeAudit(adminClient, {
    clientId: payload.clientId,
    actionType: "triggered",
    recordType: "platform_job",
    recordLabel: jobType,
    actorUserId: caller.id,
    actorEmail: caller.email || "",
    summary: target ? `Triggered ${jobType} for ${target}` : `Triggered ${jobType}`
  });

  return {
    ok: true
  };
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

  const supabaseUrl = Deno.env.get("https://phoawfpicaucdjdhrban.supabase.co");
  const anonKey = Deno.env.get("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBob2F3ZnBpY2F1Y2RqZGhyYmFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNjk0NTAsImV4cCI6MjA5ODc0NTQ1MH0.Yq-jKauZt4s0dVB4_2OtviSku5a_YODK2xPjGVoTPD4");
  const serviceRoleKey = Deno.env.get("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBob2F3ZnBpY2F1Y2RqZGhyYmFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzE2OTQ1MCwiZXhwIjoyMDk4NzQ1NDUwfQ.g1taddJnlqf3hbmFTN1Db6bCKhy0hXgDgJoInXI1kqw");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase function environment is not configured" }, 500);
  }

  try {
    const authorization = req.headers.get("Authorization") || "";
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authorization
        }
      }
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const caller = await requirePlatformAdmin(callerClient);
    const body = await req.json();
    const action = cleanText(body.action);
    const payload = (body.payload || {}) as Record<string, unknown>;

    const result =
      action === "provision-client"
        ? await provisionClient(adminClient, caller, payload)
        : action === "update-user"
        ? await updateUser(adminClient, caller, payload)
        : action === "update-config"
        ? await updateConfig(adminClient, caller, payload)
        : action === "record-intervention"
        ? await recordIntervention(adminClient, caller, payload)
        : action === "export-client-data"
        ? await exportClientData(adminClient, caller, payload)
        : action === "trigger-job"
        ? await triggerJob(adminClient, caller, payload)
        : null;

    if (!result) {
      return jsonResponse({ error: "Unknown platform action" }, 400);
    }

    return jsonResponse({
      ok: true,
      ...result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Platform admin action failed";
    return jsonResponse({ error: message }, 400);
  }
});
