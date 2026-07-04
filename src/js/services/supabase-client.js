import { SUPABASE_CONFIG, isSupabaseConfigured } from "../config/supabase.js";

let supabaseClientPromise;

export function isBackendConfigured() {
  return isSupabaseConfigured();
}

export async function getSupabaseClient() {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase project URL and publishable key are not configured.");
  }

  if (!supabaseClientPromise) {
    supabaseClientPromise = import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm").then(
      ({ createClient }) =>
        createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
          auth: {
            autoRefreshToken: true,
            detectSessionInUrl: true,
            persistSession: true
          }
        })
    );
  }

  return supabaseClientPromise;
}
