import {
  assignmentOutstanding,
  buildRegionalSummary,
  calculateMetrics,
  calculateVisionMetrics,
  getCreditLimitForParty,
  getLowStockProducts,
  getOrdersWithTotals,
  getProductMap
} from "../services/calculations.js";
import { formatCompact, formatCurrency, formatDate, formatNumber, formatPercent } from "../services/formatters.js";
import { currentUserPermissions, currentUserRole } from "../services/rbac.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { iconButton, metricCard, panelHeader, progressBar, statusPill, textButton } from "../ui/components.js";

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
    "Sales Rep"
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
      label: "Rep sell-through",
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

function renderRepStockCards(assignments) {
  if (!assignments.length) {
    return '<div class="empty-state">No stock assigned yet</div>';
  }

  return `
    <div class="rep-stock-grid">
      ${assignments.map((assignment) => `
        <article class="rep-stock-card" data-search-index="${escapeHtml(`${assignment.product.name} ${assignment.repName}`.toLowerCase())}">
          <header>
            <div>
              <span class="eyebrow">${escapeHtml(assignment.product.id)}</span>
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
            <span class="muted">${formatNumber(assignment.assigned)} loaded</span>
            <button class="button js-fill-rep-product" type="button" data-assignment-id="${escapeHtml(assignment.id)}">
              <span>Use this</span>
            </button>
          </footer>
        </article>
      `).join("")}
    </div>
  `;
}

function renderRepQuickLog(state, assignments) {
  const customers = state.retailers || [];

  return `
    <section class="panel rep-action-panel">
      ${panelHeader("Quick log", "")}
      <form id="rep-log-form" class="rep-log-form" novalidate>
        <fieldset class="rep-type-toggle" aria-label="Choose sale or return">
          <label>
            <input type="radio" name="transactionType" value="sale" checked>
            <span>Sale</span>
          </label>
          <label>
            <input type="radio" name="transactionType" value="return">
            <span>Return</span>
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

        <label class="field">
          <span>Customer</span>
          <select name="customerId" required>
            <option value="">Pick customer</option>
            ${customers.map((customer) => `
              <option value="${escapeHtml(customer.id)}">${escapeHtml(customer.name)}</option>
            `).join("")}
          </select>
        </label>

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

function renderRepActivity(transactions) {
  if (!transactions.length) {
    return '<div class="empty-state">No sales yet today</div>';
  }

  return `
    <div class="rep-activity-list">
      ${transactions.map((transaction) => `
        <article class="rep-activity-item" data-search-index="${escapeHtml(`${transaction.type} ${transaction.partyName} ${transaction.paymentType}`.toLowerCase())}">
          <div>
            <strong>${escapeHtml(transaction.type === "return" ? "Return" : "Sale")}</strong>
            <span>${escapeHtml(transaction.partyName)}</span>
          </div>
          <div>
            <strong>${formatCurrency(transaction.amount)}</strong>
            <span>${formatNumber(transaction.quantity)} units - ${escapeHtml(transaction.paymentType)}</span>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderRepReportPanel(repName, transactions, summary, existingReport) {
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
        ${renderRepQuickLog(state, assignments)}
        <section class="panel">
          ${panelHeader("Credit", creditLimit ? `${formatCurrency(creditLimit.balance)} of ${formatCurrency(creditLimit.limit)}` : "No limit set")}
          <div class="stock-line rep-credit-line">
            <div class="stock-meta">
              <span>${formatPercent(creditUsage)} used</span>
              <span>${formatCurrency(Math.max(0, Number(creditLimit?.limit || 0) - Number(creditLimit?.balance || 0)))} left</span>
            </div>
            ${progressBar(creditUsage, creditUsage >= 100 ? "danger" : creditUsage >= 85 ? "warning" : "good")}
          </div>
        </section>
        ${renderRepReportPanel(repName, transactions, summary, existingReport)}
      </div>

      <section class="panel">
        ${panelHeader("Stock in hand", "")}
        ${renderRepStockCards(assignments)}
      </section>

      <section class="panel">
        ${panelHeader("Saved today", `${formatNumber(summary.unitsSold)} sold - ${formatNumber(summary.unitsReturned)} returned`)}
        ${renderRepActivity(transactions)}
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
          label: "Rep stock owed",
          value: formatNumber(vision.repOutstandingUnits),
          meta: `${formatCurrency(vision.repOutstandingValue)} still with reps`,
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
        ${panelHeader("Factory-to-cash controls", "Produced stock, rep custody, paper trails, signatures, and payment visibility")}
        <div class="bar-list">${renderFactoryCashControls(vision)}</div>
      </section>

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
    </section>
  `;
}

export function bindDashboard({ root, store }) {
  if (root.querySelector(".sales-rep-portal")) {
    bindSalesRepDashboard({ root, store });
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
    const quantity = Number(formData.get("quantity") || 0);
    const transactionType = String(formData.get("transactionType") || "sale");
    const paymentType = String(formData.get("paymentType") || "cash");
    const assignment = (state.stockAssignments || []).find((item) => item.id === assignmentId);
    const product = (state.products || []).find((item) => item.id === assignment?.productId);
    const customer = (state.retailers || []).find((item) => item.id === customerId);
    const repName = assignment?.repName || currentRepName(state);
    const outstanding = assignment ? assignmentOutstanding(assignment) : 0;
    const amount = quantity * Number(product?.unitPrice || 0);

    setRepMessage(message, "");

    if (!assignment) {
      setRepMessage(message, "Pick a snack first.", "error");
      return;
    }

    if (!customer) {
      setRepMessage(message, "Pick a customer.", "error");
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

    if (transactionType === "sale" && normalized(paymentType).includes("credit")) {
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
      quantity,
      transactionType,
      paymentType,
      repName,
      message: transactionType === "return" ? "Return saved" : "Sale saved"
    });
  });

  qsa(".js-submit-rep-report", root).forEach((button) => {
    button.addEventListener("click", () => {
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
        transactionIds: String(button.dataset.transactionIds || "").split(",").filter(Boolean),
        message: "Sales report submitted"
      });
    });
  });
}
