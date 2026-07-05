import { creditUsageTone, getCreditLimitForParty } from "../services/calculations.js";
import { formatCurrency, formatDate, formatPercent } from "../services/formatters.js";
import { currentUserPermissions } from "../services/rbac.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { panelHeader, progressBar, statusPill, textButton } from "../ui/components.js";

function renderRetailerCard(retailer, state, permissions) {
  const canLogContact = permissions.canManageCustomers || permissions.canLogSalesReturns;
  const creditLimit = getCreditLimitForParty(state.creditLimits || [], retailer.name);
  const balance = Number(creditLimit?.balance ?? retailer.outstanding ?? 0);
  const limit = Number(creditLimit?.limit || 0);
  const creditUsage = limit ? (balance / limit) * 100 : 100;
  const creditStatus = creditUsage >= 100 ? "credit_hold" : creditUsage >= 85 ? "credit_watch" : "credit_clear";
  const searchIndex = [
    retailer.id,
    retailer.name,
    retailer.city,
    retailer.region,
    retailer.tier,
    retailer.channel,
    retailer.contact,
    creditStatus
  ]
    .join(" ")
    .toLowerCase();

  return `
    <article
      class="retailer-card"
      data-tier="${escapeHtml(retailer.tier)}"
      data-search-index="${escapeHtml(searchIndex)}"
    >
      <header>
        <div>
          <span class="eyebrow">${escapeHtml(retailer.id)}</span>
          <h3>${escapeHtml(retailer.name)}</h3>
        </div>
        ${statusPill(creditStatus)}
      </header>

      <div class="stack">
        <div class="split">
          <span class="muted">Territory</span>
          <strong>${escapeHtml(retailer.region)}</strong>
        </div>
        <div class="split">
          <span class="muted">Contact</span>
          <strong>${escapeHtml(retailer.contact)}</strong>
        </div>
        <div class="split">
          <span class="muted">Customer tier</span>
          <strong>${escapeHtml(retailer.tier)}</strong>
        </div>
        <div class="split">
          <span class="muted">Balance owed</span>
          <strong>${formatCurrency(balance)}</strong>
        </div>
        <div class="split">
          <span class="muted">Credit limit</span>
          <strong>${limit ? formatCurrency(limit) : "Not set"}</strong>
        </div>
      </div>

      <div class="stock-line">
        <div class="stock-meta">
          <span>Fill rate</span>
          <span>${formatPercent(retailer.fillRate)}</span>
        </div>
        ${progressBar(retailer.fillRate, retailer.fillRate < 88 ? "warning" : "good")}
      </div>

      <div class="stock-line">
        <div class="stock-meta">
          <span>Credit usage</span>
          <span>${limit ? formatPercent(creditUsage) : "No limit"}</span>
        </div>
        ${progressBar(creditUsage, creditUsageTone(creditUsage))}
      </div>

      <footer>
        <span class="muted">Last sale ${formatDate(retailer.lastOrder)}</span>
        ${textButton({
          iconName: "userCheck",
          label: "Contacted",
          className: "js-log-touch",
          disabled: !canLogContact,
          data: { "retailer-id": retailer.id }
        })}
      </footer>
    </article>
  `;
}

export function renderRetailers({ state }) {
  const tiers = [...new Set(state.retailers.map((retailer) => retailer.tier))].sort();
  const permissions = currentUserPermissions(state);

  return `
    <section class="view retailers-view">
      <section class="panel retailers-layout">
        <div class="toolbar">
          ${panelHeader("Customer outlets", "Supermarkets, kiosks, wholesalers, contacts, and balances owed")}
          <div class="toolbar-group">
            <label class="field">
              <span class="sr-only">Filter by tier</span>
              <select id="retailer-tier-filter">
                <option value="all">All tiers</option>
                ${tiers.map((tier) => `<option value="${escapeHtml(tier)}">${escapeHtml(tier)}</option>`).join("")}
              </select>
            </label>
          </div>
        </div>

        <div class="retailer-grid">
          ${state.retailers.map((retailer) => renderRetailerCard(retailer, state, permissions)).join("")}
        </div>
      </section>
    </section>
  `;
}

export function bindRetailers({ root, store }) {
  const tierFilter = qs("#retailer-tier-filter", root);

  tierFilter.addEventListener("change", () => {
    qsa(".retailer-card", root).forEach((card) => {
      card.hidden = tierFilter.value !== "all" && card.dataset.tier !== tierFilter.value;
    });
  });

  qsa(".js-log-touch", root).forEach((button) => {
    button.addEventListener("click", () => {
      store.dispatch({
        type: "LOG_RETAILER_TOUCH",
        retailerId: button.dataset.retailerId,
        message: "Customer contact logged"
      });
    });
  });
}
