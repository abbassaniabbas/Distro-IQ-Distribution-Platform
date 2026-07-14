import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type CreditLimitPayload = {
  clientId: string;
  representativeMembershipId: string;
  previousLimit: number;
  newLimit: number;
  paymentPeriodDays?: number;
  currencySymbol?: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatAmount(symbol: string, value: number) {
  return `${symbol}${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 }).format(value)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("DISTROIQ_FROM_EMAIL");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase function environment is not configured" }, 500);
  }

  let payload: CreditLimitPayload;

  try {
    payload = (await req.json()) as CreditLimitPayload;
  } catch {
    return jsonResponse({ error: "Credit limit details could not be read" }, 400);
  }

  const newLimit = Number(payload.newLimit || 0);
  const paymentPeriodDays = Math.max(0, Math.round(Number(payload.paymentPeriodDays ?? 1)));

  if (!payload.clientId || !payload.representativeMembershipId || !Number.isFinite(newLimit) || newLimit <= 0) {
    return jsonResponse({ error: "Client, representative, and a valid credit limit are required" }, 400);
  }

  const authorization = req.headers.get("Authorization") || "";
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } }
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: callerData, error: callerError } = await callerClient.auth.getUser();

  if (callerError || !callerData.user?.id) {
    return jsonResponse({ error: "Sign in again before sending this notification" }, 401);
  }

  const { data: callerMembership, error: membershipError } = await adminClient
    .from("memberships")
    .select("id, name, role, status")
    .eq("client_id", payload.clientId)
    .eq("user_id", callerData.user.id)
    .maybeSingle();

  const allowedRoles = new Set(["accountant", "ceo"]);
  if (
    membershipError ||
    !callerMembership ||
    callerMembership.status !== "active" ||
    !allowedRoles.has(callerMembership.role)
  ) {
    return jsonResponse({ error: "You do not have permission to change representative credit limits" }, 403);
  }

  const { data: representative, error: representativeError } = await adminClient
    .from("memberships")
    .select("id, name, email, phone_number, role, status")
    .eq("id", payload.representativeMembershipId)
    .eq("client_id", payload.clientId)
    .maybeSingle();

  if (
    representativeError ||
    !representative ||
    representative.role !== "sales_rep" ||
    !["active", "invited"].includes(representative.status) ||
    !representative.email
  ) {
    return jsonResponse({ error: "The selected sales representative does not have a valid email account" }, 400);
  }

  const { data: existingLimits, error: existingLimitError } = await adminClient
    .from("credit_limits")
    .select("id, limit_amount, balance_amount, discount_percent, late_penalty_percent")
    .eq("client_id", payload.clientId)
    .eq("party_type", "sales_rep")
    .eq("membership_id", representative.id)
    .limit(1);

  if (existingLimitError) {
    return jsonResponse({ error: existingLimitError.message }, 400);
  }

  const existingLimit = existingLimits?.[0];
  const previousLimit = Math.max(0, Number(existingLimit?.limit_amount ?? payload.previousLimit ?? 0));
  const changedAtIso = new Date().toISOString();
  const creditLimitValues = {
    client_id: payload.clientId,
    party_type: "sales_rep",
    party_name: representative.name,
    membership_id: representative.id,
    limit_amount: newLimit,
    balance_amount: Number(existingLimit?.balance_amount || 0),
    previous_limit_amount: previousLimit,
    discount_percent: Number(existingLimit?.discount_percent || 0),
    payment_period_days: paymentPeriodDays,
    late_penalty_percent: Number(existingLimit?.late_penalty_percent || 0),
    changed_by_user_id: callerData.user.id,
    changed_by_name: callerMembership.name,
    changed_at: changedAtIso
  };
  const saveResult = existingLimit
    ? await adminClient.from("credit_limits").update(creditLimitValues).eq("id", existingLimit.id)
    : await adminClient.from("credit_limits").insert(creditLimitValues);

  if (saveResult.error) {
    return jsonResponse({ error: saveResult.error.message }, 400);
  }

  const { data: client } = await adminClient
    .from("clients")
    .select("company_name, currency_symbol, timezone, credit_limit_email_enabled, credit_limit_sms_enabled")
    .eq("id", payload.clientId)
    .maybeSingle();

  const currencySymbol = String(payload.currencySymbol || client?.currency_symbol || "NGN ");
  const companyName = String(client?.company_name || "your company");
  const oldAmount = formatAmount(currencySymbol, previousLimit);
  const newAmount = formatAmount(currencySymbol, newLimit);
  const changedAt = new Date().toLocaleString("en-NG", { timeZone: client?.timezone || "Africa/Lagos" });
  const subject = `${companyName}: your DistroIQ credit limit has changed`;
  const emailEnabled = client?.credit_limit_email_enabled === true;
  const smsEnabled = client?.credit_limit_sms_enabled === true;
  const smsApiKey = Deno.env.get("TERMII_API_KEY");
  const smsSender = Deno.env.get("DISTROIQ_SMS_SENDER") || "DistroIQ";
  const smsText = `${companyName}: your DistroIQ credit limit changed from ${oldAmount} to ${newAmount}. Settle within ${paymentPeriodDays} day${paymentPeriodDays === 1 ? "" : "s"}. Changed by ${callerMembership.name}.`;
  let smsSent = false;
  let smsError = "";

  if (!smsEnabled) {
    smsError = "";
  } else if (!representative.phone_number) {
    smsError = "The representative does not have a phone number.";
  } else if (!smsApiKey) {
    smsError = "The credit-limit SMS service is not ready yet.";
  } else {
    try {
      const smsResponse = await fetch("https://v3.api.termii.com/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: smsApiKey,
          to: representative.phone_number,
          from: smsSender,
          sms: smsText,
          type: "plain",
          channel: "generic"
        })
      });
      smsSent = smsResponse.ok;
      if (!smsResponse.ok) smsError = "The SMS provider could not deliver the notification.";
    } catch {
      smsError = "The SMS service could not be reached.";
    }
  }

  if (!emailEnabled) {
    await callerClient.rpc("record_activity", {
      p_client_id: payload.clientId,
      p_action_type: "updated",
      p_record_type: "credit_limit",
      p_record_label: representative.name,
      p_summary: `Credit limit updated for ${representative.name}; notification settings applied`
    });

    return jsonResponse({
      ok: true,
      saved: true,
      emailEnabled,
      smsEnabled,
      emailSent: false,
      emailError: "",
      smsSent,
      smsError
    });
  }

  if (!resendApiKey || !fromEmail) {
    await callerClient.rpc("record_activity", {
      p_client_id: payload.clientId,
      p_action_type: "updated",
      p_record_type: "credit_limit",
      p_record_label: representative.name,
      p_summary: `Credit limit updated for ${representative.name}; email pending setup`
    });

    return jsonResponse({
      ok: true,
      saved: true,
      emailSent: false,
      emailError: "The credit-limit email service is not ready yet.",
      smsSent,
      smsError,
      emailEnabled,
      smsEnabled
    });
  }

  const textBody = [
    `Hello ${representative.name},`,
    "",
    `Your working credit limit in DistroIQ changed from ${oldAmount} to ${newAmount}.`,
    `Settlement period: ${paymentPeriodDays} day${paymentPeriodDays === 1 ? "" : "s"}.`,
    `Changed by: ${callerMembership.name}.`,
    `Date: ${changedAt}.`,
    "",
    "Sign in to DistroIQ to view your current daily credit position."
  ].join("\n");
  const htmlBody = `
    <div style="font-family:Arial,sans-serif;color:#102235;line-height:1.55;max-width:560px;margin:auto">
      <h1 style="font-size:22px;color:#0b1f3a">Credit limit updated</h1>
      <p>Hello ${escapeHtml(representative.name)},</p>
      <p>Your working credit limit for <strong>${escapeHtml(companyName)}</strong> has changed.</p>
      <table style="border-collapse:collapse;width:100%;margin:20px 0">
        <tr><td style="padding:10px;border:1px solid #dde6e3">Old limit</td><td style="padding:10px;border:1px solid #dde6e3"><strong>${escapeHtml(oldAmount)}</strong></td></tr>
        <tr><td style="padding:10px;border:1px solid #dde6e3">New limit</td><td style="padding:10px;border:1px solid #dde6e3;color:#0b765b"><strong>${escapeHtml(newAmount)}</strong></td></tr>
        <tr><td style="padding:10px;border:1px solid #dde6e3">Days to settle</td><td style="padding:10px;border:1px solid #dde6e3">${paymentPeriodDays}</td></tr>
        <tr><td style="padding:10px;border:1px solid #dde6e3">Changed by</td><td style="padding:10px;border:1px solid #dde6e3">${escapeHtml(callerMembership.name)}</td></tr>
        <tr><td style="padding:10px;border:1px solid #dde6e3">Date</td><td style="padding:10px;border:1px solid #dde6e3">${escapeHtml(changedAt)}</td></tr>
      </table>
      <p>Sign in to DistroIQ to view your current daily credit position.</p>
    </div>
  `;

  let emailResponse: Response;

  try {
    emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [representative.email],
        subject,
        text: textBody,
        html: htmlBody
      })
    });
  } catch {
    await callerClient.rpc("record_activity", {
      p_client_id: payload.clientId,
      p_action_type: "updated",
      p_record_type: "credit_limit",
      p_record_label: representative.name,
      p_summary: `Credit limit updated for ${representative.name}; email service unavailable`
    });

    return jsonResponse({
      ok: true,
      saved: true,
      emailSent: false,
      emailError: "The email service could not be reached.",
      smsSent,
      smsError,
      emailEnabled,
      smsEnabled
    });
  }

  const emailResult = await emailResponse.json().catch(() => ({}));
  if (!emailResponse.ok) {
    await callerClient.rpc("record_activity", {
      p_client_id: payload.clientId,
      p_action_type: "updated",
      p_record_type: "credit_limit",
      p_record_label: representative.name,
      p_summary: `Credit limit updated for ${representative.name}; email delivery failed`
    });

    return jsonResponse({
      ok: true,
      saved: true,
      emailSent: false,
      emailError: emailResult?.message || "The email provider could not deliver the notification.",
      smsSent,
      smsError,
      emailEnabled,
      smsEnabled
    });
  }

  await callerClient.rpc("record_activity", {
    p_client_id: payload.clientId,
    p_action_type: "updated",
    p_record_type: "credit_limit",
    p_record_label: representative.name,
    p_summary: `Credit limit updated and emailed to ${representative.name}`
  });

  return jsonResponse({ ok: true, saved: true, emailEnabled, smsEnabled, emailSent: true, emailId: emailResult?.id || "", smsSent, smsError });
});
