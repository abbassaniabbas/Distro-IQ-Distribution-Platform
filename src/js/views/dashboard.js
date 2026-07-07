import {
  assignmentOutstanding,
  buildRepLedger,
  buildRegionalSummary,
  calculateMetrics,
  calculateVisionMetrics,
  getCreditLimitForParty,
  getLowStockProducts,
  getOrdersWithTotals,
  getProductMap,
  getRetailerMap,
  getStockHealth,
  stockCategoryIdForProduct
} from "../services/calculations.js";
import { formatCompact, formatCurrency, formatDate, formatDateTime, formatNumber, formatPercent } from "../services/formatters.js";
import { currentUserPermissions, currentUserRole } from "../services/rbac.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { iconButton, metricCard, panelHeader, progressBar, statusPill, table, textButton } from "../ui/components.js";
import { icon } from "../ui/icons.js";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function currentRepName(state) {
  const userEmail = normalized(state.user?.email);
  const account = (state.accounts || []).find((item) => (
    item.userId === state.user?.id ||
    (userEmail && normalized(item.email) === userEmail)
  ));

  return (
    account?.name ||
    state.user?.user_metadata?.full_name ||
    state.stockAssignments?.[0]?.repName ||
    "Sales Representative"
  );
}

function buildRepAssignments(state) {
  const productMap = getProductMap(state.products || []);

  return (state.stockAssignments || [])
    .map((assignment) => {
      const product = productMap.get(assignment.productId);
      const outstanding = assignmentOutstanding(assignment);
      const soldPercent = assignment.assigned ? (Number(assignment.sold || 0) / Number(assignment.assigned || 0)) * 100 : 0;

      return {
        ...assignment,
        product,
        outstanding,
        soldPercent
      };
    })
    .filter((assignment) => assignment.product);
}

function todaysRepTransactions(state, repName) {
  const date = todayISO();
  const repKey = normalized(repName);

  return (state.stockTransactions || [])
    .filter((transaction) => {
      const type = normalized(transaction.type);
      return (
        (!repKey || normalized(transaction.recordedBy) === repKey) &&
        transaction.date === date &&
        (type === "sale" || type === "return")
      );
    })
    .sort((a, b) => String(b.id).localeCompare(String(a.id)));
}

function repDaySummary(transactions) {
  return transactions.reduce((summary, transaction) => {
    const amount = Number(transaction.amount || 0);
    const quantity = Number(transaction.quantity || 0);
    const type = normalized(transaction.type);
    const paymentType = normalized(transaction.paymentType);

    if (type === "sale") {
      summary.salesAmount += amount;
      summary.unitsSold += quantity;
      if (paymentType.includes("credit")) {
        summary.creditAmount += amount;
      } else {
        summary.cashAmount += amount;
      }
    }

    if (type === "return") {
      summary.returnAmount += amount;
      summary.unitsReturned += quantity;
    }

    summary.transactionIds.push(transaction.id);
    return summary;
  }, {
    salesAmount: 0,
    cashAmount: 0,
    creditAmount: 0,
    returnAmount: 0,
    unitsSold: 0,
    unitsReturned: 0,
    transactionIds: []
  });
}

function repTransactionLine(transaction, state) {
  const product = (state.products || []).find((item) => item.id === transaction.productId);
  const type = normalized(transaction.type) === "return" ? "Customer return" : "Sale";

  return {
    transactionId: transaction.id,
    type,
    productId: transaction.productId,
    productName: product?.name || "Unknown snack",
    customerName: transaction.partyName || "Customer",
    quantity: Number(transaction.quantity || 0),
    amount: Number(transaction.amount || 0),
    paymentType: transaction.paymentType || "cash"
  };
}

function repTransactionLines(transactions, state) {
  return transactions.map((transaction) => repTransactionLine(transaction, state));
}

