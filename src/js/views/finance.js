import {
  calculateMetrics,
  calculateVisionMetrics,
  creditUsageTone,
  getInvoiceAging,
  getProductMap,
  getRetailerMap
} from "../services/calculations.js";
import { currencySymbolFor, formatCurrency, formatDate, formatNumber, formatPercent } from "../services/formatters.js";
import { currentUserPermissions, currentUserRole, salesRepresentativeNames } from "../services/rbac.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { metricCard, panelHeader, progressBar, statusPill, table, textButton } from "../ui/components.js";
import { icon } from "../ui/icons.js";

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
        <td>${escapeHtml(creditTermsSummary(limit))}</td>
      </tr>
    `;
  });
}

function renderCreditLimitManager(state, permissions) {
  if (!permissions.canSetCreditLimits) return "";

  const moneySymbol = currencySymbolFor(state.client);

  return `
    <section class="panel manager-tool-panel">
      ${panelHeader("Credit terms manager", "Set limit, discount, payment period, and late-payment penalty with retained history")}
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
          <span>New limit (${escapeHtml(moneySymbol)})</span>
          <input name="limit" type="number" min="1" step="1000" inputmode="numeric" placeholder="0" required>
        </label>
        <label class="field">
          <span>Discount (%)</span>
          <input name="discountPercent" type="number" min="0" max="100" step="0.1" inputmode="decimal" placeholder="0">
        </label>
        <label class="field">
          <span>Payment period</span>
          <input name="paymentPeriodDays" type="number" min="0" step="1" inputmode="numeric" placeholder="14">
        </label>
        <label class="field">
          <span>Late payment penalty (%)</span>
          <input name="latePenaltyPercent" type="number" min="0" max="100" step="0.1" inputmode="decimal" placeholder="0">
        </label>
        <label class="field span-full">
          <span>Reason</span>
          <input name="reason" placeholder="Route growth, discount approval, payment performance, risk review">
        </label>
        <div class="manager-form-actions span-full">
          ${textButton({
            iconName: "wallet",
            label: "Update credit terms",
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
        <td>${escapeHtml([
          `${formatTermPercent(entry.discountPercent)} discount`,
          `${formatNumber(entry.paymentPeriodDays ?? 14)} days`,
          `${formatTermPercent(entry.latePenaltyPercent)} penalty`
        ].join(" - "))}</td>
        <td>${escapeHtml(entry.reason || "Manager adjustment")}</td>
        <td>
          ${escapeHtml(entry.changedBy)}
          <div class="muted">${formatDate(entry.changedAt?.slice(0, 10))}</div>
        </td>
      </tr>
    `;
  });
}

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function marginPercent(revenue, profit) {
  return revenue ? (Number(profit || 0) / Number(revenue || 0)) * 100 : 0;
}

function getOrderRouteMap(routes = []) {
  const routeMap = new Map();

  routes.forEach((route) => {
    (route.orderIds || []).forEach((orderId) => {
      routeMap.set(orderId, route);
    });
  });

  return routeMap;
}

function getAccountantSalesLines(state) {
  const productMap = getProductMap(state.products || []);
  const retailerMap = getRetailerMap(state.retailers || []);
  const routeMap = getOrderRouteMap(state.routes || []);

  return (state.orders || []).flatMap((order) => {
    const route = routeMap.get(order.id);
    const retailer = retailerMap.get(order.retailerId);

    return (order.items || []).map((item) => {
      const product = productMap.get(item.productId);
      const quantity = Number(item.quantity || 0);
      const revenue = quantity * Number(product?.unitPrice || 0);
      const cost = quantity * Number(product?.unitCost || 0);
      const profit = revenue - cost;

      return {
        id: `${order.id}-${item.productId}`,
        recordId: order.id,
        date: dateOnly(order.createdAt),
        productId: item.productId,
        productName: product?.name || "Unknown product",
        repName: route?.driver || "Unassigned",
        customerName: retailer?.name || "Unknown customer",
        quantity,
        revenue,
        cost,
        profit,
        margin: marginPercent(revenue, profit),
        status: order.status,
        paymentType: order.paymentType
      };
    });
  });
}

function getReportProductIds(report, transactionMap) {
  return (report.transactionIds || [])
    .map((transactionId) => transactionMap.get(transactionId)?.productId)
    .filter(Boolean);
}

function getAccountantSummary(state) {
  const salesLines = getAccountantSalesLines(state);
  const reportedSales = (state.salesReports || []).reduce((total, report) => total + Number(report.salesAmount || 0), 0);
  const revenue = salesLines.reduce((total, line) => total + line.revenue, 0);
  const cost = salesLines.reduce((total, line) => total + line.cost, 0);
  const profit = salesLines.reduce((total, line) => total + line.profit, 0);

  return {
    reportedSales,
    revenue,
    cost,
    profit
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

function renderAccountantSummaryCards(summary) {
  return `
    <div class="finance-kpis accountant-kpis">
      ${accountantMetricCard({
        label: "Reported sales",
        value: formatCurrency(summary.reportedSales),
        meta: "Submitted sales reports",
        iconName: "finance",
        summaryKey: "reportedSales"
      })}
      ${accountantMetricCard({
        label: "Revenue",
        value: formatCurrency(summary.revenue),
        meta: "Priced sales order lines",
        iconName: "orders",
        summaryKey: "revenue"
      })}
      ${accountantMetricCard({
        label: "Cost",
        value: formatCurrency(summary.cost),
        meta: "Product cost basis",
        iconName: "package",
        summaryKey: "cost"
      })}
      ${accountantMetricCard({
        label: "Gross profit",
        value: formatCurrency(summary.profit),
        meta: "Revenue less product cost",
        iconName: "wallet",
        summaryKey: "profit"
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
          data-search-index="${escapeHtml(searchIndex)}"
        >
          <td>
            ${formatDate(line.date)}
            <div class="muted">${escapeHtml(line.recordId)}</div>
          </td>
          <td>${escapeHtml(line.productName)}</td>
          <td>${escapeHtml(line.repName)}</td>
          <td>${escapeHtml(line.customerName)}</td>
          <td>${formatNumber(line.quantity)}</td>
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

function renderAccountantFinance({ state }) {
  const summary = getAccountantSummary(state);

  return `
    <section class="view finance-view accountant-finance">
      ${renderAccountantSummaryCards(summary)}
      ${renderAccountantFilters(state)}

      <section class="panel" data-export-table="true" data-export-title="Sales reports">
        ${panelHeader("Sales reports", "Read-only submitted sales activity")}
        ${table(
          ["Report", "Sales representative", "Date", "Sales", "Cash", "Credit", "Returns", "Status"],
          renderAccountantSalesReportRows(state),
          "No sales reports available"
        )}
      </section>

      <section class="panel" data-export-table="true" data-export-title="Revenue cost and profit">
        ${panelHeader("Revenue, cost, and profit", "Product-level financial summary")}
        ${table(
          ["Date", "Product", "Sales representative", "Customer", "Qty", "Revenue", "Cost", "Profit", "Margin"],
          renderAccountantProductRows(state),
          "No product financial records available"
        )}
      </section>

      <section class="panel" data-export-table="true" data-export-title="Credit reports">
        ${panelHeader("Credit reports", "Read-only balances and approved limits")}
        ${table(
          ["Account", "Status", "Balance", "Limit", "Available", "Usage", "Updated"],
          renderAccountantCreditRows(state),
          "No credit reports available"
        )}
      </section>
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
        ${panelHeader("Credit exposure", "Approved limits, current balances, and remaining headroom by representative or customer")}
        ${table(
          ["Account", "Status", "Usage", "Limit", "Headroom", "Terms"],
          renderCreditExposureRows(state),
          "No credit limits available"
        )}
      </section>

      <section class="panel">
        ${panelHeader("Credit terms history", "Every manager adjustment stays visible")}
        ${table(
          ["Account", "Previous", "New", "Terms", "Reason", "Changed by"],
          renderCreditHistoryRows(state),
          "No credit limit changes recorded"
        )}
      </section>
    </section>
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
  const visibleRows = qsa("[data-accountant-row]", root).filter((row) => !row.hidden);
  const visibleSalesRows = visibleRows.filter((row) => row.dataset.reportType === "sales");
  const visibleFinancialRows = visibleRows.filter((row) => row.dataset.reportType === "financial");
  const totals = {
    reportedSales: visibleSalesRows.reduce((total, row) => total + Number(row.dataset.sales || 0), 0),
    revenue: visibleFinancialRows.reduce((total, row) => total + Number(row.dataset.revenue || 0), 0),
    cost: visibleFinancialRows.reduce((total, row) => total + Number(row.dataset.cost || 0), 0),
    profit: visibleFinancialRows.reduce((total, row) => total + Number(row.dataset.profit || 0), 0)
  };

  qsa("[data-summary]", root).forEach((target) => {
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

export function bindFinance({ root, store }) {
  if (root.querySelector(".accountant-finance")) {
    bindAccountantFinance({ root });
    return;
  }

  const creditForm = qs("#credit-limit-form", root);

  creditForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(creditForm);
    const message = qs("#credit-limit-message", root);
    const creditLimitId = String(formData.get("creditLimitId") || "");
    const limit = Number(formData.get("limit") || 0);
    const paymentPeriodDays = Number(formData.get("paymentPeriodDays") || 0);

    if (message) message.textContent = "";

    if (!creditLimitId || !limit || limit <= 0) {
      if (message) message.textContent = "Choose an account and enter a new limit.";
      return;
    }

    if (paymentPeriodDays < 0) {
      if (message) message.textContent = "Payment period cannot be negative.";
      return;
    }

    store.dispatch({
      type: "UPDATE_CREDIT_LIMIT",
      creditLimitId,
      limit,
      discountPercent: Number(formData.get("discountPercent") || 0),
      paymentPeriodDays,
      latePenaltyPercent: Number(formData.get("latePenaltyPercent") || 0),
      reason: formData.get("reason"),
      message: "Credit terms updated"
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
