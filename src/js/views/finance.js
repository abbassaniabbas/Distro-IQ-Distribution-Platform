import {
  calculateMetrics,
  calculateVisionMetrics,
  creditUsageTone,
  getInvoiceAging,
  getRetailerMap
} from "../services/calculations.js";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "../services/formatters.js";
import { currentUserPermissions } from "../services/rbac.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { metricCard, panelHeader, progressBar, statusPill, table, textButton } from "../ui/components.js";

function renderAgingRows(invoices) {
  return getInvoiceAging(invoices)
    .map(
      (bucket) => `
        <div class="aging-row" data-search-index="${escapeHtml(bucket.label.toLowerCase())}">
          <strong>${escapeHtml(bucket.label)}</strong>
          ${progressBar(bucket.percent, bucket.label === "31+ days" ? "danger" : "good")}
          <span class="strong">${formatCurrency(bucket.total)}</span>
        </div>
      `
    )
    .join("");
}

function renderInvoiceRows(state, permissions) {
  const retailerMap = getRetailerMap(state.retailers);
  const canUpdateCredit = permissions.canSetCreditLimits;

  return state.invoices.map((invoice) => {
    const retailer = retailerMap.get(invoice.retailerId);
    const searchIndex = [
      invoice.id,
      retailer?.name,
      invoice.status,
      invoice.dueAt
    ]
      .join(" ")
      .toLowerCase();

    return `
      <tr data-search-index="${escapeHtml(searchIndex)}">
        <td>
          <strong>${escapeHtml(invoice.id)}</strong>
          <div class="muted">Issued ${formatDate(invoice.issuedAt)}</div>
        </td>
        <td>${escapeHtml(retailer?.name || "Unknown customer")}</td>
        <td>${statusPill(invoice.status)}</td>
        <td>${formatDate(invoice.dueAt)}</td>
        <td>${formatCurrency(invoice.amount)}</td>
        <td>
          <div class="row-actions">
            ${textButton({
              iconName: "check",
              label: invoice.status === "paid" ? "Paid" : "Mark paid",
              className: invoice.status === "paid" ? "" : "primary js-mark-paid",
              disabled: invoice.status === "paid" || !canUpdateCredit,
              data: { "invoice-id": invoice.id }
            })}
          </div>
        </td>
      </tr>
    `;
  });
}

function renderCreditExposureRows(state) {
  return state.creditLimits.map((limit) => {
    const usagePercent = limit.limit ? (Number(limit.balance || 0) / Number(limit.limit || 0)) * 100 : 100;
    const remaining = Math.max(0, Number(limit.limit || 0) - Number(limit.balance || 0));
    const status = usagePercent >= 100 ? "credit_hold" : usagePercent >= 85 ? "credit_watch" : "credit_clear";
    const searchIndex = [
      limit.partyName,
      limit.partyType,
      status
    ].join(" ").toLowerCase();

    return `
      <tr data-search-index="${escapeHtml(searchIndex)}">
        <td>
          <strong>${escapeHtml(limit.partyName)}</strong>
          <div class="muted">${escapeHtml(limit.partyType)}</div>
        </td>
        <td>${statusPill(status)}</td>
        <td>
          <div class="stock-line">
            <div class="stock-meta">
              <span>${formatCurrency(limit.balance)}</span>
              <span>${formatPercent(usagePercent)}</span>
            </div>
            ${progressBar(usagePercent, creditUsageTone(usagePercent))}
          </div>
        </td>
        <td>${formatCurrency(limit.limit)}</td>
        <td>${formatCurrency(remaining)}</td>
      </tr>
    `;
  });
}

function renderCreditLimitManager(state, permissions) {
  if (!permissions.canSetCreditLimits) return "";

  return `
    <section class="panel manager-tool-panel">
      ${panelHeader("Credit limit manager", "Set rep and supermarket limits with retained change history")}
      <form id="credit-limit-form" class="manager-form-grid" novalidate>
        <label class="field">
          <span>Account</span>
          <select name="creditLimitId" required>
            <option value="">Choose account</option>
            ${state.creditLimits.map((limit) => `
              <option value="${escapeHtml(limit.id)}">${escapeHtml(limit.partyName)} - ${escapeHtml(limit.partyType)}</option>
            `).join("")}
          </select>
        </label>
        <label class="field">
          <span>New limit</span>
          <input name="limit" type="number" min="1" step="1000" inputmode="numeric" placeholder="0" required>
        </label>
        <label class="field span-full">
          <span>Reason</span>
          <input name="reason" placeholder="Route growth, risk review, payment performance">
        </label>
        <div class="manager-form-actions span-full">
          ${textButton({
            iconName: "wallet",
            label: "Update limit",
            className: "primary",
            type: "submit"
          })}
        </div>
        <span id="credit-limit-message" class="field-error span-full"></span>
      </form>
    </section>
  `;
}

