import {
  buildRegionalSummary,
  calculateMetrics,
  calculateVisionMetrics,
  getLowStockProducts,
  getOrdersWithTotals
} from "../services/calculations.js";
import { formatCompact, formatCurrency, formatDate, formatNumber, formatPercent } from "../services/formatters.js";
import { currentUserPermissions } from "../services/rbac.js";
import { escapeHtml, qsa } from "../ui/dom.js";
import { iconButton, metricCard, panelHeader, progressBar, statusPill, textButton } from "../ui/components.js";

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

export function renderDashboard({ state }) {
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
