import { assignmentOutstanding, buildRepLedger, creditUsageTone } from "../services/calculations.js";
import { formatCurrency, formatNumber, formatPercent, statusText } from "../services/formatters.js";
import { currentUserPermissions } from "../services/rbac.js";
import { escapeHtml, qsa } from "../ui/dom.js";
import { panelHeader, progressBar, statusPill, table, textButton } from "../ui/components.js";

function renderRouteMap() {
  return `
    <div class="route-map" aria-label="Sales rep run map">
      <span class="route-line" style="left: 17%; top: 44%; width: 26%; transform: rotate(-18deg);"></span>
      <span class="route-line" style="left: 42%; top: 34%; width: 26%; transform: rotate(24deg);"></span>
      <span class="route-line" style="left: 63%; top: 55%; width: 22%; transform: rotate(-28deg);"></span>
      <span class="route-node depot" style="left: 12%; top: 38%;">DC</span>
      <span class="route-node" style="left: 39%; top: 25%;">1</span>
      <span class="route-node" style="left: 61%; top: 53%;">2</span>
      <span class="route-node" style="left: 83%; top: 40%;">3</span>
    </div>
  `;
}

function renderRouteCard(route, state, permissions) {
  const canAdvanceRun = permissions.canDispatchStock || permissions.canAssignStock;
  const routeAssignments = (state.stockAssignments || []).filter((assignment) => assignment.routeId === route.id);
  const assignedUnits = routeAssignments.reduce((total, assignment) => total + Number(assignment.assigned || 0), 0);
  const soldUnits = routeAssignments.reduce((total, assignment) => total + Number(assignment.sold || 0), 0);
  const outstandingUnits = routeAssignments.reduce((total, assignment) => total + assignmentOutstanding(assignment), 0);
  const sellThroughPercent = assignedUnits ? (soldUnits / assignedUnits) * 100 : 0;
  const routeOrders = (state.orders || []).filter((order) => (route.orderIds || []).includes(order.id));
  const notesReady = routeOrders.filter((order) => ["ready", "printed"].includes(order.deliveryNoteStatus)).length;
  const signedOrders = routeOrders.filter((order) => order.signatureStatus === "signed").length;
  const paperTrailPercent = routeOrders.length ? (notesReady / routeOrders.length) * 100 : 100;
  const searchIndex = [
    route.id,
    route.name,
    route.driver,
    route.vehicle,
    route.region,
    statusText(route.status)
  ]
    .join(" ")
    .toLowerCase();

  return `
    <article class="route-card" data-search-index="${escapeHtml(searchIndex)}">
      <header>
        <div>
          <span class="eyebrow">${escapeHtml(route.id)}</span>
          <h3>${escapeHtml(route.name)}</h3>
        </div>
        ${statusPill(route.status)}
      </header>

      <div class="stack">
        <div class="split">
          <span class="muted">Sales rep</span>
          <strong>${escapeHtml(route.driver)}</strong>
        </div>
        <div class="split">
          <span class="muted">Assigned van</span>
          <strong>${escapeHtml(route.vehicle)}</strong>
        </div>
        <div class="split">
          <span class="muted">Stops</span>
          <strong>${formatNumber(route.stops)}</strong>
        </div>
        <div class="split">
          <span class="muted">Stock outstanding</span>
          <strong>${formatNumber(outstandingUnits)}</strong>
        </div>
        <div class="split">
          <span class="muted">Delivery notes</span>
          <strong>${formatNumber(notesReady)} / ${formatNumber(routeOrders.length)}</strong>
        </div>
      </div>

      <div class="stock-line">
        <div class="stock-meta">
          <span>Rep sell-through</span>
          <span>${formatPercent(sellThroughPercent)}</span>
        </div>
        ${progressBar(sellThroughPercent, sellThroughPercent < 65 ? "warning" : "good")}
      </div>

      <div class="stock-line">
        <div class="stock-meta">
          <span>Paper trail</span>
          <span>${formatNumber(signedOrders)} signed</span>
        </div>
        ${progressBar(paperTrailPercent, paperTrailPercent < 100 ? "warning" : "good")}
      </div>

      <footer>
        <span class="muted">${escapeHtml(route.departure)} - ${escapeHtml(route.eta)}</span>
        ${textButton({
          iconName: "arrowRight",
          label: route.status === "delivered" ? "Done" : "Advance",
          className: route.status === "delivered" ? "" : "primary js-advance-route",
          disabled: route.status === "delivered" || !canAdvanceRun,
          data: { "route-id": route.id }
        })}
      </footer>
    </article>
  `;
}

