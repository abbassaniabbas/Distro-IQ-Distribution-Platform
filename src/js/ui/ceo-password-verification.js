import { signInWithPassword } from "../services/auth.js";
import { isBackendConfigured } from "../services/supabase-client.js";
import { requestPasswordDialog } from "./action-dialog.js";

export async function verifyCeoPassword({
  state,
  title = "Verify CEO password",
  message = "Enter the password for the currently signed-in CEO account to authorize this permanent action."
} = {}) {
  const password = await requestPasswordDialog({
    title,
    message,
    tone: "danger"
  });

  if (!password) return false;
  if (!isBackendConfigured()) {
    throw new Error("CEO password verification requires a connection to the factory backend. No data was deleted.");
  }

  try {
    await signInWithPassword({
      email: String(state?.user?.email || ""),
      password
    });
  } catch (error) {
    if (/invalid login credentials|invalid password/i.test(String(error?.message || ""))) {
      throw new Error("Incorrect CEO password. No data was deleted.");
    }
    throw error;
  }

  return true;
}
