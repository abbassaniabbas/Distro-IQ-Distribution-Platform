import {
  actionTypeLabel,
  getScopedActivityLogs,
  recordTypeLabel
} from "../services/activity.js";
import { formatCurrency, formatDateTime, formatNumber } from "../services/formatters.js";
import { accountForUser, currentUserRole } from "../services/rbac.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { panelHeader, table } from "../ui/components.js";

function entryDate(value) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function actorKey(entry) {
  return `${entry.actorName || "Team member"}|${entry.actorEmail || ""}`;
}

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function formatActivityTime(value) {
  if (!value) return "Just now";

  return formatDateTime(String(value).includes("T") ? value : `${value}T12:00:00`);
}

function currentRepName(state) {
  const account = accountForUser(state);

  return (
    account?.name ||
    state.user?.user_metadata?.full_name ||
    state.user?.email ||
    "Sales Representative"
  );
}

function returnDispositionLabel(value) {
  if (value === "to_store") return "Returned to store stock";
  if (value === "held_by_rep") return "Held by representative";
  return "";
}

function productNameFor(state, productId) {
  return (state.products || []).find((product) => product.id === productId)?.name || "Unknown snack";
}

function repRecentActivityRows(state) {
  const repName = currentRepName(state);
  const repKey = normalized(repName);
  const transactions = (state.stockTransactions || [])
    .filter((transaction) => {
      const type = normalized(transaction.type);
      return (type === "sale" || type === "return") && (!repKey || normalized(transaction.recordedBy) === repKey);
    })
    .map((transaction) => {
      const isReturn = normalized(transaction.type) === "return";
      const productName = transaction.productName || productNameFor(state, transaction.productId);
      const returnDisposition = isReturn ? returnDispositionLabel(transaction.returnDisposition) : "";
      const details = [
        `${formatNumber(transaction.quantity)} units`,
        transaction.paymentType || "cash",
        returnDisposition
      ].filter(Boolean).join(" - ");

      return {
        id: transaction.id,
        action: isReturn ? "return" : "sale",
        actionLabel: isReturn ? "Customer return" : "Sale",
        title: productName,
        customerName: transaction.partyName || "Customer",
        amount: formatCurrency(transaction.amount),
        details,
        when: transaction.createdAt || transaction.date,
        search: [
          isReturn ? "customer return" : "sale",
          productName,
          transaction.partyName,
          transaction.paymentType,
          returnDisposition
        ].join(" ")
      };
    });
  const reports = (state.salesReports || [])
    .filter((report) => !repKey || normalized(report.repName) === repKey)
    .map((report) => ({
      id: report.id,
      action: "report",
      actionLabel: "Report submitted",
      title: report.tripLabel || "Daily report",
      customerName: "Manager review",
      amount: formatCurrency(report.salesAmount),
      details: `${formatNumber(report.unitsSold)} sold - ${formatNumber(report.unitsReturned)} returned`,
      when: report.submittedAt || report.reportDate,
      search: `report submitted ${report.tripLabel || ""} ${report.status || ""}`
    }));

  return [...transactions, ...reports]
    .sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0) || String(b.id).localeCompare(String(a.id)));
}

function renderRepActionOptions(rows) {
  const actions = [...new Map(rows.map((row) => [row.action, row.actionLabel])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));

  return actions
    .map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
    .join("");
}

function renderRepRecentRows(rows) {
  return rows.map((row) => {
    const searchIndex = [
      row.actionLabel,
      row.title,
      row.customerName,
      row.details,
      row.amount
    ].join(" ").toLowerCase();

    return `
      <tr
        data-search-index="${escapeHtml(searchIndex)}"
        data-action="${escapeHtml(row.action)}"
        data-user="all"
        data-date="${escapeHtml(entryDate(row.when))}"
      >
        <td>${escapeHtml(formatActivityTime(row.when))}</td>
        <td><span class="activity-action">${escapeHtml(row.actionLabel)}</span></td>
        <td>
          <strong>${escapeHtml(row.title)}</strong>
          <div class="muted">${escapeHtml(row.id)}</div>
        </td>
        <td>${escapeHtml(row.customerName)}</td>
        <td>
          <strong>${escapeHtml(row.amount)}</strong>
          <div class="muted">${escapeHtml(row.details)}</div>
        </td>
      </tr>
    `;
  });
}

function renderActivityPagination() {
  return `
    <div class="activity-pagination" data-activity-pagination hidden>
      <button class="button" type="button" data-activity-page="prev">Previous</button>
      <span data-activity-page-status>Page 1 of 1</span>
      <button class="button" type="button" data-activity-page="next">Next</button>
    </div>
  `;
}

function renderSalesRepRecentActivity(state) {
  const rows = repRecentActivityRows(state);

  return `
    <section class="view activity-log-view">
      <section class="panel">
        <div class="toolbar">
          ${panelHeader("Recent activity", "Your logged sales, customer returns, and submitted reports")}
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
              <span>Activity</span>
              <select id="activity-action-filter">
                <option value="all">All activity</option>
                ${renderRepActionOptions(rows)}
              </select>
            </label>
          </div>
        </div>

        ${table(
          ["Time", "Activity", "Snack / Report", "Customer", "Details"],
          renderRepRecentRows(rows),
          "No recent activity yet"
        )}
        ${renderActivityPagination()}
      </section>
    </section>
  `;
}

