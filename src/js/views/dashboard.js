import {
  buildRegionalSummary,
  calculateMetrics,
  getLowStockProducts,
  getOrdersWithTotals
} from "../services/calculations.js";
import { formatCompact, formatCurrency, formatDate, formatNumber, formatPercent } from "../services/formatters.js";
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

function renderAlerts(state) {
  const lowStockProducts = getLowStockProducts(state.products).slice(0, 4);
  const delayedOrders = state.orders.filter((order) => order.status === "delayed");
  const alerts = [
    ...lowStockProducts.map((product) => ({
      id: product.id,
      title: `${product.name} needs replenishment`,
      detail: `${formatNumber(product.stock)} units left in ${product.warehouse}`,
      action: textButton({
        iconName: "plus",
        label: "Restock",
        className: "primary js-restock-product",
        data: { "product-id": product.id }
      })
    })),
    ...delayedOrders.map((order) => ({
      id: order.id,
      title: `${order.id} is delayed`,
      detail: `Priority ${order.priority} order due ${formatDate(order.dueAt)}`,
      action: iconButton({
        iconName: "arrowRight",
        label: "Move order forward",
        className: "js-advance-order",
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

function renderRecentOrders(state) {
  return getOrdersWithTotals(state)
    .slice(0, 5)
    .map(
      (order) => `
        <tr data-search-index="${escapeHtml(`${order.id} ${order.retailer?.name} ${order.region} ${order.status}`.toLowerCase())}">
          <td>
            <strong>${escapeHtml(order.id)}</strong>
            <div class="muted">${escapeHtml(order.retailer?.name || "Unknown retailer")}</div>
          </td>
          <td>${escapeHtml(order.region)}</td>
          <td>${statusPill(order.status)}</td>
          <td>${formatCurrency(order.total)}</td>
          <td>
            <div class="row-actions">
              ${iconButton({
                iconName: "arrowRight",
                label: "Move order forward",
                className: "js-advance-order",
                disabled: order.status === "delivered",
                data: { "order-id": order.id }
              })}
            </div>
          </td>
        </tr>
      `
    )
    .join("");
}

export function renderDashboard({ state }) {
  const metrics = calculateMetrics(state);

  return `
    <section class="view dashboard-view">
      <div class="metric-grid">
        ${metricCard({
          label: "Pipeline value",
          value: formatCurrency(metrics.orderRevenue),
          meta: `${formatNumber(state.orders.length)} orders in cycle`,
          iconName: "orders"
        })}
        ${metricCard({
          label: "Open orders",
          value: formatNumber(metrics.openOrders),
          meta: `${formatPercent(metrics.fillRate)} delivered`,
          iconName: "package"
        })}
        ${metricCard({
          label: "Active routes",
          value: formatNumber(metrics.activeRoutes),
          meta: "Scheduled or in transit",
          iconName: "truck"
        })}
        ${metricCard({
          label: "Receivables",
          value: formatCurrency(metrics.receivables),
          meta: `${metrics.lowStockCount} low stock SKUs`,
          iconName: "wallet"
        })}
      </div>

      <div class="dashboard-layout">
        <section class="panel">
          ${panelHeader("Regional demand", "Order value by operating region")}
          <div class="bar-list">${renderRegionalSummary(state)}</div>
        </section>

        <section class="panel">
          ${panelHeader("Attention queue", "Items that need action today")}
          ${renderAlerts(state)}
        </section>
      </div>

      <section class="panel">
        ${panelHeader("Recent orders", "Latest dispatch work moving through the network")}
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Region</th>
                <th>Status</th>
                <th>Value</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${renderRecentOrders(state)}</tbody>
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
        message: "Inventory replenished"
      });
    });
  });

  qsa(".js-advance-order", root).forEach((button) => {
    button.addEventListener("click", () => {
      store.dispatch({
        type: "ADVANCE_ORDER",
        orderId: button.dataset.orderId,
        message: "Order status updated"
      });
    });
  });
}
