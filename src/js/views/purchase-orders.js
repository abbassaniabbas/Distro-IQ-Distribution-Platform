import { formatDate, formatDateTime, formatNumber, statusText } from "../services/formatters.js";
import { currentUserRole } from "../services/rbac.js";
import { openInvoiceQuickView } from "../services/invoices.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { iconButton, metricCard, panelHeader, statusPill, table, textButton } from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { requestTextDialog } from "../ui/action-dialog.js";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function requestFor(state, purchaseOrder) {
  return (state.stockRequests || []).find((request) => request.id === purchaseOrder.requestId);
}

function itemSummary(items = []) {
  return items.map((item) => `${formatNumber(item.quantity)} ${item.unit || "units"} ${item.productName}`).join(" · ");
}

function stockAvailable(state, productId) {
  return Number((state.products || []).find((product) => product.id === productId)?.stock || 0);
}

function renderRequestRows(state, role) {
  const requests = [...(state.stockRequests || [])].sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")));

  return requests.map((request) => `
    <tr data-search-index="${escapeHtml(`${request.id} ${request.repName} ${request.status} ${request.priority} ${request.neededBy} ${itemSummary(request.items)}`.toLowerCase())}">
      <td><strong>${escapeHtml(request.id)}</strong><div class="muted">${formatDateTime(request.requestedAt)}</div></td>
      <td><strong>${escapeHtml(request.repName)}</strong><div class="muted">Needed ${formatDate(request.neededBy)}</div></td>
      <td><strong>${formatNumber(request.items?.length || 0)} product${request.items?.length === 1 ? "" : "s"}</strong><div class="muted po-item-summary">${escapeHtml(itemSummary(request.items))}</div></td>
      <td>${statusPill(request.priority || "normal")}</td>
      <td>${statusPill(request.status)}</td>
      <td>
        ${role === "admin" && request.status === "submitted" ? `
          <div class="row-actions">
            ${textButton({ iconName: "orders", label: "Prepare PO", className: "primary js-prepare-purchase-order", data: { "request-id": request.id } })}
            ${iconButton({ iconName: "x", label: "Decline request", className: "js-decline-stock-request", data: { "request-id": request.id } })}
          </div>
        ` : request.purchaseOrderId ? `<strong>${escapeHtml(request.purchaseOrderId)}</strong>` : `<span class="muted">${escapeHtml(request.declineReason || "Awaiting Admin")}</span>`}
      </td>
    </tr>
  `);
}

function renderPurchaseOrderRows(state, role) {
  const purchaseOrders = [...(state.purchaseOrders || [])].sort((a, b) => String(b.preparedAt || "").localeCompare(String(a.preparedAt || "")));

  return purchaseOrders.map((purchaseOrder) => {
    const availabilityProblems = (purchaseOrder.items || []).filter((item) => stockAvailable(state, item.productId) < Number(item.quantity || 0));
    return `
      <tr data-search-index="${escapeHtml(`${purchaseOrder.id} ${purchaseOrder.requestId} ${purchaseOrder.repName} ${purchaseOrder.destination} ${purchaseOrder.status} ${itemSummary(purchaseOrder.items)}`.toLowerCase())}">
        <td><strong>${escapeHtml(purchaseOrder.id)}</strong><div class="muted">Request ${escapeHtml(purchaseOrder.requestId)}</div></td>
        <td><strong>${escapeHtml(purchaseOrder.repName)}</strong><div class="muted">${escapeHtml(purchaseOrder.destination)}</div></td>
        <td><strong>${formatNumber(purchaseOrder.items?.length || 0)} product${purchaseOrder.items?.length === 1 ? "" : "s"}</strong><div class="muted po-item-summary">${escapeHtml(itemSummary(purchaseOrder.items))}</div></td>
        <td>${escapeHtml(statusText(purchaseOrder.paymentType))}<div class="muted">Needed ${formatDate(purchaseOrder.neededBy)}</div></td>
        <td>${statusPill(purchaseOrder.status)}</td>
        <td>
          ${role === "store_keeper" && purchaseOrder.status === "forwarded"
            ? textButton({
                iconName: "truck",
                label: availabilityProblems.length ? "Stock unavailable" : "Issue stock",
                className: availabilityProblems.length ? "js-open-purchase-order disabled" : "primary js-open-purchase-order",
                disabled: Boolean(availabilityProblems.length),
                data: { "purchase-order-id": purchaseOrder.id }
              })
            : purchaseOrder.invoiceId
              ? `<strong>${escapeHtml(purchaseOrder.invoiceId)}</strong>`
              : role === "store_keeper" && availabilityProblems.length
                ? `<span class="status-pill low">Insufficient stock</span>`
                : `<span class="muted">${escapeHtml(purchaseOrder.preparedBy || "Admin")}</span>`}
        </td>
      </tr>
    `;
  });
}

