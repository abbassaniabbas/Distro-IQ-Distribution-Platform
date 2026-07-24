import {
  buildOrderStatusSummary,
  getCreditGuardForOrder,
  getOrdersWithTotals
} from "../services/calculations.js?v=20260722";
import { formatCurrency, formatDate, formatNumber, formatPercent, statusText } from "../services/formatters.js";
import { currentUserPermissions, currentUserRole } from "../services/rbac.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { iconButton, panelHeader, statusPill, table } from "../ui/components.js?v=20260724b";
import { icon } from "../ui/icons.js";
import { bindCeoDataDeletion, ceoDeleteControls, ceoSelectionCell } from "../ui/ceo-data-deletion.js?v=20260724b";

const ORDER_PAGE_SIZE = 10;
const ORDER_STATUSES = ["in_transit", "delayed", "delivered"];
const DELAY_REASONS = [
  "Missed expected delivery date",
  "Traffic / route disruption",
  "Vehicle issue",
  "Customer unavailable",
  "Weather disruption",
  "Documentation / loading issue",
  "Other"
];

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function orderExpectedDate(order) {
  return dateOnly(order.expectedDeliveryAt || (order.source === "factory_dispatch" ? order.dueAt : ""));
}

function orderDaysLate(order, today = new Date().toISOString().slice(0, 10)) {
  const expected = order.originalExpectedDeliveryAt || orderExpectedDate(order);
  const expectedTime = Date.parse(`${dateOnly(expected)}T00:00:00Z`);
  const todayTime = Date.parse(`${dateOnly(today)}T00:00:00Z`);

  if (Number.isNaN(expectedTime) || Number.isNaN(todayTime)) return 0;
  return Math.max(0, Math.floor((todayTime - expectedTime) / 86400000));
}

