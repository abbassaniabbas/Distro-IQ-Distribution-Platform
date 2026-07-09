import {
  exportPlatformClientData,
  loadPlatformOverview,
  provisionPlatformClient,
  recordPlatformIntervention,
  triggerPlatformJob,
  updatePlatformAccount,
  updatePlatformConfiguration
} from "../services/backend.js";
import { CURRENCY_OPTIONS, TIMEZONE_OPTIONS } from "../services/tenant.js";
import { formatDate, formatNumber } from "../services/formatters.js";
import { createZipBlob } from "../services/zip.js";
import { ROLE_OPTIONS, roleLabel } from "../services/rbac.js";
import { escapeHtml, qs } from "../ui/dom.js";
import { metricCard, panelHeader, statusPill, table, textButton } from "../ui/components.js";

const INITIAL_ACCOUNT_ROLES = ["ceo", "manager", "accountant", "store_keeper", "sales_rep"];
const PLATFORM_REFRESH_MS = 60000;
let platformRefreshTimer = 0;
const FEATURE_MODULES = [
  {
    key: "raw_materials",
    label: "Raw materials"
  },
  {
    key: "finished_products",
    label: "Finished products"
  },
  {
    key: "equipment_tracking",
    label: "Equipment tracking"
  },
  {
    key: "credit_control",
    label: "Credit control"
  },
  {
    key: "delivery_notes",
    label: "Delivery notes"
  },
  {
    key: "field_reports",
    label: "Field reports"
  }
];

function platformData(state) {
  if (Array.isArray(state.platformOverview)) {
    return {
      stats: {},
      clients: state.platformOverview,
      users: [],
      featureModules: [],
      emailTemplates: [],
      documentSequences: [],
      auditLogs: [],
      healthEvents: [],
      platformAdmins: []
    };
  }

  return state.platformOverview || {
    stats: {},
    clients: [],
    users: [],
    featureModules: [],
    emailTemplates: [],
    documentSequences: [],
    auditLogs: [],
    healthEvents: [],
    platformAdmins: []
  };
}

function platformTotals(data) {
  const clientTotals = data.clients.reduce(
    (totals, company) => ({
      companies: totals.companies + 1,
      accounts: totals.accounts + Number(company.accountCount || 0),
      activeAccounts: totals.activeAccounts + Number(company.activeAccountCount || 0),
      invites: totals.invites + Number(company.inviteCount || 0),
      activity: totals.activity + Number(company.activityCount || 0)
    }),
    {
      companies: 0,
      accounts: 0,
      activeAccounts: 0,
      invites: 0,
      activity: 0
    }
  );

  return {
    ...clientTotals,
    healthAlerts: data.healthEvents.filter((event) => ["failed", "warning", "open"].includes(event.status)).length
  };
}

function platformStats(data) {
  return data.stats || {};
}

function storageUsage(data) {
  const stats = platformStats(data);
  const limitBytes = Number(stats.storageLimitBytes || 1073741824);
  const usedBytes = Number(stats.storageUsedBytes || 0);
  const percent = limitBytes ? (usedBytes / limitBytes) * 100 : 0;

  return {
    usedBytes,
    limitBytes,
    percent
  };
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
}

function errorHealthEvents(data) {
  return (data.healthEvents || [])
    .filter((event) => {
      const status = String(event.status || "").toLowerCase();
      const eventType = String(event.eventType || "").toLowerCase();

      return status === "failed" || eventType.includes("error");
    })
    .slice(0, 10);
}

function safeFilePart(value) {
  return String(value || "client")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "client";
}

