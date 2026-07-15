import {
  assignmentOutstanding,
  buildRepLedger,
  buildRegionalSummary,
  calculateMetrics,
  calculateVisionMetrics,
  effectiveOrderStatus,
  getFinancialSalesLines,
  getReturnableCustomerChoices,
  getCreditLimitForParty,
  getCustomerRating,
  getRepresentativeDailyCreditUsed,
  getLowStockProducts,
  getOrdersWithTotals,
  getProductMap,
  getRetailerMap,
  isRepresentativeReturnEligible,
  getStockHealth,
  stockCategoryIdForProduct
} from "../services/calculations.js";
import { formatCompact, formatCurrency, formatDate, formatDateTime, formatNumber, formatPercent, statusText } from "../services/formatters.js";
import { accountForUser, currentUserPermissions, currentUserRole } from "../services/rbac.js";
import { isModuleEnabled } from "../services/features.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { iconButton, metricCard, panelHeader, progressBar, statusPill, table, textButton } from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { bindInventory, renderCeoQuickStockActions, renderRecordCorrectionModal, renderStoreKeeperDispatchAction } from "./inventory.js";

const WALK_IN_CUSTOMER_ID = "__walk_in__";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function dashboardRouteParams() {
  if (typeof window === "undefined") return new URLSearchParams();

  const query = window.location.hash.split("?")[1] || "";
  return new URLSearchParams(query);
}

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function dateOnly(value) {
  return String(value || "").slice(0, 10);
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

function dashboardIdentity(state, role = currentUserRole(state)) {
  const account = accountForUser(state);
  const name = account?.name || state.user?.user_metadata?.full_name || state.user?.email || "Team member";
  const companyName = state.client?.companyName || "DistroIQ workspace";
  const roleLabels = {
    ceo: "CEO",
    store_keeper: "Store Keeper",
    accountant: "Accountant",
    sales_rep: "Sales Representative"
  };

  return `
    <header class="dashboard-identity">
      <div>
        <strong>${escapeHtml(name)}</strong>
        <span>${escapeHtml(roleLabels[role] || statusText(role))}</span>
      </div>
      <small>${escapeHtml(companyName)}</small>
    </header>
  `;
}

function buildRepAssignments(state, repName = "") {
  const productMap = getProductMap(state.products || []);
  const repKey = normalized(repName);

  return (state.stockAssignments || [])
    .filter((assignment) => !repKey || normalized(assignment.repName) === repKey)
    .map((assignment) => {
      const product = productMap.get(assignment.productId);
      const outstanding = assignmentOutstanding(assignment);
      const soldPercent = assignment.assigned ? (Number(assignment.sold || 0) / Number(assignment.assigned || 0)) * 100 : 0;
      const assignedDate = dateOnly(assignment.assignedAt || assignment.updatedAt || todayISO());

      return {
        ...assignment,
        product,
        outstanding,
        soldPercent,
        assignedDate
      };
    })
    .filter((assignment) => assignment.product)
    .sort((a, b) => (
      String(b.assignedDate || "").localeCompare(String(a.assignedDate || "")) ||
      String(b.updatedAt || b.assignedAt || "").localeCompare(String(a.updatedAt || a.assignedAt || ""))
    ));
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
        (type === "sale" || type === "return" || type === "return to factory")
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

    if (type === "return to factory") {
      summary.unitsReturnedToFactory += quantity;
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
    unitsReturnedToFactory: 0,
    transactionIds: []
  });
}

function returnDispositionLabel(value) {
  if (value === "to_store") return "Returned to store stock";
  if (value === "held_by_rep") return "Held by representative";
  return "";
}