function renderSummaryTiles(orders, state) {
  const summary = buildOrderStatusSummary(orders);
  const creditOrders = orders.filter((order) => getCreditGuardForOrder(order, state).status === "credit_hold").length;
  const customTiles = [
    {
      label: "Credit holds",
      value: formatNumber(creditOrders),
      status: creditOrders ? "credit_hold" : "ready"
    },
  ];

  return `
    <div class="order-summary-grid">
      ${ORDER_STATUSES
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

function renderDelayAttentionIcon(orders) {
  const delayedOrders = orders.filter((order) => order.status === "delayed");
  if (!delayedOrders.length) return "";

  const longestDelay = Math.max(...delayedOrders.map((order) => orderDaysLate(order)), 0);
  const delayedLabel = `${formatNumber(delayedOrders.length)} delayed order${delayedOrders.length === 1 ? "" : "s"}`;
  const longestDelayLabel = `${formatNumber(longestDelay)} day${longestDelay === 1 ? "" : "s"}`;

  return `
    <span class="order-delay-attention">
      <span
        class="order-delay-attention-icon"
        tabindex="0"
        role="img"
        aria-label="Delivery attention. ${escapeHtml(delayedLabel)}. Longest delay ${escapeHtml(longestDelayLabel)}."
      >
        ${icon("alert")}
      </span>
      <span class="order-delay-attention-tooltip" role="tooltip">
        <span class="eyebrow">Delivery attention</span>
        <strong>${escapeHtml(delayedLabel)}</strong>
        <p>Missed arrival dates are marked automatically and kept in the activity history.</p>
        <span>Longest delay: <strong>${escapeHtml(longestDelayLabel)}</strong></span>
      </span>
    </span>
  `;
}

function renderDelayMeta(order) {
  if (order.status !== "delayed") return "";

  const daysLate = orderDaysLate(order);

  return `
    <div class="order-delay-meta">
      <strong>${formatNumber(daysLate)} day${daysLate === 1 ? "" : "s"} late</strong>
    </div>
  `;
}

function renderDelayModal() {
  return `
    <div id="order-delay-modal" class="stock-modal-backdrop" tabindex="-1" hidden>
      <section class="stock-modal order-delay-modal" role="dialog" aria-modal="true" aria-labelledby="order-delay-title">
        <header class="stock-modal-header">
          <div>
            <span class="eyebrow">Delayed delivery</span>
            <h2 id="order-delay-title">Delay details</h2>
          </div>
          ${iconButton({ iconName: "x", label: "Close delay details", className: "js-close-order-delay" })}
        </header>
        <div id="order-delay-content"></div>
      </section>
    </div>
  `;
}

function renderDelayDetails(order, canManageOrderFlow) {
  const selectedReason = order.delayReason || "Missed expected delivery date";
  const expectedAt = orderExpectedDate(order);
  const originalExpectedAt = dateOnly(order.originalExpectedDeliveryAt || expectedAt);

  return `
    <div class="order-delay-summary">
      <div><span>Order</span><strong>${escapeHtml(order.id)}</strong></div>
      <div><span>Customer</span><strong>${escapeHtml(order.retailer?.name || order.customerName || "Customer")}</strong></div>
      <div><span>Original arrival</span><strong>${escapeHtml(formatDate(originalExpectedAt))}</strong></div>
      <div><span>Current ETA</span><strong>${escapeHtml(formatDate(expectedAt))}</strong></div>
      <div><span>Delay</span><strong>${formatNumber(orderDaysLate(order))} day${orderDaysLate(order) === 1 ? "" : "s"}</strong></div>
      <div><span>Detected</span><strong>${escapeHtml(order.delaySource === "manual" ? "Manual" : "Automatic")}</strong></div>
    </div>
    <form id="order-delay-form" class="manager-form-grid" novalidate>
      <input type="hidden" name="orderId" value="${escapeHtml(order.id)}">
      <label class="field">
        <span>Reason</span>
        <select name="reason" required ${canManageOrderFlow ? "" : "disabled"}>
          ${DELAY_REASONS.map((reason) => `<option value="${escapeHtml(reason)}" ${reason === selectedReason ? "selected" : ""}>${escapeHtml(reason)}</option>`).join("")}
        </select>
      </label>
      <label class="field">
        <span>Revised expected arrival</span>
        <input name="revisedExpectedDeliveryAt" type="date" value="${escapeHtml(expectedAt)}" ${canManageOrderFlow ? "" : "disabled"}>
      </label>
      <label class="field span-full">
        <span>Follow-up note</span>
        <textarea name="note" rows="4" maxlength="500" placeholder="Carrier update, customer contact, or recovery plan" ${canManageOrderFlow ? "" : "disabled"}>${escapeHtml(order.delayNote || "")}</textarea>
      </label>
      ${order.delayUpdatedBy ? `<p class="muted span-full">Last updated by ${escapeHtml(order.delayUpdatedBy)} on ${escapeHtml(formatDate(dateOnly(order.delayUpdatedAt)))}</p>` : ""}
      ${canManageOrderFlow ? `
        <div class="manager-form-actions span-full">
          <button class="button primary" type="submit">Save delay plan</button>
        </div>
        <span id="order-delay-message" class="field-error span-full" role="status"></span>
      ` : '<p class="muted span-full">Only the CEO can change delayed-order details.</p>'}
    </form>
  `;
}

function renderOrderRows(orders, state, permissions) {
  const canManageOrderFlow = currentUserRole(state) === "ceo";

  return orders.map((order, index) => {
    const creditGuard = getCreditGuardForOrder(order, state);
    const canAdvanceOrder = order.status !== "delivered" && canManageOrderFlow;
    const creditMeta = creditGuard.limitAmount
      ? `${formatPercent(creditGuard.usagePercent)} used`
      : "No limit set";
    const expectedAt = orderExpectedDate(order);
    const scheduleLabel = expectedAt
      ? `Expected ${formatDate(expectedAt)}`
      : `Payment due ${formatDate(order.dueAt)}`;
    const retailer = (state.retailers || []).find((item) => item.id === order.retailerId) || order.retailer;
    const transaction = (state.stockTransactions || []).find((item) => item.id === order.transactionId);
    const customerName = retailer?.name || order.customerName || "Unknown customer";
    const searchValues = [
      order.id,
      order.transactionId,
      customerName,
      retailer?.id,
      retailer?.address,
      retailer?.city,
      retailer?.stateName,
      retailer?.region,
      retailer?.channel,
      retailer?.contact,
      retailer?.contactPhone,
      order.region,
      order.priority,
      statusText(order.status),
      statusText(creditGuard.status),
      statusText(order.paymentType),
      statusText(order.paymentStatus),
      order.customerType,
      order.repName,
      order.staffName,
      transaction?.recordedBy,
      transaction?.staffResponsible,
      transaction?.recipientName,
      transaction?.dispatchDestination,
      scheduleLabel,
      expectedAt,
      order.dueAt,
      order.source,
      order.delayReason,
      order.delayNote,
      ...(order.items || []).flatMap((item) => [item.productName, item.productId])
    ].map((value) => String(value || "").trim()).filter(Boolean);
    const searchSuggestions = [...new Set(searchValues)];
    const searchIndex = searchValues.join(" ").toLowerCase();

    return `
      <tr ${index >= ORDER_PAGE_SIZE ? "hidden " : ""}
        data-order-row
        data-status="${escapeHtml(order.status)}"
        data-region="${escapeHtml(order.region)}"
        data-search-index="${escapeHtml(searchIndex)}"
        data-search-suggestions="${escapeHtml(JSON.stringify(searchSuggestions))}"
      >
        ${canManageOrderFlow ? ceoSelectionCell("orders", order.id, `sales order ${order.id}`) : ""}
        <td>
          <strong>${escapeHtml(order.id)}</strong>
          <div class="muted">${escapeHtml(scheduleLabel)} - ${escapeHtml(statusText(order.paymentType))}</div>
        </td>
        <td>
          ${escapeHtml(customerName)}
          <div class="muted">${escapeHtml(order.region)} - ${escapeHtml(order.priority)}</div>
        </td>
        <td>
          ${statusPill(order.status)}
          ${renderDelayMeta(order)}
        </td>
        <td>
          ${statusPill(creditGuard.status)}
          <div class="muted">${escapeHtml(creditMeta)}</div>
        </td>
        <td>${formatCurrency(order.total)}</td>
        <td>
          <div class="row-actions">
            <label class="order-status-select">
              <span class="sr-only">Set sales order step</span>
              <select class="js-order-status-select" data-order-id="${escapeHtml(order.id)}" data-current-status="${escapeHtml(order.status)}" ${canManageOrderFlow ? "" : "disabled"}>
                ${ORDER_STATUSES.map((status) => `
                  <option value="${escapeHtml(status)}" ${order.status === status ? "selected" : ""}>${escapeHtml(statusText(status))}</option>
                `).join("")}
              </select>
            </label>
            ${iconButton({
              iconName: "arrowRight",
              label: "Move sales order forward",
              className: "js-advance-order",
              disabled: !canAdvanceOrder,
              data: { "order-id": order.id }
            })}
            ${order.status === "delayed"
              ? iconButton({
                  iconName: "clock",
                  label: canManageOrderFlow ? "Review delay plan" : "View delay details",
                  className: "js-review-order-delay",
                  data: { "order-id": order.id }
                })
              : iconButton({
                  iconName: "clock",
                  label: "Mark delayed",
                  className: "js-delay-order",
                  disabled: order.status === "delivered" || !canManageOrderFlow,
                  data: { "order-id": order.id }
                })}
          </div>
        </td>
      </tr>
    `;
  });
}

export function renderOrders({ state }) {
  const orders = getOrdersWithTotals(state).sort((a, b) => {
    if (a.status === "delayed" && b.status !== "delayed") return -1;
    if (a.status !== "delayed" && b.status === "delayed") return 1;
    return String(a.expectedDeliveryAt || a.dueAt || "").localeCompare(String(b.expectedDeliveryAt || b.dueAt || ""));
  });
  const regions = [...new Set(orders.map((order) => order.region).filter(Boolean))].sort();
  const permissions = currentUserPermissions(state);

  return `
    <section class="view orders-view">
      ${renderSummaryTiles(orders, state)}

      <section class="panel orders-layout">
        <div class="toolbar">
          ${panelHeader("Sales order control", "")}
          <div class="toolbar-group">
            <label class="field">
              <span class="sr-only">Filter by status</span>
              <select id="order-status-filter">
                <option value="all">All statuses</option>
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
            ${renderDelayAttentionIcon(orders)}
          </div>
        </div>

        ${currentUserRole(state) === "ceo" ? ceoDeleteControls({
          scope: "orders"
        }) : ""}
        ${table(
          ["Sales order", "Customer", "Status", "Credit guard", "Value", ""],
          renderOrderRows(orders, state, permissions),
          "No sales orders available",
          { selectionScope: currentUserRole(state) === "ceo" ? "orders" : "" }
        )}
        <div class="activity-pagination" data-order-pagination hidden>
          <button class="button" type="button" data-order-page="prev">Previous</button>
          <span data-order-page-status>Page 1 of 1</span>
          <button class="button" type="button" data-order-page="next">Next</button>
        </div>
      </section>
      ${renderDelayModal()}
    </section>
  `;
}

export function bindOrders({ root, store, signal }) {
  bindCeoDataDeletion({ root, store, signal });
  const statusFilter = qs("#order-status-filter", root);
  const regionFilter = qs("#order-region-filter", root);
  const globalSearch = qs("#global-search", document);
  const delayModal = qs("#order-delay-modal", root);
  const delayContent = qs("#order-delay-content", root);
  function closeDelayModal() {
    if (delayModal) delayModal.hidden = true;
  }

  function openDelayModal(orderId) {
    const state = store.getState();
    const order = getOrdersWithTotals(state).find((item) => item.id === orderId);
    const canManageOrderFlow = currentUserRole(state) === "ceo";

    if (!order || !delayModal || !delayContent) return;

    delayContent.innerHTML = renderDelayDetails(order, canManageOrderFlow);
    delayModal.hidden = false;
    delayModal.focus();

    qs("#order-delay-form", delayContent)?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!canManageOrderFlow) return;

      const formData = new FormData(event.currentTarget);
      const reason = String(formData.get("reason") || "").trim();
      const message = qs("#order-delay-message", delayContent);

      if (!reason) {
        if (message) message.textContent = "Choose a reason for the delay.";
        return;
      }

      store.dispatch({
        type: "UPDATE_ORDER_DELAY_DETAILS",
        orderId: formData.get("orderId"),
        reason,
        revisedExpectedDeliveryAt: formData.get("revisedExpectedDeliveryAt"),
        note: formData.get("note"),
        message: "Delay plan updated"
      });
      closeDelayModal();
    }, { signal });
  }

  function setupOrderPagination() {
    const rows = qsa("[data-order-row]", root);
    const pagination = qs("[data-order-pagination]", root);
    const status = qs("[data-order-page-status]", root);
    const prevButton = qs('[data-order-page="prev"]', root);
    const nextButton = qs('[data-order-page="next"]', root);
    let currentPage = 1;

    if (!rows.length || !pagination || !status) return;

    function matchedRows() {
      const statusValue = statusFilter.value;
      const regionValue = regionFilter.value;
      const query = String(globalSearch?.value || "").trim().toLowerCase();

      return rows.filter((row) => {
        const statusMatches = statusValue === "all" || row.dataset.status === statusValue;
        const regionMatches = regionValue === "all" || row.dataset.region === regionValue;
        const searchMatches = !query || String(row.dataset.searchIndex || "").includes(query);

        return statusMatches && regionMatches && searchMatches;
      });
    }

    function applyPage() {
      const visibleRows = matchedRows();
      const totalPages = Math.max(1, Math.ceil(visibleRows.length / ORDER_PAGE_SIZE));

      currentPage = Math.min(Math.max(1, currentPage), totalPages);
      rows.forEach((row) => {
        row.hidden = true;
      });
      visibleRows.forEach((row, index) => {
        const page = Math.floor(index / ORDER_PAGE_SIZE) + 1;
        row.hidden = page !== currentPage;
      });

      pagination.hidden = visibleRows.length <= ORDER_PAGE_SIZE;
      status.textContent = `${formatNumber(visibleRows.length)} order${visibleRows.length === 1 ? "" : "s"} - page ${formatNumber(currentPage)} of ${formatNumber(totalPages)}`;
      if (prevButton) prevButton.disabled = currentPage <= 1;
      if (nextButton) nextButton.disabled = currentPage >= totalPages;
    }

    prevButton?.addEventListener("click", () => {
      currentPage -= 1;
      applyPage();
    });
    nextButton?.addEventListener("click", () => {
      currentPage += 1;
      applyPage();
    });

    const resetPage = () => {
      currentPage = 1;
      applyPage();
    };

    statusFilter.addEventListener("change", resetPage);
    regionFilter.addEventListener("change", resetPage);
    globalSearch?.addEventListener("input", resetPage, { signal });

    window.setTimeout(applyPage, 0);
  }

  setupOrderPagination();

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
      openDelayModal(button.dataset.orderId);
    });
  });

  qsa(".js-review-order-delay", root).forEach((button) => {
    button.addEventListener("click", () => openDelayModal(button.dataset.orderId));
  });

  delayModal?.addEventListener("click", (event) => {
    if (event.target === delayModal || event.target.closest(".js-close-order-delay")) closeDelayModal();
  });

  delayModal?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDelayModal();
  });

  qsa(".js-order-status-select", root).forEach((select) => {
    select.addEventListener("change", () => {
      if (select.value === "delayed" && select.dataset.currentStatus !== "delayed") {
        select.value = select.dataset.currentStatus || "in_transit";
        openDelayModal(select.dataset.orderId);
        return;
      }

      store.dispatch({
        type: "SET_ORDER_STATUS",
        orderId: select.dataset.orderId,
        status: select.value,
        message: "Sales order step updated"
      });
    });
  });
}
