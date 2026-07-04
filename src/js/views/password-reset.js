import { updateCurrentUserPassword } from "../services/auth.js";
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
    accountId: params.get("account") || ""
  };
}

function findAccount(state, clientId, accountId) {
  return state.accounts.find((account) => account.clientId === clientId && account.id === accountId);
}

function getSupabaseInviteClientId(state) {
  return state.user?.user_metadata?.client_id || state.client?.id || "";
}

function writeMessage(root, message, isError = false) {
  const target = qs("#reset-password-message", root);
  if (!target) return;

  target.textContent = message;
  target.className = isError ? "field-error span-full" : "muted span-full";
}

function renderSupabaseReset({ state }) {
  if (!state.session) {
    return `
      <section class="view">
        <section class="panel setup-card">
          ${panelHeader("Open your email link", "We need to confirm your invitation first")}
          <p>Use the link from your invitation email, then set your new password here.</p>
          <a class="button primary" href="#/login">Back to sign in</a>
        </section>
      </section>
    `;
  }

  return `
    <section class="view">
      <section class="panel setup-card">
        ${panelHeader("Set password", "Your invitation is confirmed")}
        <div class="client-id-box">
          <span class="eyebrow">${escapeHtml(state.user?.email || "Signed-in user")}</span>
          <strong>${escapeHtml(state.client?.companyName || "Company workspace")}</strong>
        </div>
        <form id="reset-password-form" class="form-grid" novalidate data-mode="supabase">
          <label class="field">
            <span>New password</span>
            <input name="newPassword" type="password" autocomplete="new-password">
          </label>
          <label class="field">
            <span>Confirm new password</span>
            <input name="confirmPassword" type="password" autocomplete="new-password">
          </label>
          <span id="reset-password-message" class="muted span-full">Use at least 8 characters.</span>
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

function renderLocalReset({ state }) {
  const { clientId, accountId } = parseResetParams();
  const account = findAccount(state, clientId, accountId);
  const clientMatches = state.client?.id === clientId;

  if (!clientMatches || !account) {
    return `
      <section class="view">
        <section class="panel setup-card">
          ${panelHeader("Reset link not recognized", "This link does not match the active company")}
          <div class="client-id-box">
            <span class="eyebrow">Try again</span>
            <strong>Use the latest invite email</strong>
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
        ${panelHeader("Create your password", "Password reset link verified for this company")}
        <div class="client-id-box">
          <span class="eyebrow">${escapeHtml(account.email)}</span>
          <strong>Set a secure password</strong>
        </div>
        <form id="reset-password-form" class="form-grid" novalidate data-mode="local">
          <label class="field">
            <span>Temporary password</span>
            <input name="temporaryPassword" type="password" autocomplete="one-time-code">
          </label>
          <label class="field">
            <span>New password</span>
            <input name="newPassword" type="password" autocomplete="new-password">
          </label>
          <label class="field span-full">
            <span>Confirm new password</span>
            <input name="confirmPassword" type="password" autocomplete="new-password">
          </label>
          <span id="reset-password-message" class="muted span-full">
            Enter the temporary password from the invite, then set a new password.
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

    if (String(newPassword).length < 8) {
      writeMessage(root, "New password must be at least 8 characters.", true);
      return;
    }

    if (newPassword !== confirmPassword) {
      writeMessage(root, "New passwords do not match.", true);
      return;
    }

    submitButton.disabled = true;

    try {
      if (form.dataset.mode === "supabase") {
        const state = store.getState();
        const clientId = getSupabaseInviteClientId(state);

        await updateCurrentUserPassword(newPassword);

        if (clientId) {
          const workspace = await activateCurrentMembership(clientId);
          store.dispatch({
            type: "SET_WORKSPACE",
            ...workspace,
            message: "Password setup complete"
          });
        }

        window.location.hash = "#/team";
        return;
      }

      const state = store.getState();
      const { clientId, accountId } = parseResetParams();
      const account = findAccount(state, clientId, accountId);
      const temporaryPassword = formData.get("temporaryPassword") || "";

      if (!account) {
        writeMessage(root, "This reset link no longer matches an account.", true);
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
      window.location.hash = "#/team";
    } catch (error) {
      writeMessage(root, error.message, true);
    } finally {
      submitButton.disabled = false;
    }
  });
}