function repTransactionLine(transaction, state) {
  const product = (state.products || []).find((item) => item.id === transaction.productId);
  const transactionType = normalized(transaction.type);
  const type = transactionType === "return to factory"
    ? "Returned to factory"
    : transactionType === "return" ? "Customer return" : "Sale";
  const returnDisposition = type === "Customer return" ? returnDispositionLabel(transaction.returnDisposition) : "";

  return {
    transactionId: transaction.id,
    type,
    productId: transaction.productId,
    productName: product?.name || "Unknown snack",
    customerName: type === "Returned to factory" ? (transaction.returnDestination || "Factory") : transaction.partyName || "Customer",
    quantity: Number(transaction.quantity || 0),
    amount: Number(transaction.amount || 0),
    paymentType: transaction.paymentType || "cash",
    returnDisposition: type === "Returned to factory" ? (transaction.reason || "Unsold stock") : returnDisposition,
    createdAt: transaction.createdAt || transaction.date
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
    const unitPrice = Number(item.unitPrice ?? item.unitPriceAtSale ?? product?.unitPrice ?? 0);
    return total + unitPrice * Number(item.quantity || 0);
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

function renderCeoMetricCard({ label, value, meta, iconName }) {
  return `
    <article class="metric-card ceo-metric-card">
      <header>
        <span class="eyebrow">${escapeHtml(label)}</span>
        <span class="metric-icon">${icon(iconName)}</span>
      </header>
      <div>
        <div class="metric-value">${escapeHtml(value)}</div>
        <div class="metric-meta">${escapeHtml(meta)}</div>
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
      const unitPrice = Number(item.unitPrice ?? item.unitPriceAtSale ?? product.unitPrice ?? 0);
      row.orderedUnits += quantity;
      row.supermarketUnits += quantity;
      row.salesValue += quantity * unitPrice;
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
    const rating = getCustomerRating(retailer, state);

    return {
      retailer,
      productIds: [...productIds],
      orderCount: orders.length,
      orderValue,
      balance,
      limit,
      usagePercent,
      latestActivity,
      rating,
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
        class="ceo-drilldown-row"
        tabindex="0"
        role="button"
        data-ceo-drilldown="product"
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
          class="ceo-drilldown-row"
          tabindex="0"
          role="button"
          data-ceo-drilldown="product"
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
          <td>${health.status === "ready" ? "" : statusPill(health.status)}</td>
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
          class="ceo-drilldown-row"
          tabindex="0"
          role="button"
          data-ceo-drilldown="rep"
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
        row.rating?.label,
        row.status,
        row.productIds.join(" ")
      ].join(" ").toLowerCase();

      return `
        <tr
          class="ceo-drilldown-row"
          tabindex="0"
          role="button"
          data-ceo-drilldown="supermarket"
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
            <div class="muted">${escapeHtml(row.rating?.label || "New customer")}</div>
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

function renderCeoCustomerRatings(supermarketRows) {
  const rows = [...supermarketRows]
    .sort((a, b) => (a.rating?.score ?? 0) - (b.rating?.score ?? 0))
    .slice(0, 4);

  if (!rows.length) {
    return '<div class="empty-state">No customers added yet</div>';
  }

  return `
    <div class="bar-list">
      ${rows.map((row) => `
        <div class="bar-row" data-search-index="${escapeHtml(`${row.retailer.name} ${row.rating?.label}`.toLowerCase())}">
          <strong>${escapeHtml(row.retailer.name)}</strong>
          <span class="muted">${formatNumber(row.rating?.score || 0)} / 100 - ${formatNumber(row.rating?.orderCount || 0)} orders</span>
          ${statusPill(row.rating?.status || "new_customer")}
        </div>
      `).join("")}
    </div>
  `;
}

function renderLeadershipDetailModal() {
  return `
    <div id="leadership-detail-modal" class="stock-modal-backdrop" tabindex="-1" hidden>
      <section class="stock-modal leadership-detail-modal" role="dialog" aria-modal="true" aria-labelledby="leadership-detail-title">
        <header class="stock-modal-header">
          <div><span class="eyebrow">Leadership history</span><h2 id="leadership-detail-title">Details</h2></div>
          ${iconButton({ iconName: "x", label: "Close history", className: "js-close-leadership-detail" })}
        </header>
        <div id="leadership-detail-content" class="leadership-detail-content"></div>
      </section>
    </div>
  `;
}

function matchingRepTransactions(state, repName) {
  return (state.stockTransactions || []).filter((transaction) => (
    normalized(transaction.repName || transaction.recordedBy) === normalized(repName)
  ));
}

function renderRepresentativeHistory(state, repName) {
  const assignments = (state.stockAssignments || [])
    .filter((assignment) => normalized(assignment.repName) === normalized(repName))
    .sort((a, b) => String(b.assignedAt || b.assignedDate || "").localeCompare(String(a.assignedAt || a.assignedDate || "")));
  const sales = matchingRepTransactions(state, repName)
    .filter((transaction) => normalized(transaction.type) === "sale")
    .sort((a, b) => String(b.createdAt || b.date || "").localeCompare(String(a.createdAt || a.date || "")));
  const creditLimit = getCreditLimitForParty(state.creditLimits || [], repName);
  const creditHistory = (state.creditLimitHistory || [])
    .filter((entry) => normalized(entry.partyName) === normalized(repName))
    .sort((a, b) => String(b.changedAt || "").localeCompare(String(a.changedAt || "")));

  return `
    <div class="leadership-detail-heading"><div><span class="eyebrow">Sales representative</span><h3>${escapeHtml(repName)}</h3></div>${statusPill(creditLimit?.balance >= creditLimit?.limit && creditLimit?.limit ? "credit_hold" : "active")}</div>
    <div class="leadership-summary-grid">
      <div><span>Total sales</span><strong>${formatCurrency(sales.reduce((total, sale) => total + Number(sale.amount || 0), 0))}</strong></div>
      <div><span>Units sold</span><strong>${formatNumber(sales.reduce((total, sale) => total + Number(sale.quantity || 0), 0))}</strong></div>
      <div><span>Stock in hand</span><strong>${formatNumber(assignments.reduce((total, assignment) => total + assignmentOutstanding(assignment), 0))}</strong></div>
      <div><span>Credit balance</span><strong>${formatCurrency(creditLimit?.balance || 0)} / ${formatCurrency(creditLimit?.limit || 0)}</strong></div>
    </div>
    <section class="leadership-history-section"><h4>Sales history</h4>${table(
      ["Date", "Customer", "Product", "Quantity", "Payment", "Amount"],
      sales.map((sale) => `<tr><td>${formatDate(sale.date)}</td><td>${escapeHtml(sale.partyName || sale.customerName || "Customer")}</td><td>${escapeHtml(sale.productName || sale.productId)}</td><td>${formatNumber(sale.quantity)}</td><td>${escapeHtml(statusText(sale.paymentType || "cash"))}</td><td>${formatCurrency(sale.amount)}</td></tr>`),
      "No sales recorded for this representative"
    )}</section>
    <section class="leadership-history-section"><h4>Stock history</h4>${table(
      ["Assigned", "Product", "Quantity", "Sold", "Returned", "In hand"],
      assignments.map((assignment) => `<tr><td>${formatDate(assignment.assignedDate || assignment.assignedAt)}</td><td>${escapeHtml(assignment.productName || state.products.find((product) => product.id === assignment.productId)?.name || assignment.productId)}</td><td>${formatNumber(assignment.assigned)}</td><td>${formatNumber(assignment.sold)}</td><td>${formatNumber(assignment.returned)}</td><td>${formatNumber(assignmentOutstanding(assignment))}</td></tr>`),
      "No stock assignments recorded"
    )}</section>
    <section class="leadership-history-section"><h4>Credit history</h4>${table(
      ["Changed", "Previous", "New limit", "Changed by", "Reason"],
      creditHistory.map((entry) => `<tr><td>${formatDateTime(entry.changedAt)}</td><td>${formatCurrency(entry.previousLimit)}</td><td>${formatCurrency(entry.nextLimit)}</td><td>${escapeHtml(entry.changedBy || "CEO")}</td><td>${escapeHtml(entry.reason || "Credit terms updated")}</td></tr>`),
      "No credit-limit history recorded"
    )}</section>
  `;
}

function productSalesTimeline(state, productId) {
  const totals = new Map();
  const add = (date, quantity, amount) => {
    const key = dateKey(date);
    if (!key) return;
    const row = totals.get(key) || { date: key, quantity: 0, amount: 0, orders: 0 };
    row.quantity += Number(quantity || 0);
    row.amount += Number(amount || 0);
    row.orders += 1;
    totals.set(key, row);
  };
  const linkedTransactionIds = new Set();
  (state.orders || []).forEach((order) => {
    if (order.transactionId) linkedTransactionIds.add(order.transactionId);
    (order.items || []).filter((item) => item.productId === productId).forEach((item) => {
      add(order.createdAt || order.orderDate || order.dueAt, item.quantity, Number(item.quantity || 0) * Number(item.unitPrice ?? item.unitPriceAtSale ?? 0));
    });
  });
  (state.stockTransactions || [])
    .filter((transaction) => transaction.productId === productId && normalized(transaction.type) === "sale" && !linkedTransactionIds.has(transaction.id))
    .forEach((transaction) => add(transaction.createdAt || transaction.date, transaction.quantity, transaction.amount));
  return [...totals.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function renderProductSalesHistory(state, productId) {
  const product = (state.products || []).find((item) => item.id === productId);
  const timeline = productSalesTimeline(state, productId);
  const maxQuantity = Math.max(...timeline.map((row) => row.quantity), 1);
  return `
    <div class="leadership-detail-heading"><div><span class="eyebrow">Product sales volume</span><h3>${escapeHtml(product?.name || productId)}</h3><p>${escapeHtml(productId)}</p></div></div>
    <div class="leadership-summary-grid">
      <div><span>Total volume</span><strong>${formatNumber(timeline.reduce((total, row) => total + row.quantity, 0))} ${escapeHtml(product?.unit || "units")}</strong></div>
      <div><span>Sales value</span><strong>${formatCurrency(timeline.reduce((total, row) => total + row.amount, 0))}</strong></div>
      <div><span>Sales days</span><strong>${formatNumber(timeline.length)}</strong></div>
      <div><span>Current stock</span><strong>${formatNumber(product?.stock || 0)} ${escapeHtml(product?.unit || "units")}</strong></div>
    </div>
    <div class="product-volume-chart">
      ${timeline.length ? timeline.slice(0, 14).reverse().map((row) => `<div><span>${escapeHtml(formatDate(row.date))}</span><div class="progress-track"><div class="progress-fill" style="width:${(row.quantity / maxQuantity) * 100}%"></div></div><strong>${formatNumber(row.quantity)}</strong></div>`).join("") : '<div class="empty-state">No sales volume recorded yet</div>'}
    </div>
    <section class="leadership-history-section"><h4>Sales volume over time</h4>${table(
      ["Date", "Volume", "Sales value", "Records"],
      timeline.map((row) => `<tr><td>${formatDate(row.date)}</td><td>${formatNumber(row.quantity)} ${escapeHtml(product?.unit || "units")}</td><td>${formatCurrency(row.amount)}</td><td>${formatNumber(row.orders)}</td></tr>`),
      "No product sales recorded"
    )}</section>
  `;
}

function supermarketSupplyRows(state, retailer) {
  const productMap = getProductMap(state.products || []);
  return (state.orders || [])
    .filter((order) => order.retailerId === retailer.id || order.customerId === retailer.id || normalized(order.customerName) === normalized(retailer.name))
    .sort((a, b) => String(b.createdAt || b.dueAt || "").localeCompare(String(a.createdAt || a.dueAt || "")))
    .map((order) => ({
      order,
      products: (order.items || []).map((item) => `${formatNumber(item.quantity)} ${productMap.get(item.productId)?.name || item.productName || "item"}`).join(", "),
      value: salesValueFromOrder(order, productMap)
    }));
}

function renderSupermarketHistory(state, retailerId) {
  const retailer = (state.retailers || []).find((item) => item.id === retailerId);
  if (!retailer) return '<div class="empty-state">Supermarket not found</div>';
  const supplies = supermarketSupplyRows(state, retailer);
  const credit = getCreditLimitForParty(state.creditLimits || [], retailer.name);
  const balance = Number(credit?.balance ?? retailer.outstanding ?? 0);
  return `
    <div class="leadership-detail-heading"><div><span class="eyebrow">Supermarket supply</span><h3>${escapeHtml(retailer.name)}</h3><p>${escapeHtml([retailer.city, retailer.stateName || retailer.region].filter(Boolean).join(", ") || "Location not set")}</p></div>${statusPill(retailer.status === "inactive" ? "inactive" : "active")}</div>
    <div class="leadership-summary-grid">
      <div><span>Balance owed</span><strong>${formatCurrency(balance)}</strong></div>
      <div><span>Credit limit</span><strong>${credit?.limit ? formatCurrency(credit.limit) : "Not set"}</strong></div>
      <div><span>Supplies</span><strong>${formatNumber(supplies.length)}</strong></div>
      <div><span>Supply value</span><strong>${formatCurrency(supplies.reduce((total, row) => total + row.value, 0))}</strong></div>
    </div>
    <section class="leadership-history-section"><h4>Supply history</h4>${table(
      ["Date", "Reference", "Products supplied", "Value", "Status"],
      supplies.map(({ order, products, value }) => `<tr><td>${formatDate(order.createdAt || order.dueAt)}</td><td><strong>${escapeHtml(order.id)}</strong></td><td>${escapeHtml(products || "No product details")}</td><td>${formatCurrency(value)}</td><td>${statusPill(order.status || "recorded")}</td></tr>`),
      "No supplies recorded for this supermarket"
    )}</section>
  `;
}

function renderCeoDrilldownTables(productRows, repRows, supermarketRows) {
  return `
    <div class="ceo-history-grid">
      <section class="panel">${panelHeader("Representatives", "Select a representative for sales, stock, and credit history")}${table(["Representative", "Stock", "Sell-through", "Credit"], [renderCeoRepRows(repRows)], "No representatives available")}</section>
      <section class="panel">${panelHeader("Products", "Select a product to view sales volume over time")}${table(["Product", "Sales", "Returns", "Performance"], [renderCeoProductRows(productRows)], "No products available")}</section>
      <section class="panel">${panelHeader("Supermarkets", "Select a supermarket for supply history and balance")}${table(["Supermarket", "Orders", "Balance", "Status"], [renderCeoSupermarketRows(supermarketRows)], "No supermarkets available")}</section>
    </div>
  `;
}

function productSizeLabel(product) {
  if (String(product?.size || "").trim()) return String(product.size).trim();
  const match = String(product?.name || "").match(/\b\d+(?:\.\d+)?\s*(?:kg|g|ml|cl|l|pack|packs|pcs|pieces?)\b/i);
  return match?.[0] || product?.unit || "Standard";
}

function productFamilyLabel(product) {
  if (String(product?.productFamily || "").trim()) return String(product.productFamily).trim();
  const size = productSizeLabel(product);
  const withoutSize = String(product?.name || "Product").replace(size, "").replace(/[-–—|]+/g, " ").replace(/\s+/g, " ").trim();
  return withoutSize || product?.name || "Product";
}

function productTypeLabel(product) {
  return String(product?.productType || "Standard").trim() || "Standard";
}

function dailyProductMovementRows(state) {
  const date = todayISO();
  const movementsByProduct = new Map();

  (state.stockTransactions || []).filter((transaction) => transaction.date === date).forEach((transaction) => {
    const row = movementsByProduct.get(transaction.productId) || { added: 0, dispatched: 0 };
    const type = normalized(transaction.type);
    if (transaction.movementDirection === "in") row.added += Number(transaction.quantity || 0);
    if (transaction.movementDirection === "out" && ["supply", "internal movement"].includes(type)) {
      row.dispatched += Number(transaction.quantity || 0);
    }
    movementsByProduct.set(transaction.productId, row);
  });

  return activeStockProducts(state.products)
    .map((product) => ({
      product,
      ...(movementsByProduct.get(product.id) || { added: 0, dispatched: 0 })
    }))
    .sort((a, b) => productFamilyLabel(a.product).localeCompare(productFamilyLabel(b.product)) || productTypeLabel(a.product).localeCompare(productTypeLabel(b.product)) || productSizeLabel(a.product).localeCompare(productSizeLabel(b.product)));
}

function renderDailyStockMovementTable(state) {
  return table(
    ["Product", "Added stock", "Dispatched product", "Available", "Status"],
    dailyProductMovementRows(state).map(({ product, added, dispatched }) => `
      <tr data-search-index="${escapeHtml(`${product.name} ${productFamilyLabel(product)} ${productTypeLabel(product)} ${productSizeLabel(product)}`.toLowerCase())}">
        <td><strong>${escapeHtml(product.name)}</strong><div class="muted">${escapeHtml(productSizeLabel(product))}</div></td>
        <td>${formatNumber(added)}</td>
        <td>${formatNumber(dispatched)}</td>
        <td>${formatNumber(product.stock || 0)} ${escapeHtml(product.unit || "units")}</td>
        <td>
          ${statusPill(Number(product.stock || 0) <= 0 ? "sold_out" : "in_stock")}
          ${product.soldOutAt ? `<div class="muted">Saved ${formatDate(product.soldOutAt)}</div>` : ""}
        </td>
      </tr>
    `),
    "No products have been added yet"
  );
}

function productDispatchPeriods(state, productId) {
  const today = todayISO();
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const dispatches = (state.stockTransactions || []).filter((transaction) => (
    transaction.productId === productId &&
    transaction.movementDirection === "out" &&
    ["supply", "internal movement"].includes(normalized(transaction.type))
  ));
  const totalFor = (prefix) => dispatches
    .filter((transaction) => String(transaction.date || "").startsWith(prefix))
    .reduce((total, transaction) => total + Number(transaction.quantity || 0), 0);

  return {
    today: totalFor(today),
    month: totalFor(month),
    year: totalFor(year)
  };
}

function renderCeoSizePicture(product) {
  if (product.imageUrl) return `<img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}">`;
  return `<span>${escapeHtml(String(product.name || "PR").slice(0, 2).toUpperCase())}</span>`;
}

function renderCeoProductStock(state) {
  const rows = dailyProductMovementRows(state).filter(({ product }) => stockCategoryIdForProduct(product) === "finished_products");
  const families = new Map();
  rows.forEach((row) => {
    const family = productFamilyLabel(row.product);
    const current = families.get(family) || [];
    current.push(row);
    families.set(family, current);
  });

  return `
    <div class="ceo-product-family-grid">
      ${[...families.entries()].map(([family, familyRows]) => {
        const types = [...new Set(familyRows.map(({ product }) => productTypeLabel(product)))].sort();
        return `
          <article class="ceo-product-family-card">
            <button class="ceo-product-family-trigger js-toggle-product-types" type="button" data-product-family="${escapeHtml(family)}" aria-expanded="false">
              <span class="eyebrow">Product</span>
              <strong>${escapeHtml(family)}</strong>
              <span>${formatNumber(types.length)} type${types.length === 1 ? "" : "s"} · ${formatNumber(familyRows.length)} size${familyRows.length === 1 ? "" : "s"}</span>
              <b>${formatNumber(familyRows.reduce((total, row) => total + Number(row.product.stock || 0), 0))} available</b>
            </button>
            <div class="ceo-product-type-dropdown" data-product-type-dropdown="${escapeHtml(family)}" hidden>
              ${types.map((type) => `
                <button class="js-open-product-size-modal" type="button" data-product-family="${escapeHtml(family)}" data-product-type="${escapeHtml(type)}">
                  <span>${escapeHtml(type)}</span>${icon("arrowRight")}
                </button>
              `).join("")}
            </div>
          </article>
        `;
      }).join("")}
    </div>
    <div id="ceo-product-size-modal" class="stock-modal-backdrop" hidden>
      <section class="stock-modal ceo-product-size-modal" role="dialog" aria-modal="true" aria-labelledby="ceo-product-size-title">
        <header class="stock-modal-header">
          <div>
            <span class="eyebrow">Product stock</span>
            <h2 id="ceo-product-size-title">Product sizes</h2>
          </div>
          ${iconButton({ iconName: "x", label: "Close product sizes", className: "js-close-product-size-modal" })}
        </header>
        <div class="ceo-size-picture-grid">
          ${rows.map(({ product }) => {
            const periods = productDispatchPeriods(state, product.id);
            return `
              <button
                class="ceo-size-picture-card js-select-product-size"
                type="button"
                data-size-family="${escapeHtml(productFamilyLabel(product))}"
                data-size-type="${escapeHtml(productTypeLabel(product))}"
                data-size-name="${escapeHtml(product.name)}"
                data-size-label="${escapeHtml(productSizeLabel(product))}"
                data-size-sku="${escapeHtml(product.id)}"
                data-size-available="${escapeHtml(product.stock || 0)}"
                data-size-unit="${escapeHtml(product.unit || "units")}"
                data-size-dispatch-day="${escapeHtml(periods.today)}"
                data-size-dispatch-month="${escapeHtml(periods.month)}"
                data-size-dispatch-year="${escapeHtml(periods.year)}"
                hidden
              >
                <span class="ceo-size-picture">${renderCeoSizePicture(product)}</span>
                <span><strong>${escapeHtml(productSizeLabel(product))}</strong><small>${escapeHtml(product.id)}</small></span>
              </button>
            `;
          }).join("")}
        </div>
        <article class="selected-size-stock-card" data-selected-size-detail hidden aria-live="polite">
          <div>
            <span class="eyebrow" data-size-detail-type>Product type</span>
            <strong data-size-detail-name>Product size</strong>
            <small data-size-detail-sku>SKU</small>
          </div>
          <div class="selected-size-stock-metrics">
            <div><span>Available in factory</span><strong data-size-detail-available>0</strong><small data-size-detail-unit>units</small></div>
            <div><span>Dispatched today</span><strong data-size-detail-day>0</strong></div>
            <div><span>This month</span><strong data-size-detail-month>0</strong></div>
            <div><span>This year</span><strong data-size-detail-year>0</strong></div>
          </div>
        </article>
      </section>
    </div>
  `;
}

function renderCorrectionApprovals(state) {
  const pending = (state.correctionRequests || []).filter((request) => request.status === "pending");
  if (!pending.length) return "";

  return `
    <section class="panel correction-approval-panel">
      ${panelHeader("Correction approvals", `${formatNumber(pending.length)} saved record${pending.length === 1 ? "" : "s"} waiting for CEO review`)}
      <div class="correction-approval-list">
        ${pending.map((request) => `
          <article class="correction-approval-row">
            <div>
              <span class="eyebrow">${escapeHtml(request.recordType)} · ${escapeHtml(request.transactionId)}</span>
              <strong>${escapeHtml(request.productName)}</strong>
              <p>${formatNumber(request.originalQuantity)} → ${formatNumber(request.requestedQuantity)} · ${escapeHtml(request.reason)}</p>
              <small>Requested by ${escapeHtml(request.requestedBy)}</small>
            </div>
            <div class="correction-approval-actions">
              ${iconButton({ iconName: "check", label: "Approve correction", className: "js-approve-record-correction", data: { "request-id": request.id } })}
              ${iconButton({ iconName: "x", label: "Reject correction", className: "js-reject-record-correction", data: { "request-id": request.id } })}
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderCeoDashboard(state) {
  const metrics = calculateMetrics(state);
  const vision = calculateVisionMetrics(state);
  const productRows = buildCeoProductPerformance(state);
  const riskRows = buildCeoRiskRows(state);
  const trend = buildCeoSalesTrend(state);
  const riskyAccountCount = riskRows.filter((row) => row.status !== "credit_clear").length;
  const latestReport = [...(state.salesReports || [])]
    .sort((a, b) => toTimestamp(b.submittedAt || b.reportDate) - toTimestamp(a.submittedAt || a.reportDate))[0];

  return `
    <section class="view dashboard-view ceo-dashboard">
      ${dashboardIdentity(state, "ceo")}
      <section class="ceo-command-strip">
        <div>
          <span class="eyebrow">CEO portal</span>
          <h2>Overview</h2>
        </div>
        ${renderCeoQuickStockActions(state)}
      </section>

      <div class="metric-grid ceo-minimal-metrics">
        ${renderCeoMetricCard({
          label: "Sales",
          value: formatCurrency(metrics.orderRevenue),
          meta: "Total order value",
          iconName: "orders"
        })}
        ${renderCeoMetricCard({
          label: "Stock",
          value: formatNumber(vision.finishedStockUnits + vision.repOutstandingUnits),
          meta: "Factory plus representative custody",
          iconName: "package"
        })}
        ${renderCeoMetricCard({
          label: "Credit",
          value: formatCurrency(vision.creditBalanceTotal),
          meta: `${formatNumber(riskyAccountCount)} risky account${riskyAccountCount === 1 ? "" : "s"}`,
          iconName: "wallet"
        })}
        ${renderCeoMetricCard({
          label: "Reports",
          value: formatNumber(state.salesReports?.length || 0),
          meta: latestReport ? `Latest: ${latestReport.repName}` : "No submitted reports yet",
          iconName: "dashboard"
        })}
      </div>

      ${renderCorrectionApprovals(state)}

      <section class="panel ceo-product-stock-panel">
        ${panelHeader("Products", "Select chips, kuli kuli, or another product to view its sizes and affiliated stock")}
        ${renderCeoProductStock(state)}
      </section>

      <section class="panel">
        ${panelHeader("Today's factory stock", "Added stock and dispatched products are recorded against each product")}
        ${renderDailyStockMovementTable(state)}
      </section>

      <div class="ceo-dashboard-layout">
        <section class="panel ceo-chart-panel">
          ${panelHeader("Sales trend", "Last 7 days")}
          ${renderCeoSalesChart(trend)}
        </section>
      </div>

      <section class="panel">
        ${panelHeader("Stock split", "Where finished stock currently sits")}
        ${renderCeoStockSplit(vision, productRows)}
      </section>
    </section>
  `;
}

function activeStockProducts(products) {
  return (products || []).filter((product) => product.status !== "inactive");
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
      label: "Finished products",
      href: "#/inventory?type=finished_products"
    },
    {
      id: "equipment",
      label: "Equipment",
      href: "#/inventory?type=equipment"
    }
  ];

  return categories.map((category) => {
    const products = activeStockProducts(state.products).filter((product) => stockCategoryIdForProduct(product) === category.id);
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
          ${category.lowCount ? statusPill("low") : ""}
        </a>
      `).join("")}
    </div>
  `;
}

function renderStoreKeeperAlertRows(state, permissions) {
  const canRestock = permissions.canManageProducts || permissions.canManageStockMovements || permissions.canReconcileStock;
  const lowStockProducts = getLowStockProducts(activeStockProducts(state.products)).slice(0, 5);

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
  const pendingTransactionIds = new Set((state.correctionRequests || [])
    .filter((request) => request.status === "pending")
    .map((request) => request.transactionId));

  if (!dispatches.length) {
    return '<div class="empty-state">No factory dispatches recorded yet</div>';
  }

  return `
    <div class="storekeeper-dispatch-list">
      ${dispatches.map((dispatch) => {
        const product = productMap.get(dispatch.productId);
        const isAdjustableDispatch = dispatch.movementDirection === "out" && ["supply", "internal movement"].includes(normalized(dispatch.type));

        return `
          <article class="storekeeper-dispatch-row" data-search-index="${escapeHtml(`${product?.name || ""} ${dispatch.partyName || ""}`.toLowerCase())}">
            <div>
              <strong>${escapeHtml(product?.name || dispatch.productId)}</strong>
              <p>${formatNumber(dispatch.quantity)} units to ${escapeHtml(dispatch.partyName || dispatch.recipientName || "Factory")}</p>
            </div>
            <div>
              ${statusPill(dispatch.movementDirection === "in" ? "in_stock" : "dispatched")}
              <span class="muted">${formatDate(dispatch.date)}</span>
              ${!isAdjustableDispatch ? "" : pendingTransactionIds.has(dispatch.id)
                ? iconButton({ iconName: "clock", label: "Correction awaiting CEO approval", disabled: true })
                : iconButton({
                    iconName: "refresh",
                    label: "Request dispatch correction",
                    className: "js-open-record-correction",
                    data: {
                      "transaction-id": dispatch.id,
                      "record-label": `${product?.name || dispatch.productId} dispatch`,
                      quantity: dispatch.quantity
                    }
                  })}
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderStoreKeeperDashboard(state, permissions) {
  const activeProducts = activeStockProducts(state.products);
  const lowStockProducts = getLowStockProducts(activeProducts);
  const dispatchCount = storeKeeperDispatches(state, 0).length;
  const totalStock = activeProducts.reduce((total, product) => total + Number(product.stock || 0), 0);

  return `
    <section class="view dashboard-view storekeeper-dashboard">
      ${dashboardIdentity(state, "store_keeper")}
      <section class="ceo-command-strip storekeeper-command-strip">
        <div>
          <span class="eyebrow">Store Keeper portal</span>
          <h2>Factory stock control</h2>
        </div>
        ${renderStoreKeeperDispatchAction(state)}
      </section>

      <div class="metric-grid">
        ${metricCard({
          label: "Total stock",
          value: formatNumber(totalStock),
          meta: "All stock currently at the factory",
          iconName: "package"
        })}
        ${metricCard({
          label: "Stocks at risk",
          value: formatNumber(lowStockProducts.length),
          meta: "Items at or below their minimum level",
          iconName: "alert"
        })}
        ${metricCard({
          label: "Dispatches",
          value: formatNumber(dispatchCount),
          meta: "Stock sent out from the factory",
          iconName: "truck"
        })}
      </div>

      <section class="panel">
        ${panelHeader("Today's factory stock", "Every stock addition and product dispatch is kept against the product for the day")}
        ${renderDailyStockMovementTable(state)}
      </section>

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
        ${panelHeader("Stock sections", "Raw materials, finished products, and equipment are managed separately")}
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
  const delayedOrders = state.orders.filter((order) => effectiveOrderStatus(order) === "delayed");
  const submittedReports = (state.salesReports || []).filter((report) => report.status === "submitted").slice(0, 2);
  const vision = calculateVisionMetrics(state);
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
    .map((order) => {
      const customerName = order.retailer?.name || order.customerName || "Unknown customer";
      const searchValues = [
        order.id,
        customerName,
        order.region,
        statusText(order.status),
        order.priority,
        order.repName,
        statusText(order.paymentType),
        ...(order.items || []).flatMap((item) => [item.productName, item.productId])
      ].map((value) => String(value || "").trim()).filter(Boolean);

      return `
        <tr
          data-search-index="${escapeHtml(searchValues.join(" ").toLowerCase())}"
          data-search-suggestions="${escapeHtml(JSON.stringify([...new Set(searchValues)]))}"
        >
          <td>
            <strong>${escapeHtml(order.id)}</strong>
            <div class="muted">${escapeHtml(customerName)}</div>
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
      `;
    })
    .join("");
}

function renderFactoryCashControls(vision) {
  const paymentCoveragePercent = vision.invoiceTotal ? vision.paymentCoveragePercent : 100;
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
      label: "Credit exposure",
      percent: vision.creditExposurePercent,
      value: `${formatCurrency(vision.creditBalanceTotal)} owed`,
      tone: vision.creditExposurePercent >= 100 ? "danger" : vision.creditExposurePercent >= 85 ? "warning" : "good"
    },
    {
      label: "Payment coverage",
      percent: paymentCoveragePercent,
      value: `${formatCurrency(vision.paidTotal)} collected`,
      tone: paymentCoveragePercent < 80 ? "warning" : "good"
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
      label: "Factory dispatch",
      value: formatNumber(openVariances),
      body: "Send stock out and track representative ledgers.",
      href: "#/inventory?tab=dispatch"
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
      body: "Manage customer profiles, contacts, ratings, and payment terms.",
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
          ${panelHeader("Factory-to-cash controls", "Produced stock, custody, credit exposure, and payment visibility")}
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

function reportLinesFor(report, state) {
  const transactionMap = new Map((state.stockTransactions || []).map((transaction) => [transaction.id, transaction]));

  return (report.reportLines || []).length
    ? report.reportLines
    : (report.transactionIds || [])
      .map((transactionId) => transactionMap.get(transactionId))
      .filter(Boolean)
      .map((transaction) => repTransactionLine(transaction, state));
}

function renderManagerReportRows(state, { readOnly = false } = {}) {

  return (state.salesReports || []).map((report) => {
    const reportLines = reportLinesFor(report, state);
    const linePreview = reportLines
      .slice(0, 2)
      .map((line) => [line.customerName, line.productName, line.returnDisposition].filter(Boolean).join(" - "))
      .join(", ");
    const searchIndex = [
      report.repName,
      report.reportDate,
      report.status,
      report.reviewNote,
      ...reportLines.flatMap((line) => [line.customerName, line.productName, line.returnDisposition])
    ].join(" ").toLowerCase();

    return `
      <tr data-search-index="${escapeHtml(searchIndex)}">
        <td>
          <strong>${escapeHtml(report.repName)}</strong>
          <div class="muted">${formatDate(report.reportDate)} - ${escapeHtml(report.tripLabel || "Daily report")}</div>
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
              iconName: "eye",
              label: "View details",
              className: "subtle js-view-report-details",
              data: { "report-id": report.id }
            })}
            ${readOnly ? "" : `
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
            `}
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderManagerSalesOperationsRows(state) {
  const rows = new Map();
  const reportedTransactionIds = new Set((state.salesReports || []).flatMap((report) => report.transactionIds || []));

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

  (state.stockTransactions || [])
    .filter((transaction) => transaction.date === todayISO())
    .filter((transaction) => ["sale", "return"].includes(normalized(transaction.type)))
    .filter((transaction) => !reportedTransactionIds.has(transaction.id))
    .forEach((transaction) => {
      const key = transaction.recordedBy || transaction.repName || "Unassigned";
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
      const amount = Number(transaction.amount || 0);
      const quantity = Number(transaction.quantity || 0);

      if (normalized(transaction.type) === "sale") {
        row.salesAmount += amount;
        row.unitsSold += quantity;
        if (normalized(transaction.paymentType).includes("credit")) row.creditAmount += amount;
        else row.cashAmount += amount;
      } else {
        row.returnAmount += amount;
        row.unitsReturned += quantity;
      }
      row.latestDate = todayISO();
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
            <div class="muted">${row.reports
              ? `${formatNumber(row.reports)} report${row.reports === 1 ? "" : "s"} - latest ${formatDate(row.latestDate)}`
              : `Live sales for ${formatDate(row.latestDate)} - not submitted yet`}</div>
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

export function renderManagerSalesOperations(state) {
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

function renderReportDetails(report, state) {
  const lines = reportLinesFor(report, state);

  return `
    <div class="report-detail-summary">
      <div><span>Sales representative</span><strong>${escapeHtml(report.repName || "Unassigned")}</strong></div>
      <div><span>Report date</span><strong>${formatDate(report.reportDate)}</strong></div>
      <div><span>Total sales</span><strong>${formatCurrency(report.salesAmount)}</strong></div>
      <div><span>Units</span><strong>${formatNumber(report.unitsSold)} sold / ${formatNumber(report.unitsReturned)} customer returned</strong></div>
      <div><span>Back to factory</span><strong>${formatNumber(report.unitsReturnedToFactory || 0)} units</strong></div>
      <div><span>Cash</span><strong>${formatCurrency(report.cashAmount)}</strong></div>
      <div><span>Credit</span><strong>${formatCurrency(report.creditAmount)}</strong></div>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Activity</th>
            <th>Customer</th>
            <th>Product</th>
            <th>Quantity</th>
            <th>Payment</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          ${lines.length ? lines.map((line) => `
            <tr>
              <td>
                <strong>${escapeHtml(line.type || "Sale")}</strong>
                ${line.returnDisposition ? `<div class="muted">${escapeHtml(line.returnDisposition)}</div>` : ""}
              </td>
              <td>${escapeHtml(line.customerName || "Customer")}</td>
              <td>${escapeHtml(line.productName || "Product")}</td>
              <td>${formatNumber(line.quantity)}</td>
              <td>${escapeHtml(statusText(line.paymentType || "cash"))}</td>
              <td>${formatCurrency(line.amount)}</td>
            </tr>
          `).join("") : '<tr><td colspan="6">No linked sale or return records</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="report-detail-note">
      <span class="eyebrow">Review note</span>
      <p>${escapeHtml(report.reviewNote || "No review query has been added.")}</p>
    </div>
  `;
}

function renderReportDetailsModal() {
  return `
    <div id="report-details-modal" class="stock-modal-backdrop" tabindex="-1" hidden>
      <section class="stock-modal report-details-modal" role="dialog" aria-modal="true" aria-labelledby="report-details-title">
        <header class="stock-modal-header">
          <div>
            <span class="eyebrow">Submitted sales report</span>
            <h2 id="report-details-title">Report details</h2>
          </div>
          ${iconButton({ iconName: "x", label: "Close report details", className: "js-close-report-details" })}
        </header>
        <div id="report-details-content" class="report-details-content"></div>
      </section>
    </div>
  `;
}

export function renderManagerReportReview(state, { readOnly = false } = {}) {
  return `
    <section class="panel" id="manager-report-review">
      ${panelHeader("Submitted sales reports", readOnly ? "Open any report to see its customers, products, quantities, and payment details" : "Open a report for full details, then review it or flag it for correction")}
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
          <tbody>${renderManagerReportRows(state, { readOnly }) || '<tr><td colspan="6">No submitted reports yet</td></tr>'}</tbody>
        </table>
      </div>
    </section>
    ${renderReportDetailsModal()}
  `;
}

function repStockDateOptions(assignments) {
  return [...new Set(assignments
    .filter((assignment) => isRepresentativeReturnEligible(assignment, todayISO()))
    .map((assignment) => assignment.assignedDate)
    .filter(Boolean))]
    .sort((a, b) => String(b).localeCompare(String(a)));
}

function selectedRepStockDate(assignments) {
  const dates = repStockDateOptions(assignments);
  const requestedDate = dashboardRouteParams().get("stockDate") || "";

  if (requestedDate && dates.includes(requestedDate)) return requestedDate;
  if (dates.includes(todayISO())) return todayISO();
  return dates[0] || "";
}

function repStockDateHref(date) {
  return `#/dashboard?stockDate=${encodeURIComponent(date)}`;
}

function renderRepStockDateFilter(assignments, activeDate) {
  const dates = repStockDateOptions(assignments);

  if (dates.length <= 1) return "";

  return `
    <nav class="subtab-nav rep-stock-date-filter" aria-label="Assigned stock days">
      ${dates.map((date) => `
        <a class="subtab-link${date === activeDate ? " is-active" : ""}" href="${repStockDateHref(date)}" data-preserve-scroll>
          ${date === todayISO() ? "Today" : escapeHtml(formatDate(date))}
        </a>
      `).join("")}
    </nav>
  `;
}

function renderRepOfflineStatus(state) {
  const pendingCount = (state.offlineSalesQueue || []).filter((entry) => (
    !entry.repUserId || entry.repUserId === state.user?.id
  )).length;
  const isOnline = typeof navigator === "undefined" || navigator.onLine !== false;

  if (isOnline && !pendingCount) return "";

  return `
    <section class="rep-offline-status ${isOnline ? "is-pending" : "is-offline"}" role="status" aria-live="polite">
      <div>
        ${icon(isOnline ? "upload" : "alert")}
        <span><strong>${isOnline ? `${formatNumber(pendingCount)} offline sale${pendingCount === 1 ? "" : "s"} waiting to sync` : "Working offline"}</strong><small>${isOnline ? "Your saved sales are still safe on this device." : "Sales will be saved on this device and queued until your connection returns."}</small></span>
      </div>
      ${isOnline && pendingCount ? '<button class="button js-sync-offline-sales" type="button"><span>Sync now</span></button>' : ""}
    </section>
  `;
}

function renderRepStockCards(assignments) {
  if (!assignments.length) {
    return '<div class="empty-state">No stock assigned in the past 7 days</div>';
  }

  return `
    <div class="rep-stock-grid">
      ${assignments.map((assignment) => `
        <article class="rep-stock-card" data-search-index="${escapeHtml(`${assignment.product.name} ${assignment.repName}`.toLowerCase())}">
          <header>
            <div>
              <span class="eyebrow">${assignment.assignedDate === todayISO() ? "Assigned today" : `Assigned ${escapeHtml(formatDate(assignment.assignedDate))}`} - ${escapeHtml(assignment.product.id)}</span>
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
              <span>${formatNumber(assignment.returned)} to store</span>
              ${Number(assignment.heldReturns || 0) ? `<span>${formatNumber(assignment.heldReturns)} held</span>` : ""}
            </div>
            ${progressBar(assignment.soldPercent, assignment.soldPercent < 60 ? "warning" : "good")}
          </div>

          <footer>
            <span class="muted">${formatNumber(assignment.assigned)} assigned</span>
            <button class="button js-fill-rep-product" type="button" data-product-id="${escapeHtml(assignment.productId)}">
              <span>Use this</span>
            </button>
          </footer>
        </article>
      `).join("")}
    </div>
  `;
}

function repProductUnit(product) {
  return product.unit || (stockCategoryIdForProduct(product) === "raw_materials" ? "kg" : "unit");
}

function renderRepProductImage(product) {
  if (product.imageUrl) {
    return `<img src="${escapeHtml(product.imageUrl)}" alt="">`;
  }

  return `<span>${escapeHtml(String(product.name || "PR").slice(0, 2).toUpperCase())}</span>`;
}

function renderRepProductCatalogue(products) {
  const catalogue = (products || [])
    .filter((product) => product.status !== "inactive" && stockCategoryIdForProduct(product) === "finished_products")
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  if (!catalogue.length) {
    return '<div class="empty-state">No visible products yet</div>';
  }

  return `
    <div class="rep-catalogue-grid">
      ${catalogue.map((product) => `
        <article class="rep-catalogue-card" data-search-index="${escapeHtml(`${product.name} ${product.category}`.toLowerCase())}">
          <div class="product-media">${renderRepProductImage(product)}</div>
          <div>
            <span class="eyebrow">${escapeHtml(product.id)}</span>
            <strong>${escapeHtml(product.name)}</strong>
            <span>${escapeHtml(product.category)} - ${formatCurrency(product.unitPrice || 0)} / ${escapeHtml(repProductUnit(product))}</span>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function repProductChoices(assignments, mode = "sale") {
  const choices = new Map();

  assignments.forEach((assignment) => {
    const available = mode === "return" ? Number(assignment.sold || 0) : assignment.outstanding;
    const canUseAssignment = available > 0 && (
      mode !== "return" || isRepresentativeReturnEligible(assignment, todayISO())
    );

    if (!canUseAssignment || !assignment.product) return;

    const existing = choices.get(assignment.productId) || {
      productId: assignment.productId,
      productName: assignment.product.name,
      available: 0,
      assignmentIds: []
    };

    existing.available += available;
    existing.assignmentIds.push(assignment.id);
    choices.set(assignment.productId, existing);
  });

  return [...choices.values()].sort((a, b) => a.productName.localeCompare(b.productName));
}

function renderRepAssignmentOptions(assignments, mode = "sale") {
  const unitLabel = mode === "return" ? "sold" : "left";

  return repProductChoices(assignments, mode).map((choice) => `
    <option value="${escapeHtml(choice.productId)}" data-assignment-ids="${escapeHtml(choice.assignmentIds.join(","))}">
      ${escapeHtml(choice.productName)} (${formatNumber(choice.available)} ${unitLabel})
    </option>
  `).join("");
}

function renderRepCustomerField(customers, prefix = "", allowWalkIn = false) {
  const customerIdName = `${prefix}CustomerId`;
  const customerNameName = `${prefix}CustomerName`;

  if (!customers.length && !allowWalkIn) {
    return `
      <label class="field">
        <span>Customer</span>
        <input name="${escapeHtml(customerNameName)}" type="text" placeholder="Customer or supermarket name" required>
      </label>
    `;
  }

  return `
    <label class="field">
      <span>Customer</span>
      <select name="${escapeHtml(customerIdName)}" ${allowWalkIn ? "data-rep-sale-customer" : ""} required>
        <option value="">Pick customer</option>
        ${allowWalkIn ? `<option value="${WALK_IN_CUSTOMER_ID}">Walk-in customer</option>` : ""}
        ${customers.map((customer) => `
          <option value="${escapeHtml(customer.id)}">${escapeHtml(customer.name)}</option>
        `).join("")}
      </select>
    </label>
  `;
}

function renderRepReturnCustomerField() {
  return `
    <label class="field">
      <span>Customer who bought it</span>
      <select name="returnCustomerId" data-rep-return-customer required disabled>
        <option value="">Select a product first</option>
      </select>
    </label>
  `;
}

function renderRepQuickLog(state, assignments) {
  const customers = (state.retailers || []).filter((customer) => customer.status !== "inactive");

  return `
    <section class="panel rep-action-panel">
      ${panelHeader("Quick log", "")}
      <div class="rep-log-sections">
        <form id="rep-sale-form" class="rep-log-form rep-log-card" novalidate>
          <div class="rep-log-card-header">
            <span class="eyebrow">Quick sale</span>
            <strong>Sale</strong>
          </div>

          <label class="field">
            <span>Product</span>
            <select name="saleAssignmentId" data-rep-assignment-select required>
              <option value="">Pick product</option>
              ${renderRepAssignmentOptions(assignments, "sale")}
            </select>
          </label>

          <label class="field">
            <span>How many?</span>
            <input name="saleQuantity" type="number" min="1" step="1" inputmode="numeric" placeholder="0" required>
          </label>

          ${renderRepCustomerField(customers, "sale", true)}

          <label class="field">
            <span>Payment</span>
            <select name="salePaymentType" data-rep-sale-payment>
              <option value="cash">Cash</option>
              <option value="credit">Credit</option>
            </select>
            <small class="muted" data-walk-in-payment-note hidden>Walk-in sales are cash only.</small>
          </label>

          <span id="rep-sale-message" class="rep-form-message" role="status" aria-live="polite"></span>
          <button class="button primary rep-save-button" type="submit">
            <span>Save sale</span>
          </button>
        </form>

        <form id="rep-return-form" class="rep-log-form rep-log-card" novalidate>
          <div class="rep-log-card-header">
            <span class="eyebrow">Customer return</span>
            <strong>Return <small>Last 7 days</small></strong>
          </div>

          <label class="field">
            <span>Product</span>
            <select name="returnAssignmentId" data-rep-assignment-select required>
              <option value="">Pick product</option>
              ${renderRepAssignmentOptions(assignments, "return")}
            </select>
          </label>

          <label class="field">
            <span>How many?</span>
            <input name="returnQuantity" type="number" min="1" step="1" inputmode="numeric" placeholder="0" required>
          </label>

          ${renderRepReturnCustomerField()}

          <label class="field">
            <span>Adjustment</span>
            <select name="returnPaymentType">
              <option value="credit adjustment">Reduce customer credit</option>
              <option value="cash refund">Cash refund</option>
            </select>
          </label>

          <label class="field">
            <span>Returned stock</span>
            <select name="returnDisposition">
              <option value="held_by_rep">Hold with me for resale</option>
              <option value="to_store">Return to store stock</option>
            </select>
          </label>

          <span id="rep-return-message" class="rep-form-message" role="status" aria-live="polite"></span>
          <button class="button primary rep-save-button" type="submit">
            <span>Save return</span>
          </button>
        </form>

        <form id="rep-factory-return-form" class="rep-log-form rep-log-card" novalidate>
          <div class="rep-log-card-header">
            <span class="eyebrow">Stock in your hand</span>
            <strong>Return to factory</strong>
          </div>

          <label class="field">
            <span>Product</span>
            <select name="factoryReturnProductId" required>
              <option value="">Pick product</option>
              ${renderRepAssignmentOptions(assignments, "sale")}
            </select>
          </label>

          <label class="field">
            <span>How many?</span>
            <input name="factoryReturnQuantity" type="number" min="1" step="1" inputmode="numeric" placeholder="0" required>
          </label>

          <label class="field">
            <span>Reason</span>
            <select name="factoryReturnReason" required>
              <option value="Unsold stock">Unsold stock</option>
              <option value="End of sales day">End of sales day</option>
              <option value="Stock exchange">Exchange stock</option>
              <option value="Other">Other</option>
            </select>
          </label>

          <span id="rep-factory-return-message" class="rep-form-message" role="status" aria-live="polite"></span>
          <button class="button primary rep-save-button" type="submit">
            <span>Return to factory</span>
          </button>
        </form>
      </div>
    </section>
  `;
}

function renderRepReportLines(transactions, state) {
  if (!transactions.length) {
    return '<div class="empty-state">No lines to report yet</div>';
  }

  const lines = repTransactionLines(transactions, state);
  const pendingTransactionIds = new Set((state.correctionRequests || [])
    .filter((request) => request.status === "pending")
    .map((request) => request.transactionId));

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
            <span>${escapeHtml([line.type, formatCurrency(line.amount), line.returnDisposition].filter(Boolean).join(" - "))}</span>
            ${line.type === "Sale" ? (pendingTransactionIds.has(line.transactionId)
              ? iconButton({ iconName: "clock", label: "Correction awaiting CEO approval", disabled: true })
              : iconButton({
                  iconName: "refresh",
                  label: "Request sale correction",
                  className: "js-open-rep-record-correction",
                  data: {
                    "transaction-id": line.transactionId,
                    "record-label": `${line.productName} sale to ${line.customerName}`,
                    quantity: line.quantity
                  }
                })) : ""}
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
      ${panelHeader("Day report", existingReport ? (hasReportChanges ? "New activity added" : "Submitted") : "Ready when today's activity is saved")}
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
        <div>
          <span class="eyebrow">Back to factory</span>
          <strong>${formatNumber(summary.unitsReturnedToFactory)}</strong>
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
        data-units-returned-to-factory="${escapeHtml(summary.unitsReturnedToFactory)}"
        data-transaction-ids="${escapeHtml(summary.transactionIds.join(","))}"
      >
        <span>${escapeHtml(buttonLabel)}</span>
      </button>
    </section>
  `;
}

function renderRepCreditPanel(creditLimit, dailyCreditUsed, creditUsage) {
  const dailyLimit = Number(creditLimit?.limit || 0);
  const creditLeft = Math.max(0, dailyLimit - Number(dailyCreditUsed || 0));

  return `
    <section class="panel rep-credit-panel">
      ${panelHeader("Daily credit", creditLimit ? `${formatCurrency(dailyCreditUsed)} of ${formatCurrency(dailyLimit)} used today` : "No daily limit set")}
      <div class="stock-line rep-credit-line">
        <div class="stock-meta">
          <span>${formatPercent(creditUsage)} used</span>
          <span>${formatCurrency(creditLeft)} left today</span>
        </div>
        ${progressBar(creditUsage, creditUsage >= 100 ? "danger" : creditUsage >= 85 ? "warning" : "good")}
      </div>
    </section>
  `;
}

function renderSalesRepDashboard(state) {
  const repName = currentRepName(state);
  const assignments = buildRepAssignments(state, repName);
  const activeStockDate = selectedRepStockDate(assignments);
  const visibleAssignments = activeStockDate
    ? assignments.filter((assignment) => (
        assignment.assignedDate === activeStockDate &&
        isRepresentativeReturnEligible(assignment, todayISO())
      ))
    : assignments;
  const transactions = todaysRepTransactions(state, repName);
  const summary = repDaySummary(transactions);
  const creditLimit = getCreditLimitForParty(state.creditLimits || [], repName);
  const dailyCreditUsed = getRepresentativeDailyCreditUsed(state, repName, todayISO());
  const creditUsage = creditLimit?.limit ? (dailyCreditUsed / Number(creditLimit.limit || 0)) * 100 : 0;
  const stockInHand = assignments.reduce((total, assignment) => total + assignment.outstanding, 0);
  const existingReport = (state.salesReports || []).find((report) => (
    normalized(report.repName) === normalized(repName) &&
    report.reportDate === todayISO()
  ));
  const fieldReportsEnabled = isModuleEnabled(state, "field_reports");
  const creditControlEnabled = isModuleEnabled(state, "credit_control");

  return `
    <section class="view dashboard-view sales-rep-portal">
      ${dashboardIdentity(state, "sales_rep")}
      ${renderRepOfflineStatus(state)}
      <section class="rep-hero">
        <div>
          <span class="eyebrow">Today</span>
          <h2>${escapeHtml(repName)}</h2>
        </div>
        <div class="rep-hero-stats${creditControlEnabled ? "" : " is-credit-disabled"}">
          <div>
            <span>Stock</span>
            <strong>${formatNumber(stockInHand)}</strong>
          </div>
          <div>
            <span>Sales</span>
            <strong>${formatCurrency(summary.salesAmount)}</strong>
          </div>
          ${creditControlEnabled ? `
            <div class="${creditUsage >= 85 ? "is-warning" : ""}">
              <span>Today credit</span>
              <strong>${formatPercent(creditUsage)}</strong>
            </div>
          ` : ""}
        </div>
      </section>

      <div class="rep-main-grid${fieldReportsEnabled ? "" : " is-report-disabled"}">
        ${renderRepQuickLog(state, assignments)}
      ${fieldReportsEnabled ? renderRepReportPanel(repName, transactions, summary, existingReport, state) : ""}
      ${renderRecordCorrectionModal()}
        ${creditControlEnabled ? renderRepCreditPanel(creditLimit, dailyCreditUsed, creditUsage) : ""}
      </div>

      <section class="panel">
        ${panelHeader(
          "Assigned stock",
          activeStockDate
            ? `${activeStockDate === todayISO() ? "Today" : formatDate(activeStockDate)} assignments`
            : "Stock currently loaded to you"
        )}
        ${renderRepStockDateFilter(assignments, activeStockDate)}
        ${renderRepStockCards(visibleAssignments)}
      </section>

      <section class="panel">
        ${panelHeader("Product catalogue", "Visible snacks from the factory")}
        ${renderRepProductCatalogue(state.products)}
      </section>

    </section>
  `;
}

function getAccountantFinancialLines(state) {
  return getFinancialSalesLines(state);
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
      ${dashboardIdentity(state, "accountant")}
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
      ${dashboardIdentity(state, role)}
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
        ${panelHeader("Factory-to-cash controls", "Produced stock, representative custody, credit exposure, and payment visibility")}
        <div class="bar-list">${renderFactoryCashControls(vision)}</div>
      </section>

      ${renderManagerRecentSalesOrders(state)}
    </section>
  `;
}

export function renderManagerRecentSalesOrders(state) {
  const metrics = calculateMetrics(state);
  const permissions = currentUserPermissions(state);

  return `
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
  `;
}

export function bindManagerActivitySections({ root, store }) {
  bindSubmittedReportDetails({ root, store });

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
        note: "CEO query raised",
        message: "Report flagged"
      });
    });
  });
}

export function bindDashboard({ root, store, signal }) {
  bindSubmittedReportDetails({ root, store });

  if (root.querySelector(".sales-rep-portal")) {
    bindSalesRepDashboard({ root, store });
    return;
  }

  if (root.querySelector(".ceo-dashboard")) {
    bindInventory({ root, store, signal });
    bindCeoDashboard({ root, store });
    return;
  }

  if (root.querySelector(".storekeeper-dashboard")) {
    bindInventory({ root, store, signal });
  }

  qsa(".js-restock-product", root).forEach((button) => {
    button.addEventListener("click", () => {
      const product = store.getState().products.find((item) => item.id === button.dataset.productId);
      const rawQuantity = window.prompt(`How many ${product?.unit || "units"} do you want to add to ${product?.name || "this stock item"}?`, "");
      if (rawQuantity === null) return;

      const quantity = Number(rawQuantity);
      if (!Number.isFinite(quantity) || quantity <= 0) return;

      store.dispatch({
        type: "RESTOCK_PRODUCT",
        productId: button.dataset.productId,
        quantity,
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
        note: "CEO query raised",
        message: "Report flagged"
      });
    });
  });
}

function bindSubmittedReportDetails({ root, store }) {
  const modal = qs("#report-details-modal", root);
  const content = qs("#report-details-content", root);
  const title = qs("#report-details-title", root);

  if (!modal || !content) return;

  function closeModal() {
    modal.hidden = true;
  }

  qsa(".js-view-report-details", root).forEach((button) => {
    button.addEventListener("click", () => {
      const report = (store.getState().salesReports || []).find((item) => item.id === button.dataset.reportId);
      if (!report) return;

      content.innerHTML = renderReportDetails(report, store.getState());
      if (title) title.textContent = `${report.repName || "Representative"} - ${formatDate(report.reportDate)}`;
      modal.hidden = false;
      modal.focus();
    });
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest(".js-close-report-details")) closeModal();
  });
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });
}

function bindCeoDashboard({ root, store }) {
  const filterControls = qsa("[data-ceo-filter]", root);
  const resetButton = qs("[data-ceo-filter-reset]", root);
  const detailModal = qs("#leadership-detail-modal", root);
  const detailContent = qs("#leadership-detail-content", root);
  const detailTitle = qs("#leadership-detail-title", root);
  const productSizeModal = qs("#ceo-product-size-modal", root);
  const productSizeTitle = qs("#ceo-product-size-title", root);
  const selectedSizeDetail = qs("[data-selected-size-detail]", root);

  function closeProductSizeModal() {
    if (productSizeModal) productSizeModal.hidden = true;
  }

  qsa(".js-toggle-product-types", root).forEach((button) => {
    button.addEventListener("click", () => {
      const family = button.dataset.productFamily || "";
      const dropdown = qsa("[data-product-type-dropdown]", root).find((item) => item.dataset.productTypeDropdown === family);
      const willOpen = Boolean(dropdown?.hidden);
      qsa("[data-product-type-dropdown]", root).forEach((item) => { item.hidden = true; });
      qsa(".js-toggle-product-types", root).forEach((item) => item.setAttribute("aria-expanded", "false"));
      if (dropdown && willOpen) {
        dropdown.hidden = false;
        button.setAttribute("aria-expanded", "true");
      }
    });
  });

  qsa(".js-open-product-size-modal", root).forEach((button) => {
    button.addEventListener("click", () => {
      if (!productSizeModal) return;
      const family = button.dataset.productFamily || "";
      const type = button.dataset.productType || "";
      qsa("[data-size-family]", productSizeModal).forEach((card) => {
        card.hidden = card.dataset.sizeFamily !== family || card.dataset.sizeType !== type;
      });
      if (productSizeTitle) productSizeTitle.textContent = `${family} · ${type}`;
      if (selectedSizeDetail) selectedSizeDetail.hidden = true;
      productSizeModal.hidden = false;
    });
  });

  qsa(".js-select-product-size", root).forEach((button) => {
    button.addEventListener("click", () => {
      if (!selectedSizeDetail) return;
      const setText = (selector, value) => {
        const target = qs(selector, selectedSizeDetail);
        if (target) target.textContent = value;
      };
      setText("[data-size-detail-type]", `${button.dataset.sizeType} · ${button.dataset.sizeLabel}`);
      setText("[data-size-detail-name]", button.dataset.sizeName || "Product size");
      setText("[data-size-detail-sku]", button.dataset.sizeSku || "SKU");
      setText("[data-size-detail-available]", formatNumber(button.dataset.sizeAvailable || 0));
      setText("[data-size-detail-unit]", button.dataset.sizeUnit || "units");
      setText("[data-size-detail-day]", formatNumber(button.dataset.sizeDispatchDay || 0));
      setText("[data-size-detail-month]", formatNumber(button.dataset.sizeDispatchMonth || 0));
      setText("[data-size-detail-year]", formatNumber(button.dataset.sizeDispatchYear || 0));
      selectedSizeDetail.hidden = false;
    });
  });

  qsa(".js-close-product-size-modal", root).forEach((button) => button.addEventListener("click", closeProductSizeModal));
  productSizeModal?.addEventListener("click", (event) => {
    if (event.target === productSizeModal) closeProductSizeModal();
  });

  qsa(".js-approve-record-correction", root).forEach((button) => {
    button.addEventListener("click", () => {
      store.dispatch({
        type: "APPROVE_RECORD_CORRECTION",
        requestId: button.dataset.requestId,
        message: "Correction approved and stock records updated"
      });
    });
  });

  qsa(".js-reject-record-correction", root).forEach((button) => {
    button.addEventListener("click", () => {
      const note = window.prompt("Why is this correction being rejected?", "Correction not approved");
      if (note === null || !note.trim()) return;
      store.dispatch({
        type: "REJECT_RECORD_CORRECTION",
        requestId: button.dataset.requestId,
        note,
        message: "Correction rejected"
      });
    });
  });

  function closeDetailModal() {
    if (detailModal) detailModal.hidden = true;
  }

  function openDetailRow(row) {
    if (!row || !detailModal || !detailContent) return;
    const state = store.getState();
    const kind = row.dataset.ceoDrilldown;
    if (kind === "rep") {
      detailContent.innerHTML = renderRepresentativeHistory(state, row.dataset.ceoRep);
      if (detailTitle) detailTitle.textContent = "Representative history";
    } else if (kind === "product") {
      detailContent.innerHTML = renderProductSalesHistory(state, row.dataset.ceoProduct);
      if (detailTitle) detailTitle.textContent = "Product sales volume";
    } else if (kind === "supermarket") {
      detailContent.innerHTML = renderSupermarketHistory(state, row.dataset.ceoSupermarket);
      if (detailTitle) detailTitle.textContent = "Supermarket history";
    } else {
      return;
    }
    detailModal.hidden = false;
    detailModal.focus();
  }

  qsa("[data-ceo-drilldown]", root).forEach((row) => {
    row.addEventListener("click", () => openDetailRow(row));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetailRow(row);
      }
    });
  });

  detailModal?.addEventListener("click", (event) => {
    if (event.target === detailModal || event.target.closest(".js-close-leadership-detail")) closeDetailModal();
  });
  detailModal?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDetailModal();
  });

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
  const saleForm = qs("#rep-sale-form", root);
  const returnForm = qs("#rep-return-form", root);
  const factoryReturnForm = qs("#rep-factory-return-form", root);
  const assignmentSelects = qsa("[data-rep-assignment-select]", root);
  const saleCustomerSelect = qs("[data-rep-sale-customer]", root);
  const salePaymentSelect = qs("[data-rep-sale-payment]", root);
  const walkInPaymentNote = qs("[data-walk-in-payment-note]", root);
  const returnProductSelect = qs('select[name="returnAssignmentId"]', root);
  const returnCustomerSelect = qs("[data-rep-return-customer]", root);
  const correctionModal = qs("#record-correction-modal", root);
  const correctionForm = qs("#record-correction-form", root);
  const correctionMessage = qs("#record-correction-message", root);

  qsa(".js-open-rep-record-correction", root).forEach((button) => {
    button.addEventListener("click", () => {
      if (!correctionModal || !correctionForm) return;
      correctionForm.reset();
      correctionForm.elements.transactionId.value = button.dataset.transactionId || "";
      correctionForm.elements.requestedQuantity.value = button.dataset.quantity || "";
      const label = qs("[data-correction-record-label]", correctionModal);
      if (label) label.textContent = button.dataset.recordLabel || "Saved sale";
      if (correctionMessage) correctionMessage.textContent = "";
      correctionModal.hidden = false;
      correctionForm.elements.requestedQuantity.focus();
    });
  });
  qsa(".js-close-record-correction", root).forEach((button) => {
    button.addEventListener("click", () => { correctionModal.hidden = true; });
  });
  correctionModal?.addEventListener("click", (event) => {
    if (event.target === correctionModal) correctionModal.hidden = true;
  });
  correctionForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(correctionForm);
    const transactionId = String(formData.get("transactionId") || "");
    const requestedQuantity = Number(formData.get("requestedQuantity") || 0);
    const reason = String(formData.get("reason") || "").trim();
    const transaction = (store.getState().stockTransactions || []).find((item) => item.id === transactionId);
    if (correctionMessage) correctionMessage.textContent = "";
    if (!transaction || !requestedQuantity || requestedQuantity <= 0 || requestedQuantity === Number(transaction.quantity || 0) || !reason) {
      if (correctionMessage) correctionMessage.textContent = "Enter a different quantity and explain the reason for the adjustment.";
      return;
    }
    store.dispatch({
      type: "REQUEST_RECORD_CORRECTION",
      transactionId,
      requestedQuantity,
      reason,
      message: "Correction sent for CEO approval"
    });
    correctionModal.hidden = true;
  });

  function applyWalkInPaymentRule() {
    if (!saleCustomerSelect || !salePaymentSelect) return;

    const isWalkIn = saleCustomerSelect.value === WALK_IN_CUSTOMER_ID;
    const creditOption = [...salePaymentSelect.options].find((option) => option.value === "credit");
    if (creditOption) creditOption.disabled = isWalkIn;
    if (isWalkIn) salePaymentSelect.value = "cash";
    if (walkInPaymentNote) walkInPaymentNote.hidden = !isWalkIn;
  }

  saleCustomerSelect?.addEventListener("change", applyWalkInPaymentRule);
  applyWalkInPaymentRule();

  function updateReturnCustomerOptions() {
    if (!returnProductSelect || !returnCustomerSelect) return;

    const state = store.getState();
    const repName = currentRepName(state);
    const productId = returnProductSelect.value;
    const eligibleAssignments = buildRepAssignments(state, repName)
      .filter((assignment) => assignment.productId === productId)
      .filter((assignment) => isRepresentativeReturnEligible(assignment, todayISO()))
      .filter((assignment) => Number(assignment.sold || 0) > 0);
    const choices = getReturnableCustomerChoices(state, {
      productId,
      repName,
      repUserId: state.user?.id || "",
      assignmentIds: eligibleAssignments.map((assignment) => assignment.id)
    });

    returnCustomerSelect.innerHTML = choices.length
      ? [
          '<option value="">Pick customer</option>',
          ...choices.map((choice) => `
            <option
              value="${escapeHtml(choice.key)}"
              data-customer-id="${escapeHtml(choice.customerId)}"
              data-customer-name="${escapeHtml(choice.customerName)}"
              data-customer-type="${escapeHtml(choice.customerType)}"
              data-returnable-quantity="${escapeHtml(choice.quantity)}"
            >
              ${escapeHtml(choice.customerName)} (${formatNumber(choice.quantity)} sold)
            </option>
          `)
        ].join("")
      : `<option value="">${productId ? "No customer sales available for this product" : "Select a product first"}</option>`;
    returnCustomerSelect.disabled = !choices.length;
  }

  returnProductSelect?.addEventListener("change", updateReturnCustomerOptions);
  updateReturnCustomerOptions();

  qsa(".js-fill-rep-product", root).forEach((button) => {
    button.addEventListener("click", () => {
      assignmentSelects.forEach((select) => {
        select.value = button.dataset.productId;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      assignmentSelects[0]?.focus();
    });
  });

  function handleRepTransaction(event, transactionType) {
    event.preventDefault();

    const form = event.currentTarget;
    const state = store.getState();
    const formData = new FormData(form);
    const prefix = transactionType === "return" ? "return" : "sale";
    const message = qs(`#rep-${prefix}-message`, root);
    const productId = String(formData.get(`${prefix}AssignmentId`) || "");
    const selectedCustomerId = String(formData.get(`${prefix}CustomerId`) || "");
    const isWalkInSale = transactionType === "sale" && selectedCustomerId === WALK_IN_CUSTOMER_ID;
    const selectedReturnOption = transactionType === "return" ? returnCustomerSelect?.selectedOptions?.[0] : null;
    const returnCustomerId = String(selectedReturnOption?.dataset.customerId || "");
    const returnCustomerName = String(selectedReturnOption?.dataset.customerName || "");
    const returnCustomerType = String(selectedReturnOption?.dataset.customerType || "Customer");
    const returnableCustomerQuantity = Number(selectedReturnOption?.dataset.returnableQuantity || 0);
    const customerId = transactionType === "return" ? returnCustomerId : isWalkInSale ? "" : selectedCustomerId;
    const typedCustomerName = String(formData.get(`${prefix}CustomerName`) || "").trim();
    const quantity = Number(formData.get(`${prefix}Quantity`) || 0);
    const paymentType = String(formData.get(`${prefix}PaymentType`) || "cash");
    const returnDisposition = String(formData.get("returnDisposition") || "held_by_rep");
    const repName = currentRepName(state);
    const selectedAssignments = buildRepAssignments(state, repName)
      .filter((assignment) => assignment.productId === productId)
      .filter((assignment) => transactionType !== "return" || isRepresentativeReturnEligible(assignment, todayISO()))
      .filter((assignment) => (
        transactionType === "return"
          ? Number(assignment.sold || 0) > 0
          : assignment.outstanding > 0
      ));
    const product = (state.products || []).find((item) => item.id === productId);
    const customer = (state.retailers || []).find((item) => item.id === customerId);
    const customerName = transactionType === "return"
      ? returnCustomerName
      : isWalkInSale ? "Walk-in customer" : customer?.name || typedCustomerName;
    const isCreditSale = transactionType === "sale" && normalized(paymentType).includes("credit");
    const availableQuantity = selectedAssignments.reduce((total, assignment) => (
      total + (transactionType === "return" ? Number(assignment.sold || 0) : assignment.outstanding)
    ), 0);
    const amount = quantity * Number(product?.unitPrice || 0);

    setRepMessage(message, "");

    if (!product || !selectedAssignments.length) {
      setRepMessage(
        message,
        transactionType === "return" ? "Customer returns can only be logged within 7 days of assignment." : "Pick a product first.",
        "error"
      );
      return;
    }

    if (transactionType === "sale" && selectedCustomerId && !isWalkInSale && !customer) {
      setRepMessage(message, "Pick a valid customer.", "error");
      return;
    }

    if (!customerName) {
      setRepMessage(message, transactionType === "return" ? "Choose the customer who bought this product." : "Enter the customer name.", "error");
      return;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setRepMessage(message, "Enter how many.", "error");
      return;
    }

    if (isWalkInSale && normalized(paymentType) !== "cash") {
      setRepMessage(message, "Walk-in customers can only pay with cash.", "error");
      return;
    }

    if (quantity > availableQuantity) {
      const detail = transactionType === "return" ? "sold units can be returned within 7 days" : "left";
      setRepMessage(message, `Only ${formatNumber(availableQuantity)} ${detail} for this product.`, "error");
      return;
    }

    if (transactionType === "return" && quantity > returnableCustomerQuantity) {
      setRepMessage(message, `Only ${formatNumber(returnableCustomerQuantity)} sold to this customer can be returned.`, "error");
      return;
    }

    if (isCreditSale && !customer) {
      setRepMessage(message, "Credit sales need a saved customer.", "error");
      return;
    }

    if (isCreditSale) {
      const repLimit = getCreditLimitForParty(state.creditLimits || [], repName);
      const customerLimit = getCreditLimitForParty(state.creditLimits || [], customer.name);
      const repCreditUsedToday = getRepresentativeDailyCreditUsed(state, repName, todayISO());
      const repProjected = repCreditUsedToday + amount;
      const customerProjected = Number(customerLimit?.balance || 0) + amount;

      if (!repLimit?.limit || repProjected > Number(repLimit.limit || 0)) {
        setRepMessage(message, !repLimit?.limit ? "Daily credit limit has not been set." : "Daily credit limit reached for today.", "error");
        return;
      }

      if (!customerLimit?.limit || customerProjected > Number(customerLimit.limit || 0)) {
        setRepMessage(message, "Customer credit limit reached.", "error");
        return;
      }
    }

    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    store.dispatch({
      type: "LOG_REP_TRANSACTION",
      assignmentIds: selectedAssignments.map((assignment) => assignment.id),
      productId,
      customerId,
      customerName,
      customerType: transactionType === "return"
        ? returnCustomerType
        : isWalkInSale ? "Walk-in" : customer?.channel || customer?.type || "Customer",
      quantity,
      transactionType,
      paymentType,
      returnDisposition: transactionType === "return" ? returnDisposition : "",
      repName,
      offline: transactionType === "sale" && offline,
      message: transactionType === "return" ? "Customer return saved" : offline ? "Sale saved offline" : "Sale saved"
    });
  }

  saleForm?.addEventListener("submit", (event) => {
    handleRepTransaction(event, "sale");
  });

  returnForm?.addEventListener("submit", (event) => {
    handleRepTransaction(event, "return");
  });

  factoryReturnForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(factoryReturnForm);
    const productId = String(formData.get("factoryReturnProductId") || "");
    const quantity = Number(formData.get("factoryReturnQuantity") || 0);
    const reason = String(formData.get("factoryReturnReason") || "Unsold stock");
    const state = store.getState();
    const repName = currentRepName(state);
    const assignments = buildRepAssignments(state, repName).filter((assignment) => assignment.productId === productId && assignment.outstanding > 0);
    const available = assignments.reduce((total, assignment) => total + assignment.outstanding, 0);
    const message = qs("#rep-factory-return-message", root);

    setRepMessage(message, "");
    if (!productId || !assignments.length) {
      setRepMessage(message, "Pick a product currently in your stock.", "error");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setRepMessage(message, "Enter how many you are returning.", "error");
      return;
    }
    if (quantity > available) {
      setRepMessage(message, `You only have ${formatNumber(available)} of this product in hand.`, "error");
      return;
    }

    store.dispatch({
      type: "RETURN_REP_STOCK_TO_FACTORY",
      assignmentIds: assignments.map((assignment) => assignment.id),
      productId,
      quantity,
      reason,
      repName,
      message: "Stock returned to factory"
    });
  });

  qs(".js-sync-offline-sales", root)?.addEventListener("click", () => {
    store.dispatch({ type: "SYNC_OFFLINE_SALES", message: "Offline sales synced" });
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
        unitsReturnedToFactory: Number(button.dataset.unitsReturnedToFactory || 0),
        transactionIds,
        reportLines,
        message: "Sales report submitted"
      });
    });
  });
}