function optionList(items, selectedValue = "") {
  return items
    .map((item) => {
      const value = typeof item === "string" ? item : item.value;
      const label = typeof item === "string" ? item : item.label;
      return `<option value="${escapeHtml(value)}" ${value === selectedValue ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function companyOptions(clients) {
  return optionList(
    clients.map((client) => ({
      value: client.id,
      label: client.companyName
    }))
  );
}

function userOptions(users) {
  return optionList(
    users.map((user) => ({
      value: user.id,
      label: `${user.name} (${user.email}) - ${user.companyName}`
    }))
  );
}

function roleOptions(selectedValue = "") {
  return optionList(ROLE_OPTIONS, selectedValue);
}

function renderCompanyRow(company) {
  const searchIndex = [
    company.companyName,
    company.timezone,
    company.accountCount,
    company.inviteCount
  ]
    .join(" ")
    .toLowerCase();

  return `
    <tr data-platform-user-row data-search-index="${escapeHtml(searchIndex)}">
      <td>
        <strong>${escapeHtml(company.companyName)}</strong>
        <div class="muted">${escapeHtml(company.documentBusinessName || company.companyName)}</div>
      </td>
      <td>${formatDate(company.createdAt?.slice(0, 10))}</td>
      <td>${escapeHtml(company.timezone)}</td>
      <td>${formatNumber(company.accountCount)}</td>
      <td>${formatNumber(company.activeAccountCount)}</td>
      <td>${formatNumber(company.inviteCount)}</td>
      <td>${company.lastActivityAt ? formatDate(company.lastActivityAt.slice(0, 10)) : "No activity yet"}</td>
      <td>${statusPill(company.activeAccountCount ? "active" : "pending")}</td>
    </tr>
  `;
}

function renderUserRow(user) {
  const searchIndex = [
    user.name,
    user.email,
    user.companyName,
    user.role,
    user.status
  ]
    .join(" ")
    .toLowerCase();

  return `
    <tr data-search-index="${escapeHtml(searchIndex)}">
      <td>
        <strong>${escapeHtml(user.name)}</strong>
        <div class="muted">${escapeHtml(user.email)}</div>
      </td>
      <td>${escapeHtml(user.companyName)}</td>
      <td>${escapeHtml(roleLabel(user.role))}</td>
      <td>${statusPill(user.status)}</td>
      <td>${user.passwordResetRequired ? statusPill("pending") : statusPill("ready")}</td>
      <td>${formatDate(user.createdAt?.slice(0, 10))}</td>
    </tr>
  `;
}

function renderAuditRow(log) {
  return `
    <tr data-search-index="${escapeHtml(`${log.companyName || ""} ${log.actionType || ""} ${log.recordType || ""} ${log.summary || ""}`.toLowerCase())}">
      <td>${formatDate(log.createdAt?.slice(0, 10))}</td>
      <td>${escapeHtml(log.companyName || "Platform")}</td>
      <td>${escapeHtml(log.actionType || "reviewed")}</td>
      <td>${escapeHtml(log.recordType || "record")}</td>
      <td>${escapeHtml(log.actorName || "Bex Lab Innovations")}</td>
      <td><code>${escapeHtml(log.actorUserId || "System")}</code></td>
      <td>${escapeHtml(log.summary || "")}</td>
    </tr>
  `;
}

function renderHealthRow(event) {
  return `
    <tr data-search-index="${escapeHtml(`${event.serviceName || ""} ${event.eventType || ""} ${event.status || ""}`.toLowerCase())}">
      <td>${escapeHtml(event.serviceName || "Platform")}</td>
      <td>${escapeHtml(event.eventType || "Monitor")}</td>
      <td>${statusPill(event.status || "ready")}</td>
      <td>${escapeHtml(event.summary || "")}</td>
      <td>${event.createdAt ? formatDate(event.createdAt.slice(0, 10)) : "Not recorded"}</td>
    </tr>
  `;
}

function renderFeatureMatrix(data) {
  const rows = data.clients.map((client) => {
    const moduleMap = new Map(
      data.featureModules
        .filter((module) => module.clientId === client.id)
        .map((module) => [module.moduleKey, module.enabled])
    );

    return `
      <tr data-search-index="${escapeHtml(client.companyName.toLowerCase())}">
        <td><strong>${escapeHtml(client.companyName)}</strong></td>
        ${FEATURE_MODULES.map((module) => `<td>${statusPill(moduleMap.get(module.key) === false ? "disabled" : "active")}</td>`).join("")}
      </tr>
    `;
  });

  return table(["Company", ...FEATURE_MODULES.map((module) => module.label)], rows, "No module configuration has been saved yet");
}

function renderInitialAccountFields() {
  return INITIAL_ACCOUNT_ROLES.map((role) => `
    <div class="platform-account-seed">
      <span class="eyebrow">${escapeHtml(roleLabel(role))}</span>
      <label class="field">
        <span>Name</span>
        <input name="${escapeHtml(role)}Name" placeholder="${escapeHtml(roleLabel(role))} name">
      </label>
      <label class="field">
        <span>Email</span>
        <input name="${escapeHtml(role)}Email" type="email" placeholder="${escapeHtml(role.replace("_", "."))}@factory.com">
      </label>
    </div>
  `).join("");
}

function renderOnboardingPanel() {
  return `
    <section class="panel">
      ${panelHeader("Client onboarding", "Create a factory deployment and provision the first client accounts")}
      <form id="platform-onboarding-form" class="form-grid" novalidate>
        <label class="field">
          <span>Company / factory name</span>
          <input name="companyName" placeholder="Bex Snacks Factory">
        </label>
        <label class="field">
          <span>Printed business name</span>
          <input name="documentBusinessName" placeholder="Bex Snacks Factory Ltd">
        </label>
        <label class="field">
          <span>Timezone</span>
          <select name="timezone">${optionList(TIMEZONE_OPTIONS, "Africa/Lagos")}</select>
        </label>
        <label class="field">
          <span>Currency</span>
          <select name="currency">${optionList(CURRENCY_OPTIONS, "NGN")}</select>
        </label>
        <label class="field">
          <span>Date format</span>
          <select name="dateFormat">
            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            <option value="MMM D, YYYY">MMM D, YYYY</option>
          </select>
        </label>
        <label class="field">
          <span>Brand colour</span>
          <input name="brandColor" value="#0B1F3A" maxlength="7">
        </label>
        <label class="field span-full">
          <span>Logo data URL</span>
          <input name="logoDataUrl" placeholder="Optional logo data URL">
        </label>
        <div class="span-full platform-seed-grid">
          ${renderInitialAccountFields()}
        </div>
        <div class="span-full split">
          <span id="platform-onboarding-message" class="field-error"></span>
          ${textButton({
            iconName: "team",
            label: "Create deployment",
            className: "primary",
            type: "submit"
          })}
        </div>
      </form>
    </section>
  `;
}

function renderUserManagementPanel(data) {
  return `
    <section class="panel">
      ${panelHeader("User account management", "Create, reset, deactivate, delete, or reassign any client account")}
      <div class="dashboard-layout">
        <form id="platform-account-form" class="form-grid" novalidate>
          <label class="field span-full">
            <span>Find user</span>
            <input id="platform-user-search" type="search" placeholder="Search name or email">
          </label>
          <label class="field span-full">
            <span>User account</span>
            <select name="membershipId">${userOptions(data.users)}</select>
          </label>
          <label class="field">
            <span>Action</span>
            <select name="actionType">
              <option value="update-role">Reassign role</option>
              <option value="reset-password">Reset password</option>
              <option value="force-reauth">Force re-authentication</option>
              <option value="deactivate">Deactivate account</option>
              <option value="reactivate">Reactivate account</option>
              <option value="delete">Permanently delete account</option>
            </select>
          </label>
          <label class="field">
            <span>Role</span>
            <select name="role">${roleOptions("manager")}</select>
          </label>
          <label class="field span-full">
            <span>Audit note</span>
            <textarea name="note" placeholder="Reason for this platform action"></textarea>
          </label>
          <div class="span-full split">
            <span id="platform-account-message" class="field-error"></span>
            ${textButton({
              iconName: "settings",
              label: "Apply action",
              className: "primary",
              type: "submit"
            })}
          </div>
        </form>

        <div>
          ${table(
            ["User", "Company", "Role", "Status", "Password", "Created"],
            data.users.map(renderUserRow),
            "No client user accounts are visible yet"
          )}
        </div>
      </div>
    </section>
  `;
}

function renderConfigurationPanel(data) {
  return `
    <section class="panel">
      ${panelHeader("Platform configuration", "Control modules, email templates, document references, and branding per client")}
      <div class="dashboard-layout">
        <form id="platform-config-form" class="form-grid" novalidate>
          <label class="field span-full">
            <span>Client deployment</span>
            <select name="clientId">${companyOptions(data.clients)}</select>
          </label>
          <label class="field">
            <span>Printed business name</span>
            <input name="documentBusinessName" placeholder="Name on reports">
          </label>
          <label class="field">
            <span>Brand colour</span>
            <input name="brandColor" value="#0B1F3A" maxlength="7">
          </label>
          <div class="span-full platform-module-grid">
            ${FEATURE_MODULES.map((module) => `
              <label class="platform-toggle">
                <input type="checkbox" name="modules" value="${escapeHtml(module.key)}" checked>
                <span>${escapeHtml(module.label)}</span>
              </label>
            `).join("")}
          </div>
          <label class="field">
            <span>Email sender name</span>
            <input name="emailSenderName" value="DistroIQ Operations">
          </label>
          <label class="field">
            <span>Email sender address</span>
            <input name="emailSenderEmail" type="email" value="no-reply@distroiq.local">
          </label>
          <label class="field">
            <span>Document prefix</span>
            <input name="documentPrefix" value="DN">
          </label>
          <label class="field">
            <span>Next number</span>
            <input name="nextNumber" type="number" min="1" value="1">
          </label>
          <div class="span-full split">
            <span id="platform-config-message" class="field-error"></span>
            ${textButton({
              iconName: "settings",
              label: "Save configuration",
              className: "primary",
              type: "submit"
            })}
          </div>
        </form>
        <div>${renderFeatureMatrix(data)}</div>
      </div>
    </section>
  `;
}

function renderDataOversightPanel(data) {
  return `
    <section class="panel">
      ${panelHeader("Data oversight and audit", "Read, annotate, flag, void, and export platform records")}
      <div class="dashboard-layout">
        <form id="platform-intervention-form" class="form-grid" novalidate>
          <label class="field">
            <span>Client deployment</span>
            <select name="clientId">${companyOptions(data.clients)}</select>
          </label>
          <label class="field">
            <span>Record type</span>
            <select name="recordType">
              <option value="transaction">Transaction</option>
              <option value="stock_movement">Stock movement</option>
              <option value="credit_record">Credit record</option>
              <option value="report">Report</option>
              <option value="user_account">User account</option>
            </select>
          </label>
          <label class="field">
            <span>Action</span>
            <select name="actionType">
              <option value="annotated">Annotate</option>
              <option value="flagged">Flag</option>
              <option value="voided">Void</option>
              <option value="exported">Export</option>
            </select>
          </label>
          <label class="field">
            <span>Record reference</span>
            <input name="recordLabel" placeholder="Record ID or reference">
          </label>
          <label class="field span-full">
            <span>Platform audit note</span>
            <textarea name="note" placeholder="Describe the intervention and reason"></textarea>
          </label>
          <div class="span-full split">
            <span id="platform-intervention-message" class="field-error"></span>
            <span class="toolbar-group">
              ${textButton({
                iconName: "download",
                label: "Export ZIP",
                className: "js-export-platform-data"
              })}
              ${textButton({
                iconName: "check",
                label: "Record note",
                className: "primary",
                type: "submit"
              })}
            </span>
          </div>
        </form>
        <div>
          ${table(
            ["Date", "Company", "Action", "Record", "Actor", "Admin ID", "Summary"],
            data.auditLogs.slice(0, 10).map(renderAuditRow),
            "No audit records have been captured yet"
          )}
        </div>
      </div>
    </section>
  `;
}

function renderHealthPanel(data) {
  const stats = platformStats(data);
  const storage = storageUsage(data);
  const errors = errorHealthEvents(data);
  const storageWarning = storage.percent >= 80;

  return `
    <section class="panel">
      ${panelHeader("System health and monitoring", "Track sessions, errors, connectivity, storage, notifications, and jobs")}
      ${storageWarning ? `
        <div class="platform-alert-banner">
          Supabase storage is at ${formatNumber(storage.percent)}% of its limit. Review uploads and storage usage.
        </div>
      ` : ""}
      <div class="metric-grid platform-health-metrics">
        ${metricCard({
          label: "Active sessions",
          value: formatNumber(stats.activeSessions || 0),
          meta: "Currently active",
          iconName: "team"
        })}
        ${metricCard({
          label: "Storage used",
          value: formatBytes(storage.usedBytes),
          meta: `${formatNumber(storage.percent)}% of ${formatBytes(storage.limitBytes)}`,
          iconName: "package"
        })}
        ${metricCard({
          label: "Error events",
          value: formatNumber(errors.length),
          meta: "Last 10 shown below",
          iconName: "alert"
        })}
      </div>
      <div class="dashboard-layout">
        <div>
          ${table(
            ["Service", "Event", "Status", "Summary", "Recorded"],
            errors.map(renderHealthRow),
            "No error events have been recorded yet"
          )}
        </div>
        <form id="platform-job-form" class="form-grid" novalidate>
          <label class="field">
            <span>Client deployment</span>
            <select name="clientId">${companyOptions(data.clients)}</select>
          </label>
          <label class="field">
            <span>Job</span>
            <select name="jobType">
              <option value="report_regeneration">Report re-generation</option>
              <option value="notification_resend">Notification re-send</option>
              <option value="document_generation">Document generation</option>
              <option value="connectivity_check">Supabase connectivity check</option>
              <option value="storage_review">Storage usage review</option>
            </select>
          </label>
          <label class="field span-full">
            <span>Target reference</span>
            <input name="target" placeholder="Report ID, notification ID, or document reference">
          </label>
          <div class="span-full split">
            <span id="platform-job-message" class="field-error"></span>
            ${textButton({
              iconName: "activity",
              label: "Trigger job",
              className: "primary",
              type: "submit"
            })}
          </div>
        </form>
      </div>
    </section>
  `;
}

function renderSecurityPanel(data) {
  return `
    <section class="panel">
      ${panelHeader("Access security", "Bex Lab Innovations Super Admin access, separate from client login")}
      <div class="metric-grid">
        ${metricCard({
          label: "Super Admin URL",
          value: "#/platform-admin",
          meta: "Unlisted tenant-isolated entry",
          iconName: "settings"
        })}
        ${metricCard({
          label: "2FA policy",
          value: "Required",
          meta: "Enforce AAL2 in Supabase Auth",
          iconName: "check"
        })}
        ${metricCard({
          label: "Super Admins",
          value: formatNumber(data.platformAdmins.length),
          meta: "Stored outside tenant membership",
          iconName: "team"
        })}
        ${metricCard({
          label: "Tenant exposure",
          value: "Hidden",
          meta: "Never listed as a client role",
          iconName: "dashboard"
        })}
      </div>
    </section>
  `;
}

export function renderPlatformConsole({ state }) {
  const data = platformData(state);
  const totals = platformTotals(data);

  return `
    <section class="view platform-view">
      <div class="metric-grid">
        ${metricCard({
          label: "Companies",
          value: formatNumber(totals.companies),
          meta: "Tenant workspaces",
          iconName: "dashboard"
        })}
        ${metricCard({
          label: "Active users",
          value: formatNumber(totals.activeAccounts),
          meta: `${formatNumber(totals.accounts)} total accounts`,
          iconName: "team"
        })}
        ${metricCard({
          label: "Invites",
          value: formatNumber(totals.invites),
          meta: "Pending or sent access setup",
          iconName: "message"
        })}
        ${metricCard({
          label: "Health alerts",
          value: formatNumber(totals.healthAlerts),
          meta: `${formatNumber(totals.activity)} audit events`,
          iconName: "activity"
        })}
      </div>

      <section class="panel">
        ${panelHeader("Company monitor", "Read-only platform view across tenant workspaces")}
        ${table(
          ["Company", "Created", "Timezone", "Accounts", "Active", "Invites", "Last activity", "Status"],
          data.clients.map(renderCompanyRow),
          "No companies are visible to this platform account yet"
        )}
      </section>

      ${renderOnboardingPanel()}
      ${renderUserManagementPanel(data)}
      ${renderConfigurationPanel(data)}
      ${renderDataOversightPanel(data)}
      ${renderHealthPanel(data)}
      ${renderSecurityPanel(data)}
    </section>
  `;
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function initialAccountsFromForm(values) {
  return INITIAL_ACCOUNT_ROLES.map((role) => ({
    role,
    name: String(values[`${role}Name`] || "").trim(),
    email: String(values[`${role}Email`] || "").trim().toLowerCase()
  })).filter((account) => account.name && account.email);
}

function requireSelection(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

function dispatchPlatformContext(store, platformOverview, message) {
  const state = store.getState();

  store.dispatch({
    type: "SET_PLATFORM_CONTEXT",
    session: state.session,
    user: state.user,
    platformOverview,
    message
  });
}

function setFormMessage(form, selector, text, isSuccess = false) {
  const message = qs(selector, form);
  if (!message) return;
  message.textContent = text;
  message.className = isSuccess ? "auth-message is-success" : "field-error";
}

function bindPlatformUserSearch(root) {
  const input = qs("#platform-user-search", root);
  const accountForm = qs("#platform-account-form", root);
  const membershipSelect = accountForm?.elements.membershipId;
  const rows = [...root.querySelectorAll("[data-platform-user-row]")];

  if (!input || !membershipSelect) return;

  input.addEventListener("input", () => {
    const query = String(input.value || "").trim().toLowerCase();

    rows.forEach((row) => {
      row.hidden = Boolean(query) && !String(row.dataset.searchIndex || "").includes(query);
    });

    [...membershipSelect.options].forEach((option) => {
      if (!option.value) return;

      option.hidden = Boolean(query) && !String(option.textContent || "").toLowerCase().includes(query);
    });

    if (membershipSelect.selectedOptions[0]?.hidden) {
      membershipSelect.value = "";
    }
  });
}

function bindAsyncForm({ root, store, formId, messageSelector, busyText, successText, collect, submit }) {
  const form = qs(formId, root);
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = qs('button[type="submit"]', form);
    const label = button ? qs("span", button) : null;
    const idleText = label?.textContent || "";

    setFormMessage(form, messageSelector, "");
    if (button) button.disabled = true;
    if (label) label.textContent = busyText;

    try {
      const payload = collect(form);
      const platformOverview = await submit(payload);
      dispatchPlatformContext(store, platformOverview, successText);
      setFormMessage(form, messageSelector, successText, true);
    } catch (error) {
      setFormMessage(form, messageSelector, error.message || "Platform action failed");
    } finally {
      if (button) button.disabled = false;
      if (label) label.textContent = idleText;
    }
  });
}

async function exportPlatformData(root, store) {
  const form = qs("#platform-intervention-form", root);
  const button = qs(".js-export-platform-data", root);
  const label = button ? qs("span", button) : null;
  const idleText = label?.textContent || "";
  const values = form ? formValues(form) : {};
  const stateData = platformData(store.getState());
  const client = stateData.clients.find((item) => item.id === values.clientId);

  if (!values.clientId) {
    setFormMessage(form, "#platform-intervention-message", "Choose a client deployment before exporting.");
    return;
  }

  if (button) button.disabled = true;
  if (label) label.textContent = "Exporting...";

  try {
    const exported = await exportPlatformClientData({ clientId: values.clientId });
    const tableEntries = Object.entries(exported.tables || {});
    const files = [
      {
        name: "manifest.json",
        content: {
          clientId: values.clientId,
          companyName: exported.companyName || client?.companyName || "",
          generatedAt: exported.generatedAt || new Date().toISOString(),
          tables: tableEntries.map(([name, rows]) => ({
            name,
            rows: Array.isArray(rows) ? rows.length : 0
          }))
        }
      },
      ...tableEntries.map(([name, rows]) => ({
        name: `tables/${name}.json`,
        content: rows
      }))
    ];
    const blob = createZipBlob(files);
    const safeName = safeFilePart(exported.companyName || client?.companyName || values.clientId);
    const date = new Date().toISOString().slice(0, 10);
    const link = document.createElement("a");

    link.href = URL.createObjectURL(blob);
    link.download = `distroiq-${safeName}-export-${date}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);

    const platformOverview = await loadPlatformOverview();
    dispatchPlatformContext(store, platformOverview, "Client export downloaded");
    setFormMessage(form, "#platform-intervention-message", "Client export downloaded as ZIP", true);
  } catch (error) {
    setFormMessage(form, "#platform-intervention-message", error.message || "Export failed");
  } finally {
    if (button) button.disabled = false;
    if (label) label.textContent = idleText;
  }
}