function toTimestamp(value) {
  if (!value) return 0;

  const rawValue = String(value);
  const normalizedValue = rawValue.includes("T") ? rawValue : `${rawValue}T12:00:00`;
  const timestamp = new Date(normalizedValue).getTime();

  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function latestDate(values) {
  return values.reduce((latest, value) => {
    const timestamp = toTimestamp(value);
    return timestamp > toTimestamp(latest) ? value : latest;
  }, "");
}

function formatUpdatedAt(value) {
  if (!value) return "No updates yet";
  return String(value).includes("T") ? formatDateTime(value) : formatDate(value);
}

function freshnessFor(values) {
  const updatedAt = latestDate(values.filter(Boolean));
  const timestamp = toTimestamp(updatedAt);
  const ageInHours = timestamp ? (Date.now() - timestamp) / 36e5 : Infinity;
  const isCurrent = timestamp && ageInHours <= 36;

  return {
    status: isCurrent ? "current" : "stale",
    label: isCurrent ? "Current" : "Stale",
    updatedAt,
    text: `Updated ${formatUpdatedAt(updatedAt)}`
  };
}

function rowPeriodMatches(value, period) {
  if (period === "all") return true;

  const timestamp = toTimestamp(value);
  if (!timestamp) return false;

  if (period === "today") {
    return String(value || "").slice(0, 10) === todayISO();
  }

  const days = period === "7d" ? 7 : 30;
  const windowMs = days * 24 * 60 * 60 * 1000;

  return timestamp >= Date.now() - windowMs;
}

function salesValueFromOrder(order, productMap) {
  return (order.items || []).reduce((total, item) => {
    const product = productMap.get(item.productId);
    return total + Number(product?.unitPrice || 0) * Number(item.quantity || 0);
  }, 0);
}

function buildCeoFreshness(state) {
  return {
    sales: freshnessFor([
      ...(state.orders || []).map((order) => order.createdAt || order.dueAt),
      ...(state.stockTransactions || []).map((transaction) => transaction.createdAt || transaction.date),
      ...(state.salesReports || []).map((report) => report.submittedAt || report.reportDate)
    ]),
    stock: freshnessFor([
      ...(state.products || []).map((product) => product.updatedAt || product.createdAt),
      ...(state.stockAssignments || []).map((assignment) => assignment.updatedAt || assignment.assignedAt),
      ...(state.stockTransactions || []).map((transaction) => transaction.createdAt || transaction.date)
    ]),
    credit: freshnessFor([
      ...(state.creditLimits || []).map((limit) => limit.changedAt || limit.updatedAt),
      ...(state.invoices || []).map((invoice) => invoice.updatedAt || invoice.issuedAt || invoice.dueAt)
    ]),
    reports: freshnessFor((state.salesReports || []).map((report) => report.submittedAt || report.reportDate))
  };
}

function renderCeoMetricCard({ label, value, meta, iconName, freshness }) {
  return `
    <article class="metric-card ceo-metric-card">
      <header>
        <span class="eyebrow">${escapeHtml(label)}</span>
        <span class="metric-icon">${icon(iconName)}</span>
      </header>
      <div>
        <div class="metric-value">${escapeHtml(value)}</div>
        <div class="metric-meta">${escapeHtml(meta)}</div>
        <div class="ceo-freshness">
          ${statusPill(freshness.status)}
          <span>${escapeHtml(freshness.text)}</span>
        </div>
      </div>
    </article>
  `;
}

function productLatestActivity(productId, state) {
  return latestDate([
    ...(state.orders || [])
      .filter((order) => (order.items || []).some((item) => item.productId === productId))
      .map((order) => order.createdAt || order.dueAt),
    ...(state.stockAssignments || [])
      .filter((assignment) => assignment.productId === productId)
      .map((assignment) => assignment.updatedAt || assignment.assignedAt),
    ...(state.stockTransactions || [])
      .filter((transaction) => transaction.productId === productId)
      .map((transaction) => transaction.createdAt || transaction.date)
  ]);
}

function buildCeoProductPerformance(state) {
  const productMap = getProductMap(state.products || []);
  const rows = (state.products || []).map((product) => ({
    id: product.id,
    product,
    orderedUnits: 0,
    directUnits: 0,
    salesValue: 0,
    returnedUnits: 0,
    repUnits: 0,
    supermarketUnits: 0,
    latestActivity: productLatestActivity(product.id, state)
  }));
  const rowMap = new Map(rows.map((row) => [row.id, row]));

  (state.orders || []).forEach((order) => {
    (order.items || []).forEach((item) => {
      const row = rowMap.get(item.productId);
      const product = productMap.get(item.productId);
      if (!row || !product) return;

      const quantity = Number(item.quantity || 0);
      row.orderedUnits += quantity;
      row.supermarketUnits += quantity;
      row.salesValue += quantity * Number(product.unitPrice || 0);
      row.latestActivity = latestDate([row.latestActivity, order.createdAt || order.dueAt]);
    });
  });

  (state.stockTransactions || []).forEach((transaction) => {
    const row = rowMap.get(transaction.productId);
    if (!row) return;

    const type = normalized(transaction.type);
    const quantity = Number(transaction.quantity || 0);

    if (type === "sale" || type === "supply") {
      row.directUnits += quantity;
      row.salesValue += Number(transaction.amount || 0);
    }

    if (type === "return") {
      row.returnedUnits += quantity;
    }

    row.latestActivity = latestDate([row.latestActivity, transaction.createdAt || transaction.date]);
  });

  (state.stockAssignments || []).forEach((assignment) => {
    const row = rowMap.get(assignment.productId);
    if (!row) return;

    row.repUnits += assignmentOutstanding(assignment);
    row.latestActivity = latestDate([row.latestActivity, assignment.updatedAt || assignment.assignedAt]);
  });

  const rankedRows = rows
    .filter((row) => stockCategoryIdForProduct(row.product) === "finished_products")
    .sort((a, b) => b.salesValue - a.salesValue);
  const topId = rankedRows[0]?.id;
  const bottomId = rankedRows.at(-1)?.id;

  return rows.map((row) => ({
    ...row,
    salesUnits: row.orderedUnits + row.directUnits,
    performanceSignal: row.id === topId ? "top_performer" : row.id === bottomId ? "underperforming" : "steady"
  }));
}

function buildCeoRepRows(state) {
  const reportTotals = new Map();
  const productIdsByRep = new Map();
  const latestByRep = new Map();

  (state.salesReports || []).forEach((report) => {
    const existing = reportTotals.get(report.repName) || { salesAmount: 0, reportCount: 0 };
    existing.salesAmount += Number(report.salesAmount || 0);
    existing.reportCount += 1;
    reportTotals.set(report.repName, existing);
    latestByRep.set(report.repName, latestDate([latestByRep.get(report.repName), report.submittedAt || report.reportDate]));
  });

  (state.stockAssignments || []).forEach((assignment) => {
    const ids = productIdsByRep.get(assignment.repName) || new Set();
    ids.add(assignment.productId);
    productIdsByRep.set(assignment.repName, ids);
    latestByRep.set(assignment.repName, latestDate([latestByRep.get(assignment.repName), assignment.updatedAt || assignment.assignedAt]));
  });

  return buildRepLedger(state).map((row) => ({
    ...row,
    productIds: [...(productIdsByRep.get(row.repName) || new Set())],
    salesAmount: reportTotals.get(row.repName)?.salesAmount || 0,
    reportCount: reportTotals.get(row.repName)?.reportCount || 0,
    latestActivity: latestByRep.get(row.repName) || ""
  }));
}

function buildCeoSupermarketRows(state) {
  const productMap = getProductMap(state.products || []);
  const creditByName = new Map((state.creditLimits || []).map((limit) => [normalized(limit.partyName), limit]));

  return (state.retailers || []).map((retailer) => {
    const orders = (state.orders || []).filter((order) => order.retailerId === retailer.id);
    const productIds = new Set();
    const orderValue = orders.reduce((total, order) => {
      (order.items || []).forEach((item) => productIds.add(item.productId));
      return total + salesValueFromOrder(order, productMap);
    }, 0);
    const creditLimit = creditByName.get(normalized(retailer.name));
    const balance = Number(creditLimit?.balance ?? creditLimit?.balanceAmount ?? retailer.outstanding ?? 0);
    const limit = Number(creditLimit?.limit ?? creditLimit?.limitAmount ?? 0);
    const usagePercent = limit ? (balance / limit) * 100 : 0;
    const latestActivity = latestDate([
      retailer.lastOrder,
      retailer.lastContact,
      ...orders.map((order) => order.createdAt || order.dueAt),
      creditLimit?.changedAt
    ]);

    return {
      retailer,
      productIds: [...productIds],
      orderCount: orders.length,
      orderValue,
      balance,
      limit,
      usagePercent,
      latestActivity,
      status: usagePercent >= 100 ? "credit_hold" : usagePercent >= 85 ? "credit_watch" : "credit_clear"
    };
  });
}

function buildCeoRiskRows(state) {
  return (state.creditLimits || [])
    .map((limit) => {
      const balance = Number(limit.balance ?? limit.balanceAmount ?? 0);
      const limitAmount = Number(limit.limit ?? limit.limitAmount ?? 0);
      const usagePercent = limitAmount ? (balance / limitAmount) * 100 : 100;
      return {
        ...limit,
        balance,
        limit: limitAmount,
        usagePercent,
        remaining: Math.max(0, limitAmount - balance),
        status: usagePercent >= 100 ? "credit_hold" : usagePercent >= 85 ? "credit_watch" : "credit_clear"
      };
    })
    .sort((a, b) => b.usagePercent - a.usagePercent);
}

function creditPartyTypeLabel(value) {
  const normalizedValue = normalized(value).replace(/_/g, " ");

  if (normalizedValue.includes("sales rep") || normalizedValue.includes("sales representative")) {
    return "Sales Representative";
  }

  if (normalizedValue.includes("supermarket")) {
    return "Supermarket";
  }

  return String(value || "Account");
}

function renderCeoFilterPanel(state, productRows, repRows, supermarketRows) {
  const finishedProducts = productRows
    .filter((row) => stockCategoryIdForProduct(row.product) === "finished_products")
    .sort((a, b) => rowLabel(a.product).localeCompare(rowLabel(b.product)));
  const reps = repRows.map((row) => row.repName).sort();
  const supermarkets = supermarketRows.map((row) => row.retailer).sort((a, b) => a.name.localeCompare(b.name));

  return `
    <section class="panel ceo-filter-panel">
      ${panelHeader("Leadership drilldown", "Period, representative, product, and supermarket views")}
      <div class="ceo-filter-grid">
        <label class="field">
          <span>Period</span>
          <select data-ceo-filter="period">
            <option value="all">All time</option>
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
        </label>
        <label class="field">
          <span>Representative</span>
          <select data-ceo-filter="rep">
            <option value="">All representatives</option>
            ${reps.map((repName) => `<option value="${escapeHtml(repName)}">${escapeHtml(repName)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Product</span>
          <select data-ceo-filter="product">
            <option value="">All products</option>
            ${finishedProducts.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.product.name)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Supermarket</span>
          <select data-ceo-filter="supermarket">
            <option value="">All supermarkets</option>
            ${supermarkets.map((retailer) => `<option value="${escapeHtml(retailer.id)}">${escapeHtml(retailer.name)}</option>`).join("")}
          </select>
        </label>
        <button class="button ceo-filter-reset" type="button" data-ceo-filter-reset>
          ${icon("refresh")}
          <span>Reset</span>
        </button>
      </div>
    </section>
  `;
}

function rowLabel(product) {
  return product?.name || "";
}

function productDataset(productIds) {
  return `|${productIds.filter(Boolean).join("|")}|`;
}

function renderCeoProductRows(productRows) {
  return productRows
    .filter((row) => stockCategoryIdForProduct(row.product) === "finished_products")
    .sort((a, b) => b.salesValue - a.salesValue)
    .map((row) => `
      <tr
        data-ceo-row
        data-ceo-kind="product"
        data-ceo-product="${escapeHtml(row.id)}"
        data-ceo-products="${escapeHtml(productDataset([row.id]))}"
        data-ceo-date="${escapeHtml(row.latestActivity)}"
        data-search-index="${escapeHtml(`${row.product.name} ${row.performanceSignal}`.toLowerCase())}"
      >
        <td>
          <strong>${escapeHtml(row.product.name)}</strong>
          <div class="muted">${escapeHtml(row.id)}</div>
        </td>
        <td>
          <strong>${formatCurrency(row.salesValue)}</strong>
          <div class="muted">${formatNumber(row.salesUnits)} units moved</div>
        </td>
        <td>
          ${formatNumber(row.returnedUnits)} returned
          <div class="muted">Last ${formatUpdatedAt(row.latestActivity)}</div>
        </td>
        <td>${statusPill(row.performanceSignal)}</td>
      </tr>
    `)
    .join("");
}

function renderCeoStockRows(productRows) {
  return productRows
    .filter((row) => row.product.status !== "inactive")
    .sort((a, b) => b.product.stock + b.repUnits + b.supermarketUnits - (a.product.stock + a.repUnits + a.supermarketUnits))
    .map((row) => {
      const health = getStockHealth(row.product);
      const searchIndex = [
        row.product.name,
        row.product.warehouse,
        row.product.category,
        health.status
      ].join(" ").toLowerCase();

      return `
        <tr
          data-ceo-row
          data-ceo-kind="product"
          data-ceo-product="${escapeHtml(row.id)}"
          data-ceo-products="${escapeHtml(productDataset([row.id]))}"
          data-ceo-date="${escapeHtml(row.latestActivity)}"
          data-search-index="${escapeHtml(searchIndex)}"
        >
          <td>
            <strong>${escapeHtml(row.product.name)}</strong>
            <div class="muted">${escapeHtml(row.product.warehouse || "Factory")}</div>
          </td>
          <td>${formatNumber(row.product.stock)}</td>
          <td>${formatNumber(row.repUnits)}</td>
          <td>${formatNumber(row.supermarketUnits)}</td>
          <td>${statusPill(health.status)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderCeoRepRows(repRows) {
  return repRows
    .map((row) => {
      const creditStatus = row.creditUsagePercent >= 100 ? "credit_hold" : row.creditUsagePercent >= 85 ? "credit_watch" : "credit_clear";
      const searchIndex = [
        row.repName,
        creditStatus,
        row.productIds.join(" ")
      ].join(" ").toLowerCase();

      return `
        <tr
          data-ceo-row
          data-ceo-kind="rep"
          data-ceo-rep="${escapeHtml(row.repName)}"
          data-ceo-products="${escapeHtml(productDataset(row.productIds))}"
          data-ceo-date="${escapeHtml(row.latestActivity)}"
          data-search-index="${escapeHtml(searchIndex)}"
        >
          <td>
            <strong>${escapeHtml(row.repName)}</strong>
            <div class="muted">${formatNumber(row.openAssignments)} open assignment${row.openAssignments === 1 ? "" : "s"}</div>
          </td>
          <td>
            ${formatNumber(row.outstanding)} units
            <div class="muted">${formatNumber(row.sold)} sold - ${formatNumber(row.returned)} returned</div>
          </td>
          <td>
            <div class="stock-line">
              <div class="stock-meta">
                <span>${formatPercent(row.sellThroughPercent)}</span>
                <span>${formatCurrency(row.salesAmount)}</span>
              </div>
              ${progressBar(row.sellThroughPercent, row.sellThroughPercent < 55 ? "warning" : "good")}
            </div>
          </td>
          <td>
            ${statusPill(creditStatus)}
            <div class="muted">${formatCurrency(row.creditBalance)} of ${formatCurrency(row.creditLimit)}</div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderCeoSupermarketRows(supermarketRows) {
  return supermarketRows
    .sort((a, b) => b.balance - a.balance)
    .map((row) => {
      const customerState = row.retailer.stateName || row.retailer.region || "";
      const customerLocation = [row.retailer.city, customerState].filter(Boolean).join(" - ");
      const searchIndex = [
        row.retailer.name,
        customerState,
        row.status,
        row.productIds.join(" ")
      ].join(" ").toLowerCase();

      return `
        <tr
          data-ceo-row
          data-ceo-kind="supermarket"
          data-ceo-supermarket="${escapeHtml(row.retailer.id)}"
          data-ceo-products="${escapeHtml(productDataset(row.productIds))}"
          data-ceo-date="${escapeHtml(row.latestActivity)}"
          data-search-index="${escapeHtml(searchIndex)}"
        >
          <td>
            <strong>${escapeHtml(row.retailer.name)}</strong>
            <div class="muted">${escapeHtml(customerLocation || "Location not set")}</div>
          </td>
          <td>
            ${formatNumber(row.orderCount)} order${row.orderCount === 1 ? "" : "s"}
            <div class="muted">${formatCurrency(row.orderValue)}</div>
          </td>
          <td>
            <div class="stock-line">
              <div class="stock-meta">
                <span>${formatCurrency(row.balance)}</span>
                <span>${formatPercent(row.usagePercent)}</span>
              </div>
              ${progressBar(row.usagePercent, row.usagePercent >= 100 ? "danger" : row.usagePercent >= 85 ? "warning" : "good")}
            </div>
          </td>
          <td>${statusPill(row.status)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderCeoRiskRows(riskRows) {
  return riskRows.slice(0, 6).map((row) => `
    <tr
      data-ceo-row
      data-ceo-kind="risk"
      data-ceo-date="${escapeHtml(row.changedAt)}"
      data-search-index="${escapeHtml(`${row.partyName} ${row.partyType} ${row.status}`.toLowerCase())}"
    >
      <td>
        <strong>${escapeHtml(row.partyName)}</strong>
        <div class="muted">${escapeHtml(creditPartyTypeLabel(row.partyType))}</div>
      </td>
      <td>${statusPill(row.status)}</td>
      <td>
        <strong>${formatCurrency(row.balance)}</strong>
        <div class="muted">${formatPercent(row.usagePercent)} of ${formatCurrency(row.limit)}</div>
      </td>
      <td>${formatCurrency(row.remaining)}</td>
    </tr>
  `).join("");
}

function dateKey(value) {
  return String(value || "").slice(0, 10);
}

function addDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate.toISOString().slice(0, 10);
}

function buildCeoSalesTrend(state) {
  const productMap = getProductMap(state.products || []);
  const anchorDate = latestDate([
    ...(state.orders || []).map((order) => order.createdAt || order.dueAt),
    ...(state.stockTransactions || []).map((transaction) => transaction.createdAt || transaction.date),
    ...(state.salesReports || []).map((report) => report.submittedAt || report.reportDate)
  ]) || todayISO();
  const anchor = new Date(`${dateKey(anchorDate || todayISO())}T12:00:00`);
  const days = Array.from({ length: 7 }, (_, index) => addDays(anchor, index - 6));
  const totals = new Map(days.map((day) => [day, 0]));

  (state.orders || []).forEach((order) => {
    const key = dateKey(order.createdAt || order.dueAt);
    if (!totals.has(key)) return;
    totals.set(key, totals.get(key) + salesValueFromOrder(order, productMap));
  });

  const maxValue = Math.max(...totals.values(), 1);

  return days.map((day) => ({
    day,
    label: formatDate(day),
    value: totals.get(day) || 0,
    percent: ((totals.get(day) || 0) / maxValue) * 100
  }));
}

function renderCeoSalesChart(trend) {
  return `
    <div class="ceo-chart" aria-label="Sales trend for the last seven days">
      ${trend.map((point) => `
        <div class="ceo-chart-column" data-search-index="${escapeHtml(`${point.label} ${point.value}`.toLowerCase())}">
          <div class="ceo-chart-track">
            <span class="ceo-chart-bar" style="height: ${Math.max(8, point.percent)}%"></span>
          </div>
          <strong>${escapeHtml(point.label)}</strong>
          <span>${formatCurrency(point.value)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderCeoPulseRows({ topProduct, lowStockProduct, riskyAccount, latestReport }) {
  const rows = [
    {
      label: "Top product",
      value: topProduct ? topProduct.product.name : "No sales yet",
      meta: topProduct ? formatCurrency(topProduct.salesValue) : "Waiting for activity",
      status: "top_performer"
    },
    {
      label: "Needs stock",
      value: lowStockProduct ? lowStockProduct.name : "Stock looks stable",
      meta: lowStockProduct ? `${formatNumber(lowStockProduct.stock)} left` : "No urgent item",
      status: lowStockProduct ? "low" : "ready"
    },
    {
      label: "Credit watch",
      value: riskyAccount ? riskyAccount.partyName : "No risky account",
      meta: riskyAccount ? `${formatPercent(riskyAccount.usagePercent)} used` : "Exposure controlled",
      status: riskyAccount?.status || "credit_clear"
    },
    {
      label: "Latest report",
      value: latestReport?.repName || "No report yet",
      meta: latestReport ? formatUpdatedAt(latestReport.submittedAt || latestReport.reportDate) : "Waiting for submission",
      status: latestReport?.status || "pending"
    }
  ];

  return `
    <div class="ceo-pulse-list">
      ${rows.map((row) => `
        <article class="ceo-pulse-row" data-search-index="${escapeHtml(`${row.label} ${row.value} ${row.meta}`.toLowerCase())}">
          <div>
            <span class="eyebrow">${escapeHtml(row.label)}</span>
            <strong>${escapeHtml(row.value)}</strong>
            <p>${escapeHtml(row.meta)}</p>
          </div>
          ${statusPill(row.status)}
        </article>
      `).join("")}
    </div>
  `;
}

function renderCeoStockSplit(vision, productRows) {
  const supermarketUnits = productRows.reduce((total, row) => total + Number(row.supermarketUnits || 0), 0);
  const maxValue = Math.max(vision.finishedStockUnits, vision.repOutstandingUnits, supermarketUnits, 1);
  const rows = [
    {
      label: "Factory",
      value: vision.finishedStockUnits,
      tone: "good"
    },
    {
      label: "Representatives",
      value: vision.repOutstandingUnits,
      tone: vision.repOutstandingUnits > vision.finishedStockUnits ? "warning" : "good"
    },
    {
      label: "Supermarkets",
      value: supermarketUnits,
      tone: "good"
    }
  ];

  return `
    <div class="bar-list">
      ${rows.map((row) => `
        <div class="bar-row ceo-stock-row" data-search-index="${escapeHtml(row.label.toLowerCase())}">
          <strong>${escapeHtml(row.label)}</strong>
          ${progressBar((row.value / maxValue) * 100, row.tone)}
          <span class="strong">${formatNumber(row.value)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderCeoProductFocus(productRows) {
  const rankedRows = productRows
    .filter((row) => stockCategoryIdForProduct(row.product) === "finished_products")
    .sort((a, b) => b.salesValue - a.salesValue);
  const rows = [
    rankedRows[0],
    rankedRows.at(-1)
  ].filter(Boolean);

  return `
    <div class="ceo-product-focus">
      ${rows.map((row) => `
        <article class="ceo-product-focus-card" data-search-index="${escapeHtml(`${row.product.name} ${row.performanceSignal}`.toLowerCase())}">
          <span class="eyebrow">${escapeHtml(row.performanceSignal === "top_performer" ? "Top performer" : "Needs attention")}</span>
          <strong>${escapeHtml(row.product.name)}</strong>
          <p>${formatCurrency(row.salesValue)} - ${formatNumber(row.salesUnits)} units moved</p>
          ${statusPill(row.performanceSignal)}
        </article>
      `).join("")}
    </div>
  `;
}

function renderCeoDashboard(state) {
  const metrics = calculateMetrics(state);
  const vision = calculateVisionMetrics(state);
  const freshness = buildCeoFreshness(state);
  const productRows = buildCeoProductPerformance(state);
  const riskRows = buildCeoRiskRows(state);
  const trend = buildCeoSalesTrend(state);
  const riskyAccountCount = riskRows.filter((row) => row.status !== "credit_clear").length;
  const topProduct = [...productRows].sort((a, b) => b.salesValue - a.salesValue)[0];
  const lowStockProduct = getLowStockProducts(state.products || [])[0];
  const riskyAccount = riskRows.find((row) => row.status !== "credit_clear") || riskRows[0];
  const latestReport = [...(state.salesReports || [])]
    .sort((a, b) => toTimestamp(b.submittedAt || b.reportDate) - toTimestamp(a.submittedAt || a.reportDate))[0];

  return `
    <section class="view dashboard-view ceo-dashboard">
      <section class="ceo-command-strip">
        <div>
          <span class="eyebrow">CEO portal</span>
          <h2>Executive overview</h2>
        </div>
        <a class="button primary" href="#/inventory?action=add-stock">
          ${icon("plus")}
          <span>Add stock</span>
        </a>
      </section>

      <div class="metric-grid ceo-minimal-metrics">
        ${renderCeoMetricCard({
          label: "Sales",
          value: formatCurrency(metrics.orderRevenue),
          meta: "Total order value",
          iconName: "orders",
          freshness: freshness.sales
        })}
        ${renderCeoMetricCard({
          label: "Stock",
          value: formatNumber(vision.finishedStockUnits + vision.repOutstandingUnits),
          meta: "Factory plus representative custody",
          iconName: "package",
          freshness: freshness.stock
        })}
        ${renderCeoMetricCard({
          label: "Credit",
          value: formatCurrency(vision.creditBalanceTotal),
          meta: `${formatNumber(riskyAccountCount)} risky account${riskyAccountCount === 1 ? "" : "s"}`,
          iconName: "wallet",
          freshness: freshness.credit
        })}
        ${renderCeoMetricCard({
          label: "Reports",
          value: formatNumber(state.salesReports?.length || 0),
          meta: latestReport ? `Latest: ${latestReport.repName}` : "No submitted reports yet",
          iconName: "dashboard",
          freshness: freshness.reports
        })}
      </div>

      <div class="dashboard-layout ceo-dashboard-layout">
        <section class="panel ceo-chart-panel">
          ${panelHeader("Sales trend", "Last 7 days")}
          ${renderCeoSalesChart(trend)}
        </section>

        <section class="panel ceo-pulse-panel">
          ${panelHeader("Business pulse", "What needs leadership attention")}
          ${renderCeoPulseRows({ topProduct, lowStockProduct, riskyAccount, latestReport })}
        </section>
      </div>

      <div class="ceo-mini-grid">
        <section class="panel">
          ${panelHeader("Stock split", "Where finished stock currently sits")}
          ${renderCeoStockSplit(vision, productRows)}
        </section>

        <section class="panel">
          ${panelHeader("Product focus", "Best seller and slow mover")}
          ${renderCeoProductFocus(productRows)}
        </section>
      </div>
    </section>
  `;
}

function storeKeeperCategorySummary(state) {
  const categories = [
    {
      id: "raw_materials",
      label: "Raw materials",
      href: "#/inventory?type=raw_materials"
    },
    {
      id: "finished_products",
      label: "Finished goods",
      href: "#/inventory?type=finished_products"
    },
    {
      id: "equipment",
      label: "Equipment",
      href: "#/inventory?type=equipment"
    }
  ];

  return categories.map((category) => {
    const products = (state.products || []).filter((product) => stockCategoryIdForProduct(product) === category.id);
    const units = products.reduce((total, product) => total + Number(product.stock || 0), 0);
    const lowCount = products.filter((product) => getStockHealth(product).status !== "ready").length;

    return {
      ...category,
      products,
      units,
      lowCount
    };
  });
}

function renderStoreKeeperCategoryCards(state) {
  return `
    <div class="storekeeper-category-grid">
      ${storeKeeperCategorySummary(state).map((category) => `
        <a class="storekeeper-category-card" href="${escapeHtml(category.href)}" data-search-index="${escapeHtml(category.label.toLowerCase())}">
          <span class="eyebrow">${escapeHtml(category.label)}</span>
          <strong>${formatNumber(category.units)}</strong>
          <p>${formatNumber(category.products.length)} item${category.products.length === 1 ? "" : "s"} - ${formatNumber(category.lowCount)} low</p>
          ${statusPill(category.lowCount ? "low" : "ready")}
        </a>
      `).join("")}
    </div>
  `;
}

function renderStoreKeeperAlertRows(state, permissions) {
  const canRestock = permissions.canManageProducts || permissions.canManageStockMovements || permissions.canReconcileStock;
  const lowStockProducts = getLowStockProducts(state.products || []).slice(0, 5);

  if (!lowStockProducts.length) {
    return '<div class="empty-state">No low-stock alerts</div>';
  }

  return `
    <div class="alert-list">
      ${lowStockProducts.map((product) => `
        <article class="alert-item" data-search-index="${escapeHtml(`${product.name} ${product.category}`.toLowerCase())}">
          <span class="alert-icon" aria-hidden="true">!</span>
          <div class="stack">
            <div>
              <strong>${escapeHtml(product.name)}</strong>
              <p>${formatNumber(product.stock)} left in ${escapeHtml(product.warehouse || "Factory")} - minimum ${formatNumber(product.reorderPoint)}</p>
            </div>
            ${textButton({
              iconName: "plus",
              label: "Restock",
              className: "primary js-restock-product",
              disabled: !canRestock,
              data: { "product-id": product.id }
            })}
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function storeKeeperDispatches(state, limit = 5) {
  const dispatches = [...(state.stockTransactions || [])]
    .filter((transaction) => {
      const type = normalized(transaction.type);
      return transaction.dispatchDestination || type === "supply" || type === "internal movement";
    })
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.id || "").localeCompare(String(a.id || "")));

  return limit ? dispatches.slice(0, limit) : dispatches;
}

function renderStoreKeeperDispatchRows(state) {
  const productMap = getProductMap(state.products || []);
  const dispatches = storeKeeperDispatches(state);

  if (!dispatches.length) {
    return '<div class="empty-state">No factory dispatches recorded yet</div>';
  }

  return `
    <div class="storekeeper-dispatch-list">
      ${dispatches.map((dispatch) => {
        const product = productMap.get(dispatch.productId);

        return `
          <article class="storekeeper-dispatch-row" data-search-index="${escapeHtml(`${product?.name || ""} ${dispatch.partyName || ""}`.toLowerCase())}">
            <div>
              <strong>${escapeHtml(product?.name || dispatch.productId)}</strong>
              <p>${formatNumber(dispatch.quantity)} units to ${escapeHtml(dispatch.partyName || dispatch.recipientName || "Factory")}</p>
            </div>
            <div>
              ${statusPill(dispatch.movementDirection === "in" ? "in_stock" : "dispatched")}
              <span class="muted">${formatDate(dispatch.date)}</span>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderStoreKeeperDashboard(state, permissions) {
  const vision = calculateVisionMetrics(state);
  const lowStockProducts = getLowStockProducts(state.products || []);
  const dispatchCount = storeKeeperDispatches(state, 0).length;
  const movementCount = (state.stockTransactions || []).length;

  return `
    <section class="view dashboard-view storekeeper-dashboard">
      <section class="ceo-command-strip storekeeper-command-strip">
        <div>
          <span class="eyebrow">Store Keeper portal</span>
          <h2>Factory stock control</h2>
        </div>
        <a class="button primary" href="#/inventory?tab=dispatch">
          ${icon("truck")}
          <span>Record dispatch</span>
        </a>
      </section>

      <div class="metric-grid">
        ${metricCard({
          label: "Finished goods",
          value: formatNumber(vision.finishedStockUnits),
          meta: "Ready stock in factory",
          iconName: "package"
        })}
        ${metricCard({
          label: "Raw material risks",
          value: formatNumber(vision.rawMaterialRiskCount),
          meta: "Below reorder health",
          iconName: "alert"
        })}
        ${metricCard({
          label: "Dispatches",
          value: formatNumber(dispatchCount),
          meta: "Recent factory movements",
          iconName: "truck"
        })}
        ${metricCard({
          label: "Movement records",
          value: formatNumber(movementCount),
          meta: "In and out history",
          iconName: "dashboard"
        })}
      </div>

      <div class="dashboard-layout">
        <section class="panel">
          ${panelHeader("Low-stock alerts", `${formatNumber(lowStockProducts.length)} item${lowStockProducts.length === 1 ? "" : "s"} need attention`)}
          ${renderStoreKeeperAlertRows(state, permissions)}
        </section>

        <section class="panel">
          ${panelHeader("Recent dispatches", "Stock leaving or entering factory control")}
          ${renderStoreKeeperDispatchRows(state)}
        </section>
      </div>

      <section class="panel">
        ${panelHeader("Stock sections", "Raw materials, finished goods, and equipment are managed separately")}
        ${renderStoreKeeperCategoryCards(state)}
      </section>
    </section>
  `;
}

function renderRegionalSummary(state) {
  return buildRegionalSummary(state)
    .map(
      (item) => `
        <div class="bar-row" data-search-index="${escapeHtml(item.region.toLowerCase())}">
          <strong>${escapeHtml(item.region)}</strong>
          ${progressBar(item.percent)}
          <span class="strong">${formatCompact(item.value)}</span>
        </div>
      `
    )
    .join("");
}

function renderAlerts(state, permissions) {
  const lowStockProducts = getLowStockProducts(state.products).slice(0, 4);
  const delayedOrders = state.orders.filter((order) => order.status === "delayed");
  const submittedReports = (state.salesReports || []).filter((report) => report.status === "submitted").slice(0, 2);
  const vision = calculateVisionMetrics(state);
  const paperTrailPending = Math.max(0, vision.paperTrailOrders - vision.paperTrailReadyOrders);
  const canRestock = permissions.canManageProducts || permissions.canManageStockMovements || permissions.canReconcileStock;
  const canAdvanceSales = permissions.canLogSalesReturns || permissions.canDispatchStock;
  const alerts = [
    ...(vision.creditHoldOrders
      ? [{
          id: "credit-holds",
          title: `${formatNumber(vision.creditHoldOrders)} sales order${vision.creditHoldOrders === 1 ? "" : "s"} on credit hold`,
          detail: "Projected customer balance exceeds the approved limit",
          action: '<a class="button" href="#/orders"><span>Review orders</span></a>'
        }]
      : []),
    ...(paperTrailPending
      ? [{
          id: "paper-trail",
          title: `${formatNumber(paperTrailPending)} delivery note${paperTrailPending === 1 ? "" : "s"} need printing`,
          detail: "Physical signature trail is not ready for every active delivery",
          action: '<a class="button" href="#/orders"><span>Open orders</span></a>'
        }]
      : []),
    ...submittedReports.map((report) => ({
      id: report.id,
      title: `${report.repName} submitted a sales report`,
      detail: `${formatCurrency(report.salesAmount)} sales for ${formatDate(report.reportDate)}`,
      action: '<a class="button" href="#/activity-log"><span>Review</span></a>'
    })),
    ...lowStockProducts.map((product) => ({
      id: product.id,
      title: `${product.name} needs replenishment`,
      detail: `${formatNumber(product.stock)} units left in ${product.warehouse}`,
      action: textButton({
        iconName: "plus",
        label: "Restock",
        className: "primary js-restock-product",
        disabled: !canRestock,
        data: { "product-id": product.id }
      })
    })),
    ...delayedOrders.map((order) => ({
      id: order.id,
      title: `${order.id} is delayed`,
      detail: `Priority ${order.priority} snack order due ${formatDate(order.dueAt)}`,
      action: iconButton({
        iconName: "arrowRight",
        label: "Move sales order forward",
        className: "js-advance-order",
        disabled: !canAdvanceSales,
        data: { "order-id": order.id }
      })
    }))
  ].slice(0, 5);

  if (!alerts.length) {
    return '<div class="empty-state">No operational alerts</div>';
  }

  return `
    <div class="alert-list">
      ${alerts
        .map(
          (alert) => `
            <article class="alert-item" data-search-index="${escapeHtml(`${alert.title} ${alert.detail}`.toLowerCase())}">
              <span class="alert-icon" aria-hidden="true">!</span>
              <div class="stack">
                <div>
                  <strong>${escapeHtml(alert.title)}</strong>
                  <p>${escapeHtml(alert.detail)}</p>
                </div>
                <div>${alert.action}</div>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderRecentOrders(state, permissions) {
  const canAdvanceSales = permissions.canLogSalesReturns || permissions.canDispatchStock;

  return getOrdersWithTotals(state)
    .slice(0, 5)
    .map(
      (order) => `
        <tr data-search-index="${escapeHtml(`${order.id} ${order.retailer?.name} ${order.region} ${order.status}`.toLowerCase())}">
          <td>
            <strong>${escapeHtml(order.id)}</strong>
            <div class="muted">${escapeHtml(order.retailer?.name || "Unknown customer")}</div>
          </td>
          <td>${escapeHtml(order.region)}</td>
          <td>${statusPill(order.status)}</td>
          <td>${formatCurrency(order.total)}</td>
          <td>
            <div class="row-actions">
              ${iconButton({
                iconName: "arrowRight",
                label: "Move sales order forward",
                className: "js-advance-order",
                disabled: order.status === "delivered" || !canAdvanceSales,
                data: { "order-id": order.id }
              })}
            </div>
          </td>
        </tr>
      `
    )
    .join("");
}

function renderFactoryCashControls(vision) {
  const controls = [
    {
      label: "Traceable records",
      percent: vision.traceabilityPercent,
      value: `${formatNumber(vision.traceableRecords)} of ${formatNumber(vision.totalTraceableRecords)}`,
      tone: vision.traceabilityPercent < 95 ? "warning" : "good"
    },
    {
      label: "Representative sell-through",
      percent: vision.repSellThroughPercent,
      value: `${formatNumber(vision.soldUnits)} sold`,
      tone: vision.repSellThroughPercent < 65 ? "warning" : "good"
    },
    {
      label: "Paper trail ready",
      percent: vision.paperTrailReadyPercent,
      value: `${formatNumber(vision.paperTrailReadyOrders)} of ${formatNumber(vision.paperTrailOrders)}`,
      tone: vision.paperTrailReadyPercent < 100 ? "warning" : "good"
    },
    {
      label: "Signed deliveries",
      percent: vision.signatureCoveragePercent,
      value: `${formatNumber(vision.signedOrders)} of ${formatNumber(vision.signatureEligibleOrders)}`,
      tone: vision.signatureCoveragePercent < 100 ? "warning" : "good"
    }
  ];

  return controls.map((control) => `
    <div class="bar-row" data-search-index="${escapeHtml(control.label.toLowerCase())}">
      <strong>${escapeHtml(control.label)}</strong>
      ${progressBar(control.percent, control.tone)}
      <span class="strong">${escapeHtml(control.value)}</span>
    </div>
  `).join("");
}

function renderManagerControlPanel(state, vision) {
  const openVariances = (state.stockAssignments || []).filter((assignment) => (
    assignment.status !== "reconciled" && assignmentOutstanding(assignment) > 0
  )).length;
  const submittedReports = (state.salesReports || []).filter((report) => report.status === "submitted").length;
  const activeProducts = (state.products || []).filter((product) => product.status !== "inactive").length;
  const watchedCredit = vision.creditWatchCount + vision.creditHoldCount;
  const cards = [
    {
      label: "Sales operations",
      value: formatCurrency(vision.invoiceTotal || 0),
      body: "Monitor consolidated sales, cash, credit, and returns.",
      href: "#manager-sales-operations"
    },
    {
      label: "Catalogue",
      value: formatNumber(activeProducts),
      body: "Add, update, categorize, price, image, show, or hide products.",
      href: "#/inventory"
    },
    {
      label: "Representative stock",
      value: formatNumber(openVariances),
      body: "Load stock to representatives and close reconciliations.",
      href: "#/inventory"
    },
    {
      label: "Credit terms",
      value: formatNumber(watchedCredit),
      body: "Set limits, discounts, payment periods, and late penalties.",
      href: "#/finance"
    },
    {
      label: "Supermarkets",
      value: formatNumber(state.retailers?.length || 0),
      body: "Manage supermarket profiles, contacts, tiers, and terms.",
      href: "#/retailers"
    },
    {
      label: "Reports",
      value: formatNumber(submittedReports),
      body: "Review representative sales and stock submissions.",
      href: "#manager-report-review"
    }
  ];

  return `
    <section class="panel manager-command-panel">
      ${panelHeader("Manager controls", "Sales operations, stock custody, credit terms, catalogue, and supermarket relationships")}
      <div class="manager-command-grid is-compact">
        ${cards.map((card) => `
          <a class="manager-command-card" href="${escapeHtml(card.href)}" title="${escapeHtml(card.body)}" aria-label="${escapeHtml(`${card.label}. ${card.body}`)}" data-search-index="${escapeHtml(`${card.label} ${card.body}`.toLowerCase())}">
            <span class="eyebrow">${escapeHtml(card.label)}</span>
            <strong>${escapeHtml(card.value)}</strong>
          </a>
        `).join("")}
      </div>
    </section>
  `;
}

function renderManagerOperationsLayout(state, permissions, vision) {
  return `
    <div class="manager-ops-layout">
      <div class="manager-ops-left">
        <section class="panel manager-half-panel">
          ${panelHeader("Factory-to-cash controls", "Produced stock, custody, paper trails, signatures, and payment visibility")}
          <div class="bar-list">${renderFactoryCashControls(vision)}</div>
        </section>

        <section class="panel manager-half-panel">
          ${panelHeader("Territory sales", "Sales value by territory")}
          <div class="bar-list">${renderRegionalSummary(state)}</div>
        </section>
      </div>

      <section class="panel manager-attention-panel">
        ${panelHeader("Attention queue", "Items that need action today")}
        ${renderAlerts(state, permissions)}
      </section>
    </div>
  `;
}

function renderManagerReportRows(state) {
  const transactionMap = new Map((state.stockTransactions || []).map((transaction) => [transaction.id, transaction]));

  return (state.salesReports || []).map((report) => {
    const reportLines = (report.reportLines || []).length
      ? report.reportLines
      : (report.transactionIds || [])
        .map((transactionId) => transactionMap.get(transactionId))
        .filter(Boolean)
        .map((transaction) => repTransactionLine(transaction, state));
    const linePreview = reportLines
      .slice(0, 2)
      .map((line) => `${line.customerName} - ${line.productName}`)
      .join(", ");
    const searchIndex = [
      report.repName,
      report.reportDate,
      report.status,
      report.reviewNote,
      ...reportLines.flatMap((line) => [line.customerName, line.productName])
    ].join(" ").toLowerCase();

    return `
      <tr data-search-index="${escapeHtml(searchIndex)}">
        <td>
          <strong>${escapeHtml(report.repName)}</strong>
          <div class="muted">${formatDate(report.reportDate)} - ${escapeHtml(report.tripLabel || "Trip")}</div>
        </td>
        <td>${statusPill(report.status)}</td>
        <td>
          <strong>${formatCurrency(report.salesAmount)}</strong>
          <div class="muted">${formatNumber(report.unitsSold)} sold - ${formatNumber(report.unitsReturned)} returned</div>
        </td>
        <td>
          ${formatCurrency(report.cashAmount)} cash
          <div class="muted">${formatCurrency(report.creditAmount)} credit</div>
        </td>
        <td>
          ${escapeHtml(report.reviewNote || "No query")}
          <div class="muted">${linePreview ? escapeHtml(linePreview) : `${formatNumber((report.transactionIds || []).length)} linked record${(report.transactionIds || []).length === 1 ? "" : "s"}`}</div>
        </td>
        <td>
          <div class="row-actions">
            ${textButton({
              iconName: "alert",
              label: "Flag",
              className: "js-flag-report",
              disabled: report.status === "flagged",
              data: { "report-id": report.id }
            })}
            ${textButton({
              iconName: "check",
              label: report.status === "reviewed" ? "Reviewed" : "Review",
              className: "primary js-review-report",
              disabled: report.status === "reviewed",
              data: { "report-id": report.id }
            })}
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderManagerSalesOperationsRows(state) {
  const rows = new Map();

  (state.salesReports || []).forEach((report) => {
    const key = report.repName || "Unassigned";
    const row = rows.get(key) || {
      repName: key,
      reports: 0,
      salesAmount: 0,
      cashAmount: 0,
      creditAmount: 0,
      returnAmount: 0,
      unitsSold: 0,
      unitsReturned: 0,
      latestDate: ""
    };

    row.reports += 1;
    row.salesAmount += Number(report.salesAmount || 0);
    row.cashAmount += Number(report.cashAmount || 0);
    row.creditAmount += Number(report.creditAmount || 0);
    row.returnAmount += Number(report.returnAmount || 0);
    row.unitsSold += Number(report.unitsSold || 0);
    row.unitsReturned += Number(report.unitsReturned || 0);
    row.latestDate = String(report.reportDate || "").localeCompare(row.latestDate) > 0 ? report.reportDate : row.latestDate;
    rows.set(key, row);
  });

  return [...rows.values()]
    .sort((a, b) => b.salesAmount - a.salesAmount)
    .map((row) => {
      const creditShare = row.salesAmount ? (row.creditAmount / row.salesAmount) * 100 : 0;

      return `
        <tr data-search-index="${escapeHtml(`${row.repName} ${row.latestDate}`.toLowerCase())}">
          <td>
            <strong>${escapeHtml(row.repName)}</strong>
            <div class="muted">${formatNumber(row.reports)} report${row.reports === 1 ? "" : "s"} - latest ${formatDate(row.latestDate)}</div>
          </td>
          <td>
            <strong>${formatCurrency(row.salesAmount)}</strong>
            <div class="muted">${formatNumber(row.unitsSold)} units sold</div>
          </td>
          <td>${formatCurrency(row.cashAmount)}</td>
          <td>
            ${formatCurrency(row.creditAmount)}
            <div class="muted">${formatPercent(creditShare)} of sales</div>
          </td>
          <td>
            ${formatCurrency(row.returnAmount)}
            <div class="muted">${formatNumber(row.unitsReturned)} units returned</div>
          </td>
        </tr>
      `;
    });
}

function renderManagerSalesOperations(state) {
  return `
    <section class="panel" id="manager-sales-operations">
      ${panelHeader("Consolidated sales activity", "Sales, cash, credit, and returns across all sales representatives")}
      ${table(
        ["Representative", "Sales", "Cash", "Credit", "Returns"],
        renderManagerSalesOperationsRows(state),
        "No representative sales activity has been submitted yet"
      )}
    </section>
  `;
}

function renderManagerReportReview(state) {
  return `
    <section class="panel" id="manager-report-review">
      ${panelHeader("Report review", "Submitted representative reports can be reviewed or flagged for correction")}
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Report</th>
              <th>Status</th>
              <th>Sales</th>
              <th>Payment mix</th>
              <th>Query</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${renderManagerReportRows(state) || '<tr><td colspan="6">No submitted reports yet</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderRepStockCards(assignments) {
  if (!assignments.length) {
    return '<div class="empty-state">No assigned stock yet</div>';
  }

  return `
    <div class="rep-stock-grid">
      ${assignments.map((assignment) => `
        <article class="rep-stock-card" data-search-index="${escapeHtml(`${assignment.product.name} ${assignment.repName}`.toLowerCase())}">
          <header>
            <div>
              <span class="eyebrow">Assigned stock - ${escapeHtml(assignment.product.id)}</span>
              <h3>${escapeHtml(assignment.product.name)}</h3>
            </div>
            ${statusPill(assignment.outstanding > 0 ? "in_hand" : "done")}
          </header>

          <div class="rep-stock-count">
            <strong>${formatNumber(assignment.outstanding)}</strong>
            <span>left</span>
          </div>

          <div class="stock-line">
            <div class="stock-meta">
              <span>${formatNumber(assignment.sold)} sold</span>
              <span>${formatNumber(assignment.returned)} returned</span>
            </div>
            ${progressBar(assignment.soldPercent, assignment.soldPercent < 60 ? "warning" : "good")}
          </div>

          <footer>
            <span class="muted">${formatNumber(assignment.assigned)} assigned</span>
            <button class="button js-fill-rep-product" type="button" data-assignment-id="${escapeHtml(assignment.id)}">
              <span>Use this</span>
            </button>
          </footer>
        </article>
      `).join("")}
    </div>
  `;
}

function renderRepCustomerField(customers) {
  if (!customers.length) {
    return `
      <label class="field">
        <span>Customer</span>
        <input name="customerName" type="text" placeholder="Customer or supermarket name" required>
      </label>
    `;
  }

  return `
    <label class="field">
      <span>Customer</span>
      <select name="customerId" required>
        <option value="">Pick customer</option>
        ${customers.map((customer) => `
          <option value="${escapeHtml(customer.id)}">${escapeHtml(customer.name)}</option>
        `).join("")}
      </select>
    </label>
  `;
}

function renderRepQuickLog(state, assignments) {
  const customers = state.retailers || [];

  return `
    <section class="panel rep-action-panel">
      ${panelHeader("Quick log", "")}
      <form id="rep-log-form" class="rep-log-form" novalidate>
        <fieldset class="rep-type-toggle" aria-label="Choose sale or customer return">
          <label>
            <input type="radio" name="transactionType" value="sale" checked>
            <span>Sale</span>
          </label>
          <label>
            <input type="radio" name="transactionType" value="return">
            <span>Customer return</span>
          </label>
        </fieldset>

        <label class="field">
          <span>Snack</span>
          <select name="assignmentId" required>
            <option value="">Pick snack</option>
            ${assignments.map((assignment) => `
              <option value="${escapeHtml(assignment.id)}" data-outstanding="${escapeHtml(assignment.outstanding)}">
                ${escapeHtml(assignment.product.name)} (${formatNumber(assignment.outstanding)} left)
              </option>
            `).join("")}
          </select>
        </label>

        <label class="field">
          <span>How many?</span>
          <input name="quantity" type="number" min="1" step="1" inputmode="numeric" placeholder="0" required>
        </label>

        ${renderRepCustomerField(customers)}

        <label class="field">
          <span>Payment</span>
          <select name="paymentType">
            <option value="cash">Cash</option>
            <option value="credit">Credit</option>
          </select>
        </label>

        <span id="rep-log-message" class="rep-form-message" role="status" aria-live="polite"></span>
        <button class="button primary rep-save-button" type="submit">
          <span>Save</span>
        </button>
      </form>
    </section>
  `;
}

function renderRepActivity(transactions, state) {
  if (!transactions.length) {
    return '<div class="empty-state">No sales yet today</div>';
  }

  const lines = repTransactionLines(transactions, state);

  return `
    <div class="rep-activity-list">
      ${lines.map((line) => `
        <article class="rep-activity-item" data-search-index="${escapeHtml(`${line.type} ${line.customerName} ${line.productName} ${line.paymentType}`.toLowerCase())}">
          <div>
            <strong>${escapeHtml(line.productName)}</strong>
            <span>${escapeHtml(line.customerName)}</span>
          </div>
          <div>
            <strong>${formatCurrency(line.amount)}</strong>
            <span>${escapeHtml(line.type)} - ${formatNumber(line.quantity)} units - ${escapeHtml(line.paymentType)}</span>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderRepReportLines(transactions, state) {
  if (!transactions.length) {
    return '<div class="empty-state">No lines to report yet</div>';
  }

  const lines = repTransactionLines(transactions, state);

  return `
    <div class="rep-report-lines" aria-label="Daily report lines">
      ${lines.map((line) => `
        <article class="rep-report-line">
          <div>
            <strong>${escapeHtml(line.productName)}</strong>
            <span>${escapeHtml(line.customerName)}</span>
          </div>
          <div>
            <strong>${formatNumber(line.quantity)}</strong>
            <span>${escapeHtml(line.type)} - ${formatCurrency(line.amount)}</span>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderRepReportPanel(repName, transactions, summary, existingReport, state) {
  const hasActivity = transactions.length > 0;
  const existingIds = (existingReport?.transactionIds || []).join(",");
  const currentIds = summary.transactionIds.join(",");
  const hasReportChanges = existingIds !== currentIds;
  const canSubmit = hasActivity && (!existingReport || hasReportChanges);
  const buttonLabel = existingReport ? (hasReportChanges ? "Update report" : "Report submitted") : "Submit report";

  return `
    <section class="panel rep-report-panel">
      ${panelHeader("Day report", existingReport ? (hasReportChanges ? "New activity added" : "Submitted") : "Ready when your sales are saved")}
      <div class="rep-report-grid">
        <div>
          <span class="eyebrow">Sales</span>
          <strong>${formatCurrency(summary.salesAmount)}</strong>
        </div>
        <div>
          <span class="eyebrow">Cash</span>
          <strong>${formatCurrency(summary.cashAmount)}</strong>
        </div>
        <div>
          <span class="eyebrow">Credit</span>
          <strong>${formatCurrency(summary.creditAmount)}</strong>
        </div>
        <div>
          <span class="eyebrow">Returns</span>
          <strong>${formatCurrency(summary.returnAmount)}</strong>
        </div>
      </div>
      ${renderRepReportLines(transactions, state)}
      <button
        class="button primary js-submit-rep-report"
        type="button"
        ${canSubmit ? "" : "disabled"}
        data-rep-name="${escapeHtml(repName)}"
        data-report-date="${escapeHtml(todayISO())}"
        data-sales-amount="${escapeHtml(summary.salesAmount)}"
        data-cash-amount="${escapeHtml(summary.cashAmount)}"
        data-credit-amount="${escapeHtml(summary.creditAmount)}"
        data-return-amount="${escapeHtml(summary.returnAmount)}"
        data-units-sold="${escapeHtml(summary.unitsSold)}"
        data-units-returned="${escapeHtml(summary.unitsReturned)}"
        data-transaction-ids="${escapeHtml(summary.transactionIds.join(","))}"
      >
        <span>${escapeHtml(buttonLabel)}</span>
      </button>
    </section>
  `;
}

function renderRepCreditPanel(creditLimit, creditUsage) {
  return `
    <section class="panel rep-credit-panel">
      ${panelHeader("Credit", creditLimit ? `${formatCurrency(creditLimit.balance)} of ${formatCurrency(creditLimit.limit)}` : "No limit set")}
      <div class="stock-line rep-credit-line">
        <div class="stock-meta">
          <span>${formatPercent(creditUsage)} used</span>
          <span>${formatCurrency(Math.max(0, Number(creditLimit?.limit || 0) - Number(creditLimit?.balance || 0)))} left</span>
        </div>
        ${progressBar(creditUsage, creditUsage >= 100 ? "danger" : creditUsage >= 85 ? "warning" : "good")}
      </div>
    </section>
  `;
}

function renderSalesRepDashboard(state) {
  const repName = currentRepName(state);
  const assignments = buildRepAssignments(state);
  const transactions = todaysRepTransactions(state, repName);
  const summary = repDaySummary(transactions);
  const creditLimit = getCreditLimitForParty(state.creditLimits || [], repName);
  const creditUsage = creditLimit?.limit ? (Number(creditLimit.balance || 0) / Number(creditLimit.limit || 0)) * 100 : 0;
  const stockInHand = assignments.reduce((total, assignment) => total + assignment.outstanding, 0);
  const existingReport = (state.salesReports || []).find((report) => (
    normalized(report.repName) === normalized(repName) &&
    report.reportDate === todayISO()
  ));

  return `
    <section class="view dashboard-view sales-rep-portal">
      <section class="rep-hero">
        <div>
          <span class="eyebrow">Today</span>
          <h2>${escapeHtml(repName)}</h2>
        </div>
        <div class="rep-hero-stats">
          <div>
            <span>Stock</span>
            <strong>${formatNumber(stockInHand)}</strong>
          </div>
          <div>
            <span>Sales</span>
            <strong>${formatCurrency(summary.salesAmount)}</strong>
          </div>
          <div class="${creditUsage >= 85 ? "is-warning" : ""}">
            <span>Credit</span>
            <strong>${formatPercent(creditUsage)}</strong>
          </div>
        </div>
      </section>

      <div class="rep-main-grid">
        <div class="rep-side-stack">
          ${renderRepQuickLog(state, assignments)}
          ${renderRepCreditPanel(creditLimit, creditUsage)}
        </div>
        ${renderRepReportPanel(repName, transactions, summary, existingReport, state)}
      </div>

      <section class="panel">
          ${panelHeader("Assigned stock", "Stock currently loaded to you")}
          ${renderRepStockCards(assignments)}
        </section>

      <section class="panel">
        ${panelHeader("Saved today", `${formatNumber(summary.unitsSold)} sold - ${formatNumber(summary.unitsReturned)} returned`)}
        ${renderRepActivity(transactions, state)}
      </section>
    </section>
  `;
}

function buildAccountantRouteMap(routes = []) {
  const routeMap = new Map();

  routes.forEach((route) => {
    (route.orderIds || []).forEach((orderId) => {
      routeMap.set(orderId, route);
    });
  });

  return routeMap;
}

function getAccountantFinancialLines(state) {
  const productMap = getProductMap(state.products || []);
  const retailerMap = getRetailerMap(state.retailers || []);
  const routeMap = buildAccountantRouteMap(state.routes || []);

  return (state.orders || []).flatMap((order) => {
    const route = routeMap.get(order.id);
    const retailer = retailerMap.get(order.retailerId);

    return (order.items || []).map((item) => {
      const product = productMap.get(item.productId);
      const quantity = Number(item.quantity || 0);
      const revenue = quantity * Number(product?.unitPrice || 0);
      const cost = quantity * Number(product?.unitCost || 0);

      return {
        productId: item.productId,
        productName: product?.name || "Unknown product",
        repName: route?.driver || "Unassigned",
        customerName: retailer?.name || "Unknown customer",
        date: order.createdAt,
        quantity,
        revenue,
        cost,
        profit: revenue - cost
      };
    });
  });
}

function buildAccountantSnapshot(state) {
  const lines = getAccountantFinancialLines(state);
  const reportedSales = (state.salesReports || []).reduce((total, report) => total + Number(report.salesAmount || 0), 0);
  const cost = lines.reduce((total, line) => total + line.cost, 0);
  const profit = lines.reduce((total, line) => total + line.profit, 0);
  const receivables = (state.invoices || [])
    .filter((invoice) => invoice.status !== "paid")
    .reduce((total, invoice) => total + Number(invoice.amount || 0), 0);
  const overdue = (state.invoices || [])
    .filter((invoice) => invoice.status === "overdue")
    .reduce((total, invoice) => total + Number(invoice.amount || 0), 0);

  return {
    lines,
    reportedSales,
    cost,
    profit,
    receivables,
    overdue
  };
}

function renderAccountantProductFocus(lines) {
  const productRows = new Map();

  lines.forEach((line) => {
    const row = productRows.get(line.productId) || {
      productName: line.productName,
      revenue: 0,
      profit: 0
    };

    row.revenue += line.revenue;
    row.profit += line.profit;
    productRows.set(line.productId, row);
  });

  const rows = [...productRows.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 4);
  const highestRevenue = Math.max(...rows.map((row) => row.revenue), 1);

  if (!rows.length) {
    return `<div class="empty-state">No product revenue available</div>`;
  }

  return rows.map((row) => {
    const percent = (row.revenue / highestRevenue) * 100;

    return `
      <div class="bar-row" data-search-index="${escapeHtml(row.productName.toLowerCase())}">
        <strong>${escapeHtml(row.productName)}</strong>
        ${progressBar(percent, row.profit < 0 ? "danger" : "good")}
        <span class="strong">${formatCurrency(row.revenue)}</span>
      </div>
    `;
  }).join("");
}

function renderAccountantCreditFocus(state) {
  const creditRows = [...(state.creditLimits || [])]
    .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0))
    .slice(0, 4);

  if (!creditRows.length) {
    return `<div class="empty-state">No credit balances available</div>`;
  }

  return creditRows.map((limit) => {
    const balance = Number(limit.balance || 0);
    const approvedLimit = Number(limit.limit || 0);
    const percent = approvedLimit ? (balance / approvedLimit) * 100 : 100;

    return `
      <div class="bar-row" data-search-index="${escapeHtml(`${limit.partyName} ${limit.partyType}`.toLowerCase())}">
        <strong>${escapeHtml(limit.partyName)}</strong>
        ${progressBar(percent, percent >= 100 ? "danger" : percent >= 85 ? "warning" : "good")}
        <span class="strong">${formatPercent(percent)}</span>
      </div>
    `;
  }).join("");
}

function renderAccountantReportRows(state) {
  return [...(state.salesReports || [])]
    .sort((a, b) => String(b.reportDate || "").localeCompare(String(a.reportDate || "")))
    .slice(0, 5)
    .map((report) => `
      <tr data-search-index="${escapeHtml(`${report.id} ${report.repName} ${report.tripLabel} ${report.status}`.toLowerCase())}">
        <td>
          <strong>${escapeHtml(report.id)}</strong>
          <div class="muted">${escapeHtml(report.tripLabel || "Sales report")}</div>
        </td>
        <td>${escapeHtml(report.repName || "Unassigned")}</td>
        <td>${formatDate(report.reportDate)}</td>
        <td>${formatCurrency(report.salesAmount)}</td>
        <td>${formatCurrency(report.creditAmount)}</td>
        <td>${statusPill(report.status)}</td>
      </tr>
    `);
}

function renderAccountantDashboard(state) {
  const snapshot = buildAccountantSnapshot(state);
  const submittedReports = (state.salesReports || []).filter((report) => report.status === "submitted").length;
  const riskyCredit = (state.creditLimits || []).filter((limit) => {
    const percent = limit.limit ? (Number(limit.balance || 0) / Number(limit.limit || 0)) * 100 : 100;
    return percent >= 85;
  }).length;
  const shortcuts = [
    {
      label: "Sales reports",
      value: formatNumber(state.salesReports?.length || 0),
      body: "Review submitted representative reports.",
      href: "#/finance"
    },
    {
      label: "Credit reports",
      value: formatNumber(state.creditLimits?.length || 0),
      body: "See balances, limits, and risk accounts.",
      href: "#/finance"
    },
    {
      label: "Profit summary",
      value: formatCurrency(snapshot.profit),
      body: "Compare revenue, cost, margin, and product performance.",
      href: "#/finance"
    },
    {
      label: "Exports",
      value: "CSV",
      body: "Download reports for reconciliation.",
      href: "#/finance"
    }
  ];

  return `
    <section class="view dashboard-view accountant-dashboard">
      <div class="metric-grid">
        ${metricCard({
          label: "Reported sales",
          value: formatCurrency(snapshot.reportedSales),
          meta: `${formatNumber(submittedReports)} submitted report${submittedReports === 1 ? "" : "s"}`,
          iconName: "finance"
        })}
        ${metricCard({
          label: "Gross profit",
          value: formatCurrency(snapshot.profit),
          meta: `${formatCurrency(snapshot.cost)} product cost`,
          iconName: "wallet"
        })}
        ${metricCard({
          label: "Receivables",
          value: formatCurrency(snapshot.receivables),
          meta: `${formatCurrency(snapshot.overdue)} overdue`,
          iconName: "alert"
        })}
        ${metricCard({
          label: "Credit risk",
          value: formatNumber(riskyCredit),
          meta: "Accounts at 85% usage or higher",
          iconName: "shield"
        })}
      </div>

      <section class="panel manager-command-panel">
        ${panelHeader("Accountant workspace", "Read-only reports and export-ready summaries")}
        <div class="manager-command-grid">
          ${shortcuts.map((card) => `
            <a class="manager-command-card" href="${escapeHtml(card.href)}" data-search-index="${escapeHtml(`${card.label} ${card.body}`.toLowerCase())}">
              <span class="eyebrow">${escapeHtml(card.label)}</span>
              <strong>${escapeHtml(card.value)}</strong>
              <p>${escapeHtml(card.body)}</p>
            </a>
          `).join("")}
        </div>
      </section>

      <div class="dashboard-layout">
        <section class="panel">
          ${panelHeader("Product revenue", "Top product lines by sales value")}
          <div class="bar-list">${renderAccountantProductFocus(snapshot.lines)}</div>
        </section>

        <section class="panel">
          ${panelHeader("Credit exposure", "Highest balances against approved limits")}
          <div class="bar-list">${renderAccountantCreditFocus(state)}</div>
        </section>
      </div>

      <section class="panel">
        ${panelHeader("Recent sales reports", "Submitted reports visible to finance")}
        ${table(
          ["Report", "Sales representative", "Date", "Sales", "Credit", "Status"],
          renderAccountantReportRows(state),
          "No submitted sales reports available"
        )}
      </section>
    </section>
  `;
}

export function renderDashboard({ state }) {
  if (state.session && state.client?.id && currentUserRole(state) === "sales_rep") {
    return renderSalesRepDashboard(state);
  }

  const metrics = calculateMetrics(state);
  const vision = calculateVisionMetrics(state);
  const permissions = currentUserPermissions(state);
  const role = currentUserRole(state);
  const isManagerPortal = role === "manager";

  if (state.session && state.client?.id && role === "ceo") {
    return renderCeoDashboard(state);
  }

  if (state.session && state.client?.id && role === "store_keeper") {
    return renderStoreKeeperDashboard(state, permissions);
  }

  if (state.session && state.client?.id && role === "accountant") {
    return renderAccountantDashboard(state);
  }

  return `
    <section class="view dashboard-view">
      <div class="metric-grid">
        ${metricCard({
          label: "Tracked flow",
          value: formatPercent(vision.traceabilityPercent),
          meta: `${formatNumber(vision.traceableRecords)} lifecycle records linked`,
          iconName: "orders"
        })}
        ${metricCard({
          label: "Representative stock owed",
          value: formatNumber(vision.repOutstandingUnits),
          meta: `${formatCurrency(vision.repOutstandingValue)} still with representatives`,
          iconName: "package"
        })}
        ${metricCard({
          label: "Credit exposure",
          value: formatCurrency(vision.creditBalanceTotal),
          meta: `${formatPercent(vision.creditExposurePercent)} of approved limits used`,
          iconName: "truck"
        })}
        ${metricCard({
          label: "Paid coverage",
          value: formatPercent(vision.paymentCoveragePercent),
          meta: `${formatCurrency(vision.receivables)} still outstanding`,
          iconName: "wallet"
        })}
      </div>
      ${isManagerPortal ? renderManagerControlPanel(state, vision) : ""}

      ${isManagerPortal
        ? renderManagerOperationsLayout(state, permissions, vision)
        : `
          <div class="dashboard-layout">
            <section class="panel">
              ${panelHeader("Territory sales", "Snack order value by sales territory")}
              <div class="bar-list">${renderRegionalSummary(state)}</div>
            </section>

            <section class="panel">
              ${panelHeader("Attention queue", "Items that need action today")}
              ${renderAlerts(state, permissions)}
            </section>
          </div>

          <section class="panel">
            ${panelHeader("Factory-to-cash controls", "Produced stock, representative custody, paper trails, signatures, and payment visibility")}
            <div class="bar-list">${renderFactoryCashControls(vision)}</div>
          </section>
        `}

      <section class="panel">
        ${panelHeader("Recent sales orders", `${formatCurrency(metrics.orderRevenue)} in cycle - ${formatNumber(metrics.openOrders)} still open - ${formatPercent(metrics.fillRate)} delivered`)}
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Sales order</th>
                <th>Region</th>
                <th>Status</th>
                <th>Value</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${renderRecentOrders(state, permissions)}</tbody>
          </table>
        </div>
      </section>
      ${isManagerPortal ? renderManagerSalesOperations(state) : ""}
      ${isManagerPortal ? renderManagerReportReview(state) : ""}
    </section>
  `;
}

export function bindDashboard({ root, store }) {
  if (root.querySelector(".sales-rep-portal")) {
    bindSalesRepDashboard({ root, store });
    return;
  }

  if (root.querySelector(".ceo-dashboard")) {
    bindCeoDashboard({ root });
    return;
  }

  qsa(".js-restock-product", root).forEach((button) => {
    button.addEventListener("click", () => {
      store.dispatch({
        type: "RESTOCK_PRODUCT",
        productId: button.dataset.productId,
        message: "Snack stock replenished"
      });
    });
  });

  qsa(".js-advance-order", root).forEach((button) => {
    button.addEventListener("click", () => {
      store.dispatch({
        type: "ADVANCE_ORDER",
        orderId: button.dataset.orderId,
        message: "Sales order status updated"
      });
    });
  });

  qsa(".js-review-report", root).forEach((button) => {
    button.addEventListener("click", () => {
      store.dispatch({
        type: "REVIEW_SALES_REPORT",
        reportId: button.dataset.reportId,
        message: "Report reviewed"
      });
    });
  });

  qsa(".js-flag-report", root).forEach((button) => {
    button.addEventListener("click", () => {
      store.dispatch({
        type: "FLAG_SALES_REPORT",
        reportId: button.dataset.reportId,
        note: "Manager query raised",
        message: "Report flagged"
      });
    });
  });
}

function bindCeoDashboard({ root }) {
  const filterControls = qsa("[data-ceo-filter]", root);
  const resetButton = qs("[data-ceo-filter-reset]", root);

  function selectedFilter(name) {
    return qs(`[data-ceo-filter="${name}"]`, root)?.value || "";
  }

  function applyCeoFilters() {
    const period = selectedFilter("period") || "all";
    const rep = selectedFilter("rep");
    const product = selectedFilter("product");
    const supermarket = selectedFilter("supermarket");

    qsa("[data-ceo-row]", root).forEach((row) => {
      const kind = row.dataset.ceoKind || "";
      const productSet = row.dataset.ceoProducts || "";
      const hasProductDimension = productSet.length > 2;
      const matchesPeriod = rowPeriodMatches(row.dataset.ceoDate, period);
      const matchesRep = !rep || kind !== "rep" || row.dataset.ceoRep === rep;
      const matchesProduct = !product || !hasProductDimension || productSet.includes(`|${product}|`);
      const matchesSupermarket = !supermarket || kind !== "supermarket" || row.dataset.ceoSupermarket === supermarket;

      row.hidden = !(matchesPeriod && matchesRep && matchesProduct && matchesSupermarket);
    });
  }

  filterControls.forEach((control) => {
    control.addEventListener("change", applyCeoFilters);
  });

  resetButton?.addEventListener("click", () => {
    filterControls.forEach((control) => {
      control.value = "";
    });
    const periodControl = qs('[data-ceo-filter="period"]', root);
    if (periodControl) periodControl.value = "all";
    applyCeoFilters();
  });

  applyCeoFilters();
}

function setRepMessage(messageEl, text, type = "") {
  if (!messageEl) return;

  messageEl.textContent = text;
  messageEl.className = `rep-form-message${type ? ` is-${type}` : ""}`;
}

function bindSalesRepDashboard({ root, store }) {
  const form = qs("#rep-log-form", root);
  const message = qs("#rep-log-message", root);
  const assignmentSelect = qs('select[name="assignmentId"]', root);

  qsa(".js-fill-rep-product", root).forEach((button) => {
    button.addEventListener("click", () => {
      if (assignmentSelect) {
        assignmentSelect.value = button.dataset.assignmentId;
        assignmentSelect.focus();
      }
    });
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();

    const state = store.getState();
    const formData = new FormData(form);
    const assignmentId = String(formData.get("assignmentId") || "");
    const customerId = String(formData.get("customerId") || "");
    const typedCustomerName = String(formData.get("customerName") || "").trim();
    const quantity = Number(formData.get("quantity") || 0);
    const transactionType = String(formData.get("transactionType") || "sale");
    const paymentType = String(formData.get("paymentType") || "cash");
    const assignment = (state.stockAssignments || []).find((item) => item.id === assignmentId);
    const product = (state.products || []).find((item) => item.id === assignment?.productId);
    const customer = (state.retailers || []).find((item) => item.id === customerId);
    const customerName = customer?.name || typedCustomerName;
    const isCreditSale = transactionType === "sale" && normalized(paymentType).includes("credit");
    const repName = assignment?.repName || currentRepName(state);
    const outstanding = assignment ? assignmentOutstanding(assignment) : 0;
    const amount = quantity * Number(product?.unitPrice || 0);

    setRepMessage(message, "");

    if (!assignment) {
      setRepMessage(message, "Pick a snack first.", "error");
      return;
    }

    if (customerId && !customer) {
      setRepMessage(message, "Pick a valid customer.", "error");
      return;
    }

    if (!customerName) {
      setRepMessage(message, "Enter the customer name.", "error");
      return;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setRepMessage(message, "Enter how many.", "error");
      return;
    }

    if (quantity > outstanding) {
      setRepMessage(message, `Only ${formatNumber(outstanding)} left for this snack.`, "error");
      return;
    }

    if (isCreditSale && !customer) {
      setRepMessage(message, "Credit sales need a saved customer.", "error");
      return;
    }

    if (isCreditSale) {
      const repLimit = getCreditLimitForParty(state.creditLimits || [], repName);
      const customerLimit = getCreditLimitForParty(state.creditLimits || [], customer.name);
      const repProjected = Number(repLimit?.balance || 0) + amount;
      const customerProjected = Number(customerLimit?.balance || 0) + amount;

      if (!repLimit?.limit || repProjected > Number(repLimit.limit || 0)) {
        setRepMessage(message, "Credit limit reached for this trip.", "error");
        return;
      }

      if (!customerLimit?.limit || customerProjected > Number(customerLimit.limit || 0)) {
        setRepMessage(message, "Customer credit limit reached.", "error");
        return;
      }
    }

    store.dispatch({
      type: "LOG_REP_TRANSACTION",
      assignmentId,
      customerId,
      customerName,
      customerType: customer?.channel || customer?.type || "Customer",
      quantity,
      transactionType,
      paymentType,
      repName,
      message: transactionType === "return" ? "Customer return saved" : "Sale saved"
    });
  });

  qsa(".js-submit-rep-report", root).forEach((button) => {
    button.addEventListener("click", () => {
      const state = store.getState();
      const transactionIds = String(button.dataset.transactionIds || "").split(",").filter(Boolean);
      const transactionMap = new Map((state.stockTransactions || []).map((transaction) => [transaction.id, transaction]));
      const reportLines = transactionIds
        .map((transactionId) => transactionMap.get(transactionId))
        .filter(Boolean)
        .map((transaction) => repTransactionLine(transaction, state));

      store.dispatch({
        type: "SUBMIT_REP_REPORT",
        repName: button.dataset.repName,
        reportDate: button.dataset.reportDate,
        salesAmount: Number(button.dataset.salesAmount || 0),
        cashAmount: Number(button.dataset.cashAmount || 0),
        creditAmount: Number(button.dataset.creditAmount || 0),
        returnAmount: Number(button.dataset.returnAmount || 0),
        unitsSold: Number(button.dataset.unitsSold || 0),
        unitsReturned: Number(button.dataset.unitsReturned || 0),
        transactionIds,
        reportLines,
        message: "Sales report submitted"
      });
    });
  });
}
