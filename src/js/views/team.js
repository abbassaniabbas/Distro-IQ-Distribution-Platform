import {
  ROLE_OPTIONS,
  getScopedAccounts,
  getScopedInvites,
  validateAccountForm
} from "../services/tenant.js";
import { inviteAccount } from "../services/backend.js";
import { isBackendConfigured } from "../services/supabase-client.js";
import { formatDate } from "../services/formatters.js";
import { currentUserPermissions, roleDescription, roleLabel } from "../services/rbac.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { panelHeader, statusPill, textButton } from "../ui/components.js";

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
        <p>${escapeHtml(roleDescription(account.role))}</p>
      </div>

      <footer>
        <span class="muted">Created ${formatDate(account.createdAt?.slice(0, 10))}</span>
        ${
          account.passwordResetRequired
            ? '<span class="status-pill pending">Reset required</span>'
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
      <span class="muted">${escapeHtml(invite.subject)}</span>
      <div class="client-id-box">
        <span class="eyebrow">${invite.resetLink ? "Invite link" : "Delivery"}</span>
        <strong>${escapeHtml(invite.resetLink ? "Ready to share" : "Email invitation sent")}</strong>
      </div>
      ${
        invite.temporaryPassword
          ? `
            <div class="split">
              <span class="muted">Temporary password</span>
              <code>${escapeHtml(invite.temporaryPassword)}</code>
            </div>
          `
          : '<span class="muted">The user will set their password from the invitation email.</span>'
      }
      ${
        invite.resetLink
          ? textButton({
              iconName: "check",
              label: "Copy reset link",
              className: "js-copy-reset-link",
              data: { "reset-link": invite.resetLink }
            })
          : ""
      }
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
          ${panelHeader("Team access", "Only Super Admins can create users or reset access")}
          <p>Your role can view the tools assigned to you, but user management is reserved for Super Admins.</p>
        </section>
      </section>
    `;
  }

  return `
    <section class="view team-view">
      <div class="dashboard-layout">
        <section class="panel">
          ${panelHeader("Invite team member", "Add a user and choose their role permissions")}
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
              <span class="muted">This invite will be added to ${escapeHtml(client.companyName)}.</span>
              ${textButton({
                iconName: "team",
                label: "Create invite",
                className: "primary",
                type: "submit"
              })}
            </div>
            <span id="account-message" class="field-error span-full"></span>
          </form>
        </section>

        <section class="panel setup-card">
          ${panelHeader("Team access", "Managers, store keepers, and sales reps added here can work in this factory")}
          <div class="client-id-box">
            <span class="eyebrow">Active factory</span>
            <strong>${escapeHtml(client.companyName)}</strong>
          </div>
          <p>
            Users only see the factory records and tools their role allows.
          </p>
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
        ${panelHeader("Invitations", "Invite delivery and setup status")}
        ${
          invites.length
            ? `<div class="stack">${invites.map(renderInvitePreview).join("")}</div>`
            : '<div class="empty-state">Invite previews will appear after account creation</div>'
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
          message: "Account invite sent"
        });
      } else {
        store.dispatch({
          type: "CREATE_ACCOUNT",
          payload: values,
          message: "Account invite created"
        });
      }
    } catch (error) {
      message.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });

  qsa(".js-copy-reset-link", root).forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.resetLink);
        button.querySelector("span").textContent = "Copied";
      } catch {
        button.querySelector("span").textContent = "Copy failed";
      }
    });
  });
}
