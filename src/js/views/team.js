import {
  ROLE_OPTIONS,
  getScopedAccounts,
  validateAccountForm
} from "../services/tenant.js";
import { deleteMembershipAccount, inviteAccount, setMembershipActiveStatus, setMembershipRole } from "../services/backend.js";
import { isBackendConfigured } from "../services/supabase-client.js";
import { formatDate } from "../services/formatters.js";
import { currentUserPermissions, currentUserRole, normalizeRole, roleLabel } from "../services/rbac.js";
import { escapeHtml, qs } from "../ui/dom.js";
import { panelHeader, statusPill, textButton } from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { confirmActionDialog } from "../ui/action-dialog.js";

let activeLoginDetailsModal = null;

function renderRoleOptions() {
  return ROLE_OPTIONS
    .filter((role) => role.value !== "ceo")
    .map((role) => `<option value="${escapeHtml(role.value)}">${escapeHtml(role.label)}</option>`)
    .join("");
}

function renderFieldError(name, errors = {}) {
  return `<span class="field-error" data-error-for="${escapeHtml(name)}">${escapeHtml(errors[name] || "")}</span>`;
}

function writeErrors(form, errors) {
  form.querySelectorAll("[data-error-for]").forEach((target) => {
    target.textContent = errors[target.dataset.errorFor] || "";
  });
}

function collectAccountForm(form) {
  const formData = new FormData(form);

  return {
    name: formData.get("name") || "",
    email: formData.get("email") || "",
    phoneNumber: formData.get("phoneNumber") || "",
    role: formData.get("role") || ""
  };
}

function appLoginUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "/login";
  return url.href;
}

export function buildLoginDetailsEmail({ client, invite, loginUrl } = {}) {
  const companyName = client?.companyName || "DistroIQ";
  const recipient = String(invite?.to || "").trim();
  const subject = `Your DistroIQ login for ${companyName}`;
  const body = [
    `${companyName} DistroIQ login details`,
    `Sign-in page: ${String(loginUrl || "").trim()}`,
    `Sign-in email: ${recipient}`,
    `Temporary password: ${invite?.temporaryPassword || ""}`,
    `Role: ${roleLabel(invite?.role)}`,
    "",
    `After signing in, you will be asked to create your own password.`
  ].join("\n");
  const recipientPath = encodeURIComponent(recipient).replace(/%40/gi, "@");
  const mailtoHref = `mailto:${recipientPath}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return {
    subject,
    body,
    mailtoHref,
    whatsappHref: `https://wa.me/?text=${encodeURIComponent(body)}`,
    clipboardText: body
  };
}

function findCreatedInvite(workspace, email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();

  return (workspace.invites || []).find((invite) => (
    String(invite.to || "").trim().toLowerCase() === normalizedEmail && invite.temporaryPassword
  )) || null;
}

async function copyTextToClipboard(text, statusTarget, trigger, successMessage, successLabel) {
  try {
    await navigator.clipboard.writeText(text);
    if (statusTarget) statusTarget.textContent = successMessage;
    if (trigger?.querySelector("span")) trigger.querySelector("span").textContent = successLabel;
  } catch {
    if (statusTarget) statusTarget.textContent = "Copy failed. Select and copy the login details manually.";
  }
}

function closeLoginDetailsModal() {
  activeLoginDetailsModal?.remove();
  activeLoginDetailsModal = null;
  document.removeEventListener("keydown", handleLoginDetailsModalKeydown);
}

function handleLoginDetailsModalKeydown(event) {
  if (event.key === "Escape") {
    closeLoginDetailsModal();
  }
}

