export const SUPABASE_CONFIG = {
  url: "https://phoawfpicaucdjdhrban.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBob2F3ZnBpY2F1Y2RqZGhyYmFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNjk0NTAsImV4cCI6MjA5ODc0NTQ1MH0.Yq-jKauZt4s0dVB4_2OtviSku5a_YODK2xPjGVoTPD4",
  inviteFunctionName: "invite-user"
};

export function isSupabaseConfigured() {
  return Boolean(
    SUPABASE_CONFIG.url &&
      SUPABASE_CONFIG.anonKey &&
      !SUPABASE_CONFIG.url.includes("YOUR-PROJECT") &&
      !SUPABASE_CONFIG.anonKey.includes("YOUR-PUBLISHABLE")
  );
}
