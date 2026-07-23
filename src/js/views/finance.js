import {
  calculateMetrics,
  calculateVisionMetrics,
  creditUsageTone,
  getFinancialSalesLines,
  getInvoiceAging,
  getRetailerMap
} from "../services/calculations.js?v=20260722";
import { currencySymbolFor, formatCurrency, formatDate, formatDateTime, formatNumber, formatPercent } from "../services/formatters.js";
import {
  currentUserPermissions,
  currentUserRole,
  salesRepresentativeAccounts,
  salesRepresentativeNames
} from "../services/rbac.js";
import { isModuleEnabled } from "../services/features.js";
import { saveRepresentativeCreditLimit } from "../services/backend.js";
import { dateIsWithinRange, normalizeDateRange } from "../services/filtering.js";
import { downloadInvoice, getFinancialInvoiceRecords, openInvoiceQuickView, printInvoice } from "../services/invoices.js?v=20260722d";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { iconButton, metricCard, panelHeader, progressBar, statusPill, table, textButton } from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { bindWorkspaceDataResetButtons } from "../ui/workspace-data-reset.js";
import { bindCeoDataDeletion, ceoDeleteControls, ceoSelectionCell } from "../ui/ceo-data-deletion.js";

const DEFAULT_FINANCE_TAB = "overview";
const FINANCE_PAGE_SIZE = 10;

function financeRouteParams() {
  if (typeof window === "undefined") return new URLSearchParams();

  const query = window.location.hash.split("?")[1] || "";
  return new URLSearchParams(query);
}

function financeTabHref(tabId) {
  return `#/finance?tab=${encodeURIComponent(tabId)}`;
}

function financeTabs(state) {
  return [
    {
      id: "overview",
      label: "Overview"
    },
    ...(isModuleEnabled(state, "field_reports") ? [{
      id: "sales-reports",
      label: "Sales reports"
    }] : []),
    {
      id: "invoices",
      label: "Invoices"
    },
    {
      id: "product-revenue",
      label: "Product revenue"
    },
    ...(isModuleEnabled(state, "credit_control") ? [
      {
        id: "credit-limits",
        label: "Credit limits"
      },
      {
        id: "credit-history",
        label: "Credit history"
      }
    ] : [])
  ];
}

function activeFinanceTabId(state) {
  const requestedTab = financeRouteParams().get("tab") || DEFAULT_FINANCE_TAB;

  return financeTabs(state).some((tab) => tab.id === requestedTab) ? requestedTab : DEFAULT_FINANCE_TAB;
}

function renderFinanceSubtabs(activeTabId, state) {
  return `
    <nav class="subtab-nav finance-subtabs" aria-label="Finance pages">
      ${financeTabs(state).map((tab) => `
        <a
          class="subtab-link ${tab.id === activeTabId ? "is-active" : ""}"
          href="${escapeHtml(financeTabHref(tab.id))}"
          aria-current="${tab.id === activeTabId ? "page" : "false"}"
        >
          ${escapeHtml(tab.label)}
        </a>
      `).join("")}
    </nav>
  `;
}

function renderAgingRows(state) {
  return getInvoiceAging(getFinancialInvoiceRecords(state))
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

function formatTermPercent(value) {
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(Number(value || 0))}%`;
}

function creditTermsSummary(limit) {
  return [
    `${formatTermPercent(limit.discountPercent)} discount`,
    `${formatNumber(limit.paymentPeriodDays ?? 14)} days`,
    `${formatTermPercent(limit.latePenaltyPercent)} late penalty`
  ].join(" - ");
}

function renderInvoiceRows(state, permissions) {
  const retailerMap = getRetailerMap(state.retailers);
  const canUpdateCredit = permissions.canSetCreditLimits;

  return getFinancialInvoiceRecords(state).map((invoice, index) => {
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
      <tr ${index >= FINANCE_PAGE_SIZE ? "hidden " : ""}data-finance-page-row="invoices" data-search-index="${escapeHtml(searchIndex)}">
        ${currentUserRole(state) === "ceo" ? ceoSelectionCell("invoices", invoice.id, `invoice ${invoice.id}`) : ""}
        <td>
          <strong>${escapeHtml(invoice.id)}</strong>
          <div class="muted">Issued ${formatDate(invoice.issuedAt)}</div>
        </td>
        <td>${escapeHtml(retailer?.name || invoice.customerName || "Customer")}</td>
        <td>${statusPill(invoice.status)}</td>
        <td>${formatDate(invoice.dueAt)}</td>
        <td>${formatCurrency(invoice.amount)}</td>
        <td>
          <div class="row-actions invoice-row-actions">
            ${iconButton({
              iconName: "eye",
              label: "View",
              className: "js-view-invoice",
              data: { "invoice-id": invoice.id }
            })}
            ${iconButton({
              iconName: "download",
              label: "Download",
              className: "js-download-invoice",
              data: { "invoice-id": invoice.id }
            })}
            ${iconButton({
              iconName: "print",
              label: "Print",
              className: "js-print-invoice",
              data: { "invoice-id": invoice.id }
            })}
            ${iconButton({
              iconName: "check",
              label: invoice.status === "paid" ? "Paid" : "Mark paid",
              className: `invoice-paid-action${invoice.status === "paid" ? " is-paid" : " js-mark-paid"}`,
              disabled: invoice.status === "paid" || !canUpdateCredit || invoice.derived,
              data: { "invoice-id": invoice.id }
            })}
          </div>
        </td>
      </tr>
    `;
  });
}

function creditAccounts(state) {
  return [...(state.creditLimits || [])]
    .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0) || String(a.partyName || "").localeCompare(String(b.partyName || "")));
}

function creditAccountStatus(limit) {
  const approvedLimit = Number(limit.limit || 0);
  const balance = Number(limit.balance || 0);
  const usagePercent = approvedLimit ? (balance / approvedLimit) * 100 : 100;
  return {
    usagePercent,
    status: usagePercent >= 100 ? "credit_hold" : usagePercent >= 85 ? "credit_watch" : "credit_clear"
  };
}

function isRepresentativeCreditAccount(limit) {
  return Boolean(limit.repUserId) || String(limit.partyType || "").toLowerCase().includes("representative");
}

