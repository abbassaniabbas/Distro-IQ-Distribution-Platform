import { getAuthContext, signOut, updateCurrentUserPassword } from "../services/auth.js";
import { activateCurrentMembership } from "../services/backend.js";
import { isBackendConfigured } from "../services/supabase-client.js";
import { escapeHtml, qs } from "../ui/dom.js";
import { panelHeader, textButton } from "../ui/components.js";

function parseResetParams() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const params = new URLSearchParams(query);

  return {
    clientId: params.get("client") || "",
    accountId: params.get("account") || "",
    recovery: params.get("recovery") === "1"
  };
}

function isPasswordRecovery() {
  return parseResetParams().recovery;
}

function findAccount(state, clientId, accountId) {
  return state.accounts.find((account) => account.clientId === clientId && account.id === accountId);
}

function getSupabaseInviteClientId(state) {
  return state.user?.user_metadata?.client_id || state.client?.id || "";
}

function currentWorkspaceAccount(state) {
  const email = String(state.user?.email || "").trim().toLowerCase();
  return (state.accounts || []).find((account) => (
    account.userId === state.user?.id ||
    (email && String(account.email || "").trim().toLowerCase() === email)
  )) || null;
}

function writeMessage(root, message, isError = false) {
  const target = qs("#reset-password-message", root);
  if (!target) return;

  target.textContent = message;
  target.className = isError ? "field-error span-full" : "muted span-full";
}

function renderSupabaseReset({ state }) {
  const recovery = isPasswordRecovery();

  if (!state.session && !recovery) {
    return `
      <section class="view">
        <section class="panel setup-card">
          ${panelHeader("Sign in first", "Use the temporary password from your CEO")}
          <p>After signing in, you will set your own password here.</p>
          <a class="button primary" href="#/login">Back to sign in</a>
        </section>
      </section>
    `;
  }

  return `
    <section class="view">
      <section class="panel setup-card">
        ${panelHeader(
          recovery ? "Reset your password" : "Create your password",
          recovery ? "Enter and confirm your new password" : "This is required before using the workspace"
        )}
        ${state.user?.email ? `
          <div class="client-id-box">
            <span class="eyebrow">${escapeHtml(state.user.email)}</span>
            <strong>${escapeHtml(recovery ? "Secure password recovery" : state.client?.companyName || "Factory workspace")}</strong>
          </div>
        ` : ""}
        <form id="reset-password-form" class="form-grid" novalidate data-mode="${recovery ? "recovery" : "supabase"}">
          <label class="field">
            <span>New password</span>
            <input name="newPassword" type="password" minlength="8" autocomplete="new-password" required>
          </label>
          <label class="field">
            <span>Confirm new password</span>
            <input name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required>
          </label>
          <span id="reset-password-message" class="muted span-full">Use 8+ characters with uppercase, lowercase, a number, and a symbol.</span>
          <div class="span-full split">
            <span class="muted">${recovery ? "Your reset link securely verifies this request." : "You only need the temporary password once."}</span>
            ${textButton({
              iconName: "check",
              label: recovery ? "Reset password" : "Continue",
              className: "primary",
              type: "submit"
            })}
          </div>
        </form>
      </section>
    </section>
  `;
}