function renderActionOptions(logs) {
  const actions = [...new Set(logs.map((entry) => entry.actionType).filter(Boolean))].sort();

  return actions
    .map((action) => `<option value="${escapeHtml(action)}">${escapeHtml(actionTypeLabel(action))}</option>`)
    .join("");
}

function renderRecordOptions(logs) {
  const records = [...new Set(logs.map((entry) => entry.recordType).filter(Boolean))].sort();

  return records
    .map((record) => `<option value="${escapeHtml(record)}">${escapeHtml(recordTypeLabel(record))}</option>`)
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
    const detailLines = Array.isArray(entry.details)
      ? entry.details.map((detail) => detail.summary).filter(Boolean)
      : [];
    const searchIndex = [
      actionLabel,
      recordLabel,
      entry.recordLabel,
      entry.actorName,
      entry.actorEmail,
      entry.summary,
      detailLines.join(" ")
    ]
      .join(" ")
      .toLowerCase();

    return `
      <tr
        data-search-index="${escapeHtml(searchIndex)}"
        data-action="${escapeHtml(entry.actionType)}"
        data-record="${escapeHtml(entry.recordType)}"
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
        <td>
          ${escapeHtml(entry.summary || "Record updated")}
          ${detailLines.length ? `<div class="muted">${detailLines.map(escapeHtml).join("<br>")}</div>` : ""}
        </td>
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

  const role = currentUserRole(state);
  if (role === "sales_rep") {
    return renderSalesRepRecentActivity(state);
  }

  const logs = getScopedActivityLogs(state);
  const isStoreKeeper = role === "store_keeper";
  const isAccountant = role === "accountant";
  const title = isStoreKeeper ? "Store activity log" : isAccountant ? "Finance activity log" : "Activity log";
  const subtitle = isStoreKeeper
    ? "Permanent searchable record of stock added, reduced, dispatched, returned, and reconciled"
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
            <label class="field">
              <span>Record type</span>
              <select id="activity-record-filter">
                <option value="all">All records</option>
                ${renderRecordOptions(logs)}
              </select>
            </label>
          </div>
        </div>

        ${table(
          ["Timestamp", "Action", "Record", "User", "Details"],
          renderRows(logs),
          "No activity has been recorded yet"
        )}
        ${renderActivityPagination()}
        <p class="activity-readonly-note">Activity entries are read-only and cannot be edited or deleted.</p>
      </section>
    </section>
  `;
}

export function bindActivityLog({ root }) {
  const pageSize = 10;
  let currentPage = 1;
  const searchFilter = qs("#activity-search", root);
  const fromFilter = qs("#activity-date-from", root);
  const toFilter = qs("#activity-date-to", root);
  const userFilter = qs("#activity-user-filter", root);
  const actionFilter = qs("#activity-action-filter", root);
  const recordFilter = qs("#activity-record-filter", root);
  const pagination = qs("[data-activity-pagination]", root);
  const pageStatus = qs("[data-activity-page-status]", root);
  const previousButton = qs('[data-activity-page="prev"]', root);
  const nextButton = qs('[data-activity-page="next"]', root);
  const filters = [searchFilter, fromFilter, toFilter, userFilter, actionFilter, recordFilter].filter(Boolean);

  function applyFilters() {
    const query = String(searchFilter?.value || "").trim().toLowerCase();
    const from = fromFilter?.value || "";
    const to = toFilter?.value || "";
    const user = userFilter?.value || "all";
    const action = actionFilter?.value || "all";
    const record = recordFilter?.value || "all";

    const rows = qsa("tbody tr", root);
    const matchedRows = rows.filter((row) => {
      const matchesDateFrom = !from || row.dataset.date >= from;
      const matchesDateTo = !to || row.dataset.date <= to;
      const matchesUser = user === "all" || row.dataset.user === user;
      const matchesAction = action === "all" || row.dataset.action === action;
      const matchesRecord = record === "all" || row.dataset.record === record;
      const matchesSearch = !query || String(row.dataset.searchIndex || "").includes(query);

      return matchesSearch && matchesDateFrom && matchesDateTo && matchesUser && matchesAction && matchesRecord;
    });

    const pageCount = Math.max(1, Math.ceil(matchedRows.length / pageSize));
    currentPage = Math.min(currentPage, pageCount);
    const pageStart = (currentPage - 1) * pageSize;
    const visibleRows = new Set(matchedRows.slice(pageStart, pageStart + pageSize));

    rows.forEach((row) => {
      row.hidden = !visibleRows.has(row);
    });

    if (pagination) {
      pagination.hidden = matchedRows.length <= pageSize;
    }

    if (pageStatus) {
      pageStatus.textContent = `Page ${currentPage} of ${pageCount}`;
    }

    if (previousButton) {
      previousButton.disabled = currentPage <= 1;
    }

    if (nextButton) {
      nextButton.disabled = currentPage >= pageCount;
    }
  }

  function resetPageAndApplyFilters() {
    currentPage = 1;
    applyFilters();
  }

  previousButton?.addEventListener("click", () => {
    currentPage = Math.max(1, currentPage - 1);
    applyFilters();
  });

  nextButton?.addEventListener("click", () => {
    currentPage += 1;
    applyFilters();
  });

  filters.forEach((filter) => filter.addEventListener("input", resetPageAndApplyFilters));
  filters.forEach((filter) => filter.addEventListener("change", resetPageAndApplyFilters));
  applyFilters();
}
