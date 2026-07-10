import {
  calculateMetrics,
  calculateVisionMetrics,
  creditUsageTone,
  getFinancialSalesLines,
  getInvoiceAging,
  getRetailerMap
} from "../services/calculations.js";
import { currencySymbolFor, formatCurrency, formatDate, formatDateTime, formatNumber, formatPercent } from "../services/formatters.js";
import {
  currentUserPermissions,
  currentUserRole,
  salesRepresentativeAccounts,
  salesRepresentativeNames
} from "../services/rbac.js";
import { isModuleEnabled } from "../services/features.js";
import { saveRepresentativeCreditLimit } from "../services/backend.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { metricCard, panelHeader, progressBar, statusPill, table, textButton } from "../ui/components.js";
import { icon } from "../ui/icons.js";

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
      id: "product-revenue",
      label: "Product revenue"
    },
    ...(isModuleEnabled(state, "credit_control") ? [{
      id: "credit-risk",
      label: "Credit & risk"
    }] : [])
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

function addDays(dateValue, days) {
  const date = parseLocalDate(dateValue);
  if (!date) return dateValue || "";
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function financeInvoices(state) {
  const invoices = [...(state.invoices || [])];
  const linkedOrderIds = new Set(invoices.map((invoice) => invoice.orderId).filter(Boolean));
  const limitsByName = new Map((state.creditLimits || []).map((limit) => [String(limit.partyName || "").trim().toLowerCase(), limit]));

  (state.orders || [])
    .filter((order) => String(order.paymentType || "").toLowerCase().includes("credit"))
    .filter((order) => String(order.paymentStatus || "open").toLowerCase() !== "paid")
    .filter((order) => !linkedOrderIds.has(order.id))
    .forEach((order) => {
      const customerName = order.customerName || "Customer";
      const limit = limitsByName.get(String(customerName).trim().toLowerCase());
      const issuedAt = dateOnly(order.createdAt || order.updatedAt);
      const dueAt = order.dueAt && order.dueAt !== issuedAt
        ? dateOnly(order.dueAt)
        : addDays(issuedAt, limit?.paymentPeriodDays ?? 14);
      const amount = (order.items || []).reduce((total, item) => (
        total + Number(item.quantity || 0) * Number(item.unitPrice ?? item.unitPriceAtSale ?? 0)
      ), 0);

      invoices.push({
        id: `INV-${order.id}`,
        orderId: order.id,
        retailerId: order.retailerId || "",
        customerName,
        issuedAt,
        dueAt,
        amount,
        status: "open",
        derived: true
      });
    });

  return invoices;
}

function renderAgingRows(state) {
  return getInvoiceAging(financeInvoices(state))
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

  return financeInvoices(state).map((invoice) => {
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
              disabled: invoice.status === "paid" || !canUpdateCredit || invoice.derived,
              data: { "invoice-id": invoice.id }
            })}
          </div>
        </td>
      </tr>
    `;
  });
}

function renderCreditExposureRows(state) {
  return [...(state.creditLimits || [])]
    .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0))
    .map((limit, index) => {
    const usagePercent = limit.limit ? (Number(limit.balance || 0) / Number(limit.limit || 0)) * 100 : 100;
    const remaining = Math.max(0, Number(limit.limit || 0) - Number(limit.balance || 0));
    const status = usagePercent >= 100 ? "credit_hold" : usagePercent >= 85 ? "credit_watch" : "credit_clear";
    const searchIndex = [
      limit.partyName,
      limit.partyType,
      status
    ].join(" ").toLowerCase();

    return `
      <tr ${index >= FINANCE_PAGE_SIZE ? "hidden " : ""}data-finance-page-row="credit-exposure" data-search-index="${escapeHtml(searchIndex)}">
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
        <td>${escapeHtml(creditTermsSummary(limit))}</td>
      </tr>
    `;
  });
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

function renderCreditHistoryRows(state) {
  return [...(state.creditLimitHistory || [])]
    .sort((a, b) => String(b.changedAt || "").localeCompare(String(a.changedAt || "")))
    .map((entry, index) => {
    const searchIndex = [
      entry.partyName,
      entry.partyType,
      entry.changedBy,
      entry.reason
    ].join(" ").toLowerCase();

    return `
      <tr ${index >= FINANCE_PAGE_SIZE ? "hidden " : ""}data-finance-page-row="credit-history" data-search-index="${escapeHtml(searchIndex)}">
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
        <td>${escapeHtml(entry.reason || "Manager adjustment")}</td>
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
  const cashIn = salesLines.reduce((total, line) => total + Number(line.cashAmount || 0), 0);
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

function accountantMetricCard({ label, value, meta, iconName, summaryKey }) {
  return `
    <article class="metric-card">
      <header>
        <span class="eyebrow">${escapeHtml(label)}</span>
        <span class="metric-icon">${icon(iconName)}</span>
      </header>
      <div>
        <div class="metric-value js-accountant-summary" data-summary="${escapeHtml(summaryKey)}">${escapeHtml(value)}</div>
        <div class="metric-meta">${escapeHtml(meta)}</div>
      </div>
    </article>
  `;
}

function renderAccountantSummaryCards(summary, state) {
  const creditControlEnabled = isModuleEnabled(state, "credit_control");

  return `
    <div class="finance-kpis accountant-kpis">
      ${accountantMetricCard({
        label: "Cash in",
        value: formatCurrency(summary.cashIn),
        meta: "Cash sales collected",
        iconName: "finance",
        summaryKey: "cashIn"
      })}
      ${accountantMetricCard({
        label: "Product revenue",
        value: formatCurrency(summary.revenue),
        meta: "Orders and rep quick sales",
        iconName: "orders",
        summaryKey: "revenue"
      })}
      ${accountantMetricCard({
        label: "Gross profit",
        value: formatCurrency(summary.profit),
        meta: "Revenue less product cost",
        iconName: "wallet",
        summaryKey: "profit"
      })}
      ${creditControlEnabled ? accountantMetricCard({
        label: "Credit owed",
        value: formatCurrency(summary.creditOwed),
        meta: "Open balances that can hurt cash flow",
        iconName: "alert",
        summaryKey: "creditOwed"
      }) : ""}
      ${accountantMetricCard({
        label: "Returns",
        value: formatCurrency(summary.returns),
        meta: "Customer returns reducing sales",
        iconName: "refresh",
        summaryKey: "returns"
      })}
      ${accountantMetricCard({
        label: "Stock loss",
        value: formatCurrency(summary.stockLoss),
        meta: "Written-off stock at cost value",
        iconName: "package",
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
          <td>
            <strong>${escapeHtml(report.id)}</strong>
            <div class="muted">${escapeHtml(report.tripLabel || "Sales report")}</div>
          </td>
          <td>${escapeHtml(report.repName || "Unassigned")}</td>
          <td>${formatDate(report.reportDate)}</td>
          <td>${formatCurrency(report.salesAmount)}</td>
          <td>${formatCurrency(report.cashAmount)}</td>
          <td>${formatCurrency(report.creditAmount)}</td>
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

function renderAccountantFinanceTab(activeTabId, state, summary) {
  if (activeTabId === "sales-reports") {
    return `
      ${renderAccountantFilters(state)}
      <section class="panel" data-export-table="true" data-export-title="Sales reports">
        ${panelHeader("Sales reports", "Read-only submitted sales activity")}
        ${table(
          ["Report", "Sales representative", "Date", "Sales", "Cash", "Credit", "Returns", "Status"],
          renderAccountantSalesReportRows(state),
          "No sales reports available"
        )}
      </section>
    `;
  }

  if (activeTabId === "product-revenue") {
    return `
      ${renderAccountantFilters(state)}
      <section class="panel">
        ${panelHeader("Product revenue", "Top product lines by sales value")}
        <div class="bar-list">${renderAccountantProductRevenue(state)}</div>
      </section>
      <section class="panel" data-export-table="true" data-export-title="Revenue cost and profit">
        ${panelHeader("Revenue, cost, and profit", "Product-level financial summary")}
        ${table(
          ["Date", "Product", "Sales representative", "Customer", "Qty", "Payment", "Revenue", "Cost", "Profit", "Margin"],
          renderAccountantProductRows(state),
          "No product financial records available"
        )}
      </section>
    `;
  }

  if (activeTabId === "credit-risk") {
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

function renderAccountantFinance({ state }) {
  const summary = getAccountantSummary(state);
  const activeTabId = activeFinanceTabId(state);
  const permissions = currentUserPermissions(state);

  return `
    <section class="view finance-view accountant-finance">
      ${renderFinanceSubtabs(activeTabId, state)}
      ${activeTabId === "credit-risk" ? renderRepresentativeCreditManager(state, permissions) : ""}
      ${activeTabId === "credit-risk" ? renderCreditLimitManager(state, permissions) : ""}
      ${renderAccountantFinanceTab(activeTabId, state, summary)}
    </section>
  `;
}

export function renderFinance({ state }) {
  if (currentUserRole(state) === "accountant") {
    return renderAccountantFinance({ state });
  }

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
      ${renderRepresentativeCreditManager(state, permissions)}
      ${renderCreditLimitManager(state, permissions)}

      <div class="finance-layout">
        <section class="panel">
          ${panelHeader("Credit aging", "Open balances owed by due-date bucket")}
          <div class="aging-list">${renderAgingRows(state)}</div>
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
        ${panelHeader("Credit exposure", "Approved limits, current balances, and remaining headroom by representative or customer")}
        ${table(
          ["Account", "Status", "Usage", "Limit", "Headroom", "Terms"],
          renderCreditExposureRows(state),
          "No credit limits available"
        )}
        ${renderFinancePagination("credit-exposure")}
      </section>

      <section class="panel">
        ${panelHeader("Credit terms history", "Every manager adjustment stays visible")}
        ${table(
          ["Account", "Previous", "New", "Terms", "Reason", "Changed by"],
          renderCreditHistoryRows(state),
          "No credit limit changes recorded"
        )}
        ${renderFinancePagination("credit-history")}
      </section>
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
    const fromDate = parseLocalDate(fromValue);
    const toDate = parseLocalDate(toValue);
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
      `distroiq-accountant-report-${datestamp}.xls`,
      "application/vnd.ms-excel;charset=utf-8",
      buildExportHtml(sections)
    );
    return;
  }

  if (format === "pdf") {
    const reportWindow = window.open("", "_blank");
    const html = buildExportHtml(sections);

    if (!reportWindow) {
      downloadBlob(`distroiq-accountant-report-${datestamp}.html`, "text/html;charset=utf-8", html);
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

  downloadBlob(`distroiq-accountant-report-${datestamp}.csv`, "text/csv;charset=utf-8", csv);
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
      return rows.filter((row) => !query || String(row.dataset.searchIndex || "").includes(query));
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

    window.setTimeout(applyPage, 0);
  });
}

export function bindFinance({ root, store }) {
  bindFinancePagination(root);

  if (root.querySelector(".accountant-finance")) {
    bindAccountantFinance({ root });
  }

  const creditForm = qs("#credit-limit-form", root);
  const repCreditForm = qs("#rep-credit-limit-form", root);

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
      message: emailSent
        ? "Representative credit limit saved and emailed"
        : `Representative credit limit saved. ${emailFailure || "Email could not be sent."}`
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