function renderCreditHistoryRows(state) {
  return (state.creditLimitHistory || []).map((entry) => {
    const searchIndex = [
      entry.partyName,
      entry.partyType,
      entry.changedBy,
      entry.reason
    ].join(" ").toLowerCase();

    return `
      <tr data-search-index="${escapeHtml(searchIndex)}">
        <td>
          <strong>${escapeHtml(entry.partyName)}</strong>
          <div class="muted">${escapeHtml(entry.partyType)}</div>
        </td>
        <td>${formatCurrency(entry.previousLimit)}</td>
        <td>${formatCurrency(entry.nextLimit)}</td>
        <td>${escapeHtml(entry.reason || "Manager adjustment")}</td>
        <td>
          ${escapeHtml(entry.changedBy)}
          <div class="muted">${formatDate(entry.changedAt?.slice(0, 10))}</div>
        </td>
      </tr>
    `;
  });
}

export function renderFinance({ state }) {
  const metrics = calculateMetrics(state);
  const vision = calculateVisionMetrics(state);
  const permissions = currentUserPermissions(state);
  const paidTotal = state.invoices
    .filter((invoice) => invoice.status === "paid")
    .reduce((total, invoice) => total + invoice.amount, 0);
  const overdueTotal = state.invoices
    .filter((invoice) => invoice.status === "overdue")
    .reduce((total, invoice) => total + invoice.amount, 0);

  return `
    <section class="view finance-view">
      <div class="finance-kpis">
        ${metricCard({
          label: "Balances owed",
          value: formatCurrency(metrics.receivables),
          meta: "Open customer credit",
          iconName: "wallet"
        })}
        ${metricCard({
          label: "Collected",
          value: formatCurrency(paidTotal),
          meta: "Confirmed customer payments",
          iconName: "check"
        })}
        ${metricCard({
          label: "Overdue",
          value: formatCurrency(overdueTotal),
          meta: "Needs collection follow-up",
          iconName: "alert"
        })}
        ${metricCard({
          label: "Credit limit usage",
          value: formatPercent(vision.creditExposurePercent),
          meta: `${formatNumber(vision.creditWatchCount + vision.creditHoldCount)} account${vision.creditWatchCount + vision.creditHoldCount === 1 ? "" : "s"} need attention`,
          iconName: "wallet"
        })}
      </div>
      ${renderCreditLimitManager(state, permissions)}

      <div class="finance-layout">
        <section class="panel">
          ${panelHeader("Credit aging", "Open balances owed by due-date bucket")}
          <div class="aging-list">${renderAgingRows(state.invoices)}</div>
        </section>

        <section class="panel">
          ${panelHeader("Customer balances", "Payment status by outlet and supermarket")}
          ${table(
            ["Invoice", "Customer", "Status", "Due", "Amount", ""],
            renderInvoiceRows(state, permissions),
            "No balances available"
          )}
        </section>
      </div>

      <section class="panel">
        ${panelHeader("Credit exposure", "Approved limits, current balances, and remaining headroom by rep or customer")}
        ${table(
          ["Account", "Status", "Usage", "Limit", "Headroom"],
          renderCreditExposureRows(state),
          "No credit limits available"
        )}
      </section>

      <section class="panel">
        ${panelHeader("Credit limit history", "Every manager adjustment stays visible")}
        ${table(
          ["Account", "Previous", "New", "Reason", "Changed by"],
          renderCreditHistoryRows(state),
          "No credit limit changes recorded"
        )}
      </section>
    </section>
  `;
}

export function bindFinance({ root, store }) {
  const creditForm = qs("#credit-limit-form", root);

  creditForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(creditForm);
    const message = qs("#credit-limit-message", root);
    const creditLimitId = String(formData.get("creditLimitId") || "");
    const limit = Number(formData.get("limit") || 0);

    if (message) message.textContent = "";

    if (!creditLimitId || !limit || limit <= 0) {
      if (message) message.textContent = "Choose an account and enter a new limit.";
      return;
    }

    store.dispatch({
      type: "UPDATE_CREDIT_LIMIT",
      creditLimitId,
      limit,
      reason: formData.get("reason"),
      message: "Credit limit updated"
    });
  });

  qsa(".js-mark-paid", root).forEach((button) => {
    button.addEventListener("click", () => {
      store.dispatch({
        type: "MARK_INVOICE_PAID",
        invoiceId: button.dataset.invoiceId,
        message: "Balance marked paid"
      });
    });
  });
}