function renderPrepareModal() {
  return `
    <div id="prepare-purchase-order-modal" class="stock-modal-backdrop" tabindex="-1" hidden>
      <section class="stock-modal purchase-order-modal" role="dialog" aria-modal="true" aria-labelledby="prepare-purchase-order-title">
        <header class="stock-modal-header">
          <div><span class="eyebrow">Sales documentation</span><h2 id="prepare-purchase-order-title">Prepare Purchase Order</h2></div>
          ${iconButton({ iconName: "x", label: "Close Purchase Order form", className: "js-close-prepare-purchase-order" })}
        </header>
        <form id="prepare-purchase-order-form" class="form-grid">
          <input type="hidden" name="requestId">
          <div class="purchase-order-request-summary span-full" data-purchase-order-request-summary></div>
          <div class="span-full po-edit-items" data-purchase-order-items></div>
          <label class="field"><span>Payment terms</span><select name="paymentType" required><option value="credit">Credit</option><option value="cash">Cash</option></select></label>
          <label class="field"><span>Delivery destination</span><input name="destination" required placeholder="Representative route or delivery point"></label>
          <label class="field span-full"><span>Admin note</span><textarea name="adminNotes" rows="3" placeholder="Optional instruction for the Store Keeper"></textarea></label>
          <div class="form-actions span-full"><span class="rep-form-message" data-prepare-po-message></span><button class="button primary" type="submit">${icon("arrowRight")}<span>Forward to Store Keeper</span></button></div>
        </form>
      </section>
    </div>
  `;
}

function renderIssueModal() {
  return `
    <div id="issue-purchase-order-modal" class="stock-modal-backdrop" tabindex="-1" hidden>
      <section class="stock-modal purchase-order-modal" role="dialog" aria-modal="true" aria-labelledby="issue-purchase-order-title">
        <header class="stock-modal-header">
          <div><span class="eyebrow">Approved allocation</span><h2 id="issue-purchase-order-title">Issue Purchase Order</h2></div>
          ${iconButton({ iconName: "x", label: "Close issue form", className: "js-close-issue-purchase-order" })}
        </header>
        <form id="issue-purchase-order-form" class="form-grid">
          <input type="hidden" name="purchaseOrderId">
          <div class="purchase-order-request-summary span-full" data-issue-purchase-order-summary></div>
          <div class="span-full po-stock-check" data-issue-purchase-order-items></div>
          <label class="field"><span>Dispatch date</span><input type="date" name="dispatchDate" value="${todayISO()}" required></label>
          <label class="field"><span>Expected arrival</span><input type="date" name="expectedDeliveryAt" value="${todayISO()}" required></label>
          <div class="form-actions span-full"><span class="rep-form-message" data-issue-po-message></span><button class="button primary" type="submit">${icon("truck")}<span>Allocate and dispatch</span></button></div>
        </form>
      </section>
    </div>
  `;
}

