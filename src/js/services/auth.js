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

export async function updateCurrentUserProfile({ name }) {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.updateUser({
    data: {
      full_name: name.trim()
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
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback({
      session,
      user: session?.user || null
    });
  });

  return () => data.subscription.unsubscribe();
}