function renderCreditAccountList(state, accountType) {
  const limits = creditAccounts(state);
  const matchingAccounts = limits
    .map((limit, index) => ({ limit, index }))
    .filter(({ limit }) => accountType === "representative"
      ? isRepresentativeCreditAccount(limit)
      : !isRepresentativeCreditAccount(limit));

  if (!matchingAccounts.length) {
    return `<div class="empty-state">No ${accountType === "representative" ? "sales representative credit reports" : "customer credit terms"} available</div>`;
  }

  return `
    <div class="credit-account-list">
      ${matchingAccounts.map(({ limit, index }) => {
        const { usagePercent, status } = creditAccountStatus(limit);
        const scope = accountType === "representative" ? "representative_credit_limits" : "customer_credit_limits";
        return `
          <div class="credit-account-select-row">
            <input type="checkbox" data-ceo-delete-item="${scope}" value="${escapeHtml(limit.id)}" aria-label="Select ${escapeHtml(limit.partyName)} credit report">
            <button class="credit-account-list-item js-open-credit-account" type="button" data-credit-account-index="${index}" data-search-index="${escapeHtml(`${limit.partyName} ${limit.partyType} ${status}`.toLowerCase())}">
              <span class="credit-account-avatar">${escapeHtml(String(limit.partyName || "AC").slice(0, 2).toUpperCase())}</span>
              <span class="credit-account-name"><strong>${escapeHtml(limit.partyName)}</strong><small>${escapeHtml(limit.partyType || "Credit account")}</small></span>
              <span class="credit-account-usage"><strong>${formatPercent(usagePercent)}</strong><small>used</small></span>
              ${statusPill(status)}
              <span class="credit-account-view" aria-hidden="true">${icon("eye")}</span>
            </button>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderCreditAccountDetails(limit, state) {
  if (!limit) return "";
  const { usagePercent, status } = creditAccountStatus(limit);
  const approvedLimit = Number(limit.limit || 0);
  const balance = Number(limit.balance || 0);
  const remaining = Math.max(0, approvedLimit - balance);
  const latestHistory = [...(state.creditLimitHistory || [])]
    .filter((entry) => String(entry.partyName || "").trim().toLowerCase() === String(limit.partyName || "").trim().toLowerCase())
    .sort((a, b) => String(b.changedAt || "").localeCompare(String(a.changedAt || "")))[0];

  return `
    <div class="credit-account-detail-heading">
      <div><span class="eyebrow">${escapeHtml(limit.partyType || "Credit account")}</span><h3>${escapeHtml(limit.partyName)}</h3></div>
      ${statusPill(status)}
    </div>
    <div class="credit-account-detail-grid">
      <div><span>Current balance</span><strong>${formatCurrency(balance)}</strong></div>
      <div><span>Approved limit</span><strong>${formatCurrency(approvedLimit)}</strong></div>
      <div><span>Amount remaining</span><strong>${formatCurrency(remaining)}</strong></div>
      <div><span>Limit used</span><strong>${formatPercent(usagePercent)}</strong></div>
      <div><span>Payment period</span><strong>${formatNumber(limit.paymentPeriodDays ?? 14)} days</strong></div>
      <div><span>Discount</span><strong>${formatTermPercent(limit.discountPercent)}</strong></div>
      <div><span>Late penalty</span><strong>${formatTermPercent(limit.latePenaltyPercent)}</strong></div>
      <div><span>Previous limit</span><strong>${formatCurrency(limit.previousLimit || latestHistory?.previousLimit || 0)}</strong></div>
    </div>
    <div class="credit-account-change-note">
      <span>Latest change</span>
      <strong>${escapeHtml(limit.changedBy || latestHistory?.changedBy || "Not recorded")}</strong>
      <small>${formatDateTime(limit.changedAt || latestHistory?.changedAt)}${latestHistory?.reason ? ` · ${escapeHtml(latestHistory.reason)}` : ""}</small>
    </div>
  `;
}

function renderCreditAccountModal() {
  return `
    <div id="credit-account-modal" class="stock-modal-backdrop" tabindex="-1" hidden>
      <section class="stock-modal credit-account-modal" role="dialog" aria-modal="true" aria-labelledby="credit-account-modal-title">
        <header class="stock-modal-header">
          <div><span class="eyebrow">Credit account</span><h2 id="credit-account-modal-title">Account details</h2></div>
          ${iconButton({ iconName: "x", label: "Close credit account", className: "js-close-credit-account" })}
        </header>
        <div data-credit-account-detail></div>
      </section>
    </div>
  `;
}

function renderCreditLimitManager(state, permissions) {
  if (!permissions.canSetCreditLimits) return "";

  const moneySymbol = currencySymbolFor(state.client);
  const customers = [...(state.retailers || [])]
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  return `
    <section class="panel manager-tool-panel">
      ${panelHeader("Customer credit terms", "Set limit, discount, payment period, and late-payment penalty with retained history")}
      <form id="credit-limit-form" class="manager-form-grid" novalidate>
        <label class="field">
          <span>Customer</span>
          <select name="customerId" required ${customers.length ? "" : "disabled"}>
            <option value="">Choose customer</option>
            ${customers.map((customer) => {
              const limit = state.creditLimits.find((item) => (
                item.retailerId === customer.id ||
                String(item.partyName || "").trim().toLowerCase() === String(customer.name || "").trim().toLowerCase()
              ));

              return `
                <option value="${escapeHtml(customer.id)}" data-credit-limit-id="${escapeHtml(limit?.id || "")}">
                  ${escapeHtml(customer.name)}${limit ? "" : " - no limit set"}
                </option>
              `;
            }).join("")}
          </select>
        </label>
        <label class="field">
          <span>New limit (${escapeHtml(moneySymbol)})</span>
          <input name="limit" type="number" min="1" step="1000" inputmode="numeric" placeholder="0" required ${customers.length ? "" : "disabled"}>
        </label>
        <label class="field">
          <span>Discount (%)</span>
          <input name="discountPercent" type="number" min="0" max="100" step="0.1" inputmode="decimal" placeholder="0" ${customers.length ? "" : "disabled"}>
        </label>
        <label class="field">
          <span>Payment period</span>
          <input name="paymentPeriodDays" type="number" min="0" step="1" inputmode="numeric" placeholder="14" ${customers.length ? "" : "disabled"}>
        </label>
        <label class="field">
          <span>Late payment penalty (%)</span>
          <input name="latePenaltyPercent" type="number" min="0" max="100" step="0.1" inputmode="decimal" placeholder="0" ${customers.length ? "" : "disabled"}>
        </label>
        <label class="field span-full">
          <span>Reason</span>
          <input name="reason" placeholder="Payment performance, credit review, approved discount" ${customers.length ? "" : "disabled"}>
        </label>
        <div class="manager-form-actions span-full">
          ${textButton({
            iconName: "wallet",
            label: "Save customer credit terms",
            className: "primary",
            type: "submit",
            disabled: !customers.length
          })}
        </div>
        <span id="credit-limit-message" class="field-error span-full">
          ${customers.length ? "" : "Add a customer before setting credit terms."}
        </span>
      </form>
    </section>
  `;
}

function renderRepresentativeCreditManager(state, permissions) {
  if (!permissions.canSetCreditLimits) return "";

  const representatives = salesRepresentativeAccounts(state);
  const moneySymbol = currencySymbolFor(state.client);

  return `
    <section class="panel manager-tool-panel">
      ${panelHeader("Sales representative credit", "Set the working credit amount a representative can sell before they settle")}
      <form id="rep-credit-limit-form" class="manager-form-grid" novalidate>
        <label class="field">
          <span>Sales representative</span>
          <select name="repKey" required ${representatives.length ? "" : "disabled"}>
            <option value="">Choose representative</option>
            ${representatives.map((account) => `
              <option
                value="${escapeHtml(account.userId || account.id || account.name)}"
                data-rep-membership-id="${escapeHtml(account.id || "")}"
                data-rep-name="${escapeHtml(account.name)}"
                data-rep-user-id="${escapeHtml(account.userId || "")}"
                data-rep-email="${escapeHtml(account.email || "")}"
              >
                ${escapeHtml(account.name)}
              </option>
            `).join("")}
          </select>
        </label>
        <label class="field">
          <span>Working credit limit (${escapeHtml(moneySymbol)})</span>
          <input name="limit" type="number" min="1" step="1000" inputmode="numeric" placeholder="0" required ${representatives.length ? "" : "disabled"}>
        </label>
        <label class="field">
          <span>Days to settle</span>
          <input name="paymentPeriodDays" type="number" min="0" step="1" inputmode="numeric" value="1" ${representatives.length ? "" : "disabled"}>
        </label>
        <label class="field span-full">
          <span>Reason</span>
          <input name="reason" placeholder="Daily route limit, risk review, payment performance" ${representatives.length ? "" : "disabled"}>
        </label>
        <div class="manager-form-actions span-full">
          ${textButton({
            iconName: "wallet",
            label: "Save representative limit",
            className: "primary",
            type: "submit",
            disabled: !representatives.length
          })}
        </div>
        <span id="rep-credit-limit-message" class="field-error span-full">
          ${representatives.length ? "" : "Add a sales representative in Team before setting a limit."}
        </span>
      </form>
    </section>
  `;
}

function isRepresentativeCreditHistory(entry) {
  return String(entry.partyType || "").toLowerCase().includes("representative");
}

function creditHistoryEntries(state, accountType) {
  return [...(state.creditLimitHistory || [])]
    .filter((entry) => accountType === "representative" ? isRepresentativeCreditHistory(entry) : !isRepresentativeCreditHistory(entry))
    .sort((a, b) => String(b.changedAt || "").localeCompare(String(a.changedAt || "")))
}

function renderCreditHistoryRows(state, accountType) {
  const pageId = `credit-history-${accountType}`;

  return creditHistoryEntries(state, accountType)
    .map((entry, index) => {
    const searchIndex = [
      entry.partyName,
      entry.partyType,
      entry.changedBy,
      entry.reason
    ].join(" ").toLowerCase();

    return `
      <tr ${index >= FINANCE_PAGE_SIZE ? "hidden " : ""}data-finance-page-row="${pageId}" data-credit-history-row data-credit-history-account="${escapeHtml(entry.partyName)}" data-credit-history-date="${escapeHtml(String(entry.changedAt || "").slice(0, 10))}" data-search-index="${escapeHtml(searchIndex)}">
        ${currentUserRole(state) === "ceo" ? ceoSelectionCell(
          accountType === "representative" ? "representative_credit_history" : "customer_credit_history",
          entry.id,
          `${entry.partyName} credit history`
        ) : ""}
        <td>
          <strong>${escapeHtml(entry.partyName)}</strong>
          <div class="muted">${escapeHtml(entry.partyType)}</div>
        </td>
        <td>${formatCurrency(entry.previousLimit)}</td>
        <td>${formatCurrency(entry.nextLimit)}</td>
        <td>${escapeHtml([
          `${formatTermPercent(entry.discountPercent)} discount`,
          `${formatNumber(entry.paymentPeriodDays ?? 14)} days`,
          `${formatTermPercent(entry.latePenaltyPercent)} penalty`
        ].join(" - "))}</td>
        <td>${escapeHtml(entry.reason || "CEO adjustment")}</td>
        <td>
          ${escapeHtml(entry.changedBy)}
          <div class="muted">${formatDateTime(entry.changedAt)}</div>
        </td>
      </tr>
    `;
  });
}

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function getAccountantSalesLines(state) {
  return getFinancialSalesLines(state);
}

function getReportProductIds(report, transactionMap) {
  const lineProductIds = (report.reportLines || [])
    .map((line) => line.productId)
    .filter(Boolean);
  const transactionProductIds = (report.transactionIds || [])
    .map((transactionId) => transactionMap.get(transactionId)?.productId)
    .filter(Boolean);

  return [...new Set([...lineProductIds, ...transactionProductIds])];
}

function getAccountantSummary(state) {
  const salesLines = getAccountantSalesLines(state);
  const reportedSales = (state.salesReports || []).reduce((total, report) => total + Number(report.salesAmount || 0), 0);
  const revenue = salesLines.reduce((total, line) => total + line.revenue, 0);
  const cost = salesLines.reduce((total, line) => total + line.cost, 0);
  const profit = salesLines.reduce((total, line) => total + line.profit, 0);
  const cashSalesReceived = salesLines.reduce((total, line) => total + Number(line.cashAmount || 0), 0);
  const collectedCredit = getFinancialInvoiceRecords(state)
    .filter((invoice) => invoice.status === "paid" && String(invoice.paymentType || "").toLowerCase().includes("credit") && invoice.paidAt)
    .reduce((total, invoice) => total + Number(invoice.amount || 0), 0);
  const cashIn = cashSalesReceived + collectedCredit;
  const creditOwed = (state.creditLimits || []).reduce((total, limit) => total + Number(limit.balance || 0), 0);
  const returns = salesLines.reduce((total, line) => total + Number(line.returnAmount || 0), 0);
  const productMap = new Map((state.products || []).map((product) => [product.id, product]));
  const stockLoss = (state.stockTransactions || [])
    .filter((transaction) => String(transaction.type || "").toLowerCase() === "write off")
    .reduce((total, transaction) => {
      const product = productMap.get(transaction.productId);
      const unitCost = Number(transaction.unitCost ?? transaction.unitCostAtSale ?? product?.unitCost ?? product?.unitPrice ?? 0);
      return total + Number(transaction.quantity || 0) * unitCost;
    }, 0);

  return {
    reportedSales,
    cashIn,
    revenue,
    cost,
    profit,
    creditOwed,
    returns,
    stockLoss
  };
}

function accountantMetricCard({ label, value, summaryKey }) {
  return `
    <article class="finance-compact-summary-card">
      <span>${escapeHtml(label)}</span>
      <strong class="js-accountant-summary" data-summary="${escapeHtml(summaryKey)}">${escapeHtml(value)}</strong>
    </article>
  `;
}

function renderAccountantSummaryCards(summary, state) {
  const creditControlEnabled = isModuleEnabled(state, "credit_control");

  return `
    <div class="finance-compact-summary" aria-label="Financial summary">
      ${accountantMetricCard({
        label: "Cash in",
        value: formatCurrency(summary.cashIn),
        summaryKey: "cashIn"
      })}
      ${accountantMetricCard({
        label: "Product revenue",
        value: formatCurrency(summary.revenue),
        summaryKey: "revenue"
      })}
      ${accountantMetricCard({
        label: "Gross profit",
        value: formatCurrency(summary.profit),
        summaryKey: "profit"
      })}
      ${creditControlEnabled ? accountantMetricCard({
        label: "Credit owed",
        value: formatCurrency(summary.creditOwed),
        summaryKey: "creditOwed"
      }) : ""}
      ${accountantMetricCard({
        label: "Returns",
        value: formatCurrency(summary.returns),
        summaryKey: "returns"
      })}
      ${accountantMetricCard({
        label: "Stock loss",
        value: formatCurrency(summary.stockLoss),
        summaryKey: "stockLoss"
      })}
    </div>
  `;
}

function renderAccountantFilters(state) {
  const products = [...(state.products || [])]
    .filter((product) => Number(product.unitPrice || 0) > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  const accountNames = salesRepresentativeNames(state);
  const repNames = new Set(accountNames);

  if (!accountNames.length) {
    (state.salesReports || []).forEach((report) => repNames.add(report.repName));
    (state.creditLimits || []).forEach((limit) => {
      if (String(limit.partyType || "").toLowerCase().includes("representative")) {
        repNames.add(limit.partyName);
      }
    });
  }

  (state.stockTransactions || []).forEach((transaction) => {
    const type = String(transaction.type || "").toLowerCase();
    if (type === "sale" || type === "return") {
      repNames.add(transaction.recordedBy);
    }
  });
  (state.orders || []).forEach((order) => repNames.add(order.repName));

  const representatives = [...repNames].filter(Boolean).sort((a, b) => a.localeCompare(b));

  return `
    <section class="panel accountant-filter-panel">
      ${panelHeader(
        "Reports",
        "Filter sales, credit, and profit records",
        `<div class="accountant-export-actions">
          ${textButton({ iconName: "download", label: "CSV", className: "subtle js-accountant-export", data: { format: "csv" } })}
          ${textButton({ iconName: "download", label: "Excel", className: "subtle js-accountant-export", data: { format: "excel" } })}
          ${textButton({ iconName: "download", label: "PDF", className: "subtle js-accountant-export", data: { format: "pdf" } })}
        </div>`
      )}
      <div class="accountant-filter-grid">
        <label class="field">
          <span>Product</span>
          <select id="accountant-product-filter">
            <option value="all">All products</option>
            ${products.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Sales representative</span>
          <select id="accountant-rep-filter">
            <option value="all">All representatives</option>
            ${representatives.map((repName) => `<option value="${escapeHtml(repName)}">${escapeHtml(repName)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Period</span>
          <select id="accountant-period-filter">
            <option value="all">All dates</option>
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="custom">Custom range</option>
          </select>
        </label>
        <label class="field accountant-custom-range" hidden>
          <span>From</span>
          <input id="accountant-date-from" type="date">
        </label>
        <label class="field accountant-custom-range" hidden>
          <span>To</span>
          <input id="accountant-date-to" type="date">
        </label>
      </div>
      <div class="accountant-filter-foot">
        <span class="muted js-accountant-result-count"></span>
        ${textButton({ iconName: "refresh", label: "Reset filters", className: "subtle", data: { "accountant-reset": "true" } })}
      </div>
    </section>
  `;
}

function renderAccountantSalesReportRows(state) {
  const transactionMap = new Map((state.stockTransactions || []).map((transaction) => [transaction.id, transaction]));

  return [...(state.salesReports || [])]
    .sort((a, b) => dateOnly(b.reportDate).localeCompare(dateOnly(a.reportDate)))
    .map((report) => {
      const productIds = getReportProductIds(report, transactionMap);
      const searchIndex = [
        report.id,
        report.repName,
        report.tripLabel,
        report.status,
        report.reportDate
      ].join(" ").toLowerCase();

      return `
        <tr
          data-accountant-row="true"
          data-report-type="sales"
          data-product-sensitive="true"
          data-products="${escapeHtml(productIds.join(" "))}"
          data-rep="${escapeHtml(report.repName || "")}"
          data-date="${escapeHtml(dateOnly(report.reportDate))}"
          data-sales="${Number(report.salesAmount || 0)}"
          data-search-index="${escapeHtml(searchIndex)}"
        >
          ${currentUserRole(state) === "ceo" ? ceoSelectionCell("sales_reports", report.id, `sales report ${report.id}`) : ""}
          <td>
            <strong>${escapeHtml(report.id)}</strong>
            <div class="muted">${escapeHtml(report.tripLabel || "Sales report")}</div>
          </td>
          <td>${escapeHtml(report.repName || "Unassigned")}</td>
          <td>${formatDate(report.reportDate)}</td>
          <td>${formatCurrency(report.salesAmount)}</td>
          <td>${formatCurrency(report.returnAmount)}</td>
          <td>${statusPill(report.status)}</td>
        </tr>
      `;
    });
}

function renderAccountantProductRows(state) {
  return getAccountantSalesLines(state)
    .sort((a, b) => b.date.localeCompare(a.date) || a.productName.localeCompare(b.productName))
    .map((line) => {
      const searchIndex = [
        line.recordId,
        line.productName,
        line.repName,
        line.customerName,
        line.source,
        line.status,
        line.paymentType
      ].join(" ").toLowerCase();

      return `
        <tr
          data-accountant-row="true"
          data-report-type="financial"
          data-product-sensitive="true"
          data-products="${escapeHtml(line.productId)}"
          data-rep="${escapeHtml(line.repName)}"
          data-date="${escapeHtml(line.date)}"
          data-revenue="${line.revenue}"
          data-cost="${line.cost}"
          data-profit="${line.profit}"
          data-cash="${line.cashAmount || 0}"
          data-credit="${line.creditAmount || 0}"
          data-return="${line.returnAmount || 0}"
          data-search-index="${escapeHtml(searchIndex)}"
        >
          ${currentUserRole(state) === "ceo" ? ceoSelectionCell("product_revenue", line.id, `${line.productName} revenue record`) : ""}
          <td>
            ${formatDate(line.date)}
            <div class="muted">${escapeHtml(line.source || line.recordId)}</div>
          </td>
          <td>${escapeHtml(line.productName)}</td>
          <td>${escapeHtml(line.repName)}</td>
          <td>${escapeHtml(line.customerName)}</td>
          <td>${formatNumber(line.quantity)}</td>
          <td>${escapeHtml(line.paymentType || line.source || "cash")}</td>
          <td>${formatCurrency(line.revenue)}</td>
          <td>${formatCurrency(line.cost)}</td>
          <td>${formatCurrency(line.profit)}</td>
          <td>${formatPercent(line.margin)}</td>
        </tr>
      `;
    });
}

function renderAccountantCreditRows(state) {
  return [...(state.creditLimits || [])]
    .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0))
    .map((limit) => {
      const balance = Number(limit.balance || 0);
      const creditLimit = Number(limit.limit || 0);
      const usagePercent = creditLimit ? (balance / creditLimit) * 100 : 100;
      const remaining = Math.max(0, creditLimit - balance);
      const status = usagePercent >= 100 ? "credit_hold" : usagePercent >= 85 ? "credit_watch" : "credit_clear";
      const isRepresentative = String(limit.partyType || "").toLowerCase().includes("representative");
      const searchIndex = [
        limit.partyName,
        limit.partyType,
        status,
        limit.changedBy
      ].join(" ").toLowerCase();

      return `
        <tr
          data-accountant-row="true"
          data-report-type="credit"
          data-product-sensitive="false"
          data-rep="${escapeHtml(isRepresentative ? limit.partyName : "")}"
          data-date="${escapeHtml(dateOnly(limit.changedAt))}"
          data-balance="${balance}"
          data-search-index="${escapeHtml(searchIndex)}"
        >
          <td>
            <strong>${escapeHtml(limit.partyName)}</strong>
            <div class="muted">${escapeHtml(limit.partyType)}</div>
          </td>
          <td>${statusPill(status)}</td>
          <td>${formatCurrency(balance)}</td>
          <td>${formatCurrency(creditLimit)}</td>
          <td>${formatCurrency(remaining)}</td>
          <td>
            ${progressBar(usagePercent, creditUsageTone(usagePercent))}
            <div class="muted">${formatPercent(usagePercent)} used</div>
          </td>
          <td>
            ${formatDate(dateOnly(limit.changedAt))}
            <div class="muted">${escapeHtml(limit.changedBy || "System")}</div>
          </td>
        </tr>
      `;
    });
}

function renderAccountantProductRevenue(state) {
  const rowsByProduct = new Map();

  getAccountantSalesLines(state).forEach((line) => {
    const row = rowsByProduct.get(line.productId) || {
      productName: line.productName,
      revenue: 0,
      profit: 0,
      quantity: 0
    };

    row.revenue += Number(line.revenue || 0);
    row.profit += Number(line.profit || 0);
    row.quantity += Number(line.quantity || 0);
    rowsByProduct.set(line.productId, row);
  });

  const rows = [...rowsByProduct.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);
  const highestRevenue = Math.max(...rows.map((row) => Math.max(0, row.revenue)), 1);

  if (!rows.length) {
    return `<div class="empty-state">No product revenue available yet</div>`;
  }

  return rows.map((row) => {
    const percent = (Math.max(0, row.revenue) / highestRevenue) * 100;

    return `
      <div class="bar-row" data-search-index="${escapeHtml(row.productName.toLowerCase())}">
        <strong>${escapeHtml(row.productName)}</strong>
        ${progressBar(percent, row.profit < 0 ? "danger" : "good")}
        <span class="strong">${formatCurrency(row.revenue)}</span>
      </div>
    `;
  }).join("");
}

function renderCreditHistoryFilters(state) {
  const names = [...new Set((state.creditLimitHistory || []).map((entry) => entry.partyName).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  return `
    <section class="accountant-filter-panel" aria-label="Credit terms history filters">
      <div class="accountant-filter-grid">
        <label class="field">
          <span>Sales representative or customer</span>
          <select id="credit-history-account">
            <option value="">Everyone</option>
            ${names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>From date</span>
          <input id="credit-history-from" type="date">
        </label>
        <label class="field">
          <span>To date</span>
          <input id="credit-history-to" type="date">
        </label>
      </div>
      <div class="accountant-filter-foot">
        <span class="muted" id="credit-history-result-count"></span>
        <div class="accountant-export-actions">
          <button class="button" type="button" data-credit-history-reset>Clear filters</button>
          <button class="button" type="button" data-credit-history-export="csv">Download CSV</button>
          <button class="button primary" type="button" data-credit-history-export="pdf">Print / PDF</button>
        </div>
      </div>
    </section>
  `;
}

function renderAccountantFinanceTab(activeTabId, state, summary) {
  if (activeTabId === "invoices") {
    const canDelete = currentUserRole(state) === "ceo";
    return `
      <section class="panel accountant-invoices-panel">
        ${panelHeader("Invoices", "Download, print, and confirm customer payments")}
        ${canDelete ? ceoDeleteControls({
          scope: "invoices",
          clearLabel: "Clear invoices",
          disabled: !getFinancialInvoiceRecords(state).length
        }) : ""}
        ${table(
          [...(canDelete ? [""] : []), "Invoice", "Customer", "Status", "Due", "Amount", "Actions"],
          renderInvoiceRows(state, currentUserPermissions(state)),
          "No invoices available"
        )}
        ${renderFinancePagination("invoices")}
      </section>
    `;
  }

  if (activeTabId === "sales-reports") {
    const canDelete = currentUserRole(state) === "ceo";
    return `
      ${renderAccountantFilters(state)}
      <section class="panel" data-export-table="true" data-export-title="Sales reports">
        ${panelHeader("Sales reports", "Read-only submitted sales activity")}
        ${canDelete ? ceoDeleteControls({
          scope: "sales_reports",
          clearLabel: "Clear sales reports",
          disabled: !(state.salesReports || []).length
        }) : ""}
        ${table(
          [...(canDelete ? [""] : []), "Report", "Sales representative", "Date", "Sales", "Returns", "Status"],
          renderAccountantSalesReportRows(state),
          "No sales reports available"
        )}
      </section>
    `;
  }

  if (activeTabId === "product-revenue") {
    const canDelete = currentUserRole(state) === "ceo";
    const revenueLines = getAccountantSalesLines(state);
    return `
      ${renderAccountantFilters(state)}
      <section class="panel">
        ${panelHeader("Product revenue", "Top product lines by sales value")}
        <div class="bar-list">${renderAccountantProductRevenue(state)}</div>
      </section>
      <section class="panel" data-export-table="true" data-export-title="Revenue cost and profit">
        ${panelHeader("Revenue, cost, and profit", "Product-level financial summary")}
        ${canDelete ? ceoDeleteControls({
          scope: "product_revenue",
          clearLabel: "Clear revenue data",
          disabled: !revenueLines.length
        }) : ""}
        ${table(
          [...(canDelete ? [""] : []), "Date", "Product", "Sales representative", "Customer", "Qty", "Payment", "Revenue", "Cost", "Profit", "Margin"],
          renderAccountantProductRows(state),
          "No product financial records available"
        )}
      </section>
    `;
  }

  if (activeTabId === "credit-reports") {
    return `
      ${renderAccountantFilters(state)}
      <section class="panel" data-export-table="true" data-export-title="Credit reports">
        ${panelHeader("Credit reports", "Balances, approved limits, and payment risk")}
        ${table(
          ["Account", "Status", "Balance", "Limit", "Available", "Usage", "Updated"],
          renderAccountantCreditRows(state),
          "No credit reports available"
        )}
      </section>
    `;
  }

  return `
    ${renderAccountantSummaryCards(summary, state)}
    <section class="panel">
      ${panelHeader("Product revenue", "Top product lines by sales value")}
      <div class="bar-list">${renderAccountantProductRevenue(state)}</div>
    </section>
  `;
}

export function renderFinance({ state }) {
  const metrics = calculateMetrics(state);
  const vision = calculateVisionMetrics(state);
  const financialSummary = getAccountantSummary(state);
  const permissions = currentUserPermissions(state);
  const activeTabId = activeFinanceTabId(state);
  const invoiceRecords = getFinancialInvoiceRecords(state);
  const paidTotal = invoiceRecords
    .filter((invoice) => invoice.status === "paid")
    .reduce((total, invoice) => total + invoice.amount, 0);
  const overdueTotal = invoiceRecords
    .filter((invoice) => invoice.status === "overdue")
    .reduce((total, invoice) => total + invoice.amount, 0);

  return `
    <section class="view finance-view">
      ${renderFinanceSubtabs(activeTabId, state)}
      ${currentUserRole(state) === "ceo" && activeTabId === "overview" ? `
        <div class="page-reset-action">
          ${textButton({ iconName: "trash", label: "Clear finance data", className: "warning", data: { "reset-workspace-scope": "finance" } })}
        </div>
      ` : ""}
      ${activeTabId === "overview" ? `
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
        ${renderAccountantSummaryCards(financialSummary, state)}
        <section class="panel">
          ${panelHeader("Credit aging", "Open balances grouped by how long payment has been overdue")}
          <div class="aging-list">${renderAgingRows(state)}</div>
        </section>
      ` : ""}

      ${activeTabId === "credit-limits" ? `
        ${renderRepresentativeCreditManager(state, permissions)}
        ${renderCreditLimitManager(state, permissions)}
        <section class="panel credit-report-panel" data-credit-report-type="representative">
          ${panelHeader("Sales representative credit reports", "Select a sales representative to view their complete credit information")}
          ${ceoDeleteControls({
            scope: "representative_credit_limits",
            clearLabel: "Clear representative credit reports",
            disabled: !creditAccounts(state).some(isRepresentativeCreditAccount)
          })}
          ${renderCreditAccountList(state, "representative")}
        </section>
        <section class="panel credit-report-panel" data-credit-report-type="customer">
          ${panelHeader("Customer credit terms", "Select a customer to view their complete credit information")}
          ${ceoDeleteControls({
            scope: "customer_credit_limits",
            clearLabel: "Clear customer credit terms",
            disabled: !creditAccounts(state).some((limit) => !isRepresentativeCreditAccount(limit))
          })}
          ${renderCreditAccountList(state, "customer")}
        </section>
        ${renderCreditAccountModal()}
      ` : ""}

      ${activeTabId === "credit-history" ? `
        ${renderCreditHistoryFilters(state)}
        <section class="panel">
          ${panelHeader("Sales representative credit terms history", "Every change stays visible and cannot be edited")}
          ${ceoDeleteControls({
            scope: "representative_credit_history",
            clearLabel: "Clear representative credit history",
            disabled: !creditHistoryEntries(state, "representative").length
          })}
          ${table(
            ["", "Account", "Previous", "New", "Terms", "Reason", "Changed by"],
            renderCreditHistoryRows(state, "representative"),
            "No sales representative credit changes recorded"
          )}
          ${renderFinancePagination("credit-history-representative")}
        </section>
        <section class="panel">
          ${panelHeader("Customer credit terms history", "Every change stays visible and cannot be edited")}
          ${ceoDeleteControls({
            scope: "customer_credit_history",
            clearLabel: "Clear customer credit history",
            disabled: !creditHistoryEntries(state, "customer").length
          })}
          ${table(
            ["", "Account", "Previous", "New", "Terms", "Reason", "Changed by"],
            renderCreditHistoryRows(state, "customer"),
            "No customer credit changes recorded"
          )}
          ${renderFinancePagination("credit-history-customer")}
        </section>
      ` : ""}

      ${["sales-reports", "invoices", "product-revenue"].includes(activeTabId)
        ? renderAccountantFinanceTab(activeTabId, state, financialSummary)
        : ""}
    </section>
  `;
}

function renderFinancePagination(id) {
  return `
    <div class="activity-pagination" data-finance-pagination="${escapeHtml(id)}" hidden>
      <button class="button" type="button" data-finance-page="prev">Previous</button>
      <span data-finance-page-status>Page 1 of 1</span>
      <button class="button" type="button" data-finance-page="next">Next</button>
    </div>
  `;
}

function parseLocalDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function rowMatchesPeriod(rowDateValue, period, fromValue, toValue) {
  if (period === "all") return true;

  const rowDate = parseLocalDate(rowDateValue);
  if (!rowDate) return false;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (period === "today") {
    return rowDate.getTime() === today.getTime();
  }

  if (period === "7d" || period === "30d") {
    const days = period === "7d" ? 7 : 30;
    const start = new Date(today);
    start.setDate(today.getDate() - (days - 1));
    return rowDate >= start && rowDate <= today;
  }

  if (period === "custom") {
    const { from, to } = normalizeDateRange(fromValue, toValue);
    const fromDate = parseLocalDate(from);
    const toDate = parseLocalDate(to);
    if (fromDate && rowDate < fromDate) return false;
    if (toDate && rowDate > toDate) return false;
  }

  return true;
}

function updateAccountantSummary(root) {
  const allRows = qsa("[data-accountant-row]", root);
  if (!allRows.length) return;

  const visibleRows = allRows.filter((row) => !row.hidden);
  const visibleSalesRows = visibleRows.filter((row) => row.dataset.reportType === "sales");
  const visibleFinancialRows = visibleRows.filter((row) => row.dataset.reportType === "financial");
  const visibleCreditRows = visibleRows.filter((row) => row.dataset.reportType === "credit");
  const totals = {
    reportedSales: visibleSalesRows.reduce((total, row) => total + Number(row.dataset.sales || 0), 0),
    revenue: visibleFinancialRows.reduce((total, row) => total + Number(row.dataset.revenue || 0), 0),
    cost: visibleFinancialRows.reduce((total, row) => total + Number(row.dataset.cost || 0), 0),
    profit: visibleFinancialRows.reduce((total, row) => total + Number(row.dataset.profit || 0), 0),
    cashIn: visibleFinancialRows.reduce((total, row) => total + Number(row.dataset.cash || 0), 0),
    creditOwed: visibleCreditRows.reduce((total, row) => total + Number(row.dataset.balance || 0), 0),
    returns: visibleFinancialRows.reduce((total, row) => total + Number(row.dataset.return || 0), 0)
  };

  qsa("[data-summary]", root).forEach((target) => {
    if (target.dataset.summary === "stockLoss") return;

    target.textContent = formatCurrency(totals[target.dataset.summary] || 0);
  });

  const resultCount = qs(".js-accountant-result-count", root);
  if (resultCount) {
    resultCount.textContent = `${formatNumber(visibleRows.length)} visible report row${visibleRows.length === 1 ? "" : "s"}`;
  }
}

function bindAccountantFinance({ root }) {
  const productFilter = qs("#accountant-product-filter", root);
  const repFilter = qs("#accountant-rep-filter", root);
  const periodFilter = qs("#accountant-period-filter", root);
  const dateFrom = qs("#accountant-date-from", root);
  const dateTo = qs("#accountant-date-to", root);
  const resetButton = qs("[data-accountant-reset]", root);
  const customRangeFields = qsa(".accountant-custom-range", root);

  function applyFilters() {
    const productId = productFilter?.value || "all";
    const repName = repFilter?.value || "all";
    const period = periodFilter?.value || "all";
    const fromValue = dateFrom?.value || "";
    const toValue = dateTo?.value || "";

    customRangeFields.forEach((field) => {
      field.hidden = period !== "custom";
    });

    qsa("[data-accountant-row]", root).forEach((row) => {
      const productSensitive = row.dataset.productSensitive === "true";
      const productIds = String(row.dataset.products || "").split(/\s+/).filter(Boolean);
      const productMatches = productId === "all" || !productSensitive || productIds.includes(productId);
      const repMatches = repName === "all" || row.dataset.rep === repName;
      const periodMatches = rowMatchesPeriod(row.dataset.date, period, fromValue, toValue);

      row.hidden = !productMatches || !repMatches || !periodMatches;
    });

    updateAccountantSummary(root);
  }

  [productFilter, repFilter, periodFilter, dateFrom, dateTo].filter(Boolean).forEach((control) => {
    control.addEventListener("change", applyFilters);
  });

  resetButton?.addEventListener("click", () => {
    if (productFilter) productFilter.value = "all";
    if (repFilter) repFilter.value = "all";
    if (periodFilter) periodFilter.value = "all";
    if (dateFrom) dateFrom.value = "";
    if (dateTo) dateTo.value = "";
    applyFilters();
  });

  qsa(".js-accountant-export", root).forEach((button) => {
    button.addEventListener("click", () => {
      exportAccountantReport(root, button.dataset.format || "csv");
    });
  });

  applyFilters();
}

function escapeCsvValue(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function getExportSections(root) {
  return qsa("[data-export-table]", root)
    .map((section) => {
      const headers = qsa("thead th", section).map((cell) => cell.textContent.trim());
      const rows = qsa("tbody tr", section)
        .filter((row) => !row.hidden)
        .map((row) => qsa("td", row).map((cell) => cell.textContent.replace(/\s+/g, " ").trim()));

      return {
        title: section.dataset.exportTitle || "Report",
        headers,
        rows
      };
    })
    .filter((section) => section.headers.length && section.rows.length);
}

function downloadBlob(filename, mimeType, content) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildExportHtml(sections) {
  const generatedAt = new Date().toLocaleString();

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>DistroIQ Accountant Report</title>
        <style>
          body { font-family: Arial, sans-serif; color: #10243f; margin: 28px; }
          h1 { font-size: 20px; margin: 0 0 4px; }
          h2 { font-size: 15px; margin: 24px 0 8px; }
          p { color: #5b6678; margin: 0 0 18px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
          th, td { border: 1px solid #d9e3ec; padding: 7px; text-align: left; font-size: 11px; }
          th { background: #eef5f3; }
        </style>
      </head>
      <body>
        <h1>DistroIQ Accountant Report</h1>
        <p>Generated ${escapeHtml(generatedAt)}</p>
        ${sections.map((section) => `
          <h2>${escapeHtml(section.title)}</h2>
          <table>
            <thead>
              <tr>${section.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
            </thead>
            <tbody>
              ${section.rows.map((row) => `
                <tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>
              `).join("")}
            </tbody>
          </table>
        `).join("")}
      </body>
    </html>
  `;
}

function exportAccountantReport(root, format) {
  const sections = getExportSections(root);
  const datestamp = new Date().toISOString().slice(0, 10);

  if (!sections.length) return;

  if (format === "excel") {
    downloadBlob(
      `distroiq-finance-report-${datestamp}.xls`,
      "application/vnd.ms-excel;charset=utf-8",
      buildExportHtml(sections)
    );
    return;
  }

  if (format === "pdf") {
    const reportWindow = window.open("", "_blank");
    const html = buildExportHtml(sections);

    if (!reportWindow) {
      downloadBlob(`distroiq-finance-report-${datestamp}.html`, "text/html;charset=utf-8", html);
      return;
    }

    reportWindow.document.write(html);
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.print();
    return;
  }

  const csv = sections.map((section) => {
    const rows = [
      [section.title],
      section.headers,
      ...section.rows
    ];

    return rows.map((row) => row.map(escapeCsvValue).join(",")).join("\n");
  }).join("\n\n");

  downloadBlob(`distroiq-finance-report-${datestamp}.csv`, "text/csv;charset=utf-8", csv);
}

function visibleCreditHistoryRows(root) {
  return qsa("[data-credit-history-row]", root)
    .filter((row) => row.dataset.filterHidden !== "true");
}

function exportCreditHistory(root, format) {
  const rows = visibleCreditHistoryRows(root);
  if (!rows.length) return;

  const headers = ["Account", "Previous", "New", "Terms", "Reason", "Changed by"];
  const values = rows.map((row) => qsa("td", row).map((cell) => cell.textContent.replace(/\s+/g, " ").trim()));
  const datestamp = new Date().toISOString().slice(0, 10);

  if (format === "pdf") {
    const html = buildExportHtml([{ title: "Credit Terms History", headers, rows: values }]);
    const reportWindow = window.open("", "_blank");
    if (!reportWindow) {
      downloadBlob(`distroiq-credit-terms-history-${datestamp}.html`, "text/html;charset=utf-8", html);
      return;
    }
    reportWindow.document.write(html);
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.print();
    return;
  }

  const csv = [headers, ...values].map((row) => row.map(escapeCsvValue).join(",")).join("\n");
  downloadBlob(`distroiq-credit-terms-history-${datestamp}.csv`, "text/csv;charset=utf-8", csv);
}

function bindCreditHistoryFilters(root) {
  const account = qs("#credit-history-account", root);
  const from = qs("#credit-history-from", root);
  const to = qs("#credit-history-to", root);
  const count = qs("#credit-history-result-count", root);
  if (!account || !from || !to) return;

  function applyFilters() {
    let matches = 0;
    qsa("[data-credit-history-row]", root).forEach((row) => {
      const accountMatches = !account.value || row.dataset.creditHistoryAccount === account.value;
      const date = row.dataset.creditHistoryDate || "";
      const hasDateRange = Boolean(from.value || to.value);
      const dateMatches = !hasDateRange || dateIsWithinRange(date, from.value, to.value);
      const isMatch = accountMatches && dateMatches;
      row.dataset.filterHidden = isMatch ? "false" : "true";
      if (isMatch) matches += 1;
    });
    if (count) count.textContent = `${formatNumber(matches)} change${matches === 1 ? "" : "s"} found`;
    root.dispatchEvent(new Event("financepaginationchange"));
  }

  [account, from, to].forEach((control) => {
    control.addEventListener("input", applyFilters);
    control.addEventListener("change", applyFilters);
  });
  qs("[data-credit-history-reset]", root)?.addEventListener("click", () => {
    account.value = "";
    from.value = "";
    to.value = "";
    applyFilters();
  });
  qsa("[data-credit-history-export]", root).forEach((button) => {
    button.addEventListener("click", () => exportCreditHistory(root, button.dataset.creditHistoryExport));
  });
  applyFilters();
}

function bindFinancePagination(root) {
  qsa("[data-finance-pagination]", root).forEach((pagination) => {
    const id = pagination.dataset.financePagination;
    const rows = qsa(`[data-finance-page-row="${id}"]`, root);
    const status = qs("[data-finance-page-status]", pagination);
    const previous = qs('[data-finance-page="prev"]', pagination);
    const next = qs('[data-finance-page="next"]', pagination);
    const globalSearch = qs("#global-search", document);
    let currentPage = 1;

    if (!rows.length || !status) return;

    function matchingRows() {
      const query = String(globalSearch?.value || "").trim().toLowerCase();
      return rows.filter((row) => row.dataset.filterHidden !== "true" && (!query || String(row.dataset.searchIndex || "").includes(query)));
    }

    function applyPage() {
      const visibleRows = matchingRows();
      const totalPages = Math.max(1, Math.ceil(visibleRows.length / FINANCE_PAGE_SIZE));
      currentPage = Math.min(Math.max(1, currentPage), totalPages);

      rows.forEach((row) => {
        row.hidden = true;
      });
      visibleRows.forEach((row, index) => {
        row.hidden = Math.floor(index / FINANCE_PAGE_SIZE) + 1 !== currentPage;
      });

      pagination.hidden = visibleRows.length <= FINANCE_PAGE_SIZE;
      status.textContent = `${formatNumber(visibleRows.length)} record${visibleRows.length === 1 ? "" : "s"} - page ${formatNumber(currentPage)} of ${formatNumber(totalPages)}`;
      if (previous) previous.disabled = currentPage === 1;
      if (next) next.disabled = currentPage === totalPages;
    }

    previous?.addEventListener("click", () => {
      currentPage -= 1;
      applyPage();
    });
    next?.addEventListener("click", () => {
      currentPage += 1;
      applyPage();
    });
    globalSearch?.addEventListener("input", () => {
      currentPage = 1;
      applyPage();
    });
    root.addEventListener("financepaginationchange", () => {
      currentPage = 1;
      applyPage();
    });

    window.setTimeout(applyPage, 0);
  });
}

export function bindFinance({ root, store, signal }) {
  bindWorkspaceDataResetButtons({ root, store, signal });
  bindCeoDataDeletion({ root, store, signal });
  bindFinancePagination(root);
  bindCreditHistoryFilters(root);

  bindAccountantFinance({ root });

  const creditForm = qs("#credit-limit-form", root);
  const repCreditForm = qs("#rep-credit-limit-form", root);
  const creditAccountModal = qs("#credit-account-modal", root);
  const creditAccountDetail = qs("[data-credit-account-detail]", root);
  const creditAccountTitle = qs("#credit-account-modal-title", root);

  function closeCreditAccountModal() {
    if (creditAccountModal) creditAccountModal.hidden = true;
  }

  qsa(".js-open-credit-account", root).forEach((button) => {
    button.addEventListener("click", () => {
      if (!creditAccountModal || !creditAccountDetail) return;
      const limit = creditAccounts(store.getState())[Number(button.dataset.creditAccountIndex || 0)];
      if (!limit) return;
      creditAccountDetail.innerHTML = renderCreditAccountDetails(limit, store.getState());
      if (creditAccountTitle) creditAccountTitle.textContent = limit.partyName || "Account details";
      creditAccountModal.hidden = false;
      creditAccountModal.focus();
    });
  });

  qsa(".js-close-credit-account", root).forEach((button) => button.addEventListener("click", closeCreditAccountModal));
  creditAccountModal?.addEventListener("click", (event) => {
    if (event.target === creditAccountModal) closeCreditAccountModal();
  });
  creditAccountModal?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeCreditAccountModal();
  });

  qsa(".js-view-invoice", root).forEach((button) => {
    button.addEventListener("click", () => {
      const state = store.getState();
      const invoice = getFinancialInvoiceRecords(state).find((item) => item.id === button.dataset.invoiceId);
      if (invoice) openInvoiceQuickView(invoice, state);
    });
  });

  qsa(".js-download-invoice", root).forEach((button) => {
    button.addEventListener("click", () => {
      const state = store.getState();
      const invoice = getFinancialInvoiceRecords(state).find((item) => item.id === button.dataset.invoiceId);
      if (invoice) downloadInvoice(invoice, state);
    });
  });

  qsa(".js-print-invoice", root).forEach((button) => {
    button.addEventListener("click", () => {
      const state = store.getState();
      const invoice = getFinancialInvoiceRecords(state).find((item) => item.id === button.dataset.invoiceId);
      if (invoice) printInvoice(invoice, state);
    });
  });

  repCreditForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(repCreditForm);
    const message = qs("#rep-credit-limit-message", root);
    const repSelect = repCreditForm.elements.repKey;
    const selectedOption = repSelect?.selectedOptions?.[0];
    const limit = Number(formData.get("limit") || 0);
    const paymentPeriodDays = Number(formData.get("paymentPeriodDays") || 1);
    const submitButton = repCreditForm.querySelector('button[type="submit"]');

    if (message) message.textContent = "";

    if (!selectedOption?.value || !limit || limit <= 0) {
      if (message) message.textContent = "Choose a representative and enter a limit.";
      return;
    }

    if (paymentPeriodDays < 0) {
      if (message) message.textContent = "Days to settle cannot be negative.";
      return;
    }

    const state = store.getState();
    const repUserId = String(selectedOption.dataset.repUserId || "");
    const repName = String(selectedOption.dataset.repName || "Sales Representative");
    const existingLimit = (state.creditLimits || []).find((item) => (
      (repUserId && item.repUserId === repUserId) ||
      (
        String(item.partyType || "").toLowerCase().includes("representative") &&
        String(item.partyName || "").trim().toLowerCase() === repName.trim().toLowerCase()
      )
    ));
    let emailSent = false;
    let emailFailure = "";
    let smsSent = false;
    let smsFailure = "";
    let emailEnabled = state.client?.creditLimitEmailEnabled === true;
    let smsEnabled = state.client?.creditLimitSmsEnabled === true;

    if (submitButton) submitButton.disabled = true;

    try {
      const saveResult = await saveRepresentativeCreditLimit({
        clientId: state.client?.id,
        representativeMembershipId: selectedOption.dataset.repMembershipId,
        previousLimit: Number(existingLimit?.limit || 0),
        newLimit: limit,
        paymentPeriodDays,
        currencySymbol: currencySymbolFor(state.client)
      });
      emailSent = saveResult?.emailSent === true;
      emailFailure = saveResult?.emailError || "";
      smsSent = saveResult?.smsSent === true;
      smsFailure = saveResult?.smsError || "";
      emailEnabled = saveResult?.emailEnabled === true;
      smsEnabled = saveResult?.smsEnabled === true;
    } catch (error) {
      emailFailure = error.message;
    }

    store.dispatch({
      type: "UPSERT_REP_CREDIT_LIMIT",
      repName,
      repUserId,
      limit,
      paymentPeriodDays,
      reason: formData.get("reason"),
      message: !emailEnabled && !smsEnabled
        ? "Representative credit limit saved. Notifications are turned off in Settings."
        : emailSent === emailEnabled && smsSent === smsEnabled
          ? `Representative credit limit saved and sent by ${[emailSent && "email", smsSent && "SMS"].filter(Boolean).join(" and ")}`
          : `Representative credit limit saved. ${[
              emailEnabled && !emailSent ? emailFailure || "Email could not be sent." : "",
              smsEnabled && !smsSent ? smsFailure || "SMS could not be sent." : ""
            ].filter(Boolean).join(" ")}`
    });
  });

  creditForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(creditForm);
    const message = qs("#credit-limit-message", root);
    const customerId = String(formData.get("customerId") || "");
    const selectedOption = creditForm.elements.customerId?.selectedOptions?.[0];
    const creditLimitId = String(selectedOption?.dataset.creditLimitId || "");
    const limit = Number(formData.get("limit") || 0);
    const paymentPeriodDays = Number(formData.get("paymentPeriodDays") || 0);

    if (message) message.textContent = "";

    if (!customerId || !limit || limit <= 0) {
      if (message) message.textContent = "Choose a customer and enter a new limit.";
      return;
    }

    if (paymentPeriodDays < 0) {
      if (message) message.textContent = "Payment period cannot be negative.";
      return;
    }

    store.dispatch(creditLimitId
      ? {
          type: "UPDATE_CREDIT_LIMIT",
          creditLimitId,
          limit,
          discountPercent: Number(formData.get("discountPercent") || 0),
          paymentPeriodDays,
          latePenaltyPercent: Number(formData.get("latePenaltyPercent") || 0),
          reason: formData.get("reason"),
          message: "Credit terms updated"
        }
      : {
          type: "UPSERT_CUSTOMER_CREDIT_LIMIT",
          customerId,
          limit,
          discountPercent: Number(formData.get("discountPercent") || 0),
          paymentPeriodDays,
          latePenaltyPercent: Number(formData.get("latePenaltyPercent") || 0),
          reason: formData.get("reason"),
          message: "Customer credit terms saved"
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