export function bindPlatformConsole({ root, store }) {
  if (platformRefreshTimer) {
    window.clearInterval(platformRefreshTimer);
  }

  platformRefreshTimer = window.setInterval(async () => {
    if (!store.getState().platformAdmin) {
      window.clearInterval(platformRefreshTimer);
      platformRefreshTimer = 0;
      return;
    }

    try {
      const platformOverview = await loadPlatformOverview();
      dispatchPlatformContext(store, platformOverview);
    } catch {
      // Keep the current console visible if a background refresh fails.
    }
  }, PLATFORM_REFRESH_MS);

  bindPlatformUserSearch(root);

  bindAsyncForm({
    root,
    store,
    formId: "#platform-onboarding-form",
    messageSelector: "#platform-onboarding-message",
    busyText: "Creating...",
    successText: "Client deployment created",
    collect: (form) => {
      const values = formValues(form);
      requireSelection(values.companyName?.trim(), "Company name is required.");

      return {
        ...values,
        origin: window.location.origin,
        redirectTo: `${window.location.origin}/#/reset-password`,
        initialAccounts: initialAccountsFromForm(values)
      };
    },
    submit: provisionPlatformClient
  });

  bindAsyncForm({
    root,
    store,
    formId: "#platform-account-form",
    messageSelector: "#platform-account-message",
    busyText: "Applying...",
    successText: "Account action recorded",
    collect: (form) => {
      const values = formValues(form);
      requireSelection(values.membershipId, "Choose a user account.");

      return {
        ...values,
        redirectTo: `${window.location.origin}/#/reset-password`
      };
    },
    submit: updatePlatformAccount
  });

  bindAsyncForm({
    root,
    store,
    formId: "#platform-config-form",
    messageSelector: "#platform-config-message",
    busyText: "Saving...",
    successText: "Platform configuration saved",
    collect: (form) => {
      const values = formValues(form);
      const modules = new Set(new FormData(form).getAll("modules"));
      requireSelection(values.clientId, "Choose a client deployment.");

      return {
        ...values,
        modules: FEATURE_MODULES.map((module) => ({
          key: module.key,
          enabled: modules.has(module.key)
        }))
      };
    },
    submit: updatePlatformConfiguration
  });

  bindAsyncForm({
    root,
    store,
    formId: "#platform-intervention-form",
    messageSelector: "#platform-intervention-message",
    busyText: "Recording...",
    successText: "Platform audit note recorded",
    collect: (form) => {
      const values = formValues(form);
      requireSelection(values.clientId, "Choose a client deployment.");
      requireSelection(values.recordLabel?.trim(), "Record reference is required.");

      return values;
    },
    submit: recordPlatformIntervention
  });

  bindAsyncForm({
    root,
    store,
    formId: "#platform-job-form",
    messageSelector: "#platform-job-message",
    busyText: "Triggering...",
    successText: "Platform job triggered",
    collect: (form) => {
      const values = formValues(form);
      requireSelection(values.clientId, "Choose a client deployment.");

      return values;
    },
    submit: triggerPlatformJob
  });

  qs(".js-export-platform-data", root)?.addEventListener("click", async () => {
    await exportPlatformData(root, store);
  });
}
