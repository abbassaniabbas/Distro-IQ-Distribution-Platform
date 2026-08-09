import { formatDate, formatDateTime, formatNumber, formatPercent, productSelectionLabel } from "../services/formatters.js?v=20260805h";
import { currentUserRole } from "../services/rbac.js?v=20260805g";
import { stockCategoryIdForProduct } from "../services/calculations.js?v=20260804i";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { metricCard, panelHeader, statusPill, table, textButton } from "../ui/components.js?v=20260724b";
import { icon } from "../ui/icons.js?v=20260722";
import { confirmActionDialog, requestTextDialog } from "../ui/action-dialog.js";

const MANAGER_TABS = [
  { id: "plans", label: "Production plans" },
  { id: "reports", label: "Submitted reports" },
  { id: "issues", label: "Production issues" }
];

const SUPERVISOR_TABS = [
  { id: "plans", label: "Assigned plans" },
  { id: "issues", label: "Production issues" }
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function textLabel(value) {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function activeTab(role) {
  const tabs = role === "production_supervisor" ? SUPERVISOR_TABS : MANAGER_TABS;
  if (typeof window === "undefined") return tabs[0].id;
  const requested = new URLSearchParams(window.location.hash.split("?")[1] || "").get("tab") || tabs[0].id;
  return tabs.some((tab) => tab.id === requested) ? requested : tabs[0].id;
}

function finishedProducts(state) {
  return (state.products || [])
    .filter((product) => product.status !== "inactive" && stockCategoryIdForProduct(product) === "finished_products")
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function productionSupervisors(state) {
  return (state.accounts || [])
    .filter((account) => account.role === "production_supervisor" && String(account.status || "").toLowerCase() === "active")
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function planLine(plan) {
  return plan?.lines?.[0] || {
    productId: plan?.productId || "",
    productName: plan?.productName || "Finished product",
    quantity: Number(plan?.targetQuantity || 0)
  };
}

function batchForPlan(state, planId) {
  return (state.productionBatches || []).find((batch) => batch.planId === planId && batch.supervisorWorkflow) || null;
}

function planTarget(plan) {
  return Number(plan.targetQuantity || planLine(plan).quantity || 0);
}

function planGoodOutput(state, plan) {
  const batch = batchForPlan(state, plan.id);
  return Number(batch?.quantityProduced ?? plan.actualGoodQuantity ?? 0);
}

function varianceLabel(value) {
  const number = Number(value || 0);
  return `${number > 0 ? "+" : ""}${formatNumber(number)}`;
}

function managerMetrics(state) {
  const plans = state.productionPlans || [];
  const reports = (state.productionBatches || []).filter((batch) => batch.supervisorWorkflow);
  const planned = plans.reduce((total, plan) => total + planTarget(plan), 0);
  const good = reports.reduce((total, batch) => total + Number(batch.quantityProduced || 0), 0);
  return `<div class="metric-grid production-metric-grid">
    ${metricCard({ label: "Planned output", value: formatNumber(planned), meta: `${formatNumber(plans.length)} assigned plans`, iconName: "orders" })}
    ${metricCard({ label: "Good output", value: formatNumber(good), meta: planned ? `${formatPercent((good / planned) * 100)} of target` : "No output submitted", iconName: "package" })}
    ${metricCard({ label: "Reports to review", value: formatNumber(reports.filter((batch) => batch.status === "submitted").length), meta: "Submitted by production supervisors", iconName: "check" })}
    ${metricCard({ label: "Open issues", value: formatNumber((state.productionIssues || []).filter((issue) => issue.status === "open").length), meta: "Production exceptions awaiting review", iconName: "alert" })}
  </div>`;
}

function supervisorMetrics(state) {
  const plans = state.productionPlans || [];
  return `<div class="metric-grid production-metric-grid">
    ${metricCard({ label: "Assigned plans", value: formatNumber(plans.length), meta: "Plans assigned specifically to you", iconName: "orders" })}
    ${metricCard({ label: "In progress", value: formatNumber(plans.filter((plan) => plan.status === "in_progress").length), meta: "Production currently running", iconName: "package" })}
    ${metricCard({ label: "Awaiting review", value: formatNumber(plans.filter((plan) => plan.status === "submitted").length), meta: "Batch reports sent to the manager", iconName: "check" })}
    ${metricCard({ label: "My open issues", value: formatNumber((state.productionIssues || []).filter((issue) => issue.status === "open").length), meta: "Issues attached to your production work", iconName: "alert" })}
  </div>`;
}

function managerPlanActions(state, plan) {
  if (plan.status === "submitted") {
    return `<a class="button primary" href="#/production?tab=reports">${icon("check")}<span>Review report</span></a>`;
  }
  if (plan.status !== "completed") return "";
  const hasOpenIssues = (state.productionIssues || []).some((issue) => issue.planId === plan.id && issue.status === "open");
  if (hasOpenIssues) return '<span class="muted">Resolve open issues before closing</span>';
  return textButton({ iconName: "check", label: "Close plan", className: "primary js-close-production-plan-record", data: { "plan-id": plan.id } });
}

function renderManagerPlans(state) {
  const rows = [...(state.productionPlans || [])]
    .sort((a, b) => String(b.productionDate || b.startDate || "").localeCompare(String(a.productionDate || a.startDate || "")))
    .map((plan) => {
      const line = planLine(plan);
      const good = planGoodOutput(state, plan);
      const variance = good - planTarget(plan);
      return `<tr data-search-index="${escapeHtml(`${plan.name} ${line.productName} ${plan.assignedSupervisorName} ${plan.status}`.toLowerCase())}">
        <td><strong>${escapeHtml(plan.name)}</strong><div class="muted">${escapeHtml(plan.id)}</div></td>
        <td><strong>${escapeHtml(line.productName)}</strong><div class="muted">${formatDate(plan.productionDate || plan.startDate)}</div></td>
        <td>${escapeHtml(plan.assignedSupervisorName || "Legacy unassigned plan")}</td>
        <td><strong>${formatNumber(good)} / ${formatNumber(planTarget(plan))}</strong><div class="muted">Variance ${varianceLabel(variance)}</div></td>
        <td>${plan.startedAt ? formatDateTime(plan.startedAt) : '<span class="muted">Not started</span>'}<div class="muted">${plan.completedAt ? `Completed ${formatDateTime(plan.completedAt)}` : ""}</div></td>
        <td>${statusPill(plan.status || "planned")}</td>
        <td><div class="row-actions">${managerPlanActions(state, plan)}</div></td>
      </tr>`;
    });
  return `<section class="panel">
    ${panelHeader("Assigned production plans", "Monitor target quantity against completed good output and close approved plans")}
    ${table(["Plan", "Product and date", "Supervisor", "Good / planned", "Timing", "Status", "Actions"], rows, "No production plans have been created")}
  </section>`;
}

function supervisorPlanActions(plan) {
  if (plan.status === "planned") {
    return textButton({ iconName: "check", label: "Start plan", className: "primary js-start-production-plan", data: { "plan-id": plan.id } });
  }
  if (["in_progress", "flagged"].includes(plan.status)) {
    return textButton({ iconName: "package", label: plan.status === "flagged" ? "Correct and resubmit" : "Complete and submit", className: "primary js-open-supervisor-report", data: { "plan-id": plan.id } });
  }
  if (plan.status === "submitted") return '<span class="muted">Submitted successfully. No further action until the Production Line Manager reviews it.</span>';
  if (["completed", "closed"].includes(plan.status)) return '<span class="muted">Approved good output transferred</span>';
  if (plan.status === "rejected") return '<span class="muted">Report rejected</span>';
  return "";
}

function renderSupervisorPlans(state) {
  const rows = [...(state.productionPlans || [])]
    .sort((a, b) => String(b.productionDate || b.startDate || "").localeCompare(String(a.productionDate || a.startDate || "")))
    .map((plan) => {
      const batch = batchForPlan(state, plan.id);
      const line = planLine(plan);
      return `<tr data-search-index="${escapeHtml(`${plan.name} ${line.productName} ${plan.status}`.toLowerCase())}">
        <td><strong>${escapeHtml(plan.name)}</strong><div class="muted">${escapeHtml(plan.batchReference || "Batch number generated when started")}</div></td>
        <td><strong>${escapeHtml(line.productName)}</strong><div class="muted">${formatDate(plan.productionDate || plan.startDate)}</div></td>
        <td>${formatNumber(planTarget(plan))}</td>
        <td><strong>${formatNumber(batch?.quantityProduced || 0)} good</strong><div class="muted">${formatNumber(batch?.quantityDamaged || 0)} damaged · ${formatNumber(batch?.quantityRejected || 0)} rejected</div></td>
        <td>${plan.startedAt ? formatDateTime(plan.startedAt) : '<span class="muted">Not started</span>'}<div class="muted">${plan.completedAt ? `Completed ${formatDateTime(plan.completedAt)}` : ""}</div></td>
        <td>${statusPill(plan.status || "planned")}${plan.reviewNote ? `<div class="field-error">${escapeHtml(plan.reviewNote)}</div>` : ""}</td>
        <td><div class="row-actions">${supervisorPlanActions(plan)}</div></td>
      </tr>`;
    });
  return `<section class="panel">
    ${panelHeader("My assigned production plans", "Start work, record output, and submit the completed batch to your Production Line Manager and Admin")}
    ${table(["Plan / batch", "Product and date", "Target", "Reported output", "Timing", "Status", "Actions"], rows, "No production plans are assigned to you")}
  </section>`;
}

function reportActions(batch) {
  if (batch.syncPending) return '<span class="muted">Finalizing shared report…</span>';
  if (batch.status !== "submitted") return "";
  return [
    textButton({ iconName: "check", label: "Approve", className: "primary js-approve-supervisor-report", data: { "batch-id": batch.id } }),
    textButton({ iconName: "alert", label: "Flag", className: "js-flag-supervisor-report", data: { "batch-id": batch.id } }),
    textButton({ iconName: "x", label: "Reject", className: "warning js-reject-supervisor-report", data: { "batch-id": batch.id } })
  ].join("");
}

function renderManagerReports(state) {
  const savedReports = (state.productionBatches || []).filter((batch) => batch.supervisorWorkflow);
  const savedPlanIds = new Set(savedReports.map((batch) => String(batch.planId || "")));
  const pendingPlanReports = (state.productionPlans || [])
    .filter((plan) => plan.status === "submitted" && !savedPlanIds.has(String(plan.id || "")))
    .map((plan) => ({
      id: `pending-${plan.id}`,
      planId: plan.id,
      reference: plan.batchReference || plan.id,
      finishedProductName: plan.productName || planLine(plan).productName,
      recordedBy: plan.assignedSupervisorName,
      plannedQuantity: planTarget(plan),
      quantityProduced: Number(plan.actualGoodQuantity || 0),
      quantityDamaged: Number(plan.quantityDamaged || 0),
      quantityRejected: Number(plan.quantityRejected || 0),
      variance: Number(plan.variance || 0),
      submittedAt: plan.submittedAt,
      status: "submitted",
      supervisorWorkflow: true,
      syncPending: true
    }));
  const rows = [...savedReports, ...pendingPlanReports]
    .sort((a, b) => String(b.submittedAt || b.createdAt || "").localeCompare(String(a.submittedAt || a.createdAt || "")))
    .map((batch) => {
      const plan = (state.productionPlans || []).find((item) => item.id === batch.planId);
      return `<tr data-search-index="${escapeHtml(`${batch.reference} ${batch.finishedProductName} ${batch.recordedBy} ${batch.status}`.toLowerCase())}">
        <td><strong>${escapeHtml(batch.reference)}</strong><div class="muted">${escapeHtml(plan?.name || batch.planId)}</div></td>
        <td><strong>${escapeHtml(batch.finishedProductName)}</strong><div class="muted">${escapeHtml(batch.recordedBy || plan?.assignedSupervisorName || "Supervisor")}</div></td>
        <td>${formatNumber(batch.plannedQuantity || 0)}</td>
        <td><strong>${formatNumber(batch.quantityProduced || 0)} good</strong><div class="muted">${formatNumber(batch.quantityDamaged || 0)} damaged · ${formatNumber(batch.quantityRejected || 0)} rejected</div></td>
        <td><strong>${varianceLabel(batch.variance)}</strong><div class="muted">${batch.submittedAt ? formatDateTime(batch.submittedAt) : "Not submitted"}</div></td>
        <td>${statusPill(batch.status)}${batch.reviewNote ? `<div class="muted">${escapeHtml(batch.reviewNote)}</div>` : ""}</td>
        <td><div class="row-actions">${reportActions(batch)}</div></td>
      </tr>`;
    });
  return `<section class="panel">
    ${panelHeader("Submitted batch reports", "Approve, flag, or reject reports; approval automatically transfers good output into finished stock")}
    ${table(["Batch", "Product / supervisor", "Planned", "Output", "Variance", "Review status", "Actions"], rows, "No supervisor batch reports have been submitted")}
  </section>`;
}

function renderIssues(state, role) {
  const rows = [...(state.productionIssues || [])]
    .sort((a, b) => String(b.reportedAt || "").localeCompare(String(a.reportedAt || "")))
    .map((issue) => {
      const plan = (state.productionPlans || []).find((item) => item.id === issue.planId);
      return `<tr data-search-index="${escapeHtml(`${issue.issueType} ${issue.description} ${issue.status}`.toLowerCase())}">
        <td><strong>${escapeHtml(textLabel(issue.issueType))}</strong><div class="muted">${escapeHtml(plan?.name || "No plan")}</div></td>
        <td>${statusPill(issue.severity || "medium")}</td>
        <td>${escapeHtml(issue.description)}${issue.resolution ? `<div class="muted">Resolution: ${escapeHtml(issue.resolution)}</div>` : ""}</td>
        <td>${formatNumber(issue.downtimeMinutes || 0)} min</td>
        <td>${escapeHtml(issue.reportedBy || "Production staff")}<div class="muted">${formatDateTime(issue.reportedAt)}</div></td>
        <td>${statusPill(issue.status || "open")}</td>
        <td>${["production_manager", "ceo"].includes(role) && issue.status === "open" ? textButton({ iconName: "check", label: "Resolve", className: "primary js-resolve-production-issue", data: { "issue-id": issue.id } }) : ""}</td>
      </tr>`;
    });
  return `<section class="panel">
    ${panelHeader(role === "production_supervisor" ? "My production issues" : "Production issues", role === "production_supervisor" ? "Issues you reported for your assigned production work" : "Review production exceptions and record their resolution")}
    ${table(["Issue / plan", "Severity", "Details", "Downtime", "Reported by", "Status", "Actions"], rows, "No production issues have been reported")}
  </section>`;
}

function modalHeader(eyebrow, title, closeClass) {
  return `<header class="stock-modal-header"><div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h2>${escapeHtml(title)}</h2></div>${textButton({ iconName: "x", label: "Close", className: closeClass })}</header>`;
}

function renderManagerModal(state) {
  const products = finishedProducts(state);
  const supervisors = productionSupervisors(state);
  return `<div id="production-plan-modal" class="stock-modal-backdrop" hidden><section class="stock-modal production-workflow-modal" role="dialog" aria-modal="true">
    ${modalHeader("Production planning", "Create and assign production plan", "js-close-production-plan")}
    <form id="assigned-production-plan-form" class="manager-form-grid" novalidate>
      <label class="field"><span>Product</span><select name="productId" required><option value="">Choose finished product</option>${products.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(productSelectionLabel(product))}</option>`).join("")}</select></label>
      <label class="field"><span>Target quantity</span><input name="targetQuantity" type="number" min="1" step="1" inputmode="numeric" required></label>
      <label class="field"><span>Production date</span><input name="productionDate" type="date" value="${todayISO()}" required></label>
      <label class="field"><span>Production Supervisor</span><select name="supervisorId" required><option value="">Assign a supervisor</option>${supervisors.map((supervisor) => `<option value="${escapeHtml(supervisor.id)}">${escapeHtml(supervisor.name)}</option>`).join("")}</select></label>
      <label class="field span-full"><span>Instructions</span><textarea name="notes" rows="3" placeholder="Optional production instructions"></textarea></label>
      <span class="field-error span-full" data-production-plan-error></span>
      <div class="manager-form-actions span-full"><button class="button primary" type="submit">${icon("check")}<span>Create and assign</span></button></div>
    </form>
  </section></div>`;
}

function renderSupervisorModals(state) {
  const plans = (state.productionPlans || []).filter((plan) => !["closed", "rejected"].includes(plan.status));
  return `
    <div id="supervisor-report-modal" class="stock-modal-backdrop" hidden><section class="stock-modal production-workflow-modal" role="dialog" aria-modal="true">
      ${modalHeader("Batch completion", "Complete and submit batch report", "js-close-supervisor-report")}
      <form id="supervisor-batch-report-form" class="manager-form-grid" novalidate><input name="planId" type="hidden">
        <label class="field"><span>Batch number</span><input name="batchReference" readonly></label>
        <label class="field"><span>Product</span><input name="productName" readonly></label>
        <label class="field"><span>Planned quantity</span><input name="plannedQuantity" readonly></label>
        <label class="field"><span>Good quantity</span><input name="goodQuantity" type="number" min="0" step="1" value="0" required></label>
        <label class="field"><span>Damaged quantity</span><input name="damagedQuantity" type="number" min="0" step="1" value="0" required></label>
        <label class="field"><span>Rejected quantity</span><input name="rejectedQuantity" type="number" min="0" step="1" value="0" required></label>
        <label class="field span-full"><span>Batch notes</span><textarea name="notes" rows="3" placeholder="Optional completion notes"></textarea></label>
        <span class="field-error span-full" data-supervisor-report-error></span>
        <div class="manager-form-actions span-full"><button class="button primary" type="submit">${icon("check")}<span>Complete and submit report</span></button></div>
      </form>
    </section></div>
    <div id="production-issue-modal" class="stock-modal-backdrop" hidden><section class="stock-modal production-workflow-modal" role="dialog" aria-modal="true">
      ${modalHeader("Production exception", "Report production issue", "js-close-production-issue")}
      <form id="production-issue-form" class="manager-form-grid" novalidate>
        <label class="field"><span>Assigned plan</span><select name="planId" required><option value="">Choose plan</option>${plans.map((plan) => `<option value="${escapeHtml(plan.id)}">${escapeHtml(plan.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Issue type</span><select name="issueType"><option value="machine_downtime">Machine downtime</option><option value="material_shortage">Material shortage</option><option value="delay">Production delay</option><option value="quality">Quality concern</option><option value="other">Other issue</option></select></label>
        <label class="field"><span>Severity</span><select name="severity"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
        <label class="field"><span>Downtime in minutes</span><input name="downtimeMinutes" type="number" min="0" step="1" value="0"></label>
        <label class="field span-full"><span>Issue details</span><textarea name="description" rows="4" required></textarea></label>
        <span class="field-error span-full" data-production-issue-error></span>
        <div class="manager-form-actions span-full"><button class="button primary" type="submit">${icon("alert")}<span>Report issue</span></button></div>
      </form>
    </section></div>`;
}

export function renderProduction({ state }) {
  const role = currentUserRole(state);
  if (!["production_manager", "production_supervisor", "ceo"].includes(role)) {
    return `<section class="view"><section class="panel"><div class="empty-state">Production access is required.</div></section></section>`;
  }
  const tabs = role === "production_supervisor" ? SUPERVISOR_TABS : MANAGER_TABS;
  const tab = activeTab(role);
  const supervisor = role === "production_supervisor";
  const submittedReportCount = (state.productionBatches || []).filter((batch) => batch.supervisorWorkflow && batch.status === "submitted").length;
  return `<section class="view production-view ${supervisor ? "production-supervisor-view" : "production-manager-view"}">
    <section class="ceo-command-strip production-command-strip">
      <div><span class="eyebrow">${supervisor ? "Production Supervisor portal" : role === "ceo" ? "CEO production oversight" : "Production Line Manager portal"}</span><h2>${supervisor ? "Assigned production" : "Production control"}</h2><p>${supervisor ? "Run assigned plans; reports and issues notify the Production Line Manager, Admin, and CEO." : "Assign production, review batch reports, resolve issues, and control finished-goods approval."}</p></div>
      <div class="row-actions">
        ${supervisor
          ? textButton({ iconName: "alert", label: "Report issue", className: "js-open-production-issue" })
          : `<a class="button ${submittedReportCount ? "primary" : ""}" href="#/production?tab=reports">${icon("check")}<span>Review submitted reports${submittedReportCount ? ` (${formatNumber(submittedReportCount)})` : ""}</span></a>${textButton({ iconName: "orders", label: "Create plan", className: `${submittedReportCount ? "" : "primary "}js-open-production-plan` })}`}
      </div>
    </section>
    <div class="field-error production-sync-status" data-production-sync-status role="status" aria-live="polite"></div>
    ${supervisor ? supervisorMetrics(state) : managerMetrics(state)}
    <nav class="subtab-nav stock-subtabs" aria-label="Production pages">${tabs.map((item) => `<a class="subtab-link ${item.id === tab ? "is-active" : ""}" href="#/production?tab=${item.id}" aria-current="${item.id === tab ? "page" : "false"}">${escapeHtml(item.label)}</a>`).join("")}</nav>
    ${tab === "issues" ? renderIssues(state, role) : supervisor ? renderSupervisorPlans(state) : tab === "reports" ? renderManagerReports(state) : renderManagerPlans(state)}
    ${supervisor ? renderSupervisorModals(state) : renderManagerModal(state)}
  </section>`;
}

export function bindProduction({ root, store, operationalSync, signal }) {
  const role = currentUserRole(store.getState());
  const planModal = qs("#production-plan-modal", root);
  const reportModal = qs("#supervisor-report-modal", root);
  const issueModal = qs("#production-issue-modal", root);
  const planForm = qs("#assigned-production-plan-form", root);
  const reportForm = qs("#supervisor-batch-report-form", root);
  const issueForm = qs("#production-issue-form", root);
  const syncStatus = qs("[data-production-sync-status]", root);
  const open = (modal) => { if (modal) { modal.hidden = false; qs("input:not([type='hidden']), select, textarea", modal)?.focus(); } };
  const close = (modal) => { if (modal) modal.hidden = true; };

  const dispatchAndConfirm = async (action, { errorTarget = syncStatus, pendingTarget = errorTarget, onSuccess } = {}) => {
    if (errorTarget) errorTarget.textContent = "Saving to the backend…";
    const alreadyPending = pendingTarget?.dataset.productionSavePending === "true";
    if (!alreadyPending) {
      const { message, ...payload } = action;
      store.dispatch({ ...payload, deferRenderUntilSaved: true });
      if (pendingTarget) pendingTarget.dataset.productionSavePending = "true";
    }
    try {
      await operationalSync?.flush?.(action.type);
      if (pendingTarget) delete pendingTarget.dataset.productionSavePending;
      if (errorTarget) errorTarget.textContent = "";
      onSuccess?.();
      store.dispatch({ type: "PRODUCTION_SAVE_CONFIRMED", message: action.message || "Production change saved" });
      return true;
    } catch (error) {
      if (errorTarget) errorTarget.textContent = error?.message || "The backend did not confirm this change. Try again.";
      return false;
    }
  };

  qs(".js-open-production-plan", root)?.addEventListener("click", () => open(planModal), { signal });
  qs(".js-open-production-issue", root)?.addEventListener("click", () => open(issueModal), { signal });
  qsa(".js-close-production-plan", root).forEach((button) => button.addEventListener("click", () => close(planModal), { signal }));
  qsa(".js-close-supervisor-report", root).forEach((button) => button.addEventListener("click", () => close(reportModal), { signal }));
  qsa(".js-close-production-issue", root).forEach((button) => button.addEventListener("click", () => close(issueModal), { signal }));

  planForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(planForm);
    const error = qs("[data-production-plan-error]", planForm);
    if (!data.get("productId") || Number(data.get("targetQuantity")) <= 0 || !data.get("productionDate") || !data.get("supervisorId")) {
      if (error) error.textContent = "Choose a product, target quantity, production date, and Production Supervisor.";
      return;
    }
    await dispatchAndConfirm({
      type: "CREATE_ASSIGNED_PRODUCTION_PLAN",
      productId: data.get("productId"),
      targetQuantity: Number(data.get("targetQuantity")),
      productionDate: data.get("productionDate"),
      supervisorId: data.get("supervisorId"),
      notes: data.get("notes"),
      message: "Production plan created and assigned"
    }, { errorTarget: error, onSuccess: () => close(planModal) });
  }, { signal });

  qsa(".js-start-production-plan", root).forEach((button) => button.addEventListener("click", async () => {
    await dispatchAndConfirm(
      { type: "START_ASSIGNED_PRODUCTION_PLAN", planId: button.dataset.planId, message: "Production plan started and batch number generated" },
      { pendingTarget: button }
    );
  }, { signal }));

  qsa(".js-open-supervisor-report", root).forEach((button) => button.addEventListener("click", () => {
    const state = store.getState();
    const plan = (state.productionPlans || []).find((item) => item.id === button.dataset.planId);
    const batch = batchForPlan(state, plan?.id);
    if (!plan || !reportForm) return;
    reportForm.elements.planId.value = plan.id;
    reportForm.elements.batchReference.value = plan.batchReference || batch?.reference || "Generated automatically";
    reportForm.elements.productName.value = planLine(plan).productName;
    reportForm.elements.plannedQuantity.value = planTarget(plan);
    reportForm.elements.goodQuantity.max = String(planTarget(plan));
    reportForm.elements.goodQuantity.value = Number(batch?.quantityProduced || 0);
    reportForm.elements.damagedQuantity.value = Number(batch?.quantityDamaged || 0);
    reportForm.elements.rejectedQuantity.value = Number(batch?.quantityRejected || 0);
    reportForm.elements.notes.value = batch?.notes || "";
    open(reportModal);
  }, { signal }));

  reportForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(reportForm);
    const goodQuantity = Number(data.get("goodQuantity"));
    const damagedQuantity = Number(data.get("damagedQuantity"));
    const rejectedQuantity = Number(data.get("rejectedQuantity"));
    const plannedQuantity = Number(data.get("plannedQuantity"));
    const error = qs("[data-supervisor-report-error]", reportForm);
    if ([goodQuantity, damagedQuantity, rejectedQuantity].some((quantity) => !Number.isInteger(quantity) || quantity < 0) || goodQuantity + damagedQuantity + rejectedQuantity <= 0) {
      if (error) error.textContent = "Enter whole-number good, damaged, and rejected quantities. Total output must be greater than zero.";
      return;
    }
    if (goodQuantity > plannedQuantity) {
      if (error) error.textContent = `Good quantity cannot be more than the planned quantity of ${formatNumber(plannedQuantity)}.`;
      reportForm.elements.goodQuantity.focus();
      return;
    }
    await dispatchAndConfirm({
      type: "SUBMIT_SUPERVISOR_BATCH_REPORT",
      planId: data.get("planId"),
      goodQuantity,
      damagedQuantity,
      rejectedQuantity,
      notes: data.get("notes"),
      message: "Batch report submitted to the Production Line Manager, Admin, and CEO"
    }, { errorTarget: error, onSuccess: () => close(reportModal) });
  }, { signal });

  qsa(".js-approve-supervisor-report", root).forEach((button) => button.addEventListener("click", async () => {
    const batch = (store.getState().productionBatches || []).find((item) => item.id === button.dataset.batchId);
    const confirmed = await confirmActionDialog({
      title: "Approve batch report?",
      message: `${formatNumber(batch?.quantityProduced || 0)} good units will enter finished-goods stock automatically. Damaged and rejected quantities will stay out of sellable stock.`,
      confirmLabel: "Approve and transfer"
    });
    if (confirmed) await dispatchAndConfirm(
      { type: "APPROVE_SUPERVISOR_BATCH_REPORT", batchId: button.dataset.batchId, message: "Report approved and good output transferred" },
      { pendingTarget: button }
    );
  }, { signal }));

  qsa(".js-flag-supervisor-report", root).forEach((button) => button.addEventListener("click", async () => {
    const note = await requestTextDialog({ title: "Flag batch report", message: "Explain what the Production Supervisor must correct.", label: "Correction required", placeholder: "Reason for flagging", confirmLabel: "Flag report" });
    if (note) await dispatchAndConfirm(
      { type: "FLAG_SUPERVISOR_BATCH_REPORT", batchId: button.dataset.batchId, note, message: "Batch report flagged for correction" },
      { pendingTarget: button }
    );
  }, { signal }));

  qsa(".js-reject-supervisor-report", root).forEach((button) => button.addEventListener("click", async () => {
    const note = await requestTextDialog({ title: "Reject batch report", message: "Record why this batch report is rejected.", label: "Rejection reason", placeholder: "Reason for rejection", confirmLabel: "Reject report" });
    if (note) await dispatchAndConfirm(
      { type: "REJECT_SUPERVISOR_BATCH_REPORT", batchId: button.dataset.batchId, note, message: "Batch report rejected" },
      { pendingTarget: button }
    );
  }, { signal }));

  qsa(".js-close-production-plan-record", root).forEach((button) => button.addEventListener("click", async () => {
    const confirmed = await confirmActionDialog({ title: "Close completed production plan?", message: "The approved output and audit history will remain available.", confirmLabel: "Close plan" });
    if (confirmed) await dispatchAndConfirm(
      { type: "CLOSE_PRODUCTION_PLAN", planId: button.dataset.planId, message: "Production plan closed" },
      { pendingTarget: button }
    );
  }, { signal }));

  issueForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(issueForm);
    const description = String(data.get("description") || "").trim();
    const downtimeMinutes = Number(data.get("downtimeMinutes") || 0);
    const error = qs("[data-production-issue-error]", issueForm);
    if (!data.get("planId") || !description || (data.get("issueType") === "machine_downtime" && downtimeMinutes <= 0)) {
      if (error) error.textContent = "Choose the assigned plan, describe the issue, and enter downtime for machine downtime.";
      return;
    }
    await dispatchAndConfirm(
      { type: "REPORT_PRODUCTION_ISSUE", planId: data.get("planId"), issueType: data.get("issueType"), severity: data.get("severity"), downtimeMinutes, description, message: "Production issue reported to the Production Line Manager, Admin, and CEO" },
      { errorTarget: error, onSuccess: () => close(issueModal) }
    );
  }, { signal });

  qsa(".js-resolve-production-issue", root).forEach((button) => button.addEventListener("click", async () => {
    const resolution = await requestTextDialog({ title: "Resolve production issue", message: "Record how the issue was resolved.", label: "Resolution", placeholder: "Resolution details", confirmLabel: "Mark resolved" });
    if (resolution) await dispatchAndConfirm(
      { type: "RESOLVE_PRODUCTION_ISSUE", issueId: button.dataset.issueId, resolution, message: "Production issue resolved" },
      { pendingTarget: button }
    );
  }, { signal }));

  if (!["production_manager", "production_supervisor", "ceo"].includes(role)) return;
}
