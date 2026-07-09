import { creditUsageTone, getCreditLimitForParty, getCustomerRating } from "../services/calculations.js";
import { currencySymbolFor, formatCurrency, formatDate, formatNumber, formatPercent } from "../services/formatters.js";
import { accountForUser, currentUserPermissions } from "../services/rbac.js";
import { isModuleEnabled } from "../services/features.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { iconButton, panelHeader, progressBar, statusPill, textButton } from "../ui/components.js";

function formatTermPercent(value) {
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(Number(value || 0))}%`;
}

function renderSupermarketManager(state, permissions) {
  if (!permissions.canManageCustomers && !permissions.canAddCustomers) return "";

  const moneySymbol = currencySymbolFor(state.client);
  const canManagePaymentTerms = permissions.canManageCustomers && isModuleEnabled(state, "credit_control");
  const title = canManagePaymentTerms ? "Customer relationship" : "Add customer";
  const subtitle = canManagePaymentTerms
    ? "Add or update customer details, location, customer type, and payment terms"
    : "Create a customer outlet for sales logging";

  return `
    <section class="panel manager-tool-panel">
      ${panelHeader(title, subtitle)}
      <form id="retailer-form" class="manager-form-grid" novalidate>
        <input type="hidden" name="retailerId">
        <label class="field">
          <span>Customer name</span>
          <input name="name" placeholder="Customer outlet name" required>
        </label>
        <label class="field">
          <span>City or town</span>
          <input name="city" placeholder="Lagos">
        </label>
        <label class="field">
          <span>State</span>
          <input name="stateName" placeholder="Lagos">
        </label>
        <label class="field">
          <span>Address</span>
          <input name="address" placeholder="Street, area, or landmark">
        </label>
        <label class="field">
          <span>Customer type</span>
          <select name="channel">
            <option value="Supermarket">Supermarket</option>
            <option value="Wholesale">Wholesale</option>
            <option value="Distributor">Distributor</option>
            <option value="Mini mart">Mini mart</option>
            <option value="Kiosk">Kiosk</option>
            <option value="Restaurant / Hotel">Restaurant / Hotel</option>
            <option value="School / Canteen">School / Canteen</option>
            <option value="Other">Other</option>
          </select>
        </label>
        <label class="field">
          <span>Contact person</span>
          <input name="contact" placeholder="Store manager">
        </label>
        <label class="field">
          <span>Phone number</span>
          <input name="contactPhone" type="tel" inputmode="tel" placeholder="0800 000 0000">
        </label>
        ${canManagePaymentTerms
          ? `
            <label class="field">
              <span>Orders completed (%)</span>
              <input name="fillRate" type="number" min="0" max="100" step="1" inputmode="numeric" placeholder="90">
            </label>
            <label class="field">
              <span>Amount owed (${escapeHtml(moneySymbol)})</span>
              <input name="outstanding" type="number" min="0" step="1000" inputmode="numeric" placeholder="0">
            </label>
            <label class="field">
              <span>Maximum credit allowed (${escapeHtml(moneySymbol)})</span>
              <input name="creditLimit" type="number" min="0" step="1000" inputmode="numeric" placeholder="0">
            </label>
            <label class="field">
              <span>Discount (%)</span>
              <input name="discountPercent" type="number" min="0" max="100" step="0.1" inputmode="decimal" placeholder="0">
            </label>
            <label class="field">
              <span>Days to pay</span>
              <input name="paymentPeriodDays" type="number" min="0" step="1" inputmode="numeric" placeholder="14">
            </label>
            <label class="field">
              <span>Late payment penalty (%)</span>
              <input name="latePenaltyPercent" type="number" min="0" max="100" step="0.1" inputmode="decimal" placeholder="0">
            </label>
          `
          : ""}
        <div class="manager-form-actions span-full">
          ${textButton({
            iconName: "check",
            label: "Save customer",
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

function customerCreditSummary(retailer, state) {
  const creditLimit = getCreditLimitForParty(state.creditLimits || [], retailer.name);
  const balance = Number(creditLimit?.balance ?? retailer.outstanding ?? 0);
  const limit = Number(creditLimit?.limit || 0);
  const creditUsage = limit ? (balance / limit) * 100 : 100;
  const creditStatus = creditUsage >= 100 ? "credit_hold" : creditUsage >= 85 ? "credit_watch" : "credit_clear";

  return {
    creditLimit,
    balance,
    limit,
    creditUsage,
    creditStatus
  };
}

function renderRetailerListItem(retailer, state) {
  const { balance, limit, creditStatus } = customerCreditSummary(retailer, state);
  const rating = getCustomerRating(retailer, state);
  const searchIndex = [
    retailer.id,
    retailer.name,
    retailer.city,
    retailer.stateName,
    retailer.region,
    retailer.address,
    retailer.channel,
    retailer.contact,
    retailer.contactPhone,
    rating.label,
    creditStatus
  ]
    .join(" ")
    .toLowerCase();

  return `
    <article
      class="retailer-list-item"
      data-rating="${escapeHtml(rating.status)}"
      data-search-index="${escapeHtml(searchIndex)}"
    >
      <button class="retailer-list-main js-view-retailer" type="button" data-retailer-id="${escapeHtml(retailer.id)}">
        <span>
          <span class="eyebrow">${escapeHtml(retailer.id)}</span>
          <strong>${escapeHtml(retailer.name)}</strong>
          <small>${escapeHtml([retailer.city, retailer.stateName || retailer.region].filter(Boolean).join(", ") || "Location not set")}</small>
        </span>
        <span>
          <span class="muted">Type</span>
          <strong>${escapeHtml(retailer.channel || "Not set")}</strong>
        </span>
        <span>
          <span class="muted">Rating</span>
          <strong>${escapeHtml(rating.label)}</strong>
        </span>
        <span>
          <span class="muted">Balance</span>
          <strong>${formatCurrency(balance)}</strong>
        </span>
        <span>
          <span class="muted">Credit limit</span>
          <strong>${limit ? formatCurrency(limit) : "Not set"}</strong>
        </span>
        <span class="retailer-list-status">
          ${statusPill(creditStatus)}
        </span>
      </button>
    </article>
  `;
}

function detailItem(label, value) {
  return `
    <div class="split">
      <span class="muted">${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderCustomerDetails(retailer, state, permissions) {
  const { creditLimit, balance, limit, creditUsage, creditStatus } = customerCreditSummary(retailer, state);
  const rating = getCustomerRating(retailer, state);

  return `
    <div class="customer-detail-summary">
      <div>
        <span class="eyebrow">${escapeHtml(retailer.id)}</span>
        <h3>${escapeHtml(retailer.name)}</h3>
        <p>${escapeHtml([retailer.city, retailer.stateName || retailer.region].filter(Boolean).join(", ") || "Location not set")}</p>
      </div>
      <div class="row-actions">
        ${statusPill(rating.status)}
        ${statusPill(creditStatus)}
      </div>
    </div>

    <div class="customer-detail-grid">
      ${detailItem("Customer type", retailer.channel || "Not set")}
      ${detailItem("Contact person", retailer.contact || "Not set")}
      ${detailItem("Phone", retailer.contactPhone || "Not set")}
      ${detailItem("Address", retailer.address || "Not set")}
      ${detailItem("Customer rating", rating.label)}
      ${detailItem("Rating basis", `${formatNumber(rating.score)} / 100`)}
      ${detailItem("Orders completed", formatPercent(retailer.fillRate))}
      ${detailItem("Last sale", formatDate(retailer.lastOrder))}
      ${detailItem("Last contact", formatDate(retailer.lastContact))}
      ${detailItem("Balance owed", formatCurrency(balance))}
      ${detailItem("Credit limit", limit ? formatCurrency(limit) : "Not set")}
      ${detailItem("Credit usage", limit ? formatPercent(creditUsage) : "No limit set")}
      ${detailItem("Days to pay", `${formatNumber(creditLimit?.paymentPeriodDays ?? 14)} days`)}
      ${detailItem("Discount / late penalty", `${formatTermPercent(creditLimit?.discountPercent)} / ${formatTermPercent(creditLimit?.latePenaltyPercent)}`)}
    </div>

    <div class="stock-line">
      <div class="stock-meta">
        <span>Orders completed</span>
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

    <footer class="customer-detail-actions">
      ${permissions.canManageCustomers
        ? textButton({
            iconName: "settings",
            label: "Edit customer",
            className: "primary js-modal-edit-retailer",
            data: { "retailer-id": retailer.id }
          })
        : ""}
    </footer>
  `;
}

function renderCustomerDetailsModal() {
  return `
    <div id="customer-details-modal" class="stock-modal-backdrop" tabindex="-1" hidden>
      <section class="stock-modal customer-details-modal" role="dialog" aria-modal="true" aria-labelledby="customer-details-title">
        <header class="stock-modal-header">
          <div>
            <span class="eyebrow">Customer outlet</span>
            <h2 id="customer-details-title">Customer details</h2>
          </div>
          ${iconButton({
            iconName: "x",
            label: "Close customer details",
            className: "js-close-customer-modal"
          })}
        </header>
        <div id="customer-details-content" class="customer-details-content"></div>
      </section>
    </div>
  `;
}

export function renderRetailers({ state }) {
  const ratings = [...new Map(state.retailers
    .map((retailer) => getCustomerRating(retailer, state))
    .map((rating) => [rating.status, rating])).values()]
    .sort((a, b) => a.label.localeCompare(b.label));
  const permissions = currentUserPermissions(state);

  return `
    <section class="view retailers-view">
      ${renderSupermarketManager(state, permissions)}
      <section class="panel retailers-layout">
        <div class="toolbar">
          ${panelHeader("Customer outlets", "Supermarkets, kiosks, wholesalers, contacts, and balances owed")}
          <div class="toolbar-group">
            <label class="field">
              <span class="sr-only">Filter by customer rating</span>
              <select id="retailer-rating-filter">
                <option value="all">All ratings</option>
                ${ratings.map((rating) => `<option value="${escapeHtml(rating.status)}">${escapeHtml(rating.label)}</option>`).join("")}
              </select>
            </label>
          </div>
        </div>

        ${state.retailers.length
          ? `<div class="retailer-list">${state.retailers.map((retailer) => renderRetailerListItem(retailer, state)).join("")}</div>`
          : '<div class="empty-state">No customers added yet</div>'}
      </section>
      ${renderCustomerDetailsModal()}
    </section>
  `;
}

export function bindRetailers({ root, store }) {
  const ratingFilter = qs("#retailer-rating-filter", root);
  const retailerForm = qs("#retailer-form", root);
  const customerModal = qs("#customer-details-modal", root);
  const customerModalContent = qs("#customer-details-content", root);

  ratingFilter?.addEventListener("change", () => {
    qsa(".retailer-list-item", root).forEach((card) => {
      card.hidden = ratingFilter.value !== "all" && card.dataset.rating !== ratingFilter.value;
    });
  });

  function closeCustomerModal() {
    if (customerModal) customerModal.hidden = true;
  }

  function openCustomerModal(retailerId) {
    const state = store.getState();
    const retailer = (state.retailers || []).find((item) => item.id === retailerId);
    const permissions = currentUserPermissions(state);

    if (!customerModal || !customerModalContent || !retailer) return;

    customerModalContent.innerHTML = renderCustomerDetails(retailer, state, permissions);
    customerModal.hidden = false;
    customerModal.focus();

    qs(".js-modal-edit-retailer", customerModal)?.addEventListener("click", () => {
      closeCustomerModal();
      fillRetailerForm(retailer.id);
    });
  }

  function fillRetailerForm(retailerId) {
    const state = store.getState();
    const retailer = state.retailers.find((item) => item.id === retailerId);
    if (!retailerForm || !retailer) return;

    const creditLimit = getCreditLimitForParty(state.creditLimits || [], retailer.name);
    retailerForm.elements.retailerId.value = retailer.id;
    retailerForm.elements.name.value = retailer.name || "";
    retailerForm.elements.city.value = retailer.city || "";
    retailerForm.elements.stateName.value = retailer.stateName || retailer.region || "";
    retailerForm.elements.address.value = retailer.address || "";
    const channelValue = retailer.channel || "Supermarket";
    const hasChannelOption = [...retailerForm.elements.channel.options].some((option) => option.value === channelValue);
    retailerForm.elements.channel.value = hasChannelOption ? channelValue : "Other";
    retailerForm.elements.contact.value = retailer.contact || "";
    retailerForm.elements.contactPhone.value = retailer.contactPhone || "";
    if (retailerForm.elements.fillRate) retailerForm.elements.fillRate.value = retailer.fillRate || 0;
    if (retailerForm.elements.outstanding) retailerForm.elements.outstanding.value = creditLimit?.balance ?? retailer.outstanding ?? 0;
    if (retailerForm.elements.creditLimit) retailerForm.elements.creditLimit.value = creditLimit?.limit || 0;
    if (retailerForm.elements.discountPercent) retailerForm.elements.discountPercent.value = creditLimit?.discountPercent || 0;
    if (retailerForm.elements.paymentPeriodDays) retailerForm.elements.paymentPeriodDays.value = creditLimit?.paymentPeriodDays ?? 14;
    if (retailerForm.elements.latePenaltyPercent) retailerForm.elements.latePenaltyPercent.value = creditLimit?.latePenaltyPercent || 0;
    retailerForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  retailerForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(retailerForm);
    const message = qs("#retailer-form-message", root);
    const currentState = store.getState();
    const permissions = currentUserPermissions(currentState);
    const isRepCustomerAdd = permissions.canAddCustomers && !permissions.canManageCustomers;
    const account = accountForUser(currentState);

    if (message) message.textContent = "";

    if (isRepCustomerAdd && String(formData.get("retailerId") || "").trim()) {
      if (message) message.textContent = "Sales representatives can add new customers, but existing customer changes go to a manager.";
      return;
    }

    if (!String(formData.get("name") || "").trim()) {
      if (message) message.textContent = "Customer name is required.";
      return;
    }

    store.dispatch({
      type: "UPSERT_RETAILER",
      retailerId: formData.get("retailerId"),
      name: formData.get("name"),
      city: formData.get("city"),
      stateName: formData.get("stateName"),
      address: formData.get("address"),
      channel: formData.get("channel"),
      contact: formData.get("contact"),
      contactPhone: formData.get("contactPhone"),
      fillRate: formData.get("fillRate"),
      outstanding: formData.get("outstanding"),
      creditLimit: formData.get("creditLimit"),
      discountPercent: formData.get("discountPercent"),
      paymentPeriodDays: formData.get("paymentPeriodDays"),
      latePenaltyPercent: formData.get("latePenaltyPercent"),
      assignedRepUserId: isRepCustomerAdd ? currentState.user?.id : "",
      assignedRepName: isRepCustomerAdd ? account?.name || currentState.user?.user_metadata?.full_name || currentState.user?.email || "" : "",
      message: "Customer saved"
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

  qsa(".js-view-retailer", root).forEach((button) => {
    button.addEventListener("click", () => {
      openCustomerModal(button.dataset.retailerId);
    });
  });

  customerModal?.addEventListener("click", (event) => {
    if (event.target === customerModal || event.target.closest(".js-close-customer-modal")) {
      closeCustomerModal();
    }
  });

  customerModal?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeCustomerModal();
    }
  });
}