function showLoginDetailsModal({ client, invite }) {
  if (!invite?.temporaryPassword) return;

  closeLoginDetailsModal();

  const loginDetails = buildLoginDetailsEmail({
    client,
    invite,
    loginUrl: appLoginUrl()
  });
  const modal = document.createElement("div");
  modal.className = "login-details-modal-backdrop";
  modal.innerHTML = `
    <section class="login-details-modal" role="dialog" aria-modal="true" aria-labelledby="login-details-title">
      <header class="login-details-modal-header">
        <div>
          <span class="eyebrow">Member created</span>
          <h2 id="login-details-title">Login details</h2>
        </div>
        <button class="button login-details-close" type="button" data-close-login-details>Close</button>
      </header>

      <div class="login-details-grid">
        <div class="client-id-box">
          <span class="eyebrow">Sign-in email</span>
          <strong>${escapeHtml(invite.to)}</strong>
        </div>
        <div class="client-id-box">
          <span class="eyebrow">Role</span>
          <strong>${escapeHtml(roleLabel(invite.role))}</strong>
        </div>
        <div class="client-id-box span-full">
          <span class="eyebrow">Temporary password</span>
          <code>${escapeHtml(invite.temporaryPassword)}</code>
        </div>
        <div class="client-id-box span-full">
          <span class="eyebrow">Sign-in page</span>
          <code>${escapeHtml(appLoginUrl())}</code>
        </div>
      </div>

      <div class="login-details-actions">
        ${textButton({
          iconName: "check",
          label: "Copy password",
          className: "js-modal-copy-password"
        })}
        ${textButton({
          iconName: "check",
          label: "Copy details",
          className: "primary js-modal-copy-login-details"
        })}
        <button class="icon-button js-modal-share-login-details" type="button" title="Share login details" aria-label="Share login details">${icon("share")}</button>
        <div class="login-details-share-options span-full" data-login-share-options hidden>
          <a class="button" href="${escapeHtml(loginDetails.mailtoHref)}">${icon("mail")}<span>Mail</span></a>
          <a class="button" href="${escapeHtml(loginDetails.whatsappHref)}" target="_blank" rel="noopener noreferrer">${icon("message")}<span>WhatsApp</span></a>
        </div>
      </div>
      <span class="login-details-status" aria-live="polite"></span>
    </section>
  `;

  document.body.appendChild(modal);
  activeLoginDetailsModal = modal;
  document.addEventListener("keydown", handleLoginDetailsModalKeydown);

  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest("[data-close-login-details]")) {
      closeLoginDetailsModal();
    }
  });

  qs(".js-modal-copy-password", modal).addEventListener("click", (event) => {
    copyTextToClipboard(
      invite.temporaryPassword,
      qs(".login-details-status", modal),
      event.currentTarget,
      "Password copied.",
      "Copied"
    );
  });

  qs(".js-modal-copy-login-details", modal).addEventListener("click", (event) => {
    copyTextToClipboard(
      loginDetails.clipboardText,
      qs(".login-details-status", modal),
      event.currentTarget,
      "Login details copied.",
      "Details copied"
    );
  });

  qs(".js-modal-share-login-details", modal).addEventListener("click", async () => {
    const status = qs(".login-details-status", modal);
    const fallbackOptions = qs("[data-login-share-options]", modal);

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: loginDetails.subject, text: loginDetails.clipboardText });
        if (status) status.textContent = "Login details shared.";
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }

    fallbackOptions.hidden = false;
    if (status) status.textContent = "Choose Mail or WhatsApp to share the login details.";
  });

  qs(".js-modal-copy-password", modal).focus();
}

function accountIsActive(account) {
  return String(account.status || "").toLowerCase() === "active";
}

function renderAccountListItem(account) {
  const searchIndex = [
    account.name,
    account.email,
    account.role,
    account.status
  ]
    .join(" ")
    .toLowerCase();

  return `
    <button class="team-member-row" type="button" data-team-account-id="${escapeHtml(account.id)}" data-search-index="${escapeHtml(searchIndex)}">
      <span class="team-member-avatar">${escapeHtml(String(account.name || "TM").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase())}</span>
      <span class="team-member-primary"><strong>${escapeHtml(account.name)}</strong><small>${escapeHtml(account.email)}</small></span>
      <span class="team-member-role">${escapeHtml(roleLabel(account.role))}</span>
      ${statusPill(accountIsActive(account) ? "active" : "inactive")}
      <span class="team-member-open" aria-hidden="true">${icon("arrowRight")}</span>
    </button>
  `;
}

function renderTeamAccountModal() {
  return `
    <div id="team-account-modal" class="stock-modal-backdrop" tabindex="-1" hidden>
      <section class="stock-modal team-account-modal" role="dialog" aria-modal="true" aria-labelledby="team-account-modal-title">
        <header class="stock-modal-header">
          <div><span class="eyebrow">Staff account</span><h2 id="team-account-modal-title">Staff details</h2></div>
          <button class="icon-button js-close-team-account" type="button" title="Close staff details" aria-label="Close staff details">${icon("x")}</button>
        </header>
        <div id="team-account-modal-content"></div>
      </section>
    </div>
  `;
}

