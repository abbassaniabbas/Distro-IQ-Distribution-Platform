import {
  ROLE_OPTIONS,
  getScopedAccounts,
  getScopedInvites,
  validateAccountForm
} from "../services/tenant.js";
import { inviteAccount } from "../services/backend.js";
import { isBackendConfigured } from "../services/supabase-client.js";
import { formatDate } from "../services/formatters.js";
import { currentUserPermissions, roleLabel } from "../services/rbac.js";
import { escapeHtml, qs } from "../ui/dom.js";
import { panelHeader, statusPill, textButton } from "../ui/components.js";

let activeLoginDetailsModal = null;

function renderRoleOptions() {
  return ROLE_OPTIONS.map((role) => `<option value="${escapeHtml(role.value)}">${escapeHtml(role.label)}</option>`).join("");
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
    role: formData.get("role") || ""
  };
}

function appLoginUrl() {
  const basePath = `${window.location.origin}${window.location.pathname}`;
  return `${basePath}#/login`;
}

function emailLoginDetails({ client, invite }) {
  const companyName = client?.companyName || "DistroIQ";
  const subject = `Your DistroIQ login for ${companyName}`;
  const body = [
    `Hello,`,
    "",
    `Your DistroIQ account for ${companyName} is ready.`,
    "",
    `Sign-in page: ${appLoginUrl()}`,
    `Email: ${invite.to}`,
    `Temporary password: ${invite.temporaryPassword}`,
    `Role: ${roleLabel(invite.role)}`,
    "",
    `After signing in, you will be asked to create your own password.`
  ].join("\n");

  window.location.href = `mailto:${encodeURIComponent(invite.to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function findCreatedInvite(workspace, email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();

  return (workspace.invites || []).find((invite) => (
    String(invite.to || "").trim().toLowerCase() === normalizedEmail && invite.temporaryPassword
  )) || null;
}

async function copyPasswordToClipboard(password, statusTarget, trigger) {
  try {
    await navigator.clipboard.writeText(password);
    if (statusTarget) statusTarget.textContent = "Password copied.";
    if (trigger) trigger.querySelector("span").textContent = "Copied";
  } catch {
    if (statusTarget) statusTarget.textContent = "Copy failed. Select and copy the password manually.";
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
      </div>

      <div class="login-details-actions">
        ${textButton({
          iconName: "check",
          label: "Copy password",
          className: "js-modal-copy-password",
          data: { "temporary-password": invite.temporaryPassword }
        })}
        ${textButton({
          iconName: "mail",
          label: "Email login details",
          className: "primary js-modal-email-login-details"
        })}
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
    copyPasswordToClipboard(invite.temporaryPassword, qs(".login-details-status", modal), event.currentTarget);
  });

  qs(".js-modal-email-login-details", modal).addEventListener("click", () => {
    emailLoginDetails({ client, invite });
  });

  qs(".js-modal-copy-password", modal).focus();
}

function renderAccountCard(account) {
  const searchIndex = [
    account.name,
    account.email,
    account.role,
    account.status
  ]
    .join(" ")
    .toLowerCase();

  return `
    <article class="account-card" data-search-index="${escapeHtml(searchIndex)}">
      <header>
        <div>
          <span class="eyebrow">${escapeHtml(roleLabel(account.role))}</span>
          <h3>${escapeHtml(account.name)}</h3>
        </div>
        ${statusPill(account.status)}
      </header>

      <div class="account-meta">
        <div class="split">
          <span class="muted">Email</span>
          <strong>${escapeHtml(account.email)}</strong>
        </div>
        <div class="split">
          <span class="muted">Role</span>
          <strong>${escapeHtml(roleLabel(account.role))}</strong>
        </div>
      </div>

      <footer>
        <span class="muted">Created ${formatDate(account.createdAt?.slice(0, 10))}</span>
        ${
          account.passwordResetRequired
            ? '<span class="status-pill pending">Password change required</span>'
            : '<span class="status-pill active">Password set</span>'
        }
      </footer>
    </article>
  `;
}

function renderInvitePreview(invite) {
  return `
    <article class="invite-preview" data-search-index="${escapeHtml(`${invite.to} ${invite.subject}`.toLowerCase())}">
      <div class="split">
        <strong>${escapeHtml(invite.to)}</strong>
        ${statusPill(invite.status)}
      </div>
      <span class="muted">Temporary login details are shown in a secure modal when the member is created.</span>
      <div class="client-id-box">
        <span class="eyebrow">Sign-in email</span>
        <strong>${escapeHtml(invite.to)}</strong>
      </div>
    </article>
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
  const invites = getScopedInvites(state);
  const permissions = currentUserPermissions(state);

  if (!permissions.canManageUsers) {
    return `
      <section class="view team-view">
        <section class="panel setup-card">
          ${panelHeader("Team access", "Only CEOs and Managers can create users or reset access")}
          <p>Your role can view the tools assigned to you, but user management is reserved for CEOs and Managers.</p>
        </section>
      </section>
    `;
  }

  return `
    <section class="view team-view">
      <div class="dashboard-layout">
        <section class="panel">
          ${panelHeader("Add team member", "Create login access with a one-time password")}
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
            <label class="field span-full">
              <span>Role assignment</span>
              <select name="role">
                ${renderRoleOptions()}
              </select>
              ${renderFieldError("role")}
            </label>
            <div class="span-full split">
              <span class="muted">They sign in once with a temporary password, then choose a new one.</span>
              ${textButton({
                iconName: "team",
                label: "Create member",
                className: "primary",
                type: "submit"
              })}
            </div>
            <span id="account-message" class="field-error span-full"></span>
          </form>
        </section>

        <section class="panel setup-card">
          ${panelHeader("Team access", "Each member gets their own role and password")}
          <div class="client-id-box">
            <span class="eyebrow">Active factory</span>
            <strong>${escapeHtml(client.companyName)}</strong>
          </div>
          <p>Users only see the factory records and tools their role allows.</p>
        </section>
      </div>

      <section class="panel team-layout">
        ${panelHeader("Accounts", "Users created for this factory")}
        ${
          accounts.length
            ? `<div class="account-grid">${accounts.map(renderAccountCard).join("")}</div>`
            : '<div class="empty-state">No accounts have been created for this factory yet</div>'
        }
      </section>

      <section class="panel team-layout">
        ${panelHeader("Temporary passwords", "Shown after member creation")}
        ${
          invites.length
            ? `<div class="stack">${invites.map(renderInvitePreview).join("")}</div>`
            : '<div class="empty-state">Temporary passwords will appear after member creation</div>'
        }
      </section>
    </section>
  `;
}

export function bindTeam({ root, store }) {
  const form = qs("#account-form", root);
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
  });
}
