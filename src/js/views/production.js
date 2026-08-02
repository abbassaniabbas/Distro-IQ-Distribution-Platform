import { formatDate, formatNumber, formatPercent } from "../services/formatters.js";
import { currentUserPermissions, currentUserRole } from "../services/rbac.js?v=20260801d";
import { stockCategoryIdForProduct } from "../services/calculations.js?v=20260722";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { metricCard, panelHeader, statusPill, table, textButton } from "../ui/components.js?v=20260724b";
import { icon } from "../ui/icons.js?v=20260722";
import { confirmActionDialog, requestTextDialog } from "../ui/action-dialog.js";

const PRODUCTION_TABS = [
  { id: "plans", label: "Production plans" },
  { id: "batches", label: "Batches & quality control" },
  { id: "issues", label: "Production issues" },
  { id: "reports", label: "Output reports" }
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function activeTab() {
  if (typeof window === "undefined") return "plans";
  const requested = new URLSearchParams(window.location.hash.split("?")[1] || "").get("tab") || "plans";
  return PRODUCTION_TABS.some((tab) => tab.id === requested) ? requested : "plans";
}

function textLabel(value) {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function finishedProducts(state) {
  return (state.products || []).filter((product) => product.status !== "inactive" && stockCategoryIdForProduct(product) === "finished_products");
}

function rawMaterials(state) {
  return (state.products || []).filter((product) => product.status !== "inactive" && stockCategoryIdForProduct(product) === "raw_materials");
}

function productOptions(products, placeholder) {
  return `<option value="">${escapeHtml(placeholder)}</option>${products.map((product) => `
    <option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} (${escapeHtml(product.id)})</option>
  `).join("")}`;
}

function planActualForProduct(state, planId, productId) {
  return (state.productionBatches || [])
    .filter((batch) => batch.planId === planId && batch.finishedProductId === productId)
    .reduce((total, batch) => total + Number(batch.quantityProduced || 0), 0);
}

function planProgress(state, plan) {
  const planned = (plan.lines || []).reduce((total, line) => total + Number(line.quantity || 0), 0);
  const actual = (plan.lines || []).reduce((total, line) => total + planActualForProduct(state, plan.id, line.productId), 0);
  return { planned, actual, percent: planned > 0 ? Math.min(100, (actual / planned) * 100) : 0 };
}

function productionMetrics(state) {
  const managedBatches = (state.productionBatches || []).filter((batch) => batch.planId);
  const planned = (state.productionPlans || []).reduce((total, plan) => total + (plan.lines || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0), 0);
  const produced = managedBatches.reduce((total, batch) => total + Number(batch.quantityProduced || 0), 0);
  const wastage = managedBatches.reduce((total, batch) => total + Number(batch.quantityRejected || 0) + Number(batch.quantityDamaged || 0) + Number(batch.quantityWasted || 0), 0);
  const totalOutput = produced + wastage;
  const downtime = (state.productionIssues || []).reduce((total, issue) => total + Number(issue.downtimeMinutes || 0), 0);
  return {
    planned,
    produced,
    wastage,
    efficiency: planned > 0 ? (produced / planned) * 100 : 0,
    yieldPercent: totalOutput > 0 ? (produced / totalOutput) * 100 : 0,
    downtime
  };
}

function renderMetrics(state) {
  const metrics = productionMetrics(state);
  return `<div class="metric-grid production-metric-grid">
    ${metricCard({ label: "Planned output", value: formatNumber(metrics.planned), meta: "Units across daily and weekly plans", iconName: "orders" })}
    ${metricCard({ label: "Actual output", value: formatNumber(metrics.produced), meta: `${formatPercent(metrics.efficiency)} of plan`, iconName: "package" })}
    ${metricCard({ label: "Production yield", value: formatPercent(metrics.yieldPercent), meta: `${formatNumber(metrics.wastage)} rejected, damaged, or wasted`, iconName: "check" })}
    ${metricCard({ label: "Machine downtime", value: `${formatNumber(metrics.downtime)} min`, meta: "Reported production downtime", iconName: "alert" })}
  </div>`;
}

function renderPlanRows(state) {
  return [...(state.productionPlans || [])]
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .map((plan) => {
      const progress = planProgress(state, plan);
      const productSummary = (plan.lines || []).map((line) => `${line.productName}: ${formatNumber(line.quantity)}`).join(" · ");
      return `<tr data-search-index="${escapeHtml(`${plan.name} ${plan.team} ${plan.shift} ${plan.machine} ${productSummary}`.toLowerCase())}">
        <td><strong>${escapeHtml(plan.name)}</strong><div class="muted">${escapeHtml(plan.id)} · ${escapeHtml(textLabel(plan.cadence))}</div></td>
        <td>${formatDate(plan.startDate)}${plan.endDate !== plan.startDate ? ` – ${formatDate(plan.endDate)}` : ""}</td>
        <td><strong>${formatNumber(progress.actual)} / ${formatNumber(progress.planned)}</strong><div class="muted">${formatPercent(progress.percent)} complete</div></td>
        <td><strong>${escapeHtml(plan.team)}</strong><div class="muted">${escapeHtml(plan.shift)} · ${escapeHtml(plan.machine)}</div></td>
        <td><div class="production-product-summary">${escapeHtml(productSummary)}</div></td>
        <td>${statusPill(plan.status || "planned")}</td>
      </tr>`;
    });
}

function renderPlans(state) {
  return `<section class="panel production-plans-panel">
    ${panelHeader("Daily and weekly production plans", "Choose products, target quantities, teams, shifts, and machines")}
    ${table(["Plan", "Schedule", "Actual / planned", "Work assignment", "Products", "Status"], renderPlanRows(state), "No production plans have been created")}
  </section>`;
}

function batchActionButtons(batch) {
  if (!batch.planId) return '<span class="muted">Legacy batch</span>';
  if (["awaiting_qc", "qc_failed"].includes(batch.status)) {
    return textButton({ iconName: "check", label: batch.status === "qc_failed" ? "Repeat quality check" : "Perform quality check", className: "primary js-open-production-qc", data: { "batch-id": batch.id } });
  }
  if (batch.status === "qc_passed") {
    return textButton({ iconName: "check", label: "Approve batch", className: "primary js-approve-production-batch", data: { "batch-id": batch.id } });
  }
  if (batch.status === "approved") {
    return textButton({ iconName: "truck", label: "Transfer to warehouse", className: "primary js-transfer-production-batch", data: { "batch-id": batch.id } });
  }
  return batch.status === "transferred" ? '<span class="muted">In finished-goods stock</span>' : "";
}

function renderBatchRows(state) {
  return [...(state.productionBatches || [])]
    .sort((a, b) => String(b.createdAt || b.batchDate || "").localeCompare(String(a.createdAt || a.batchDate || "")))
    .map((batch) => `<tr data-search-index="${escapeHtml(`${batch.reference} ${batch.finishedProductName} ${batch.team} ${batch.machine} ${batch.status}`.toLowerCase())}">
      <td><strong>${escapeHtml(batch.reference || batch.id)}</strong><div class="muted">${formatDate(batch.batchDate)} · expires ${batch.expiryDate ? formatDate(batch.expiryDate) : "not recorded"}</div></td>
      <td><strong>${escapeHtml(batch.finishedProductName || batch.finishedProductId)}</strong><div class="muted">Plan ${formatNumber(batch.plannedQuantity || batch.quantityProduced || 0)}</div></td>
      <td><strong>${formatNumber(batch.quantityProduced || 0)} produced</strong><div class="muted">${formatNumber(batch.quantityRejected || 0)} rejected · ${formatNumber(batch.quantityDamaged || 0)} damaged · ${formatNumber(batch.quantityWasted || 0)} wasted</div></td>
      <td><strong>${escapeHtml(batch.team || "Factory team")}</strong><div class="muted">${escapeHtml(batch.shift || "Shift not recorded")} · ${escapeHtml(batch.machine || "Machine not recorded")}</div></td>
      <td>${statusPill(batch.qualityStatus || (batch.status === "transferred" ? "passed" : "pending"))}<div class="muted">${escapeHtml(batch.qualityCheckedBy || "QC pending")}</div></td>
      <td>${statusPill(batch.status || "transferred")}</td>
      <td><div class="row-actions">${batchActionButtons(batch)}</div></td>
    </tr>`);
}

function renderBatches(state) {
  return `<section class="panel production-batches-panel">
    ${panelHeader("Production batches and quality control", "Record output and losses, confirm QC, approve completed batches, then transfer finished goods")}
    ${table(["Batch", "Product", "Output", "Assignment", "Quality", "Stage", "Actions"], renderBatchRows(state), "No production batches have been recorded")}
  </section>`;
}

function renderIssueRows(state) {
  return [...(state.productionIssues || [])]
    .sort((a, b) => String(b.reportedAt || "").localeCompare(String(a.reportedAt || "")))
    .map((issue) => `<tr data-search-index="${escapeHtml(`${issue.issueType} ${issue.machine} ${issue.description} ${issue.status}`.toLowerCase())}">
      <td><strong>${escapeHtml(textLabel(issue.issueType))}</strong><div class="muted">${escapeHtml(issue.id)}</div></td>
      <td>${statusPill(issue.severity || "medium")}</td>
      <td>${escapeHtml(issue.machine || "Production line")}</td>
      <td>${escapeHtml(issue.description)}${issue.resolution ? `<div class="muted">Resolution: ${escapeHtml(issue.resolution)}</div>` : ""}</td>
      <td>${formatNumber(issue.downtimeMinutes || 0)} min</td>
      <td>${formatDate(String(issue.reportedAt || "").slice(0, 10))}<div class="muted">${escapeHtml(issue.reportedBy || "Production manager")}</div></td>
      <td>${statusPill(issue.status || "open")}</td>
      <td>${issue.status === "open" ? textButton({ iconName: "check", label: "Resolve", className: "primary js-resolve-production-issue", data: { "issue-id": issue.id } }) : ""}</td>
    </tr>`);
}

function renderIssues(state) {
  return `<section class="panel production-issues-panel">
    ${panelHeader("Production issues", "Machine downtime, shortages, delays, quality concerns, and other production exceptions")}
    ${table(["Issue", "Severity", "Machine", "Details", "Downtime", "Reported", "Status", "Actions"], renderIssueRows(state), "No production issues have been reported")}
  </section>`;
}

function renderReportRows(state) {
  return (state.productionPlans || []).flatMap((plan) => (plan.lines || []).map((line) => {
    const batches = (state.productionBatches || []).filter((batch) => batch.planId === plan.id && batch.finishedProductId === line.productId);
    const actual = batches.reduce((total, batch) => total + Number(batch.quantityProduced || 0), 0);
    const losses = batches.reduce((total, batch) => total + Number(batch.quantityRejected || 0) + Number(batch.quantityDamaged || 0) + Number(batch.quantityWasted || 0), 0);
    const efficiency = Number(line.quantity || 0) > 0 ? (actual / Number(line.quantity)) * 100 : 0;
    const yieldPercent = actual + losses > 0 ? (actual / (actual + losses)) * 100 : 0;
    return `<tr>
      <td><strong>${escapeHtml(plan.name)}</strong><div class="muted">${formatDate(plan.startDate)}</div></td>
      <td>${escapeHtml(line.productName)}</td>
      <td>${formatNumber(line.quantity)}</td>
      <td>${formatNumber(actual)}</td>
      <td>${formatNumber(actual - Number(line.quantity || 0))}</td>
      <td>${formatPercent(efficiency)}</td>
      <td>${formatNumber(losses)}</td>
      <td>${formatPercent(yieldPercent)}</td>
    </tr>`;
  }));
}

function renderReports(state) {
  return `<section class="panel production-reports-panel">
    ${panelHeader("Production efficiency, wastage, and output", "Compare planned quantities with actual good output and production losses")}
    ${table(["Plan", "Product", "Planned", "Actual", "Variance", "Plan efficiency", "Losses", "Yield"], renderReportRows(state), "Create a production plan and record a batch to see output reports")}
  </section>`;
}

function renderPlanProductRow(state) {
  return `<div class="production-form-line" data-production-plan-line>
    <label class="field"><span>Product</span><select name="planProductId" required>${productOptions(finishedProducts(state), "Choose finished product")}</select></label>
    <label class="field"><span>Quantity to produce</span><input name="planQuantity" type="number" min="1" step="1" inputmode="numeric" required></label>
    <button class="icon-button js-remove-production-line" type="button" title="Remove product" aria-label="Remove product">${icon("x")}</button>
  </div>`;
}

function renderMaterialRow(state) {
  return `<div class="production-form-line" data-production-material-line>
    <label class="field"><span>Saved raw material</span><select name="materialId">${productOptions(rawMaterials(state), "Choose saved material (optional)")}</select></label>
    <label class="field"><span>Or type raw material</span><input name="materialName" placeholder="e.g. Fresh ginger"></label>
    <label class="field"><span>Quantity issued</span><input name="materialQuantity" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="Optional"></label>
    <label class="field"><span>Unit</span><input name="materialUnit" placeholder="kg, litres, bags..."></label>
    <button class="icon-button js-remove-production-material" type="button" title="Remove raw material" aria-label="Remove raw material">${icon("x")}</button>
  </div>`;
}

function modalHeader(eyebrow, title, closeClass) {
  return `<header class="stock-modal-header"><div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h2>${escapeHtml(title)}</h2></div>${textButton({ iconName: "x", label: "Close", className: closeClass })}</header>`;
}

function renderProductionModals(state) {
  const plans = (state.productionPlans || []).filter((plan) => !["cancelled", "completed"].includes(plan.status));
  return `
    <div id="production-plan-modal" class="stock-modal-backdrop" hidden><section class="stock-modal production-workflow-modal" role="dialog" aria-modal="true">
      ${modalHeader("Production planning", "Create production plan", "js-close-production-plan")}
      <form id="production-plan-form" class="manager-form-grid" novalidate>
        <label class="field"><span>Plan name</span><input name="name" placeholder="Week 32 production" required></label>
        <label class="field"><span>Plan period</span><select name="cadence"><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
        <label class="field"><span>Start date</span><input name="startDate" type="date" value="${todayISO()}" required></label>
        <label class="field"><span>End date</span><input name="endDate" type="date" value="${todayISO()}" required></label>
        <fieldset class="span-full production-line-fieldset"><legend>Products and target quantities</legend><div data-production-plan-lines>${renderPlanProductRow(state)}</div>${textButton({ iconName: "plus", label: "Add product", className: "js-add-production-line" })}</fieldset>
        <label class="field"><span>Team</span><input name="team" placeholder="Team A" required></label>
        <label class="field"><span>Shift</span><input name="shift" placeholder="Day shift" required></label>
        <label class="field"><span>Machine or production line</span><input name="machine" placeholder="Line 1" required></label>
        <label class="field span-full"><span>Plan notes</span><textarea name="notes" rows="3" placeholder="Priority, packaging, or production instructions"></textarea></label>
        <span class="field-error span-full" data-production-plan-error></span>
        <div class="manager-form-actions span-full"><button class="button primary" type="submit">${icon("check")}<span>Create plan</span></button></div>
      </form>
    </section></div>

    <div id="production-batch-modal" class="stock-modal-backdrop" hidden><section class="stock-modal production-workflow-modal" role="dialog" aria-modal="true">
      ${modalHeader("Production execution", "Record completed production", "js-close-production-batch")}
      <form id="managed-production-batch-form" class="manager-form-grid" novalidate>
        <label class="field"><span>Production plan</span><select name="planId" required><option value="">Choose plan</option>${plans.map((plan) => `<option value="${escapeHtml(plan.id)}">${escapeHtml(plan.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Product produced</span><select name="finishedProductId" required><option value="">Choose a plan first</option></select></label>
        <label class="field"><span>Batch number</span><input name="batchReference" placeholder="BATCH-2026-001" required></label>
        <label class="field"><span>Production date</span><input name="batchDate" type="date" value="${todayISO()}" required></label>
        <label class="field"><span>Expiry date</span><input name="expiryDate" type="date" required></label>
        <label class="field"><span>Good quantity produced</span><input name="quantityProduced" type="number" min="1" step="1" inputmode="numeric" required></label>
        <label class="field"><span>Rejected quantity</span><input name="quantityRejected" type="number" min="0" step="1" value="0"></label>
        <label class="field"><span>Damaged quantity</span><input name="quantityDamaged" type="number" min="0" step="1" value="0"></label>
        <label class="field"><span>Wasted quantity</span><input name="quantityWasted" type="number" min="0" step="1" value="0"></label>
        <label class="field"><span>Team</span><input name="team" readonly></label>
        <label class="field"><span>Shift</span><input name="shift" readonly></label>
        <label class="field"><span>Machine</span><input name="machine" readonly></label>
        <fieldset class="span-full production-line-fieldset"><legend>Raw materials issued for this batch <span class="muted">(optional)</span></legend><p class="muted">Select a saved material to deduct it from stock, or type a material that is not yet saved in the system.</p><div data-production-material-lines>${renderMaterialRow(state)}</div>${textButton({ iconName: "plus", label: "Add raw material", className: "js-add-production-material" })}</fieldset>
        <label class="field span-full"><span>Production notes</span><textarea name="notes" rows="3"></textarea></label>
        <span class="field-error span-full" data-production-batch-error></span>
        <div class="manager-form-actions span-full"><button class="button primary" type="submit">${icon("check")}<span>Record batch for quality check</span></button></div>
      </form>
    </section></div>

    <div id="production-qc-modal" class="stock-modal-backdrop" hidden><section class="stock-modal production-workflow-modal" role="dialog" aria-modal="true">
      ${modalHeader("Quality control (QC)", "Confirm batch quality", "js-close-production-qc")}
      <form id="production-qc-form" class="manager-form-grid" novalidate><input name="batchId" type="hidden">
        <p class="muted span-full">Quality control checks that the batch meets appearance, measurement, packaging, and safety standards before approval.</p>
        <div class="span-full production-qc-checks">
          <label><input name="appearance" type="checkbox"> Appearance and colour checked</label>
          <label><input name="weight" type="checkbox"> Weight or volume checked</label>
          <label><input name="packaging" type="checkbox"> Packaging and seal checked</label>
          <label><input name="safety" type="checkbox"> Safety and contamination check completed</label>
        </div>
        <label class="field"><span>QC outcome</span><select name="outcome" required><option value="">Choose outcome</option><option value="passed">Passed</option><option value="failed">Failed</option></select></label>
        <label class="field span-full"><span>QC notes</span><textarea name="notes" rows="4" placeholder="Required when QC fails"></textarea></label>
        <span class="field-error span-full" data-production-qc-error></span>
        <div class="manager-form-actions span-full"><button class="button primary" type="submit">${icon("check")}<span>Save quality check</span></button></div>
      </form>
    </section></div>

    <div id="production-issue-modal" class="stock-modal-backdrop" hidden><section class="stock-modal production-workflow-modal" role="dialog" aria-modal="true">
      ${modalHeader("Production exception", "Report production issue", "js-close-production-issue")}
      <form id="production-issue-form" class="manager-form-grid" novalidate>
        <label class="field"><span>Issue type</span><select name="issueType"><option value="machine_downtime">Machine downtime</option><option value="material_shortage">Material shortage</option><option value="delay">Production delay</option><option value="quality">Quality concern</option><option value="other">Other issue</option></select></label>
        <label class="field"><span>Severity</span><select name="severity"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
        <label class="field"><span>Related plan</span><select name="planId"><option value="">No specific plan</option>${plans.map((plan) => `<option value="${escapeHtml(plan.id)}">${escapeHtml(plan.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Machine or line</span><input name="machine" placeholder="Line 1"></label>
        <label class="field"><span>Downtime in minutes</span><input name="downtimeMinutes" type="number" min="0" step="1" value="0"></label>
        <label class="field span-full"><span>Issue details</span><textarea name="description" rows="4" required></textarea></label>
        <span class="field-error span-full" data-production-issue-error></span>
        <div class="manager-form-actions span-full"><button class="button primary" type="submit">${icon("alert")}<span>Report issue</span></button></div>
      </form>
    </section></div>
  `;
}

export function renderProduction({ state }) {
  if (currentUserRole(state) !== "production_manager" || !currentUserPermissions(state).canPlanProduction) {
    return `<section class="view"><section class="panel"><div class="empty-state">Production management access is required.</div></section></section>`;
  }
  const tab = activeTab();
  return `<section class="view production-view">
    <section class="ceo-command-strip production-command-strip">
      <div><span class="eyebrow">Production Line Manager portal</span><h2>Production control</h2><p>Plan, execute, check, approve, transfer, and report production work.</p></div>
      <div class="row-actions">
        ${textButton({ iconName: "orders", label: "Create plan", className: "primary js-open-production-plan" })}
        ${textButton({ iconName: "package", label: "Record batch", className: "js-open-production-batch" })}
        ${textButton({ iconName: "alert", label: "Report issue", className: "js-open-production-issue" })}
      </div>
    </section>
    ${renderMetrics(state)}
    <nav class="subtab-nav stock-subtabs" aria-label="Production pages">${PRODUCTION_TABS.map((item) => `<a class="subtab-link ${item.id === tab ? "is-active" : ""}" href="#/production?tab=${item.id}" aria-current="${item.id === tab ? "page" : "false"}">${escapeHtml(item.label)}</a>`).join("")}</nav>
    ${tab === "plans" ? renderPlans(state) : tab === "batches" ? renderBatches(state) : tab === "issues" ? renderIssues(state) : renderReports(state)}
    ${renderProductionModals(state)}
  </section>`;
}

export function bindProduction({ root, store }) {
  const state = store.getState();
  const planModal = qs("#production-plan-modal", root);
  const batchModal = qs("#production-batch-modal", root);
  const qcModal = qs("#production-qc-modal", root);
  const issueModal = qs("#production-issue-modal", root);
  const planForm = qs("#production-plan-form", root);
  const batchForm = qs("#managed-production-batch-form", root);
  const qcForm = qs("#production-qc-form", root);
  const issueForm = qs("#production-issue-form", root);

  function open(modal) { if (modal) { modal.hidden = false; qs("input:not([type='hidden']), select, textarea", modal)?.focus(); } }
  function close(modal) { if (modal) modal.hidden = true; }
  function syncRemoveButtons(container, rowSelector, buttonSelector) {
    const rows = qsa(rowSelector, container);
    rows.forEach((row) => { const button = qs(buttonSelector, row); if (button) button.disabled = rows.length === 1; });
  }
  function bindRemoveButtons(container, rowSelector, buttonSelector) {
    qsa(buttonSelector, container).forEach((button) => button.addEventListener("click", () => {
      button.closest(rowSelector)?.remove();
      syncRemoveButtons(container, rowSelector, buttonSelector);
    }));
    syncRemoveButtons(container, rowSelector, buttonSelector);
  }

  qs(".js-open-production-plan", root)?.addEventListener("click", () => open(planModal));
  qs(".js-open-production-batch", root)?.addEventListener("click", () => open(batchModal));
  qs(".js-open-production-issue", root)?.addEventListener("click", () => open(issueModal));
  qsa(".js-close-production-plan", root).forEach((button) => button.addEventListener("click", () => close(planModal)));
  qsa(".js-close-production-batch", root).forEach((button) => button.addEventListener("click", () => close(batchModal)));
  qsa(".js-close-production-qc", root).forEach((button) => button.addEventListener("click", () => close(qcModal)));
  qsa(".js-close-production-issue", root).forEach((button) => button.addEventListener("click", () => close(issueModal)));

  const planLines = qs("[data-production-plan-lines]", planForm);
  bindRemoveButtons(planLines, "[data-production-plan-line]", ".js-remove-production-line");
  qs(".js-add-production-line", planForm)?.addEventListener("click", () => {
    planLines.insertAdjacentHTML("beforeend", renderPlanProductRow(store.getState()));
    bindRemoveButtons(planLines, "[data-production-plan-line]", ".js-remove-production-line");
  });

  const materialLines = qs("[data-production-material-lines]", batchForm);
  bindRemoveButtons(materialLines, "[data-production-material-line]", ".js-remove-production-material");
  qs(".js-add-production-material", batchForm)?.addEventListener("click", () => {
    materialLines.insertAdjacentHTML("beforeend", renderMaterialRow(store.getState()));
    bindRemoveButtons(materialLines, "[data-production-material-line]", ".js-remove-production-material");
  });

  const planSelect = batchForm?.elements.planId;
  function syncBatchPlan() {
    const plan = (store.getState().productionPlans || []).find((item) => item.id === planSelect?.value);
    if (!batchForm) return;
    batchForm.elements.finishedProductId.innerHTML = `<option value="">Choose product</option>${(plan?.lines || []).map((line) => `<option value="${escapeHtml(line.productId)}">${escapeHtml(line.productName)} — planned ${formatNumber(line.quantity)}</option>`).join("")}`;
    batchForm.elements.team.value = plan?.team || "";
    batchForm.elements.shift.value = plan?.shift || "";
    batchForm.elements.machine.value = plan?.machine || "";
  }
  planSelect?.addEventListener("change", syncBatchPlan);

  planForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(planForm);
    const productIds = data.getAll("planProductId").map(String);
    const quantities = data.getAll("planQuantity").map(Number);
    const lines = productIds.map((productId, index) => ({ productId, quantity: quantities[index] }));
    const error = qs("[data-production-plan-error]", planForm);
    if (String(data.get("endDate")) < String(data.get("startDate"))) {
      error.textContent = "The plan end date cannot be before its start date.";
      return;
    }
    if (!data.get("name") || !data.get("startDate") || !data.get("endDate") || !data.get("team") || !data.get("shift") || !data.get("machine") || lines.some((line) => !line.productId || line.quantity <= 0)) {
      error.textContent = "Complete the schedule, product quantities, team, shift, and machine.";
      return;
    }
    store.dispatch({ type: "CREATE_PRODUCTION_PLAN", name: data.get("name"), cadence: data.get("cadence"), startDate: data.get("startDate"), endDate: data.get("endDate"), lines, team: data.get("team"), shift: data.get("shift"), machine: data.get("machine"), notes: data.get("notes"), message: "Production plan created" });
    close(planModal);
  });

  batchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(batchForm);
    const materialIds = data.getAll("materialId").map(String);
    const materialNames = data.getAll("materialName").map(String);
    const materialQuantities = data.getAll("materialQuantity").map(Number);
    const materialUnits = data.getAll("materialUnit").map(String);
    const materials = materialIds.map((productId, index) => ({ productId, name: materialNames[index], quantity: materialQuantities[index], unit: materialUnits[index] }))
      .filter((material) => material.productId || String(material.name || "").trim() || material.quantity > 0);
    const error = qs("[data-production-batch-error]", batchForm);
    const rawState = store.getState();
    const invalidMaterial = materials.find((material) => {
      if ((!material.productId && !String(material.name || "").trim()) || material.quantity <= 0) return true;
      if (!material.productId) return false;
      return material.quantity > Number(rawState.products.find((product) => product.id === material.productId)?.stock || 0);
    });
    if (String(data.get("expiryDate")) < String(data.get("batchDate"))) {
      error.textContent = "The expiry date cannot be before the production date.";
      return;
    }
    if (!data.get("planId") || !data.get("finishedProductId") || !data.get("batchReference") || !data.get("batchDate") || !data.get("expiryDate") || Number(data.get("quantityProduced")) <= 0 || invalidMaterial) {
      error.textContent = invalidMaterial ? "Complete each entered material and keep saved-material quantities within current stock." : "Complete the plan, batch dates, and good output quantity.";
      return;
    }
    store.dispatch({ type: "RECORD_MANAGED_PRODUCTION_BATCH", planId: data.get("planId"), finishedProductId: data.get("finishedProductId"), batchReference: data.get("batchReference"), batchDate: data.get("batchDate"), expiryDate: data.get("expiryDate"), quantityProduced: Number(data.get("quantityProduced")), quantityRejected: Number(data.get("quantityRejected")), quantityDamaged: Number(data.get("quantityDamaged")), quantityWasted: Number(data.get("quantityWasted")), team: data.get("team"), shift: data.get("shift"), machine: data.get("machine"), materials, notes: data.get("notes"), message: "Production batch recorded for QC" });
    close(batchModal);
  });

  qsa(".js-open-production-qc", root).forEach((button) => button.addEventListener("click", () => {
    qcForm.reset();
    qcForm.elements.batchId.value = button.dataset.batchId;
    open(qcModal);
  }));
  qcForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(qcForm);
    const outcome = String(data.get("outcome") || "");
    const notes = String(data.get("notes") || "").trim();
    const error = qs("[data-production-qc-error]", qcForm);
    const checks = { appearance: data.has("appearance"), weight: data.has("weight"), packaging: data.has("packaging"), safety: data.has("safety") };
    if (!outcome || (outcome === "passed" && !Object.values(checks).every(Boolean)) || (outcome === "failed" && !notes)) {
      error.textContent = outcome === "passed" ? "Confirm every quality-control check before passing this batch." : "Choose the QC outcome and explain any failure.";
      return;
    }
    store.dispatch({ type: "RECORD_PRODUCTION_QC", batchId: data.get("batchId"), outcome, checks, notes, message: `Quality control ${outcome}` });
    close(qcModal);
  });

  qsa(".js-approve-production-batch", root).forEach((button) => button.addEventListener("click", async () => {
    const batch = (store.getState().productionBatches || []).find((item) => item.id === button.dataset.batchId);
    const approved = await confirmActionDialog({ title: "Approve completed batch?", message: `${batch?.reference || "This batch"} passed QC and will become eligible for finished-goods transfer.`, confirmLabel: "Approve batch" });
    if (approved) store.dispatch({ type: "APPROVE_PRODUCTION_BATCH", batchId: button.dataset.batchId, message: "Production batch approved" });
  }));
  qsa(".js-transfer-production-batch", root).forEach((button) => button.addEventListener("click", async () => {
    const batch = (store.getState().productionBatches || []).find((item) => item.id === button.dataset.batchId);
    const approved = await confirmActionDialog({ title: "Transfer finished goods?", message: `${formatNumber(batch?.quantityProduced || 0)} ${batch?.finishedProductName || "finished units"} will be added to warehouse stock.`, confirmLabel: "Transfer stock" });
    if (approved) store.dispatch({ type: "TRANSFER_PRODUCTION_BATCH", batchId: button.dataset.batchId, message: "Finished goods transferred" });
  }));

  issueForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(issueForm);
    const error = qs("[data-production-issue-error]", issueForm);
    if (!String(data.get("description") || "").trim() || (data.get("issueType") === "machine_downtime" && Number(data.get("downtimeMinutes")) <= 0)) {
      error.textContent = "Describe the issue and record downtime minutes for machine downtime.";
      return;
    }
    store.dispatch({ type: "REPORT_PRODUCTION_ISSUE", issueType: data.get("issueType"), severity: data.get("severity"), planId: data.get("planId"), machine: data.get("machine"), downtimeMinutes: Number(data.get("downtimeMinutes")), description: data.get("description"), message: "Production issue reported" });
    close(issueModal);
  });
  qsa(".js-resolve-production-issue", root).forEach((button) => button.addEventListener("click", async () => {
    const resolution = await requestTextDialog({ title: "Resolve production issue", message: "Record how the issue was resolved.", label: "Resolution", placeholder: "Resolution details", confirmLabel: "Mark resolved" });
    if (resolution !== null) store.dispatch({ type: "RESOLVE_PRODUCTION_ISSUE", issueId: button.dataset.issueId, resolution, message: "Production issue resolved" });
  }));
}