function renderTeamAccountDetails(account, state) {
  const isActive = accountIsActive(account);
  const isCurrentAccount = account.userId === state.user?.id;
  const canDeleteAccount = !isCurrentAccount && normalizeRole(account.role) !== "ceo";

  return `
    <div class="team-account-summary">
      <div class="team-account-identity">
        <span class="team-member-avatar">${escapeHtml(String(account.name || "TM").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase())}</span>
        <div><h3>${escapeHtml(account.name)}</h3><p>${escapeHtml(roleLabel(account.role))}</p></div>
        ${statusPill(isActive ? "active" : "inactive")}
      </div>
      <div class="team-account-detail-grid">
        <div><span>Email</span><strong>${escapeHtml(account.email || "Not set")}</strong></div>
        <div><span>Phone number</span><strong>${escapeHtml(account.phoneNumber || "Not set")}</strong></div>
        <div><span>Created</span><strong>${formatDate(account.createdAt?.slice(0, 10))}</strong></div>
        <div><span>Password</span><strong>${account.passwordResetRequired ? "Change required" : "Password set"}</strong></div>
      </div>
      <div class="team-account-actions">
        ${canDeleteAccount ? `
          <div class="team-account-role-control">
            <label class="field"><span>Staff role</span><select data-team-account-role>${renderRoleOptions().replace(`value="${escapeHtml(normalizeRole(account.role))}"`, `value="${escapeHtml(normalizeRole(account.role))}" selected`)}</select></label>
            <button class="button js-set-team-account-role" type="button" data-account-id="${escapeHtml(account.id)}">${icon("check")}<span>Update role</span></button>
          </div>
        ` : ""}
        <button class="button ${isActive ? "" : "primary"} js-set-team-account-status" type="button" data-account-id="${escapeHtml(account.id)}" data-account-active="${isActive ? "false" : "true"}" ${isCurrentAccount ? "disabled" : ""}>
          ${icon(isActive ? "x" : "check")}<span>${isActive ? "Make inactive" : "Make active"}</span>
        </button>
        ${canDeleteAccount ? `
          <button class="button warning js-delete-team-account" type="button" data-account-id="${escapeHtml(account.id)}" data-account-name="${escapeHtml(account.name)}">
            ${icon("x")}<span>Delete account</span>
          </button>
        ` : ""}
        ${isCurrentAccount ? '<span class="muted">You cannot deactivate the account you are currently using.</span>' : ""}
        <span class="field-error" data-team-account-message aria-live="polite"></span>
      </div>
    </div>
  `;
}

export function renderTeam({ state }) {
  const client = state.client;

  if (!client?.id) {
    return `
      <section class="view">
        <section class="panel setup-card">
          ${panelHeader("Factory setup required", "Create the factory workspace before adding accounts")}
          <a class="button primary" href="#/onboarding">Start onboarding</a>
        </section>
      </section>
    `;
  }

  const accounts = getScopedAccounts(state);
  const permissions = currentUserPermissions(state);

  if (!permissions.canManageUsers) {
    return `
      <section class="view team-view">
        <section class="panel setup-card">
          ${panelHeader("Staff access", "Only the CEO can create staff or reset access")}
        </section>
      </section>
    `;
  }

  return `
    <section class="view team-view">
      <div class="staff-create-layout">
        <section class="panel">
          ${panelHeader("Add Staff", "")}
          <form id="account-form" class="form-grid" novalidate>
            <label class="field">
              <span>Full name</span>
              <input name="name" autocomplete="name" placeholder="Ada Okonkwo">
              ${renderFieldError("name")}
            </label>
            <label class="field">
              <span>Email</span>
              <input name="email" type="email" autocomplete="email" placeholder="ada@example.com">
              ${renderFieldError("email")}
            </label>
            <label class="field">
              <span>Phone number</span>
              <input name="phoneNumber" type="tel" inputmode="tel" autocomplete="tel" placeholder="0800 000 0000" required>
              ${renderFieldError("phoneNumber")}
            </label>
            <label class="field span-full">
              <span>Role assignment</span>
              <select name="role">
                ${renderRoleOptions(state)}
              </select>
              ${renderFieldError("role")}
            </label>
            <div class="span-full split">
              <span class="muted">They sign in once with a temporary password, then choose a new one.</span>
              ${textButton({
                iconName: "team",
                label: "Create staff",
                className: "primary",
                type: "submit"
              })}
            </div>
            <span id="account-message" class="field-error span-full"></span>
          </form>
        </section>

      </div>

      <section class="panel team-layout">
        ${panelHeader("Staff accounts", "")}
        ${
          accounts.length
            ? `<div class="team-member-list">${accounts.map(renderAccountListItem).join("")}</div>`
            : '<div class="empty-state">No accounts have been created for this factory yet</div>'
        }
      </section>
      ${renderTeamAccountModal()}
    </section>
  `;
}