function renderLocalReset({ state }) {
  const { clientId, accountId } = parseResetParams();
  const account = findAccount(state, clientId, accountId);
  const clientMatches = state.client?.id === clientId;

  if (!clientMatches || !account) {
    return `
      <section class="view">
        <section class="panel setup-card">
          ${panelHeader("Setup request not recognized", "This account does not match the active company")}
          <div class="client-id-box">
            <span class="eyebrow">Try again</span>
            <strong>Ask the CEO for a new temporary password</strong>
          </div>
          <a class="button primary" href="#/team">Back to team</a>
        </section>
      </section>
    `;
  }

  if (!account.passwordResetRequired) {
    return `
      <section class="view">
        <section class="panel setup-card">
          ${panelHeader("Password already set", "This account has completed password setup")}
          <div class="client-id-box">
            <span class="eyebrow">${escapeHtml(account.email)}</span>
            <strong>Password setup complete</strong>
          </div>
          <a class="button primary" href="#/team">Back to team</a>
        </section>
      </section>
    `;
  }

  return `
    <section class="view">
      <section class="panel setup-card">
        ${panelHeader("Create your password", "Temporary access verified for this company")}
        <div class="client-id-box">
          <span class="eyebrow">${escapeHtml(account.email)}</span>
          <strong>Set a secure password</strong>
        </div>
        <form id="reset-password-form" class="form-grid" novalidate data-mode="local">
          <label class="field">
            <span>Temporary password</span>
            <input name="temporaryPassword" type="password" autocomplete="one-time-code" required>
          </label>
          <label class="field">
            <span>New password</span>
            <input name="newPassword" type="password" minlength="8" autocomplete="new-password" required>
          </label>
          <label class="field span-full">
            <span>Confirm new password</span>
            <input name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required>
          </label>
          <span id="reset-password-message" class="muted span-full">
            Enter the temporary password, then use 8+ characters with uppercase, lowercase, a number, and a symbol.
          </span>
          <div class="span-full split">
            <span class="muted">This completes your account setup.</span>
            ${textButton({
              iconName: "check",
              label: "Set password",
              className: "primary",
              type: "submit"
            })}
          </div>
        </form>
      </section>
    </section>
  `;
}

export function renderPasswordReset({ state }) {
  if (isBackendConfigured()) {
    return renderSupabaseReset({ state });
  }

  return renderLocalReset({ state });
}

export function bindPasswordReset({ root, store }) {
  const form = qs("#reset-password-form", root);
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const newPassword = formData.get("newPassword") || "";
    const confirmPassword = formData.get("confirmPassword") || "";
    const submitButton = qs('button[type="submit"]', form);

    if (
      String(newPassword).length < 8 ||
      !/[a-z]/.test(String(newPassword)) ||
      !/[A-Z]/.test(String(newPassword)) ||
      !/\d/.test(String(newPassword)) ||
      !/[^A-Za-z0-9]/.test(String(newPassword))
    ) {
      writeMessage(root, "Use 8+ characters with uppercase, lowercase, a number, and a symbol.", true);
      return;
    }

    if (newPassword !== confirmPassword) {
      writeMessage(root, "New passwords do not match.", true);
      return;
    }

    submitButton.disabled = true;

    try {
      if (form.dataset.mode === "recovery") {
        const authContext = await getAuthContext();
        if (!authContext.session) {
          writeMessage(root, "This password reset link has expired or has already been used. Request a new link and try again.", true);
          return;
        }

        await updateCurrentUserPassword(newPassword);
        try {
          await signOut();
        } finally {
          store.dispatch({ type: "CLEAR_AUTH_CONTEXT" });
          window.location.hash = "#/login?password-reset=success";
        }
        return;
      }

      if (form.dataset.mode === "supabase") {
        const state = store.getState();
        const clientId = getSupabaseInviteClientId(state);
        const requiresMembershipActivation = Boolean(currentWorkspaceAccount(state)?.passwordResetRequired);

        await updateCurrentUserPassword(newPassword);

        if (clientId && requiresMembershipActivation) {
          const workspace = await activateCurrentMembership(clientId, newPassword);
          store.dispatch({
            type: "SET_WORKSPACE",
            ...workspace,
            message: "Password setup complete"
          });
        }

        window.location.hash = "#/dashboard";
        return;
      }

      const state = store.getState();
      const { clientId, accountId } = parseResetParams();
      const account = findAccount(state, clientId, accountId);
      const temporaryPassword = formData.get("temporaryPassword") || "";

      if (!account) {
        writeMessage(root, "This setup request no longer matches an account.", true);
        return;
      }

      if (temporaryPassword !== account.temporaryPassword) {
        writeMessage(root, "Temporary password does not match the invite.", true);
        return;
      }

      store.dispatch({
        type: "COMPLETE_PASSWORD_RESET",
        clientId,
        accountId,
        message: "Password setup complete"
      });
      window.location.hash = "#/dashboard";
    } catch (error) {
      writeMessage(root, error.message, true);
    } finally {
      submitButton.disabled = false;
    }
  });
}
