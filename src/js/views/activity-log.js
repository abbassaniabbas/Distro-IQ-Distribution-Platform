import {
  actionTypeLabel,
  getScopedActivityLogs,
  recordTypeLabel
} from "../services/activity.js";
import { formatDateTime } from "../services/formatters.js";
import { currentUserRole } from "../services/rbac.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { panelHeader, table } from "../ui/components.js";

function entryDate(value) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function actorKey(entry) {
  return `${entry.actorName || "Team member"}|${entry.actorEmail || ""}`;
}

function renderActionOptions(logs) {
  const actions = [...new Set(logs.map((entry) => entry.actionType).filter(Boolean))].sort();

  return actions
    .map((action) => `<option value="${escapeHtml(action)}">${escapeHtml(actionTypeLabel(action))}</option>`)
    .join("");
}

function renderUserOptions(logs) {
  const users = new Map();

  logs.forEach((entry) => {
    users.set(actorKey(entry), {
      name: entry.actorName || "Team member",
      email: entry.actorEmail || ""
    });
  });

  return [...users.entries()]
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([key, user]) => {
      const label = user.email ? `${user.name} (${user.email})` : user.name;
      return `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`;
    })
    .join("");
}

function renderRows(logs) {
  return logs.map((entry) => {
    const actionLabel = actionTypeLabel(entry.actionType);
    const recordLabel = recordTypeLabel(entry.recordType);
    const userLabel = entry.actorEmail ? `${entry.actorName} ${entry.actorEmail}` : entry.actorName;
    const searchIndex = [
      actionLabel,
      recordLabel,
      entry.recordLabel,
      entry.actorName,
      entry.actorEmail,
      entry.summary
    ]
      .join(" ")
      .toLowerCase();

    return `
      <tr
        data-search-index="${escapeHtml(searchIndex)}"
        data-action="${escapeHtml(entry.actionType)}"
        data-user="${escapeHtml(actorKey(entry))}"
        data-date="${escapeHtml(entryDate(entry.createdAt))}"
      >
        <td>${escapeHtml(formatDateTime(entry.createdAt))}</td>
        <td><span class="activity-action">${escapeHtml(actionLabel)}</span></td>
        <td>
          <strong>${escapeHtml(recordLabel)}</strong>
          ${entry.recordLabel ? `<div class="muted">${escapeHtml(entry.recordLabel)}</div>` : ""}
        </td>
        <td>
          <strong>${escapeHtml(entry.actorName || "Team member")}</strong>
          ${entry.actorEmail ? `<div class="muted">${escapeHtml(entry.actorEmail)}</div>` : ""}
        </td>
        <td>${escapeHtml(entry.summary || "Record updated")}</td>
      </tr>
    `;
  });
}

export function renderActivityLog({ state }) {
  if (!state.client?.id) {
    return `
      <section class="view">
        <section class="panel setup-card">
          ${panelHeader("Factory setup required", "Create or join a factory before viewing activity")}
          <a class="button primary" href="#/onboarding">Start onboarding</a>
        </section>
      </section>
    `;
  }

  const logs = getScopedActivityLogs(state);
  const role = currentUserRole(state);
  const isStoreKeeper = role === "store_keeper";
  const isAccountant = role === "accountant";
  const title = isStoreKeeper ? "Store activity log" : isAccountant ? "Finance activity log" : "Activity log";
  const subtitle = isStoreKeeper
    ? "Permanent searchable record of stock movements, representative assignments, and in-transit run updates"
    : isAccountant
      ? "Permanent searchable record of sales, payments, credit balances, and submitted reports"
      : "Permanent searchable record of what changed, who changed it, and when";

  return `
    <section class="view activity-log-view">
      <section class="panel">
        <div class="toolbar">
          ${panelHeader(title, subtitle)}
          <div class="toolbar-group activity-filters">
            <label class="field">
              <span>Search</span>
              <input id="activity-search" type="search" placeholder="Search activity">
            </label>
            <label class="field">
              <span>Date from</span>
              <input id="activity-date-from" type="date">
            </label>
            <label class="field">
              <span>Date to</span>
              <input id="activity-date-to" type="date">
            </label>
            <label class="field">
              <span>User</span>
              <select id="activity-user-filter">
                <option value="all">All users</option>
                ${renderUserOptions(logs)}
              </select>
            </label>
            <label class="field">
              <span>Action</span>
              <select id="activity-action-filter">
                <option value="all">All actions</option>
                ${renderActionOptions(logs)}
              </select>
            </label>
          </div>
        </div>

        ${table(
          ["Timestamp", "Action", "Record", "User", "Details"],
          renderRows(logs),
          "No activity has been recorded yet"
        )}
      </section>
    </section>
  `;
}

export function bindActivityLog({ root }) {
  const searchFilter = qs("#activity-search", root);
  const fromFilter = qs("#activity-date-from", root);
  const toFilter = qs("#activity-date-to", root);
  const userFilter = qs("#activity-user-filter", root);
  const actionFilter = qs("#activity-action-filter", root);
  const filters = [searchFilter, fromFilter, toFilter, userFilter, actionFilter].filter(Boolean);

  function applyFilters() {
    const query = String(searchFilter?.value || "").trim().toLowerCase();
    const from = fromFilter?.value || "";
    const to = toFilter?.value || "";
    const user = userFilter?.value || "all";
    const action = actionFilter?.value || "all";

    qsa("tbody tr", root).forEach((row) => {
      const matchesDateFrom = !from || row.dataset.date >= from;
      const matchesDateTo = !to || row.dataset.date <= to;
      const matchesUser = user === "all" || row.dataset.user === user;
      const matchesAction = action === "all" || row.dataset.action === action;
      const matchesSearch = !query || String(row.dataset.searchIndex || "").includes(query);

      row.hidden = !matchesSearch || !matchesDateFrom || !matchesDateTo || !matchesUser || !matchesAction;
    });
  }

  filters.forEach((filter) => filter.addEventListener("input", applyFilters));
  filters.forEach((filter) => filter.addEventListener("change", applyFilters));
}