export function bindTeam({ root, store, signal }) {
  const form = qs("#account-form", root);
  const accountModal = qs("#team-account-modal", root);
  const accountModalContent = qs("#team-account-modal-content", root);

  function closeAccountModal() {
    if (accountModal) accountModal.hidden = true;
  }

  function openAccountModal(accountId) {
    const state = store.getState();
    const account = getScopedAccounts(state).find((item) => item.id === accountId);
    if (!account || !accountModal || !accountModalContent) return;
    accountModalContent.innerHTML = renderTeamAccountDetails(account, state);
    accountModal.hidden = false;
    accountModal.focus();
  }

  root.addEventListener("click", async (event) => {
    const accountRow = event.target.closest?.("[data-team-account-id]");
    if (accountRow) {
      openAccountModal(accountRow.dataset.teamAccountId);
      return;
    }
    if (event.target === accountModal || event.target.closest?.(".js-close-team-account")) {
      closeAccountModal();
      return;
    }
    const deleteButton = event.target.closest?.(".js-delete-team-account");
    if (deleteButton) {
      if (deleteButton.disabled) return;
      const state = store.getState();
      const accountId = deleteButton.dataset.accountId;
      const accountName = deleteButton.dataset.accountName || "this staff member";
      const confirmed = await confirmActionDialog({
        title: "Delete staff account?",
        message: `Delete ${accountName}'s account permanently? They will lose access and this action cannot be undone.`,
        confirmLabel: "Delete account",
        tone: "danger"
      });
      if (!confirmed) return;

      const message = qs("[data-team-account-message]", accountModal);
      deleteButton.disabled = true;
      if (message) message.textContent = "Deleting account...";

      try {
        if (isBackendConfigured()) {
          const workspace = await deleteMembershipAccount({ clientId: state.client.id, membershipId: accountId });
          store.dispatch({ type: "SET_WORKSPACE", ...workspace, message: "Staff account deleted" });
        } else {
          store.dispatch({ type: "DELETE_ACCOUNT", accountId, message: "Staff account deleted" });
        }
        closeAccountModal();
      } catch (error) {
        if (message) message.textContent = error.message;
        deleteButton.disabled = false;
      }
      return;
    }
    const roleButton = event.target.closest?.(".js-set-team-account-role");
    if (roleButton) {
      if (roleButton.disabled) return;
      const state = store.getState();
      const accountId = roleButton.dataset.accountId;
      const roleSelect = qs("[data-team-account-role]", accountModal);
      const role = String(roleSelect?.value || "");
      const account = getScopedAccounts(state).find((item) => item.id === accountId);
      const message = qs("[data-team-account-message]", accountModal);
      if (!account || !["sales_rep", "store_keeper", "admin"].includes(role)) return;
      if (normalizeRole(account.role) === role) {
        if (message) message.textContent = "Choose a different role before updating.";
        return;
      }

      roleButton.disabled = true;
      if (message) message.textContent = "Updating staff role...";
      try {
        if (isBackendConfigured()) {
          const workspace = await setMembershipRole({ clientId: state.client.id, membershipId: accountId, role });
          store.dispatch({ type: "SET_WORKSPACE", ...workspace, message: "Staff role updated" });
        } else {
          store.dispatch({ type: "SET_ACCOUNT_ROLE", accountId, role, message: "Staff role updated" });
        }
        closeAccountModal();
      } catch (error) {
        if (message) message.textContent = error.message;
        roleButton.disabled = false;
      }
      return;
    }
    const statusButton = event.target.closest?.(".js-set-team-account-status");
    if (!statusButton) return;
    if (statusButton.disabled) return;

    const state = store.getState();
    const accountId = statusButton.dataset.accountId;
    const active = statusButton.dataset.accountActive === "true";
    const message = qs("[data-team-account-message]", accountModal);
    statusButton.disabled = true;
    if (message) message.textContent = "";

    try {
      if (isBackendConfigured()) {
        const workspace = await setMembershipActiveStatus({ clientId: state.client.id, membershipId: accountId, active });
        store.dispatch({ type: "SET_WORKSPACE", ...workspace, message: active ? "Account activated" : "Account deactivated" });
      } else {
        store.dispatch({ type: "SET_ACCOUNT_STATUS", accountId, active, message: active ? "Account activated" : "Account deactivated" });
      }
      closeAccountModal();
    } catch (error) {
      if (message) message.textContent = error.message;
      statusButton.disabled = false;
    }
  }, { signal });

  accountModal?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAccountModal();
  }, { signal });

  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const state = store.getState();
    const values = collectAccountForm(form);
    const errors = validateAccountForm(values, getScopedAccounts(state));
    const submitButton = qs('button[type="submit"]', form);
    const message = qs("#account-message", form);

    writeErrors(form, errors);
    message.textContent = "";

    if (Object.keys(errors).length) return;

    submitButton.disabled = true;

    try {
      if (isBackendConfigured()) {
        const workspace = await inviteAccount({
          client: state.client,
          ...values
        });
        store.dispatch({
          type: "SET_WORKSPACE",
          ...workspace,
          message: "Member created"
        });
        showLoginDetailsModal({
          client: workspace.client,
          invite: findCreatedInvite(workspace, values.email)
        });
      } else {
        store.dispatch({
          type: "CREATE_ACCOUNT",
          payload: values,
          message: "Member created"
        });
        const updatedState = store.getState();
        showLoginDetailsModal({
          client: updatedState.client,
          invite: findCreatedInvite(updatedState, values.email)
        });
      }
    } catch (error) {
      message.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  }, { signal });
}
