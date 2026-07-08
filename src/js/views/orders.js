import {
  buildOrderStatusSummary,
  calculateVisionMetrics,
  getCreditGuardForOrder,
  getOrdersWithTotals
} from "../services/calculations.js";
import { formatCurrency, formatDate, formatNumber, formatPercent, statusText } from "../services/formatters.js";
import { currentUserPermissions } from "../services/rbac.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { iconButton, panelHeader, statusPill, table } from "../ui/components.js";

function renderSummaryTiles(state) {
  const summary = buildOrderStatusSummary(state.orders);
  const vision = calculateVisionMetrics(state);
  const statuses = ["processing", "packed", "in_transit", "delayed", "delivered"];
  const customTiles = [
    {
      label: "Credit holds",
      value: formatNumber(vision.creditHoldOrders),
      status: vision.creditHoldOrders ? "credit_hold" : "ready"
    },
  ];

  return `
    <div class="order-summary-grid">
      ${statuses
        .map(
          (status) => `
            <article class="summary-tile">
              <span class="eyebrow">${escapeHtml(statusText(status))}</span>
              <strong>${formatNumber(summary[status] || 0)}</strong>
              ${statusPill(status)}
            </article>
          `
        )
        .join("")}
      ${customTiles.map((tile) => `
        <article class="summary-tile">
          <span class="eyebrow">${escapeHtml(tile.label)}</span>
          <strong>${escapeHtml(tile.value)}</strong>
          ${statusPill(tile.status)}
        </article>
      `).join("")}
    </div>
  `;
}

function renderOrderRows(orders, state, permissions) {
  const canUpdateSales = permissions.canLogSalesReturns || permissions.canDispatchStock;

  return orders.map((order) => {
    const creditGuard = getCreditGuardForOrder(order, state);
    const canAdvanceOrder = order.status !== "delivered" && canUpdateSales && creditGuard.status !== "credit_hold";
    const creditMeta = creditGuard.limitAmount
      ? `${formatPercent(creditGuard.usagePercent)} used`
      : "No limit set";
    const searchIndex = [
      order.id,
      order.retailer?.name,
      order.region,
      order.priority,
      statusText(order.status),
      statusText(creditGuard.status)
    ]
      .join(" ")
      .toLowerCase();

    return `
      <tr
        data-status="${escapeHtml(order.status)}"
        data-region="${escapeHtml(order.region)}"
        data-search-index="${escapeHtml(searchIndex)}"
      >
        <td>
          <strong>${escapeHtml(order.id)}</strong>
          <div class="muted">Due ${formatDate(order.dueAt)} - ${escapeHtml(statusText(order.paymentType))}</div>
        </td>
        <td>
          ${escapeHtml(order.retailer?.name || "Unknown customer")}
          <div class="muted">${escapeHtml(order.region)} - ${escapeHtml(order.priority)}</div>
        </td>
        <td>${statusPill(order.status)}</td>
        <td>
          ${statusPill(creditGuard.status)}
          <div class="muted">${escapeHtml(creditMeta)}</div>
        </td>
        <td>${formatCurrency(order.total)}</td>
        <td>
          <div class="row-actions">
            ${iconButton({
              iconName: "arrowRight",
              label: creditGuard.status === "credit_hold" ? "Credit hold: cannot advance" : "Move sales order forward",
              className: "js-advance-order",
              disabled: !canAdvanceOrder,
              data: { "order-id": order.id }
            })}
            ${iconButton({
              iconName: "clock",
              label: "Mark delayed",
              className: "js-delay-order",
              disabled: order.status === "delivered" || order.status === "delayed" || !canUpdateSales,
              data: { "order-id": order.id }
            })}
          </div>
        </td>
      </tr>
    `;
  });
}

export function renderOrders({ state }) {
  const orders = getOrdersWithTotals(state);
  const regions = [...new Set(state.orders.map((order) => order.region))].sort();
  const permissions = currentUserPermissions(state);

  return `
    <section class="view orders-view">
      ${renderSummaryTiles(state)}

      <section class="panel orders-layout">
        <div class="toolbar">
          ${panelHeader("Sales order control", "Order status and credit checks for every snack order")}
          <div class="toolbar-group">
            <label class="field">
              <span class="sr-only">Filter by status</span>
              <select id="order-status-filter">
                <option value="all">All statuses</option>
                <option value="processing">Processing</option>
                <option value="packed">Packed</option>
                <option value="in_transit">In transit</option>
                <option value="delayed">Delayed</option>
                <option value="delivered">Delivered</option>
              </select>
            </label>
            <label class="field">
              <span class="sr-only">Filter by region</span>
              <select id="order-region-filter">
                <option value="all">All regions</option>
                ${regions.map((region) => `<option value="${escapeHtml(region)}">${escapeHtml(region)}</option>`).join("")}
              </select>
            </label>
          </div>
        </div>

        ${table(
          ["Sales order", "Customer", "Status", "Credit guard", "Value", ""],
          renderOrderRows(orders, state, permissions),
          "No sales orders available"
        )}
      </section>
    </section>
  `;
}

export function bindOrders({ root, store }) {
  const statusFilter = qs("#order-status-filter", root);
  const regionFilter = qs("#order-region-filter", root);

  function applyFilters() {
    const status = statusFilter.value;
    const region = regionFilter.value;

    qsa("tbody tr", root).forEach((row) => {
      const statusMatches = status === "all" || row.dataset.status === status;
      const regionMatches = region === "all" || row.dataset.region === region;
      row.hidden = !statusMatches || !regionMatches;
    });
  }

  statusFilter.addEventListener("change", applyFilters);
  regionFilter.addEventListener("change", applyFilters);

  qsa(".js-advance-order", root).forEach((button) => {
    button.addEventListener("click", () => {
      store.dispatch({
        type: "ADVANCE_ORDER",
        orderId: button.dataset.orderId,
        message: "Sales order status updated"
      });
    });
  });

  qsa(".js-delay-order", root).forEach((button) => {
    button.addEventListener("click", () => {
      store.dispatch({
        type: "DELAY_ORDER",
        orderId: button.dataset.orderId,
        message: "Sales order marked delayed"
      });
    });
  });
}