function renderRepLedgerRows(state) {
  return buildRepLedger(state).map((row) => {
    const creditStatus = row.creditUsagePercent >= 100 ? "credit_hold" : row.creditUsagePercent >= 85 ? "credit_watch" : "credit_clear";

    return `
      <tr data-search-index="${escapeHtml(`${row.repName} ${creditStatus}`.toLowerCase())}">
        <td>
          <strong>${escapeHtml(row.repName)}</strong>
          <div class="muted">${formatNumber(row.openAssignments)} open assignment${row.openAssignments === 1 ? "" : "s"}</div>
        </td>
        <td>${formatNumber(row.assigned)}</td>
        <td>
          <div class="stock-line">
            <div class="stock-meta">
              <span>${formatNumber(row.sold)} sold</span>
              <span>${formatPercent(row.sellThroughPercent)}</span>
            </div>
            ${progressBar(row.sellThroughPercent, row.sellThroughPercent < 65 ? "warning" : "good")}
          </div>
        </td>
        <td><strong>${formatNumber(row.outstanding)}</strong></td>
        <td>
          ${statusPill(creditStatus)}
          <div class="muted">${formatCurrency(row.creditBalance)} / ${formatCurrency(row.creditLimit)}</div>
        </td>
      </tr>
    `;
  });
}

export function renderRoutes({ state }) {
  const permissions = currentUserPermissions(state);

  return `
    <section class="view routes-view">
      <div class="dashboard-layout">
        <section class="panel">
          ${panelHeader("Rep run board", "Live view of today's snack stock moving with sales reps")}
          ${renderRouteMap()}
        </section>

        <section class="panel">
          ${panelHeader("Rep run mix", "Sales rep stock status by operating phase")}
          <div class="bar-list">
            ${["scheduled", "in_transit", "delivered"]
              .map((status) => {
                const count = state.routes.filter((route) => route.status === status).length;
                const percent = state.routes.length ? (count / state.routes.length) * 100 : 0;

                return `
                  <div class="bar-row" data-search-index="${escapeHtml(statusText(status).toLowerCase())}">
                    <strong>${escapeHtml(statusText(status))}</strong>
                    ${progressBar(percent)}
                    <span class="strong">${formatNumber(count)}</span>
                  </div>
                `;
              })
              .join("")}
          </div>
        </section>
      </div>

      <section class="panel routes-layout">
        ${panelHeader("Sales rep assignments", "Reps, vans, outlet stops, and assigned stock readiness")}
        <div class="route-grid">
          ${state.routes.map((route) => renderRouteCard(route, state, permissions)).join("")}
        </div>
      </section>

      <section class="panel">
        ${panelHeader("Rep custody ledger", "Assigned, sold, outstanding, and credit exposure per sales rep")}
        ${table(
          ["Sales rep", "Assigned", "Sell-through", "Outstanding", "Credit"],
          renderRepLedgerRows(state),
          "No rep custody records available"
        )}
      </section>
    </section>
  `;
}

export function bindRoutes({ root, store }) {
  qsa(".js-advance-route", root).forEach((button) => {
    button.addEventListener("click", () => {
      store.dispatch({
        type: "ADVANCE_ROUTE",
        routeId: button.dataset.routeId,
        message: "Rep run status updated"
      });
    });
  });
}
