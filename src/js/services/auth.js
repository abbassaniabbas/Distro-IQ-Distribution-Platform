import { getSupabaseClient, isBackendConfigured } from "./supabase-client.js";

function messageFromError(error) {
  return error?.message || "Supabase authentication failed.";
}

export async function getAuthContext() {
  if (!isBackendConfigured()) {
    return {
      configured: false,
      session: null,
      user: null
    };
  }

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw new Error(messageFromError(error));
  }

  return {
    configured: true,
    session: data.session,
    user: data.session?.user || null
  };
}

function normalizeMfaFactor(factor) {
  return {
    id: factor.id,
    status: factor.status || "",
    friendlyName: factor.friendly_name || factor.friendlyName || "Authenticator app",
    factorType: factor.factor_type || factor.factorType || "totp"
  };
}

export async function signInWithPassword({ email, password }) {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password
  });

  if (error) {
    throw new Error(messageFromError(error));
  }

  return data;
}

export async function signUpWithPassword({ name, email, password }) {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      data: {
        full_name: name.trim()
      }
    }
  });

  if (error) {
    throw new Error(messageFromError(error));
  }

  return data;
}

export async function signOut() {
  const supabase = await getSupabaseClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error(messageFromError(error));
  }
}

export async function requestPasswordReset(email, redirectTo) {
  const supabase = await getSupabaseClient();
  const { error } = await supabase.auth.resetPasswordForEmail(
    String(email || "").trim().toLowerCase(),
    { redirectTo }
  );

  if (error) {
    throw new Error(messageFromError(error));
  }
}

export async function getAuthenticatorAssuranceLevel() {
  const supabase = await getSupabaseClient();

  if (!supabase.auth.mfa?.getAuthenticatorAssuranceLevel) {
    return {
      currentLevel: "unknown",
      nextLevel: "unknown"
    };
  }

  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (error) {
    throw new Error(messageFromError(error));
  }

  return {
    currentLevel: data.currentLevel || data.current_level || "unknown",
    nextLevel: data.nextLevel || data.next_level || "unknown"
  };
}

export async function listAuthenticatorFactors() {
  const supabase = await getSupabaseClient();

  if (!supabase.auth.mfa?.listFactors) {
    return {
      totp: []
    };
  }

  const { data, error } = await supabase.auth.mfa.listFactors();

  if (error) {
    throw new Error(messageFromError(error));
  }

  return {
    totp: (data.totp || []).map(normalizeMfaFactor)
  };
}

export async function enrollTotpFactor() {
  const supabase = await getSupabaseClient();

  if (!supabase.auth.mfa?.enroll) {
    throw new Error("MFA is not available for this Supabase project.");
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "DistroIQ Super Admin"
  });

  if (error) {
    throw new Error(messageFromError(error));
  }

  return {
    factorId: data.id,
    qrCode: data.totp?.qr_code || data.totp?.qrCode || "",
    secret: data.totp?.secret || "",
    uri: data.totp?.uri || ""
  };
}

export async function createMfaChallenge(factorId) {
  const supabase = await getSupabaseClient();

  if (!supabase.auth.mfa?.challenge) {
    throw new Error("MFA challenge is not available for this Supabase project.");
  }

  const { data, error } = await supabase.auth.mfa.challenge({
    factorId
  });

  if (error) {
    throw new Error(messageFromError(error));
  }

  return {
    challengeId: data.id
  };
}

export async function verifyMfaChallenge({ factorId, challengeId, code }) {
  const supabase = await getSupabaseClient();

  if (!supabase.auth.mfa?.verify) {
    throw new Error("MFA verification is not available for this Supabase project.");
  }

  const { data, error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId,
    code: String(code || "").trim()
  });

  if (error) {
    throw new Error(messageFromError(error));
  }

  return data;
}

export async function updateCurrentUserPassword(password) {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.updateUser({
    password
  });

  if (error) {
    throw new Error(messageFromError(error));
  }

  return data;
}

export async function updateCurrentUserProfile({ name, staffImageUrl }) {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.updateUser({
    data: {
      full_name: name.trim(),
      avatar_url: String(staffImageUrl || "")
    }
  });

  if (error) {
    throw new Error(messageFromError(error));
  }

  return data;
}

export async function onAuthStateChange(callback) {
  if (!isBackendConfigured()) return () => {};

  const supabase = await getSupabaseClient();
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback({
      event,
      session,
      user: session?.user || null
    });
  });

  return () => data.subscription.unsubscribe();
}