export function renderPurchaseOrders({ state }) {
  const role = currentUserRole(state);
  const requests = state.stockRequests || [];
  const purchaseOrders = state.purchaseOrders || [];
  const submitted = requests.filter((request) => request.status === "submitted").length;
  const forwarded = purchaseOrders.filter((purchaseOrder) => purchaseOrder.status === "forwarded").length;
  const issued = purchaseOrders.filter((purchaseOrder) => purchaseOrder.status === "issued").length;

  return `
    <section class="view purchase-orders-view">
      <section class="purchase-orders-hero">
        <div><span class="eyebrow">${role === "admin" ? "Admin portal" : role === "store_keeper" ? "Store Keeper queue" : "CEO oversight"}</span><h2>Stock requests and Purchase Orders</h2><p>${role === "admin" ? "Prepare sales documentation and forward approved stock requests for allocation." : role === "store_keeper" ? "Allocate factory stock only from Purchase Orders forwarded by Admin." : "Follow each request from submission through factory issue."}</p></div>
        <span class="purchase-orders-hero-icon">${icon("orders")}</span>
      </section>
      <div class="metric-grid purchase-order-metrics">
        ${metricCard({ label: "New requests", value: formatNumber(submitted), meta: "Waiting for Admin review", iconName: "orders" })}
        ${metricCard({ label: "Forwarded", value: formatNumber(forwarded), meta: "Waiting for Store Keeper", iconName: "arrowRight" })}
        ${metricCard({ label: "Issued", value: formatNumber(issued), meta: "Allocated and dispatched", iconName: "check" })}
      </div>
      ${role === "store_keeper" ? "" : `<section class="panel">${panelHeader("Representative stock requests", role === "admin" ? "Review each request before preparing its Purchase Order" : "Original requests and their current status")}${table(["Request", "Representative", "Products", "Priority", "Status", "Action"], renderRequestRows(state, role), "No representative stock requests have been submitted")}</section>`}
      <section class="panel">${panelHeader(role === "store_keeper" ? "Forwarded Purchase Orders" : "Purchase Order register", role === "store_keeper" ? "Verify availability, then allocate and dispatch the listed products" : "Documents forwarded to the Store Keeper and their issue status")}${table(["Purchase Order", "Representative", "Products", "Terms", "Status", role === "store_keeper" ? "Allocation" : "Record"], renderPurchaseOrderRows(state, role), "No Purchase Orders have been prepared")}</section>
      ${role === "admin" ? renderPrepareModal() : ""}
      ${role === "store_keeper" ? renderIssueModal() : ""}
    </section>
  `;
}

