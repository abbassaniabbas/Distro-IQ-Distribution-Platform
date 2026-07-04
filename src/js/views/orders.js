import { buildOrderStatusSummary, getOrdersWithTotals } from "../services/calculations.js";
import { formatCurrency, formatDate, formatNumber, statusText } from "../services/formatters.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { iconButton, panelHeader, statusPill, table } from "../ui/components.js";

function renderSummaryTiles(orders) {
  const summary = buildOrderStatusSummary(orders);
  const statuses = ["processing", "packed", "in_transit", "delayed", "delivered"];

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
    </div>
  `;
}

function renderOrderRows(orders) {
  return orders.map((order) => {
    const searchIndex = [
      order.id,
      order.retailer?.name,
      order.region,
      order.priority,
      statusText(order.status)
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
          <div class="muted">Due ${formatDate(order.dueAt)}</div>
        </td>
        <td>${escapeHtml(order.retailer?.name || "Unknown retailer")}</td>
        <td>${escapeHtml(order.region)}</td>
        <td>${statusPill(order.status)}</td>
        <td>${escapeHtml(order.priority)}</td>
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
            ${iconButton({
              iconName: "clock",
              label: "Mark delayed",
              className: "js-delay-order",
              disabled: order.status === "delivered" || order.status === "delayed",
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

  return `
    <section class="view orders-view">
      ${renderSummaryTiles(state.orders)}

      <section class="panel orders-layout">
        <div class="toolbar">
          ${panelHeader("Order control", "Move orders through processing, packing, dispatch, and delivery")}
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
          ["Order", "Retailer", "Region", "Status", "Priority", "Value", ""],
          renderOrderRows(orders),
          "No orders available"
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
        message: "Order status updated"
      });
    });
  });

  qsa(".js-delay-order", root).forEach((button) => {
    button.addEventListener("click", () => {
      store.dispatch({
        type: "DELAY_ORDER",
        orderId: button.dataset.orderId,
        message: "Order marked delayed"
      });
    });
  });
}
