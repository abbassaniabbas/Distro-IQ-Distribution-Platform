import { creditUsageTone, getCreditLimitForParty } from "../services/calculations.js";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "../services/formatters.js";
import { currentUserPermissions } from "../services/rbac.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { panelHeader, progressBar, statusPill, textButton } from "../ui/components.js";

function formatTermPercent(value) {
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(Number(value || 0))}%`;
}

function renderSupermarketManager(state, permissions) {
  if (!permissions.canManageCustomers) return "";

  return `
    <section class="panel manager-tool-panel">
      ${panelHeader("Supermarket relationship", "Add or update customer details, channel, territory, and credit terms")}
      <form id="retailer-form" class="manager-form-grid" novalidate>
        <input type="hidden" name="retailerId">
        <label class="field">
          <span>Supermarket name</span>
          <input name="name" placeholder="Lekki Family Mart" required>
        </label>
        <label class="field">
          <span>City</span>
          <input name="city" placeholder="Lagos">
        </label>
        <label class="field">
          <span>Territory</span>
          <input name="region" placeholder="South West">
        </label>
        <label class="field">
          <span>Tier</span>
          <select name="tier">
            <option value="Platinum">Platinum</option>
            <option value="Gold">Gold</option>
            <option value="Silver">Silver</option>
            <option value="Bronze">Bronze</option>
            <option value="Standard">Standard</option>
          </select>
        </label>
        <label class="field">
          <span>Channel</span>
          <input name="channel" placeholder="Supermarket, Wholesale, Kiosk">
        </label>
        <label class="field">
          <span>Contact person</span>
          <input name="contact" placeholder="Store manager">
        </label>
        <label class="field">
          <span>Fill rate</span>
          <input name="fillRate" type="number" min="0" max="100" step="1" inputmode="numeric" placeholder="90">
        </label>
        <label class="field">
          <span>Outstanding balance</span>
          <input name="outstanding" type="number" min="0" step="1000" inputmode="numeric" placeholder="0">
        </label>
        <label class="field">
          <span>Credit limit</span>
          <input name="creditLimit" type="number" min="0" step="1000" inputmode="numeric" placeholder="0">
        </label>
        <label class="field">
          <span>Discount</span>
          <input name="discountPercent" type="number" min="0" max="100" step="0.1" inputmode="decimal" placeholder="0">
        </label>
        <label class="field">
          <span>Payment period</span>
          <input name="paymentPeriodDays" type="number" min="0" step="1" inputmode="numeric" placeholder="14">
        </label>
        <label class="field">
          <span>Late penalty</span>
          <input name="latePenaltyPercent" type="number" min="0" max="100" step="0.1" inputmode="decimal" placeholder="0">
        </label>
        <div class="manager-form-actions span-full">
          ${textButton({
            iconName: "check",
            label: "Save supermarket",
            className: "primary",
            type: "submit"
          })}
          ${textButton({
            iconName: "refresh",
            label: "Clear",
            className: "js-clear-retailer-form"
          })}
        </div>
        <span id="retailer-form-message" class="field-error span-full"></span>
      </form>
    </section>
  `;
}

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
        <div class="split">
          <span class="muted">Payment terms</span>
          <strong>${formatNumber(creditLimit?.paymentPeriodDays ?? 14)} days</strong>
        </div>
        <div class="split">
          <span class="muted">Discount / penalty</span>
          <strong>${formatTermPercent(creditLimit?.discountPercent)} / ${formatTermPercent(creditLimit?.latePenaltyPercent)}</strong>
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
        <div class="row-actions">
          ${permissions.canManageCustomers
            ? textButton({
                iconName: "settings",
                label: "Edit",
                className: "js-edit-retailer",
                data: { "retailer-id": retailer.id }
              })
            : ""}
          ${textButton({
            iconName: "userCheck",
            label: "Contacted",
            className: "js-log-touch",
            disabled: !canLogContact,
            data: { "retailer-id": retailer.id }
          })}
        </div>
      </footer>
    </article>
  `;
}

export function renderRetailers({ state }) {
  const tiers = [...new Set(state.retailers.map((retailer) => retailer.tier))].sort();
  const permissions = currentUserPermissions(state);

  return `
    <section class="view retailers-view">
      ${renderSupermarketManager(state, permissions)}
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
  const retailerForm = qs("#retailer-form", root);

  tierFilter.addEventListener("change", () => {
    qsa(".retailer-card", root).forEach((card) => {
      card.hidden = tierFilter.value !== "all" && card.dataset.tier !== tierFilter.value;
    });
  });

  function fillRetailerForm(retailerId) {
    const state = store.getState();
    const retailer = state.retailers.find((item) => item.id === retailerId);
    if (!retailerForm || !retailer) return;

    const creditLimit = getCreditLimitForParty(state.creditLimits || [], retailer.name);
    retailerForm.elements.retailerId.value = retailer.id;
    retailerForm.elements.name.value = retailer.name || "";
    retailerForm.elements.city.value = retailer.city || "";
    retailerForm.elements.region.value = retailer.region || "";
    retailerForm.elements.tier.value = retailer.tier || "Standard";
    retailerForm.elements.channel.value = retailer.channel || "";
    retailerForm.elements.contact.value = retailer.contact || "";
    retailerForm.elements.fillRate.value = retailer.fillRate || 0;
    retailerForm.elements.outstanding.value = creditLimit?.balance ?? retailer.outstanding ?? 0;
    retailerForm.elements.creditLimit.value = creditLimit?.limit || 0;
    retailerForm.elements.discountPercent.value = creditLimit?.discountPercent || 0;
    retailerForm.elements.paymentPeriodDays.value = creditLimit?.paymentPeriodDays ?? 14;
    retailerForm.elements.latePenaltyPercent.value = creditLimit?.latePenaltyPercent || 0;
    retailerForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  retailerForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(retailerForm);
    const message = qs("#retailer-form-message", root);

    if (message) message.textContent = "";

    if (!String(formData.get("name") || "").trim()) {
      if (message) message.textContent = "Supermarket name is required.";
      return;
    }

    store.dispatch({
      type: "UPSERT_RETAILER",
      retailerId: formData.get("retailerId"),
      name: formData.get("name"),
      city: formData.get("city"),
      region: formData.get("region"),
      tier: formData.get("tier"),
      channel: formData.get("channel"),
      contact: formData.get("contact"),
      fillRate: formData.get("fillRate"),
      outstanding: formData.get("outstanding"),
      creditLimit: formData.get("creditLimit"),
      discountPercent: formData.get("discountPercent"),
      paymentPeriodDays: formData.get("paymentPeriodDays"),
      latePenaltyPercent: formData.get("latePenaltyPercent"),
      message: "Supermarket relationship saved"
    });
  });

  qs(".js-clear-retailer-form", root)?.addEventListener("click", () => {
    retailerForm?.reset();
    if (retailerForm?.elements.retailerId) retailerForm.elements.retailerId.value = "";
  });

  qsa(".js-edit-retailer", root).forEach((button) => {
    button.addEventListener("click", () => {
      fillRetailerForm(button.dataset.retailerId);
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
