export const SUPABASE_CONFIG = {
  url: "https://phoawfpicaucdjdhrban.supabase.co",
  anonKey: "sb_publishable_IVPKc-WvsZ89EwHVELYjmw_qZImz3Fw",
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
