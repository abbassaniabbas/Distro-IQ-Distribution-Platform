import { assignmentOutstanding, getFinancialSalesLines, stockCategoryIdForProduct } from "../services/calculations.js";
import { formatCurrency, formatDate, formatDateTime, formatNumber, statusText } from "../services/formatters.js";
import { currentUserRole, salesRepresentativeAccounts } from "../services/rbac.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { iconButton, metricCard, panelHeader, statusPill, table, textButton } from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { requestTextDialog } from "../ui/action-dialog.js";

const SECTIONS = [
  ["approvals", "Approval centre"],
  ["reconciliation", "Daily reconciliation"],
  ["documents", "Document centre"],
  ["performance", "Rep performance"],
  ["exceptions", "Exception alerts"],
  ["procurement", "Procurement"],
  ["audit", "Admin audit"]
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function activeSection(role) {
  if (role === "store_keeper") return "procurement";
  const params = new URLSearchParams((window.location.hash.split("?")[1] || ""));
  const requested = params.get("section") || "approvals";
  return SECTIONS.some(([id]) => id === requested) ? requested : "approvals";
}

function latestReportFor(state, rep) {
  return [...(state.salesReports || [])]
    .filter((report) => report.repUserId === rep.userId || normalized(report.repName) === normalized(rep.name))
    .sort((a, b) => String(b.submittedAt || b.reportDate || "").localeCompare(String(a.submittedAt || a.reportDate || "")))[0];
}

function repAssignments(state, rep) {
  return (state.stockAssignments || []).filter((assignment) => (
    assignment.repUserId === rep.userId || normalized(assignment.repName) === normalized(rep.name)
  ));
}

function repSalesToday(state, rep) {
  return (state.stockTransactions || []).filter((transaction) => (
    normalized(transaction.type) === "sale" &&
    String(transaction.date || transaction.createdAt || "").slice(0, 10) === todayISO() &&
    (transaction.repUserId === rep.userId || normalized(transaction.recordedBy) === normalized(rep.name))
  ));
}

function creditForRep(state, rep) {
  return (state.creditLimits || []).find((limit) => (
    limit.repUserId === rep.userId || normalized(limit.partyName) === normalized(rep.name)
  ));
}

function renderSubnav(active, role) {
  if (role === "store_keeper") return "";
  return `<nav class="subtab-nav admin-operations-subnav" aria-label="Admin operations sections">
    ${SECTIONS.map(([id, label]) => `<a class="subtab-link ${id === active ? "is-active" : ""}" href="#/admin-operations?section=${id}" aria-current="${id === active ? "page" : "false"}">${escapeHtml(label)}</a>`).join("")}
  </nav>`;
}

function renderApprovalCentre(state, role) {
  const corrections = [...(state.correctionRequests || [])].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const reports = [...(state.salesReports || [])]
    .filter((report) => !["reviewed", "flagged"].includes(report.status))
    .sort((a, b) => String(b.submittedAt || "").localeCompare(String(a.submittedAt || "")));
  const requests = [...(state.stockRequests || [])].filter((request) => request.status === "submitted");
  const returns = [...(state.stockTransactions || [])]
    .filter((transaction) => normalized(transaction.type) === "return" && transaction.returnReviewStatus === "pending")
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const mayAct = ["admin", "ceo"].includes(role);
  const rows = [
    ...corrections.map((request) => ({
      id: request.id,
      type: `${statusText(request.recordType)} correction`,
      owner: request.requestedBy,
      submitted: request.createdAt,
      detail: `${request.productName}: ${formatNumber(request.originalQuantity)} → ${formatNumber(request.requestedQuantity)}`,
      status: request.status,
      actions: mayAct && request.status === "pending" ? `<div class="row-actions">${iconButton({ iconName: "check", label: "Approve correction", className: "js-admin-approve-correction", data: { "request-id": request.id } })}${iconButton({ iconName: "x", label: "Reject correction", className: "js-admin-reject-correction", data: { "request-id": request.id } })}</div>` : ""
    })),
    ...reports.map((report) => ({
      id: report.id,
      type: "Sales report",
      owner: report.repName,
      submitted: report.submittedAt || report.reportDate,
      detail: `${formatNumber(report.unitsSold)} units · ${formatCurrency(report.salesAmount)}`,
      status: report.status || "submitted",
      actions: mayAct ? `<div class="row-actions">${iconButton({ iconName: "check", label: "Mark report reviewed", className: "js-admin-review-report", data: { "report-id": report.id } })}${iconButton({ iconName: "alert", label: "Flag report", className: "js-admin-flag-report", data: { "report-id": report.id } })}</div>` : ""
    })),
    ...returns.map((transaction) => ({
      id: transaction.id,
      type: "Customer return",
      owner: transaction.recordedBy,
      submitted: transaction.createdAt || transaction.date,
      detail: `${formatNumber(transaction.quantity)} ${transaction.productName} · ${transaction.partyName}`,
      status: transaction.returnReviewStatus,
      actions: mayAct ? `<div class="row-actions">${iconButton({ iconName: "check", label: "Review customer return", className: "js-admin-review-return", data: { "transaction-id": transaction.id } })}${iconButton({ iconName: "alert", label: "Flag customer return", className: "js-admin-flag-return", data: { "transaction-id": transaction.id } })}</div>` : ""
    })),
    ...requests.map((request) => ({
      id: request.id,
      type: "Stock request",
      owner: request.repName,
      submitted: request.requestedAt,
      detail: `${request.items?.length || 0} products · Needed ${formatDate(request.neededBy)}`,
      status: request.status,
      actions: role === "admin" ? `<a class="button compact" href="#/purchase-orders">${icon("arrowRight")}<span>Open</span></a>` : ""
    }))
  ];
  const pending = rows.filter((row) => ["pending", "submitted"].includes(row.status)).length;

  return `
    <div class="metric-grid admin-operations-metrics">
      ${metricCard({ label: "Awaiting decision", value: formatNumber(pending), meta: "Corrections, reports and requests", iconName: "clock" })}
      ${metricCard({ label: "Corrections", value: formatNumber(corrections.filter((item) => item.status === "pending").length), meta: "Operational edit requests", iconName: "refresh" })}
      ${metricCard({ label: "Returns and stock", value: formatNumber(returns.length + requests.length), meta: "Returns to review and stock requests", iconName: "package" })}
    </div>
    <section class="panel">${panelHeader("Approval centre", "One queue for stock requests, dispatch or sales corrections, and submitted sales reports")}
      ${table(["Record", "Type", "Submitted by", "Details", "Status", "Decision"], rows.map((row) => `<tr><td><strong>${escapeHtml(row.id)}</strong><div class="muted">${formatDateTime(row.submitted)}</div></td><td>${escapeHtml(row.type)}</td><td>${escapeHtml(row.owner || "Team member")}</td><td>${escapeHtml(row.detail)}</td><td>${statusPill(row.status)}</td><td>${row.actions || "<span class=\"muted\">Recorded</span>"}</td></tr>`), "No items are waiting for review")}
    </section>`;
}

function renderReconciliation(state) {
  const reps = salesRepresentativeAccounts(state);
  const rows = reps.map((rep) => {
    const assignments = repAssignments(state, rep);
    const sales = repSalesToday(state, rep);
    const units = sales.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const inHand = assignments.reduce((sum, item) => sum + assignmentOutstanding(item), 0);
    const shortage = assignments.filter((item) => item.status === "variance").reduce((sum, item) => sum + assignmentOutstanding(item), 0);
    const report = latestReportFor(state, rep);
    const reportedToday = String(report?.reportDate || report?.submittedAt || "").slice(0, 10) === todayISO();
    const cash = reportedToday
      ? Number(report.cashAmount || 0)
      : sales.filter((item) => !normalized(item.paymentType).includes("credit")).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const credit = reportedToday
      ? Number(report.creditAmount || 0)
      : sales.filter((item) => normalized(item.paymentType).includes("credit")).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return `<tr><td><strong>${escapeHtml(rep.name)}</strong><div class="muted">${escapeHtml(rep.email || "")}</div></td><td>${formatNumber(inHand)}</td><td>${formatNumber(units)}</td><td>${formatCurrency(cash)}</td><td>${formatCurrency(credit)}</td><td>${formatNumber(shortage)}</td><td>${statusPill(reportedToday ? "submitted" : "missing")}</td></tr>`;
  });
  return `<section class="panel">${panelHeader("Daily reconciliation", "Today’s representative stock, sales, cash, credit and shortages are shown together")}${table(["Representative", "Stock in hand", "Units sold", "Cash submitted", "Credit sales", "Shortage", "Daily report"], rows, "No sales representatives are available for reconciliation")}</section>`;
}

function documentRows(state) {
  const documents = [
    ...(state.purchaseOrders || []).map((item) => ({ id: item.id, type: "Purchase Order", party: item.repName, date: item.preparedAt, status: item.status, route: "purchase-orders" })),
    ...(state.invoices || []).map((item) => ({ id: item.id, type: "Invoice", party: item.customerName || item.partyName || item.repName, date: item.createdAt || item.date, status: item.status || item.paymentStatus, route: "invoices" })),
    ...(state.orders || []).filter((item) => item.source === "factory_dispatch").map((item) => ({ id: item.id, type: "Delivery Note", party: item.customerName || item.repName, date: item.createdAt, status: item.status, route: "orders" })),
    ...(state.salesReports || []).map((item) => ({ id: item.id, type: "Sales Report", party: item.repName, date: item.submittedAt || item.reportDate, status: item.status, route: "activity-log?tab=submitted-reports" }))
  ];
  return documents.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

function renderDocuments(state) {
  const rows = documentRows(state).map((item) => `<tr><td><strong>${escapeHtml(item.id)}</strong></td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.party || "Not assigned")}</td><td>${formatDateTime(item.date)}</td><td>${statusPill(item.status || "recorded")}</td><td><a class="icon-button" href="#/${escapeHtml(item.route)}" title="Open ${escapeHtml(item.type)}" aria-label="Open ${escapeHtml(item.type)}">${icon("eye")}</a></td></tr>`);
  return `<section class="panel">${panelHeader("Document centre", "Purchase Orders, invoices, delivery notes and sales reports in one register")}${table(["Document", "Type", "Related party", "Created", "Status", "Open"], rows, "No operational documents have been created")}</section>`;
}

function renderPerformance(state) {
  const lines = getFinancialSalesLines(state);
  const rows = salesRepresentativeAccounts(state).map((rep) => {
    const repLines = lines.filter((line) => normalized(line.repName) === normalized(rep.name));
    const assigned = repAssignments(state, rep);
    const credit = creditForRep(state, rep);
    const report = latestReportFor(state, rep);
    const reportingStatus = report ? `${statusText(report.status || "submitted")} · ${formatDate(report.reportDate || String(report.submittedAt || "").slice(0, 10))}` : "No report";
    return `<tr><td><strong>${escapeHtml(rep.name)}</strong></td><td>${formatNumber(assigned.reduce((sum, item) => sum + assignmentOutstanding(item), 0))}</td><td>${formatNumber(repLines.reduce((sum, item) => sum + Number(item.quantity || 0), 0))}</td><td>${formatCurrency(repLines.reduce((sum, item) => sum + Number(item.revenue || 0), 0))}</td><td>${formatCurrency(Number(credit?.balance || 0))}</td><td>${escapeHtml(reportingStatus)}</td></tr>`;
  });
  return `<section class="panel">${panelHeader("Representative performance", "Assigned stock, recorded sales, credit owed and reporting compliance")}${table(["Representative", "Stock in hand", "Units sold", "Sales value", "Credit owed", "Latest report"], rows, "No representative performance records are available")}</section>`;
}

function exceptionItems(state) {
  const today = todayISO();
  const lowStock = (state.products || []).filter((product) => product.status !== "inactive" && Number(product.stock || 0) <= Number(product.reorderPoint || 0));
  const delayed = (state.orders || []).filter((order) => order.status === "delayed" || (!["delivered", "cancelled"].includes(order.status) && String(order.expectedDeliveryAt || order.dueAt || "") < today));
  const overdue = (state.invoices || []).filter((invoice) => !["paid", "cancelled"].includes(normalized(invoice.status || invoice.paymentStatus)) && String(invoice.dueAt || "") && String(invoice.dueAt).slice(0, 10) < today);
  const missingReports = salesRepresentativeAccounts(state).filter((rep) => String(latestReportFor(state, rep)?.reportDate || "").slice(0, 10) !== today);
  return [
    ...delayed.map((item) => ({ level: "critical", type: "Delayed dispatch", record: item.id, detail: item.customerName || item.repName || "Delivery destination", route: "orders" })),
    ...lowStock.map((item) => ({ level: "warning", type: "Low stock", record: item.id, detail: `${item.name} · ${formatNumber(item.stock)} remaining`, route: "inventory" })),
    ...overdue.map((item) => ({ level: "critical", type: "Overdue credit", record: item.id, detail: `${item.customerName || "Customer"} · ${formatCurrency(item.amount)}`, route: "finance" })),
    ...missingReports.map((item) => ({ level: "warning", type: "Report not submitted", record: item.id, detail: item.name, route: "activity-log?tab=submitted-reports" }))
  ];
}

function renderExceptions(state) {
  const items = exceptionItems(state);
  const rows = items.map((item) => `<tr><td>${statusPill(item.level)}</td><td><strong>${escapeHtml(item.type)}</strong></td><td>${escapeHtml(item.record)}</td><td>${escapeHtml(item.detail)}</td><td><a class="icon-button" href="#/${escapeHtml(item.route)}" title="Open record" aria-label="Open record">${icon("arrowRight")}</a></td></tr>`);
  return `<section class="panel">${panelHeader("Exception alerts", "Delayed dispatches, low stock, overdue credit and missing sales reports")}${table(["Level", "Exception", "Record", "Details", "Open"], rows, "No operational exceptions require attention")}</section>`;
}

function procurementRows(state, role) {
  return [...(state.procurementOrders || [])].sort((a, b) => String(b.preparedAt || "").localeCompare(String(a.preparedAt || ""))).map((order) => {
    const action = role === "admin" && order.status === "requested"
      ? `<div class="row-actions">${iconButton({ iconName: "arrowRight", label: "Mark as ordered", className: "js-mark-procurement-ordered", data: { "order-id": order.id } })}${iconButton({ iconName: "x", label: "Cancel supplier order", className: "js-cancel-procurement", data: { "order-id": order.id } })}</div>`
      : role === "admin" && order.status === "ordered"
        ? iconButton({ iconName: "x", label: "Cancel supplier order", className: "js-cancel-procurement", data: { "order-id": order.id } })
        : role === "store_keeper" && order.status === "ordered"
          ? textButton({ iconName: "check", label: "Receive", className: "primary js-receive-procurement", data: { "order-id": order.id } })
          : `<span class="muted">${escapeHtml(order.receivedBy || order.orderedBy || order.preparedBy || "Recorded")}</span>`;
    return `<tr><td><strong>${escapeHtml(order.id)}</strong><div class="muted">Expected ${formatDate(order.expectedAt)}</div></td><td><strong>${escapeHtml(order.supplierName)}</strong><div class="muted">${escapeHtml(order.supplierContact || "No contact")}</div></td><td><strong>${escapeHtml(order.productName)}</strong><div class="muted">${escapeHtml(order.sku)}</div></td><td>${formatNumber(order.quantity)} ${escapeHtml(order.unit)}</td><td>${formatCurrency(Number(order.quantity) * Number(order.unitCost))}</td><td>${statusPill(order.status)}</td><td>${action}</td></tr>`;
  });
}

function renderProcurement(state, role) {
  const rawMaterials = (state.products || []).filter((product) => product.status !== "inactive" && stockCategoryIdForProduct(product) === "raw_materials");
  return `
    ${role === "admin" ? `<section class="panel admin-procurement-create">${panelHeader("Prepare supplier order", "Admin records the order; the Store Keeper confirms the physical receipt")}
      <form id="admin-procurement-form" class="form-grid">
        <label class="field"><span>Supplier name</span><input name="supplierName" required></label>
        <label class="field"><span>Supplier contact</span><input name="supplierContact" placeholder="Phone or email"></label>
        <label class="field"><span>Raw material</span><select name="productId" required><option value="">Select material</option>${rawMaterials.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} · ${escapeHtml(product.id)}</option>`).join("")}</select></label>
        <label class="field"><span>Quantity</span><input name="quantity" type="number" min="0.01" step="0.01" required></label>
        <label class="field"><span>Unit cost</span><input name="unitCost" type="number" min="0" step="0.01" required></label>
        <label class="field"><span>Expected delivery</span><input name="expectedAt" type="date" min="${todayISO()}" value="${todayISO()}" required></label>
        <label class="field span-full"><span>Order note</span><textarea name="notes" rows="2" placeholder="Optional supplier or delivery instruction"></textarea></label>
        <div class="form-actions span-full"><span class="rep-form-message" data-procurement-message></span><button class="button primary" type="submit">${icon("plus")}<span>Prepare order</span></button></div>
      </form>
    </section>` : `<section class="admin-receipt-note"><span>${icon("package")}</span><div><strong>Supplier receipts</strong><p>Confirm only materials physically received. Confirmation immediately adds the received quantity to factory stock.</p></div></section>`}
    <section class="panel">${panelHeader("Supplier procurement register", role === "store_keeper" ? "Orders marked as ordered by Admin are ready for receipt confirmation" : "Track requested, ordered, received and outstanding raw materials")}${table(["Order", "Supplier", "Material", "Quantity", "Value", "Status", "Action"], procurementRows(state, role), "No supplier procurement orders have been recorded")}</section>
    <div id="receive-procurement-modal" class="stock-modal-backdrop" tabindex="-1" hidden><section class="stock-modal compact-record-modal" role="dialog" aria-modal="true" aria-labelledby="receive-procurement-title"><header class="stock-modal-header"><div><span class="eyebrow">Factory intake</span><h2 id="receive-procurement-title">Confirm supplier receipt</h2></div>${iconButton({ iconName: "x", label: "Close receipt form", className: "js-close-receive-procurement" })}</header><form id="receive-procurement-form" class="form-grid"><input type="hidden" name="procurementOrderId"><div class="span-full purchase-order-request-summary" data-receipt-summary></div><label class="field"><span>Quantity received</span><input name="receivedQuantity" type="number" min="0.01" step="0.01" required></label><label class="field span-full"><span>Receipt note</span><textarea name="receiptNote" rows="3" placeholder="Condition, shortage, batch or delivery note reference"></textarea></label><div class="form-actions span-full"><button class="button primary" type="submit">${icon("check")}<span>Add to factory stock</span></button></div></form></section></div>`;
}

function renderAudit(state) {
  const adminNames = new Set((state.accounts || []).filter((account) => normalized(account.role) === "admin").map((account) => normalized(account.name)));
  const relevantTypes = new Set(["stock_request", "purchase_order", "procurement_order", "record_correction", "report", "account"]);
  const logs = (state.activityLogs || []).filter((entry) => adminNames.has(normalized(entry.actorName)) || relevantTypes.has(entry.recordType));
  const rows = logs.map((entry) => `<tr><td>${formatDateTime(entry.createdAt)}</td><td><strong>${escapeHtml(entry.actorName || "Team member")}</strong></td><td>${escapeHtml(statusText(entry.actionType))}</td><td><strong>${escapeHtml(entry.recordLabel || entry.recordType)}</strong><div class="muted">${escapeHtml(statusText(entry.recordType))}</div></td><td>${escapeHtml(entry.summary || "Recorded")}</td></tr>`);
  return `<section class="panel">${panelHeader("Admin audit", "Approvals, rejections, document changes, procurement and role actions remain traceable")}${table(["Time", "Actor", "Action", "Record", "Summary"], rows, "No Admin audit events have been recorded")}</section>`;
}

function renderSection(state, role, section) {
  if (role === "store_keeper") return renderProcurement(state, role);
  if (section === "reconciliation") return renderReconciliation(state);
  if (section === "documents") return renderDocuments(state);
  if (section === "performance") return renderPerformance(state);
  if (section === "exceptions") return renderExceptions(state);
  if (section === "procurement") return renderProcurement(state, role);
  if (section === "audit") return renderAudit(state);
  return renderApprovalCentre(state, role);
}

export function renderAdminOperations({ state }) {
  const role = currentUserRole(state);
  const section = activeSection(role);
  return `<section class="view admin-operations-view">
    <section class="admin-operations-hero"><div><span class="eyebrow">${role === "store_keeper" ? "Store Keeper" : role === "admin" ? "Admin portal" : "CEO oversight"}</span><h2>${role === "store_keeper" ? "Supplier receipts" : "Admin Operations"}</h2><p>${role === "store_keeper" ? "Confirm inbound raw materials and add verified quantities to factory stock." : "Coordinate approvals, daily controls, documents, field performance, exceptions and procurement."}</p></div><span class="admin-operations-hero-icon">${icon(role === "store_keeper" ? "package" : "shield")}</span></section>
    ${renderSubnav(section, role)}
    ${renderSection(state, role, section)}
  </section>`;
}

export function bindAdminOperations({ root, store }) {
  qsa(".js-admin-approve-correction", root).forEach((button) => button.addEventListener("click", () => store.dispatch({ type: "APPROVE_RECORD_CORRECTION", requestId: button.dataset.requestId, message: "Correction approved" })));
  qsa(".js-admin-reject-correction", root).forEach((button) => button.addEventListener("click", async () => {
    const note = await requestTextDialog({
      title: "Reject correction",
      message: "Enter the reason for rejecting this correction. The decision will remain in the audit record.",
      label: "Reason for rejection",
      confirmLabel: "Reject correction"
    });
    if (note?.trim()) store.dispatch({ type: "REJECT_RECORD_CORRECTION", requestId: button.dataset.requestId, note, message: "Correction rejected" });
  }));
  qsa(".js-admin-review-report", root).forEach((button) => button.addEventListener("click", () => store.dispatch({ type: "REVIEW_SALES_REPORT", reportId: button.dataset.reportId, note: "Reviewed by Admin", message: "Sales report reviewed" })));
  qsa(".js-admin-flag-report", root).forEach((button) => button.addEventListener("click", async () => {
    const note = await requestTextDialog({
      title: "Request report correction",
      message: "Describe what needs to be corrected in this submitted sales report.",
      label: "Correction required",
      placeholder: "Describe the incorrect or missing information",
      confirmLabel: "Flag report"
    });
    if (note?.trim()) store.dispatch({ type: "FLAG_SALES_REPORT", reportId: button.dataset.reportId, note, message: "Sales report flagged" });
  }));
  qsa(".js-admin-review-return", root).forEach((button) => button.addEventListener("click", () => store.dispatch({ type: "REVIEW_REP_RETURN", transactionId: button.dataset.transactionId, message: "Customer return reviewed" })));
  qsa(".js-admin-flag-return", root).forEach((button) => button.addEventListener("click", async () => {
    const note = await requestTextDialog({
      title: "Request return clarification",
      message: "Explain what needs clarification about this customer return.",
      label: "Clarification required",
      placeholder: "Describe the information that needs clarification",
      confirmLabel: "Flag return"
    });
    if (note?.trim()) store.dispatch({ type: "FLAG_REP_RETURN", transactionId: button.dataset.transactionId, note, message: "Customer return flagged" });
  }));

  const procurementForm = qs("#admin-procurement-form", root);
  procurementForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(procurementForm);
    const message = qs("[data-procurement-message]", procurementForm);
    if (!procurementForm.reportValidity()) {
      if (message) message.textContent = "Please complete the required fields";
      return;
    }
    store.dispatch({ type: "CREATE_PROCUREMENT_ORDER", supplierName: data.get("supplierName"), supplierContact: data.get("supplierContact"), productId: data.get("productId"), quantity: data.get("quantity"), unitCost: data.get("unitCost"), expectedAt: data.get("expectedAt"), notes: data.get("notes"), message: "Supplier order prepared" });
  });
  qsa(".js-mark-procurement-ordered", root).forEach((button) => button.addEventListener("click", () => store.dispatch({ type: "MARK_PROCUREMENT_ORDERED", procurementOrderId: button.dataset.orderId, message: "Supplier order marked as ordered" })));
  qsa(".js-cancel-procurement", root).forEach((button) => button.addEventListener("click", async () => {
    const reason = await requestTextDialog({
      title: "Cancel supplier order",
      message: "Enter the reason for cancelling this supplier order. This will be retained in the procurement record.",
      label: "Cancellation reason",
      placeholder: "Explain why this order is being cancelled",
      confirmLabel: "Cancel order"
    });
    if (reason?.trim()) store.dispatch({ type: "CANCEL_PROCUREMENT_ORDER", procurementOrderId: button.dataset.orderId, reason, message: "Supplier order cancelled" });
  }));

  const modal = qs("#receive-procurement-modal", root);
  const receiptForm = qs("#receive-procurement-form", root);
  const closeReceipt = () => { if (modal) modal.hidden = true; };
  qsa(".js-receive-procurement", root).forEach((button) => button.addEventListener("click", () => {
    const order = (store.getState().procurementOrders || []).find((item) => item.id === button.dataset.orderId);
    if (!order || !modal || !receiptForm) return;
    receiptForm.reset();
    receiptForm.elements.procurementOrderId.value = order.id;
    receiptForm.elements.receivedQuantity.value = order.quantity;
    qs("[data-receipt-summary]", modal).innerHTML = `<strong>${escapeHtml(order.id)} · ${escapeHtml(order.productName)}</strong><span>${formatNumber(order.quantity)} ${escapeHtml(order.unit)} ordered from ${escapeHtml(order.supplierName)}</span>`;
    modal.hidden = false;
    modal.focus();
  }));
  qsa(".js-close-receive-procurement", root).forEach((button) => button.addEventListener("click", closeReceipt));
  modal?.addEventListener("click", (event) => { if (event.target === modal) closeReceipt(); });
  receiptForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!receiptForm.reportValidity()) return;
    const data = new FormData(receiptForm);
    store.dispatch({ type: "RECEIVE_PROCUREMENT_ORDER", procurementOrderId: data.get("procurementOrderId"), receivedQuantity: data.get("receivedQuantity"), receiptNote: data.get("receiptNote"), message: "Supplier receipt added to factory stock" });
    closeReceipt();
  });
}
