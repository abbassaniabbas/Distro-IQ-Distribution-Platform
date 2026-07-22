import { formatDateTime, formatNumber, statusText } from "../services/formatters.js";
import { currentUserRole, roleLabel } from "../services/rbac.js";
import { escapeHtml, qsa } from "../ui/dom.js";
import { iconButton, metricCard, panelHeader, statusPill, table, textButton } from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { requestTextDialog } from "../ui/action-dialog.js";
import { bindWorkspaceDataResetButtons } from "../ui/workspace-data-reset.js";
import { packagingQuantityLabel } from "../services/packaging.js";

function correctionQuantityLabel(request, prefix) {
  const packagingType = String(request[`${prefix}PackagingType`] || "piece");
  const pieces = Number(request[`${prefix}Quantity`] || 0);
  const packagingQuantity = Number(request[`${prefix}PackagingQuantity`] ?? pieces);
  if (packagingType === "piece") return `${formatNumber(pieces)} piece${pieces === 1 ? "" : "s"}`;
  return `${packagingQuantityLabel(packagingQuantity, packagingType)} (${formatNumber(pieces)} pieces)`;
}

function adjustmentRows(state) {
  return [...(state.correctionRequests || [])]
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function renderRows(state, role) {
  return adjustmentRows(state).map((request) => {
    const canReview = ["ceo", "admin"].includes(role) && request.status === "pending";
    return `
      <tr data-search-index="${escapeHtml(`${request.id} ${request.transactionId} ${request.productName} ${request.requestedBy} ${request.reason} ${request.status}`.toLowerCase())}">
        <td><strong>${escapeHtml(request.id)}</strong><div class="muted">${formatDateTime(request.createdAt)}</div></td>
        <td><strong>${escapeHtml(request.requestedBy || "Staff member")}</strong><div class="muted">${escapeHtml(roleLabel(request.requestedByRole))}</div></td>
        <td><strong>${escapeHtml(request.productName || "Stock record")}</strong><div class="muted">${escapeHtml(statusText(request.recordType))} · ${escapeHtml(request.transactionId)}</div></td>
        <td><strong>${escapeHtml(correctionQuantityLabel(request, "original"))} → ${escapeHtml(correctionQuantityLabel(request, "requested"))}</strong><div class="muted">${escapeHtml(request.reason)}</div></td>
        <td>${statusPill(request.status)}</td>
        <td>${canReview ? `<div class="row-actions">${iconButton({ iconName: "check", label: "Approve adjustment", className: "js-approve-adjustment", data: { "request-id": request.id } })}${iconButton({ iconName: "x", label: "Reject adjustment", className: "js-reject-adjustment", data: { "request-id": request.id } })}</div>` : `<span class="muted">${escapeHtml(request.reviewedBy || "Awaiting review")}</span>`}</td>
      </tr>
    `;
  });
}

export function renderAdjustments({ state }) {
  const role = currentUserRole(state);
  return `
    <section class="view adjustments-view">
      <section class="adjustments-hero">
        <div><span class="eyebrow">${role === "ceo" ? "CEO control" : "Admin control"}</span><h2>Adjustment approvals</h2><p>Review correction requests submitted after a sales or dispatch record has been saved.</p></div>
        <span class="adjustments-hero-icon">${icon("refresh")}</span>
      </section>
      ${renderAdjustmentContent(state)}
    </section>
  `;
}

export function renderAdjustmentContent(state) {
  const role = currentUserRole(state);
  const requests = adjustmentRows(state);
  const pending = requests.filter((request) => request.status === "pending");
  const salesRepPending = pending.filter((request) => request.requestedByRole === "sales_rep");

  return `
      <header class="stock-tab-heading">
        <div><span class="eyebrow">Controlled corrections</span><h2>Adjustment approvals</h2><p>Review saved sales and dispatch correction requests.</p></div>
      </header>
      <div class="metric-grid adjustments-metrics">
        ${metricCard({ label: "Pending", value: formatNumber(pending.length), meta: "Waiting for a decision", iconName: "clock" })}
        ${metricCard({ label: "Sales representative", value: formatNumber(salesRepPending.length), meta: "Sales corrections awaiting review", iconName: "team" })}
        ${metricCard({ label: "Completed", value: formatNumber(requests.length - pending.length), meta: "Approved or rejected", iconName: "check" })}
      </div>
      <section class="panel">
        ${panelHeader(
          "Correction requests",
          role === "ceo" ? "Staff requests require approval; CEO adjustments are saved directly" : "Approve or reject staff requests with a recorded decision",
          role === "ceo" ? textButton({ iconName: "trash", label: "Delete all", className: "warning", data: { "reset-workspace-scope": "adjustments" } }) : ""
        )}
        ${table(["Request", "Requested by", "Record", "Requested change", "Status", "Decision"], renderRows(state, role), "No correction requests have been submitted")}
      </section>
  `;
}

export function bindAdjustments({ root, store, signal }) {
  bindWorkspaceDataResetButtons({ root, store, signal });
  qsa(".js-approve-adjustment", root).forEach((button) => button.addEventListener("click", () => {
    store.dispatch({
      type: "APPROVE_RECORD_CORRECTION",
      requestId: button.dataset.requestId,
      message: "Adjustment approved and linked records updated"
    });
  }));

  qsa(".js-reject-adjustment", root).forEach((button) => button.addEventListener("click", async () => {
    const note = await requestTextDialog({
      title: "Reject adjustment",
      message: "Enter the reason for rejecting this adjustment. The reason will be recorded with the decision.",
      label: "Reason for rejection",
      placeholder: "Explain why this adjustment cannot be approved",
      confirmLabel: "Reject adjustment"
    });
    if (!note?.trim()) return;
    store.dispatch({
      type: "REJECT_RECORD_CORRECTION",
      requestId: button.dataset.requestId,
      note,
      message: "Adjustment rejected"
    });
  }));
}