export function bindPurchaseOrders({ root, store }) {
  const role = currentUserRole(store.getState());

  if (role === "admin") {
    const modal = qs("#prepare-purchase-order-modal", root);
    const form = qs("#prepare-purchase-order-form", root);
    const message = qs("[data-prepare-po-message]", root);
    const close = () => { if (modal) modal.hidden = true; };

    qsa(".js-prepare-purchase-order", root).forEach((button) => button.addEventListener("click", () => {
      const request = (store.getState().stockRequests || []).find((item) => item.id === button.dataset.requestId);
      if (!request || !modal || !form) return;
      form.reset();
      form.elements.requestId.value = request.id;
      qs("[data-purchase-order-request-summary]", modal).innerHTML = `<strong>${escapeHtml(request.id)} · ${escapeHtml(request.repName)}</strong><span>Needed ${formatDate(request.neededBy)} · ${escapeHtml(statusText(request.priority))}</span>`;
      qs("[data-purchase-order-items]", modal).innerHTML = request.items.map((item) => `<label class="po-edit-item"><span>${escapeHtml(item.productName)} <small>${escapeHtml(item.sku)}</small></span><span><input type="number" min="1" step="1" name="quantity-${escapeHtml(item.productId)}" value="${escapeHtml(item.quantity)}" required><small>${escapeHtml(item.unit)}</small></span></label>`).join("");
      if (message) message.textContent = "";
      modal.hidden = false;
    }));
    qsa(".js-close-prepare-purchase-order", root).forEach((button) => button.addEventListener("click", close));
    modal?.addEventListener("click", (event) => { if (event.target === modal) close(); });
    qsa(".js-decline-stock-request", root).forEach((button) => button.addEventListener("click", async () => {
      const reason = await requestTextDialog({
        title: "Decline stock request",
        message: "Enter the reason this stock request cannot be approved. The Sales Representative will see this decision.",
        label: "Reason for declining",
        placeholder: "Explain why the request cannot be approved",
        confirmLabel: "Decline request"
      });
      if (!reason?.trim()) return;
      store.dispatch({ type: "DECLINE_STOCK_REQUEST", requestId: button.dataset.requestId, reason, message: "Stock request declined" });
    }));
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const state = store.getState();
      const formData = new FormData(form);
      const requestId = String(formData.get("requestId") || "");
      const request = (state.stockRequests || []).find((item) => item.id === requestId);
      if (!request) return;
      const items = request.items.map((item) => ({ productId: item.productId, quantity: Number(formData.get(`quantity-${item.productId}`) || 0) }));
      if (!form.reportValidity() || items.some((item) => item.quantity <= 0)) {
        if (message) message.textContent = "Please complete the required fields";
        return;
      }
      store.dispatch({ type: "PREPARE_PURCHASE_ORDER", requestId, items, paymentType: formData.get("paymentType"), destination: formData.get("destination"), adminNotes: formData.get("adminNotes"), message: "Purchase Order forwarded to Store Keeper" });
      close();
    });
  }

  if (role === "store_keeper") {
    const modal = qs("#issue-purchase-order-modal", root);
    const form = qs("#issue-purchase-order-form", root);
    const message = qs("[data-issue-po-message]", root);
    const close = () => { if (modal) modal.hidden = true; };

    qsa(".js-open-purchase-order", root).forEach((button) => button.addEventListener("click", () => {
      const state = store.getState();
      const purchaseOrder = (state.purchaseOrders || []).find((item) => item.id === button.dataset.purchaseOrderId);
      if (!purchaseOrder || !modal || !form) return;
      form.reset();
      form.elements.purchaseOrderId.value = purchaseOrder.id;
      form.elements.dispatchDate.value = todayISO();
      form.elements.expectedDeliveryAt.value = purchaseOrder.neededBy >= todayISO() ? purchaseOrder.neededBy : todayISO();
      qs("[data-issue-purchase-order-summary]", modal).innerHTML = `<strong>${escapeHtml(purchaseOrder.id)} · ${escapeHtml(purchaseOrder.repName)}</strong><span>${escapeHtml(purchaseOrder.destination)} · ${escapeHtml(statusText(purchaseOrder.paymentType))}</span>`;
      qs("[data-issue-purchase-order-items]", modal).innerHTML = purchaseOrder.items.map((item) => { const available = stockAvailable(state, item.productId); return `<div class="po-stock-row"><span><strong>${escapeHtml(item.productName)}</strong><small>${escapeHtml(item.sku)}</small></span><span><strong>${formatNumber(item.quantity)} requested</strong><small>${formatNumber(available)} available</small></span>${statusPill(available >= item.quantity ? "available" : "low")}</div>`; }).join("");
      if (message) message.textContent = "";
      modal.hidden = false;
    }));
    qsa(".js-close-issue-purchase-order", root).forEach((button) => button.addEventListener("click", close));
    modal?.addEventListener("click", (event) => { if (event.target === modal) close(); });
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const state = store.getState();
      const formData = new FormData(form);
      const purchaseOrder = (state.purchaseOrders || []).find((item) => item.id === formData.get("purchaseOrderId"));
      if (!purchaseOrder || !form.reportValidity()) return;
      if (purchaseOrder.items.some((item) => stockAvailable(state, item.productId) < item.quantity)) {
        if (message) message.textContent = "The factory does not have enough stock to complete this Purchase Order.";
        return;
      }
      const invoiceIds = new Set((state.invoices || []).map((invoice) => invoice.id));
      const dispatchIds = new Set((state.stockTransactions || []).map((transaction) => transaction.dispatchId).filter(Boolean));
      store.dispatch({ type: "RECORD_STOCK_DISPATCH", items: purchaseOrder.items.map((item) => ({ productId: item.productId, quantity: item.quantity })), recipientType: "Sales Representative", recipientName: purchaseOrder.repName, paymentType: purchaseOrder.paymentType, destination: purchaseOrder.destination, dispatchDate: formData.get("dispatchDate"), expectedDeliveryAt: formData.get("expectedDeliveryAt"), staffName: "Store Keeper", message: "Purchase Order stock issued" });
      const nextState = store.getState();
      const invoice = (nextState.invoices || []).find((item) => !invoiceIds.has(item.id));
      const transaction = (nextState.stockTransactions || []).find((item) => item.dispatchId && !dispatchIds.has(item.dispatchId));
      if (!invoice || !transaction) {
        if (message) message.textContent = "The dispatch could not be recorded. Check the stock and form details.";
        return;
      }
      store.dispatch({ type: "MARK_PURCHASE_ORDER_ISSUED", purchaseOrderId: purchaseOrder.id, dispatchId: transaction.dispatchId, invoiceId: invoice.id, message: "Purchase Order issued" });
      close();
      openInvoiceQuickView(invoice, store.getState());
    });
  }
}
