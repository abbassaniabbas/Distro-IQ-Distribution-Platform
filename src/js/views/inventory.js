import {
  getCreditLimitForParty,
  getProductMap,
  getStockHealth,
  isRepresentativeSellThroughOrder,
  stockCategoryIdForProduct
} from "../services/calculations.js";
import {
  formatCurrency,
  currencySymbolFor,
  formatDate,
  formatNumber,
  formatPercent,
  statusText
} from "../services/formatters.js";
import { currentUserPermissions, currentUserRole, salesRepresentativeNames } from "../services/rbac.js";
import { getInvoiceRecords, openInvoiceQuickView } from "../services/invoices.js";
import { loadSharedProductImages, saveSharedProductImage } from "../services/backend.js";
import { removeProductImage, saveProductImage } from "../services/product-images.js";
import { isBackendConfigured } from "../services/supabase-client.js";
import { printTabularReport } from "../services/report-export.js";
import { dateIsWithinRange } from "../services/filtering.js";
import { LOGO_ACCEPT, LOGO_HELP_TEXT, readLogoFile, validateLogoFile } from "../services/branding.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { iconButton, panelHeader, progressBar, statusPill, table, textButton } from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { bindAdjustments, renderAdjustmentContent } from "./adjustments.js";
import {
  enabledPackagingTypes,
  effectivePiecePrice,
  packagingDefaults,
  packagingLineAmount,
  packagingMultiplier,
  packagingOption,
  packagingQuantityLabel,
  packagingUnitPrice,
  productPackagingTypes,
  quantityInPieces
} from "../services/packaging.js";

const DEFAULT_STOCK_TAB = "stock-health";
const DISPATCH_PAGE_SIZE = 10;
const MOVEMENT_PAGE_SIZE = 10;
const FINISHED_PRODUCTS_CATEGORY = "finished_products";
const RAW_MATERIALS_CATEGORY = "raw_materials";
const PRODUCT_SIZE_UNITS = [
  { value: "g", label: "g" },
  { value: "kg", label: "kg" },
  { value: "mg", label: "mg" },
  { value: "ml", label: "ml" },
  { value: "other", label: "Other" }
];
const stockEntrySession = {
  open: false,
  family: "",
  productIds: [],
  adding: false,
  editingProductId: "",
  draft: {},
  imageUrl: "",
  defaults: {},
  step: 1
};
let stockHealthView = "list";

function renderProductSizeUnitOptions(selected = "g") {
  return PRODUCT_SIZE_UNITS.map((unit) => `
    <option value="${unit.value}" ${unit.value === selected ? "selected" : ""}>${unit.label}</option>
  `).join("");
}

function normalizeProductSizeUnit(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function formatProductSize(value, unit) {
  const numericValue = String(value || "").trim();
  const normalizedUnit = normalizeProductSizeUnit(unit);
  return numericValue && normalizedUnit ? `${numericValue}${normalizedUnit}` : "";
}

function splitProductSize(value, fallbackUnit = "g") {
  const match = String(value || "").trim().match(/^(\d+(?:\.\d+)?)\s*([^\d\s]+)$/);
  const unit = normalizeProductSizeUnit(match?.[2] || fallbackUnit) || "g";
  const standardUnit = PRODUCT_SIZE_UNITS.some((option) => option.value === unit) ? unit : "other";
  return {
    value: match?.[1] || "",
    unit: standardUnit,
    customUnit: standardUnit === "other" ? unit : ""
  };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function inventoryRouteParams() {
  if (typeof window === "undefined") return new URLSearchParams();

  const query = window.location.hash.split("?")[1] || "";
  return new URLSearchParams(query);
}

function stockTabHref(tabId) {
  return `#/inventory?tab=${encodeURIComponent(tabId)}`;
}

function stockTabsForPermissions(permissions, state) {
  return [
    {
      id: "stock-health",
      label: "Stock health"
    },
    ...(permissions.canDispatchStock || permissions.canManageStockMovements || permissions.canAssignStock
      ? [{
          id: "dispatch",
          label: "Factory dispatch"
        }]
      : []),
    {
      id: "overview",
      label: "Stock journey"
    },
    {
      id: "assignments",
      label: "Rep stock ledger"
    },
    {
      id: "movement-history",
      label: "Movement history"
    },
    ...(["ceo", "admin"].includes(currentUserRole(state)) ? [{
      id: "adjustments",
      label: "Adjustments"
    }] : [])
  ];
}

function activeStockTabId(permissions, state) {
  const tabs = stockTabsForPermissions(permissions, state);
  const requestedTab = inventoryRouteParams().get("tab") || DEFAULT_STOCK_TAB;
  const normalizedTab = ["factory-health", "add-stock", "raw-materials", "finished-goods", "equipment", "categories", "production-usage"]
    .includes(requestedTab)
    ? DEFAULT_STOCK_TAB
    : requestedTab;

  return tabs.some((tab) => tab.id === normalizedTab) ? normalizedTab : tabs[0].id;
}

function renderStockSubtabs(activeTabId, permissions, state) {
  return `
    <nav class="subtab-nav stock-subtabs" aria-label="Stock pages">
      ${stockTabsForPermissions(permissions, state).map((tab) => `
        <a
          class="subtab-link ${tab.id === activeTabId ? "is-active" : ""}"
          href="${escapeHtml(stockTabHref(tab.id))}"
          aria-current="${tab.id === activeTabId ? "page" : "false"}"
        >
          ${escapeHtml(tab.label)}
        </a>
      `).join("")}
    </nav>
  `;
}

function stockJourneyPayment(state, productIds) {
  return (state.orders || []).reduce((summary, order) => {
    if (isRepresentativeSellThroughOrder(order, state)) return summary;

    const value = (order.items || []).reduce((total, item) => (
      productIds.has(item.productId)
        ? total + Number(item.lineAmount ?? (Number(item.quantity || 0) * Number(item.unitPrice ?? item.unitPriceAtSale ?? 0)))
        : total
    ), 0);

    summary.total += value;
    if (String(order.paymentStatus || "").toLowerCase() === "paid" || !String(order.paymentType || "").toLowerCase().includes("credit")) {
      summary.paid += value;
    }
    return summary;
  }, { total: 0, paid: 0 });
}

function stockJourneyPackageSummary(state, entries) {
  const packageTotals = new Map();

  entries.forEach(({ product, pieces }) => {
    if (stockCategoryIdForProduct(product) !== FINISHED_PRODUCTS_CATEGORY) return;
    const availableTypes = productPackagingTypes(state.client, product).filter((type) => type !== "piece");
    const packageType = availableTypes.includes("carton") ? "carton" : availableTypes[0];
    if (!packageType) return;

    const piecesPerPackage = packagingMultiplier(product, packageType, state.client);
    if (piecesPerPackage <= 0) return;

    const packageCount = Math.floor(Math.max(0, Number(pieces || 0)) / piecesPerPackage);
    packageTotals.set(packageType, (packageTotals.get(packageType) || 0) + packageCount);
  });

  return [...packageTotals.entries()].map(([type, quantity]) => {
    const option = packagingOption(type);
    return `${formatNumber(quantity)} ${quantity === 1 ? option.singular : option.label.toLowerCase()}`;
  }).join(" · ");
}

function stockJourneyCategory(state, definition) {
  const products = (state.products || []).filter((product) => (
    product.status !== "inactive" && stockCategoryIdForProduct(product) === definition.id
  ));
  const productIds = new Set(products.map((product) => product.id));
  const payment = stockJourneyPayment(state, productIds);
  const atFactoryEntries = products.map((product) => ({ product, pieces: Number(product.stock || 0) }));
  const representativeEntries = products.map((product) => ({
    product,
    pieces: (state.stockAssignments || [])
      .filter((assignment) => assignment.productId === product.id)
      .reduce((total, assignment) => total + Math.max(0, assignmentInHand(assignment)), 0)
  }));

  return {
    ...definition,
    atFactoryEntries,
    representativeEntries,
    atFactory: atFactoryEntries.reduce((total, entry) => total + entry.pieces, 0),
    atFactoryPackages: stockJourneyPackageSummary(state, atFactoryEntries),
    runningLow: products.filter((product) => getStockHealth(product).status !== "ready").length,
    withRepresentatives: representativeEntries.reduce((total, entry) => total + entry.pieces, 0),
    representativePackages: stockJourneyPackageSummary(state, representativeEntries),
    updates: (state.stockTransactions || []).filter((transaction) => productIds.has(transaction.productId)).length,
    paidValue: payment.paid,
    salesValue: payment.total,
    paidPercent: payment.total ? (payment.paid / payment.total) * 100 : 0
  };
}

function renderJourneyFigures(row) {
  const figures = [
    { label: "At factory", value: row.atFactoryPackages || formatNumber(row.atFactory), exact: row.atFactoryPackages ? `${formatNumber(row.atFactory)} ${row.quantityLabel}` : "" },
    { label: "Running low", value: formatNumber(row.runningLow) },
    { label: "With sales representatives", value: row.representativePackages || formatNumber(row.withRepresentatives), exact: row.representativePackages ? `${formatNumber(row.withRepresentatives)} ${row.quantityLabel}` : "" },
    { label: "Stock updates", value: formatNumber(row.updates) },
    { label: "Paid", value: row.salesValue ? formatPercent(row.paidPercent) : "No sales yet" }
  ];

  return `
    <div class="stock-journey-figures">
      ${figures.map(({ label, value, exact }) => `
        <div>
          <span>${escapeHtml(label)}</span>
          <strong class="${exact ? "stock-journey-package-quantity" : ""}">${escapeHtml(value)}</strong>
          ${exact ? `<small>${escapeHtml(exact)}</small>` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

function renderLifecycle(state) {
  const categories = [
    {
      id: "raw_materials",
      label: "Raw materials",
      meaning: "Ingredients and packaging used to make products.",
      quantityLabel: "units"
    },
    {
      id: "finished_products",
      label: "Finished products",
      meaning: "Packed products that are ready to sell.",
      quantityLabel: "pieces"
    },
    {
      id: "equipment",
      label: "Equipment",
      meaning: "Machines and tools owned by the factory or available for sale.",
      quantityLabel: "units"
    }
  ].map((definition) => stockJourneyCategory(state, definition));
  const overall = categories.reduce((summary, row) => ({
    atFactory: summary.atFactory + row.atFactory,
    runningLow: summary.runningLow + row.runningLow,
    withRepresentatives: summary.withRepresentatives + row.withRepresentatives,
    updates: summary.updates + row.updates,
    paidValue: summary.paidValue + row.paidValue,
    salesValue: summary.salesValue + row.salesValue,
    atFactoryEntries: [...summary.atFactoryEntries, ...row.atFactoryEntries],
    representativeEntries: [...summary.representativeEntries, ...row.representativeEntries],
    paidPercent: 0
  }), { atFactory: 0, runningLow: 0, withRepresentatives: 0, updates: 0, paidValue: 0, salesValue: 0, paidPercent: 0, atFactoryEntries: [], representativeEntries: [] });
  overall.paidPercent = overall.salesValue ? (overall.paidValue / overall.salesValue) * 100 : 0;
  overall.atFactoryPackages = stockJourneyPackageSummary(state, overall.atFactoryEntries);
  overall.representativePackages = stockJourneyPackageSummary(state, overall.representativeEntries);
  overall.quantityLabel = "total units";

  return `
    <section class="panel stock-journey-panel">
      ${panelHeader("Stock journey", "A simple view of what is at the factory, what is running low, and what has been paid for")}
      <section class="stock-journey-overall" aria-label="All stock summary">
        <div>
          <span class="eyebrow">All stock</span>
          <h3>Total Stock</h3>
          <p>Raw materials, finished products, and equipment.</p>
        </div>
        ${renderJourneyFigures(overall)}
      </section>
      <div class="stock-journey-categories">
        ${categories.map((category) => `
          <article class="stock-journey-category" data-search-index="${escapeHtml(`${category.label} ${category.meaning}`.toLowerCase())}">
            <header>
              <h3>${escapeHtml(category.label)}</h3>
              <p>${escapeHtml(category.meaning)}</p>
            </header>
            ${renderJourneyFigures(category)}
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function productUnit(product) {
  return product.unit || (stockCategoryIdForProduct(product) === RAW_MATERIALS_CATEGORY ? "kg" : "unit");
}

function productionBatchReference(batch) {
  return String(batch?.reference || batch?.batchReference || "Production batch").trim();
}

function productionBatchesForProduct(state, productId) {
  return (state.productionBatches || [])
    .filter((batch) => String(batch.finishedProductId || "") === String(productId || ""))
    .sort((a, b) => (
      String(b.batchDate || b.createdAt || "").localeCompare(String(a.batchDate || a.createdAt || "")) ||
      productionBatchReference(b).localeCompare(productionBatchReference(a))
    ));
}

function batchMaterialDescription(material, productMap) {
  const product = productMap.get(material.productId);
  const name = material.productName || product?.name || material.productId || "Raw material";
  const unit = material.unit || productUnit(product || { stockCategory: RAW_MATERIALS_CATEGORY });
  return `${name}: ${formatNumber(material.quantity)} ${unit}`;
}

function batchOutputDescription(batch, product) {
  const name = batch.finishedProductName || product?.name || "Finished product";
  const quantity = Number(batch.quantityProduced || 0);
  const breakdown = Array.isArray(batch.packagingBreakdown) ? batch.packagingBreakdown.filter((item) => Number(item.packagingQuantity || 0) > 0) : [];
  if (breakdown.length) {
    return `${breakdown.map((item) => packagingQuantityLabel(item.packagingQuantity, item.packagingType)).join(" + ")} (${formatNumber(quantity)} pieces) ${name}`;
  }
  return quantity > 0
    ? `${formatNumber(quantity)} ${batch.outputUnit || productUnit(product || {})} ${name}`
    : name;
}

function normalizedProductName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function productVariantKey(productFamily, productType, size) {
  return [productFamily, productType, size]
    .map(normalizedProductName)
    .join("|");
}

function duplicateProductVariant(state, { productFamily, productType, size, productId = "" }) {
  const nextVariant = productVariantKey(productFamily, productType, size);
  const currentProductId = String(productId || "").trim();

  if (!normalizedProductName(productFamily)) return false;

  return (state.products || []).some((product) => (
    product.id !== currentProductId &&
    productVariantKey(stockProductBaseName(product), product.productType, product.size) === nextVariant
  ));
}

function duplicateProductSku(state, sku, productId = "") {
  const nextSku = normalizedProductName(sku);
  const currentProductId = String(productId || "").trim();

  if (!nextSku) return false;

  return (state.products || []).some((product) => (
    product.id !== currentProductId && normalizedProductName(product.id) === nextSku
  ));
}

function nextAutomaticProductId(products = [], format = "SKU-{0000}") {
  const tokenMatch = String(format || "").match(/\{(0{2,})\}/);
  const token = tokenMatch?.[0] || "{0000}";
  const width = tokenMatch?.[1].length || 4;
  const [prefix = "SKU-", suffix = ""] = String(format || "SKU-{0000}").split(token);
  const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const idPattern = new RegExp(`^${escapePattern(prefix)}(\\d{${width},})${escapePattern(suffix)}$`, "i");
  const usedIds = new Set(products.map((product) => String(product.id || "").trim().toUpperCase()));
  const highestNumber = products.reduce((highest, product) => {
    const match = String(product.id || "").trim().match(idPattern);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  let number = highestNumber + 1;
  let candidate = `${prefix}${String(number).padStart(width, "0")}${suffix}`;

  while (usedIds.has(candidate.toUpperCase())) {
    number += 1;
    candidate = `${prefix}${String(number).padStart(width, "0")}${suffix}`;
  }

  return candidate;
}

function renderProductImage(product) {
  if (product.imageUrl) {
    return `<img src="${escapeHtml(product.imageUrl)}" alt="">`;
  }

  return `<span>${escapeHtml(product.name.slice(0, 2).toUpperCase())}</span>`;
}

function renderStockProductModal(state, permissions) {
  if (!permissions.canManageProducts && !permissions.canAddStock) return "";

  const moneySymbol = currencySymbolFor(state.client);

  return `
    <div id="stock-product-modal" class="stock-modal-backdrop" ${stockEntrySession.open ? "" : "hidden"}>
      <section class="stock-modal" role="dialog" aria-modal="true" aria-labelledby="stock-product-modal-title">
        <header class="stock-modal-header">
          <div>
            <span class="eyebrow">Stock record</span>
            <h2 id="stock-product-modal-title">${stockEntrySession.editingProductId ? "Update stock" : "Add stock"}</h2>
          </div>
          ${textButton({
            iconName: "x",
            label: "Close",
            className: "js-close-stock-modal"
          })}
        </header>
      <form id="manager-product-form" class="manager-form-grid" novalidate>
        <input type="hidden" name="productId">
        <section class="span-full affiliated-product-progress" data-affiliated-product-progress hidden aria-live="polite">
          <header>
            <div>
              <span class="affiliated-product-success">${icon("check")}<strong>Product added successfully</strong></span>
              <small>Add another type or size under the same product when needed.</small>
            </div>
            ${iconButton({ iconName: "plus", label: "Add affiliated product", className: "js-add-affiliated-product" })}
          </header>
          <div class="affiliated-product-list" data-affiliated-product-list></div>
        </section>
        <div class="stock-entry-fields span-full manager-form-grid" data-stock-entry-fields>
        <nav class="stock-form-stepper span-full" aria-label="Stock form progress">
          <span class="is-active" data-stock-step-indicator="1"><b>1</b><small>General</small></span>
          <span data-stock-step-indicator="2"><b>2</b><small>Stock</small></span>
          <span data-stock-step-indicator="3"><b>3</b><small>Catalogue</small></span>
        </nav>
        <section class="stock-form-step span-full manager-form-grid" data-stock-form-step="1">
        <label class="field">
          <span>Product name</span>
          <input name="name" placeholder="Plantain Chips" required>
        </label>
        <label class="field">
          <span>Product type</span>
          <input name="productType" placeholder="Original, pouch, spicy" required>
        </label>
        <div class="field">
          <span>Product size</span>
          <div class="product-size-control">
            <input name="sizeValue" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="150" aria-label="Product size value" required>
            <select name="sizeUnit" aria-label="Product size unit" required>
              ${renderProductSizeUnitOptions()}
            </select>
            <input name="sizeUnitOther" maxlength="12" placeholder="Custom unit" aria-label="Custom product size unit" hidden>
          </div>
        </div>
        <label class="field stock-sku-field">
          <span>SKU</span>
          <input name="sku" value="${escapeHtml(nextAutomaticProductId(state.products, state.client?.skuFormat))}" readonly required>
        </label>
        <label class="field">
          <span>Category</span>
          <select name="stockCategory" required>
            ${state.stockCategories.map((category) => `
              <option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>
            `).join("")}
          </select>
        </label>
        </section>
        <section class="stock-form-step span-full manager-form-grid" data-stock-form-step="2" hidden>
        <div class="factory-stock-entry span-full">
          <label class="field">
            <span data-stock-quantity-label>Factory stock</span>
            <input name="stock" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" required>
          </label>
          <label class="field">
            <span>Enter stock as</span>
            <select name="stockEntryMode" data-stock-entry-mode>
              ${enabledPackagingTypes(state.client).some((type) => type !== "piece") ? '<option value="package">Package</option>' : ""}
              <option value="piece">Pieces</option>
            </select>
          </label>
          <label class="field" data-stock-package-type hidden>
            <span data-stock-package-label>Package type</span>
            <select name="stockPackagingType" data-stock-packaging-type>
              ${enabledPackagingTypes(state.client).filter((type) => type !== "piece").map((type) => {
                const option = packagingOption(type);
                return `<option value="${escapeHtml(type)}">${escapeHtml(option.label)}</option>`;
              }).join("")}
            </select>
          </label>
          <div class="factory-stock-piece-total" data-stock-piece-total hidden aria-live="polite">
            <span>Total factory stock</span><strong>0 pieces</strong>
          </div>
        </div>
        <label class="field">
          <span>Reorder point</span>
          <input name="reorderPoint" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" required>
        </label>
        <label class="field">
          <span>Cost price per piece (${escapeHtml(moneySymbol)})</span>
          <input name="unitCost" type="number" min="0" step="1" inputmode="numeric" placeholder="0" required>
        </label>
        <label class="field">
          <span>Selling price per piece (${escapeHtml(moneySymbol)})</span>
          <input name="unitPrice" type="number" min="0" step="1" inputmode="numeric" placeholder="0" required>
        </label>
        ${(() => {
          const packageTypes = enabledPackagingTypes(state.client).filter((type) => type !== "piece");
          if (!packageTypes.length) return "";
          return `<fieldset class="span-full product-packaging-conversions"><legend>Package contents and selling prices</legend>${packageTypes.map((type) => {
            const option = packagingOption(type);
            return `<section class="product-package-pricing"><strong>${escapeHtml(option.label)}</strong><label class="field"><span>Pieces contained</span><input name="packagingConversion-${escapeHtml(type)}" type="number" min="1" step="1" inputmode="numeric" placeholder="0" required></label><label class="field"><span>Selling price per ${escapeHtml(option.singular)} (${escapeHtml(moneySymbol)})</span><input name="packagingPrice-${escapeHtml(type)}" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" required></label></section>`;
          }).join("")}</fieldset>`;
        })()}
        </section>
        <section class="stock-form-step span-full manager-form-grid" data-stock-form-step="3" hidden>
        <label class="field">
          <span>Catalogue status</span>
          <select name="status" required>
            <option value="active">Visible</option>
            <option value="inactive">Hidden</option>
          </select>
        </label>
        <div class="field span-full file-field" id="stock-image-upload-field">
          <span>Stock picture</span>
          <div class="file-upload-row">
            <input class="file-input sr-only" id="stock-image-input" name="imageFile" type="file" accept="${LOGO_ACCEPT}">
            <label class="file-dropzone" for="stock-image-input">
              <span class="file-upload-icon">${icon("upload")}</span>
              <span class="file-upload-copy">
                <strong id="stock-image-upload-title">Choose picture file</strong>
                <small id="stock-image-file-name">${escapeHtml(LOGO_HELP_TEXT)}</small>
              </span>
              <span class="file-upload-action">Browse</span>
            </label>
            <button class="icon-button clear-file-button" id="clear-stock-image-file" type="button" title="Clear selected picture" aria-label="Clear selected picture" hidden>
              ${icon("x")}
            </button>
          </div>
        </div>
        </section>
        <div class="stock-wizard-actions span-full">
          <button class="icon-button stock-wizard-previous" type="button" title="Previous step" aria-label="Previous step" data-stock-step-previous hidden>${icon("arrowRight")}</button>
          <span id="manager-product-message" class="field-error" aria-live="polite"></span>
          <button class="icon-button primary stock-wizard-next" type="button" title="Next step" aria-label="Next step" data-stock-step-next>${icon("arrowRight")}</button>
          <button class="button primary js-save-stock-entry" type="submit" data-stock-step-save hidden>${icon("check")}<span>Save stock</span></button>
        </div>
        </div>
      </form>
      </section>
    </div>
  `;
}

function renderRestockModal(permissions) {
  const canRestock = permissions.canManageProducts || permissions.canManageStockMovements || permissions.canReconcileStock;
  if (!canRestock) return "";

  return `
    <div id="restock-modal" class="stock-modal-backdrop" hidden>
      <section class="stock-modal" role="dialog" aria-modal="true" aria-labelledby="restock-modal-title">
        <header class="stock-modal-header">
          <div>
            <span class="eyebrow">Restock</span>
            <h2 id="restock-modal-title">Add stock quantity</h2>
          </div>
          ${textButton({
            iconName: "x",
            label: "Close",
            className: "js-close-restock-modal"
          })}
        </header>
        <form id="restock-form" class="manager-form-grid" novalidate>
          <input type="hidden" name="productId">
          <label class="field span-full">
            <span>Stock item</span>
            <input name="productName" disabled>
          </label>
          <label class="field">
            <span>Quantity to add</span>
            <input name="quantity" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="Enter amount" required>
          </label>
          <div class="manager-form-actions span-full">
            ${textButton({
              iconName: "plus",
              label: "Add stock",
              className: "primary",
              type: "submit"
            })}
          </div>
          <span id="restock-form-message" class="field-error span-full" aria-live="polite"></span>
        </form>
      </section>
    </div>
  `;
}

function renderStockReductionModal(permissions) {
  if (!permissions.canManageStockMovements) return "";

  return `
    <div id="reduce-stock-modal" class="stock-modal-backdrop" hidden>
      <section class="stock-modal" role="dialog" aria-modal="true" aria-labelledby="reduce-stock-modal-title">
        <header class="stock-modal-header">
          <div>
            <span class="eyebrow">Stock reduction</span>
            <h2 id="reduce-stock-modal-title">Reduce stock quantity</h2>
          </div>
          ${textButton({
            iconName: "x",
            label: "Close",
            className: "js-close-reduce-stock-modal"
          })}
        </header>
        <form id="reduce-stock-form" class="manager-form-grid" novalidate>
          <input type="hidden" name="productId">
          <label class="field span-full">
            <span>Stock item</span>
            <input name="productName" disabled>
          </label>
          <label class="field">
            <span>Quantity to remove</span>
            <input name="quantity" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="Enter amount" required>
          </label>
          <label class="field">
            <span>Reason</span>
            <select name="reason" required>
              <option value="">Choose reason</option>
              <option value="Damaged stock">Damaged stock</option>
              <option value="Expired stock">Expired stock</option>
              <option value="Stock count correction">Stock count correction</option>
              <option value="Other">Other</option>
            </select>
          </label>
          <label class="field span-full">
            <span>Extra note (optional)</span>
            <textarea name="reasonDetails" rows="3" placeholder="Example: 3 cartons were damaged during loading"></textarea>
          </label>
          <div class="manager-form-actions span-full">
            ${textButton({
              iconName: "alert",
              label: "Reduce stock",
              className: "primary",
              type: "submit"
            })}
          </div>
          <span id="reduce-stock-form-message" class="field-error span-full" aria-live="polite"></span>
        </form>
      </section>
    </div>
  `;
}

function managerRepOptions(state) {
  const accountNames = salesRepresentativeNames(state);

  if (accountNames.length) {
    return accountNames;
  }

  const names = new Set((state.stockAssignments || []).map((assignment) => assignment.repName).filter(Boolean));

  return [...names].sort();
}

function renderProductCard(product, state, permissions) {
  const health = getStockHealth(product);
  const canRestock = permissions.canManageProducts || permissions.canManageStockMovements || permissions.canReconcileStock;
  const canReduceStock = permissions.canManageStockMovements;
  const canManageProducts = permissions.canManageProducts;
  const isFinishedProduct = stockCategoryIdForProduct(product) === FINISHED_PRODUCTS_CATEGORY;
  const productionBatches = isFinishedProduct ? productionBatchesForProduct(state, product.id) : [];
  const batchesUsingStockMaterials = productionBatches.filter((batch) => (batch.materials || []).length > 0);
  const hasStockMaterialUsage = batchesUsingStockMaterials.length > 0;
  const latestBatch = productionBatches[0];
  const lineageTitle = hasStockMaterialUsage
    ? "Made using stock raw materials"
    : "No stock-material usage recorded";
  const lineageDescription = hasStockMaterialUsage
    ? `${formatNumber(batchesUsingStockMaterials.length)} linked batch${batchesUsingStockMaterials.length === 1 ? "" : "es"}${latestBatch ? ` - latest ${productionBatchReference(latestBatch)}` : ""}`
    : "Production batches with raw materials will appear here.";
  const lineageTooltipId = `production-lineage-tooltip-${String(product.id || "product").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const searchIndex = [
    product.id,
    product.name,
    product.category,
    product.region,
    product.warehouse
  ]
    .join(" ")
    .toLowerCase();

  return `
    <article
      class="product-card ${product.status === "inactive" ? "is-inactive" : ""}"
      data-category="${escapeHtml(product.category)}"
      data-stock-category="${escapeHtml(stockCategoryIdForProduct(product))}"
      data-search-index="${escapeHtml(searchIndex)}"
    >
      <header>
        <div class="product-media">${renderProductImage(product)}</div>
        <div>
          <span class="eyebrow">${escapeHtml(product.id)}</span>
          <h3>${escapeHtml(product.name)}</h3>
        </div>
        ${product.status === "inactive"
          ? statusPill("inactive")
          : health.status === "ready"
            ? ""
            : statusPill(health.status)}
      </header>

      <div class="stock-line">
        <div class="stock-meta">
          <span>${formatNumber(product.stock)} available</span>
          <span>${health.daysCover} days cover</span>
        </div>
        ${progressBar(health.percent, health.tone)}
      </div>

      <div class="split">
        <span class="muted">Cost ${formatCurrency(product.unitCost)}</span>
        <strong>${product.unitPrice ? formatCurrency(product.unitPrice) : "Factory use"}</strong>
      </div>

      ${isFinishedProduct ? `
        <span class="product-production-lineage ${hasStockMaterialUsage ? "has-lineage" : "no-lineage"}">
          <button
            class="icon-button product-production-lineage-button js-open-production-traceability"
            type="button"
            title="${escapeHtml(`${lineageTitle}. ${lineageDescription}`)}"
            aria-label="${escapeHtml(`${lineageTitle}. ${lineageDescription} Open details.`)}"
            aria-describedby="${escapeHtml(lineageTooltipId)}"
            data-product-id="${escapeHtml(product.id)}"
          >
            ${icon(hasStockMaterialUsage ? "eye" : "history")}
          </button>
          <span class="product-production-lineage-tooltip" id="${escapeHtml(lineageTooltipId)}" role="tooltip">
            <strong>${escapeHtml(lineageTitle)}</strong>
            <span>${escapeHtml(lineageDescription)}</span>
          </span>
        </span>
      ` : ""}

      <footer>
        <span class="muted">${escapeHtml(product.category)}</span>
        <div class="row-actions">
          ${canManageProducts
            ? textButton({
                iconName: "settings",
                label: "Update",
                className: "js-edit-product",
                data: { "product-id": product.id }
              })
            : ""}
          ${canManageProducts
            ? textButton({
                iconName: product.status === "inactive" ? "check" : "x",
                label: product.status === "inactive" ? "Show" : "Hide",
                className: "js-toggle-product-status",
                data: { "product-id": product.id }
              })
            : ""}
          ${!canManageProducts && canRestock
            ? textButton({
                iconName: "plus",
                label: "Restock",
                className: "primary js-restock-product",
                data: { "product-id": product.id }
              })
            : ""}
          ${canReduceStock
            ? textButton({
                iconName: "alert",
                label: "Reduce",
                className: "js-reduce-stock",
                disabled: Number(product.stock || 0) <= 0,
                data: { "product-id": product.id }
              })
            : ""}
        </div>
      </footer>
    </article>
  `;
}

function stockProductBaseName(product) {
  const savedFamily = String(product?.productFamily || "").trim();
  let baseName = savedFamily || String(product?.name || "Stock item").trim();
  [product?.size, product?.productType].forEach((suffix) => {
    const normalizedSuffix = String(suffix || "").trim();
    if (!normalizedSuffix) return;
    const escapedSuffix = normalizedSuffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    baseName = baseName.replace(new RegExp(`\\s+${escapedSuffix}$`, "i"), "").trim();
  });
  return baseName || String(product?.name || "Stock item").trim();
}

function renderProductListRow(product, state, permissions) {
  const health = getStockHealth(product);
  const canRestock = permissions.canManageProducts || permissions.canManageStockMovements || permissions.canReconcileStock;
  const canReduceStock = permissions.canManageStockMovements;
  const canManageProducts = permissions.canManageProducts;
  const stockCategory = stockCategoryIdForProduct(product);
  const isRawMaterial = stockCategory === RAW_MATERIALS_CATEGORY;
  const searchIndex = [product.id, product.name, product.productType, product.size, product.category, product.region, product.warehouse]
    .join(" ")
    .toLowerCase();

  return `
    <tr
      class="stock-health-row ${product.status === "inactive" ? "is-inactive" : ""}"
      data-category="${escapeHtml(product.category)}"
      data-stock-category="${escapeHtml(stockCategory)}"
      data-search-index="${escapeHtml(searchIndex)}"
      data-open-stock-product
      data-product-id="${escapeHtml(product.id)}"
      tabindex="0"
      aria-label="View full details for ${escapeHtml(product.name)}"
    >
      ${canManageProducts ? `
        <td class="stock-select-cell">
          <input class="js-select-stock" type="checkbox" value="${escapeHtml(product.id)}" aria-label="Select ${escapeHtml(product.name)} (${escapeHtml(product.id)})">
        </td>
      ` : ""}
      <td>
        <div class="stock-health-item">
          <div class="product-media">${renderProductImage(product)}</div>
          <div>
            <strong>${escapeHtml(stockProductBaseName(product))}</strong>
            <span>${escapeHtml(product.id)}</span>
          </div>
        </div>
      </td>
      <td><strong>${escapeHtml(product.category)}</strong></td>
      <td>${escapeHtml(product.productType || "Standard")}</td>
      <td>${escapeHtml(product.size || "Standard")}</td>
      <td><div class="stock-health-quantity"><strong>${formatNumber(product.stock)}</strong><span>${formatNumber(product.reorderPoint)} reorder point</span></div></td>
      <td>
        <div class="stock-health-progress">
          <div>
            ${product.status === "inactive" ? statusPill("inactive") : health.status === "ready" ? "" : statusPill(health.status)}
            <span>${health.daysCover} days cover</span>
          </div>
          ${progressBar(health.percent, health.tone)}
        </div>
      </td>
      <td><div class="stock-health-prices"><span>Cost ${formatCurrency(product.unitCost)}</span><strong>${product.unitPrice ? formatCurrency(product.unitPrice) : "Factory use"}</strong></div></td>
      <td>
        <div class="row-actions stock-list-actions">
          ${canManageProducts ? iconButton({ iconName: "settings", label: "Update stock record", className: "js-edit-product", data: { "product-id": product.id } }) : ""}
          ${canManageProducts ? iconButton({ iconName: product.status === "inactive" ? "check" : "x", label: product.status === "inactive" ? "Show" : "Hide", className: "js-toggle-product-status", data: { "product-id": product.id } }) : ""}
          ${canManageProducts ? iconButton({ iconName: "trash", label: "Delete stock record", className: "js-delete-product warning-icon", data: { "product-id": product.id } }) : ""}
          ${canRestock ? iconButton({ iconName: "plus", label: "Add stock quantity", className: "stock-action-primary js-restock-product", data: { "product-id": product.id } }) : ""}
          ${canReduceStock ? iconButton({ iconName: "alert", label: "Reduce stock", className: "js-reduce-stock", disabled: Number(product.stock || 0) <= 0, data: { "product-id": product.id } }) : ""}
          ${isRawMaterial && Number(product.stock || 0) > 0 && (canManageProducts || canReduceStock)
            ? iconButton({ iconName: "wallet", label: "Sell raw material", className: "js-sell-raw-material", data: { "product-id": product.id } })
            : ""}
        </div>
      </td>
    </tr>
  `;
}

function cartonStockBreakdown(product) {
  const pieces = Math.max(0, Number(product.stock || 0));
  const piecesPerCarton = Math.max(0, Number(product.packagingConversions?.carton || 0));
  const fullCartons = piecesPerCarton > 0 ? Math.floor(pieces / piecesPerCarton) : 0;
  const loosePieces = piecesPerCarton > 0 ? pieces - (fullCartons * piecesPerCarton) : pieces;
  const cartonLabel = fullCartons === 1 ? "carton" : "cartons";

  return {
    pieces,
    piecesPerCarton,
    fullCartons,
    loosePieces,
    cartonLabel,
    hasFullCarton: fullCartons > 0
  };
}

function renderStockGridCard(product, state, permissions) {
  const health = getStockHealth(product);
  const canRestock = permissions.canManageProducts || permissions.canManageStockMovements || permissions.canReconcileStock;
  const canReduceStock = permissions.canManageStockMovements;
  const canManageProducts = permissions.canManageProducts;
  const stockCategory = stockCategoryIdForProduct(product);
  const isRawMaterial = stockCategory === RAW_MATERIALS_CATEGORY;
  const searchIndex = [product.id, product.name, product.productType, product.size, product.category, product.region, product.warehouse]
    .join(" ")
    .toLowerCase();
  const cartonStock = cartonStockBreakdown(product);
  const primaryStockUnit = cartonStock.hasFullCarton ? "carton" : "piece";
  const primaryStockLabel = cartonStock.hasFullCarton
    ? `${formatNumber(cartonStock.fullCartons)} ${cartonStock.cartonLabel}`
    : `${formatNumber(cartonStock.pieces)} piece${cartonStock.pieces === 1 ? "" : "s"}`;
  const looseStockLabel = cartonStock.hasFullCarton && cartonStock.loosePieces > 0
    ? `+ ${formatNumber(cartonStock.loosePieces)} loose piece${cartonStock.loosePieces === 1 ? "" : "s"}`
    : "";

  return `
    <article
      class="stock-health-grid-card ${product.status === "inactive" ? "is-inactive" : ""}"
      data-category="${escapeHtml(product.category)}"
      data-stock-category="${escapeHtml(stockCategory)}"
      data-search-index="${escapeHtml(searchIndex)}"
      data-open-stock-product
      data-product-id="${escapeHtml(product.id)}"
      tabindex="0"
      role="group"
      aria-label="${escapeHtml(product.name)} product card. Press Enter to view full details."
    >
      <div class="stock-health-grid-image">${renderProductImage(product)}</div>
      <div class="stock-health-grid-body">
        <div class="stock-health-grid-heading">
          <div>
            <strong>${escapeHtml(stockProductBaseName(product))}</strong>
            <span>${escapeHtml(product.id)}</span>
          </div>
          ${product.status === "inactive" ? statusPill("inactive") : health.status === "ready" ? "" : statusPill(health.status)}
        </div>
        <div class="stock-health-grid-meta">
          <span>${escapeHtml(product.productType || "Standard")}</span>
          <span>${escapeHtml(product.size || "Standard size")}</span>
        </div>
        <div class="stock-health-grid-availability" data-grid-stock-unit="${primaryStockUnit}">
          <span>Available stock</span>
          <div>
            <strong>${primaryStockLabel}</strong>
            ${looseStockLabel ? `<small>${looseStockLabel}</small>` : ""}
          </div>
        </div>
        <div class="row-actions stock-list-actions stock-health-grid-actions">
          ${canManageProducts ? iconButton({ iconName: "settings", label: "Update stock record", className: "js-edit-product", data: { "product-id": product.id } }) : ""}
          ${canManageProducts ? iconButton({ iconName: product.status === "inactive" ? "check" : "x", label: product.status === "inactive" ? "Show" : "Hide", className: "js-toggle-product-status", data: { "product-id": product.id } }) : ""}
          ${canManageProducts ? iconButton({ iconName: "trash", label: "Delete stock record", className: "js-delete-product warning-icon", data: { "product-id": product.id } }) : ""}
          ${canRestock ? iconButton({ iconName: "plus", label: "Add stock quantity", className: "stock-action-primary js-restock-product", data: { "product-id": product.id } }) : ""}
          ${canReduceStock ? iconButton({ iconName: "alert", label: "Reduce stock", className: "js-reduce-stock", disabled: Number(product.stock || 0) <= 0, data: { "product-id": product.id } }) : ""}
          ${isRawMaterial && Number(product.stock || 0) > 0 && (canManageProducts || canReduceStock)
            ? iconButton({ iconName: "wallet", label: "Sell raw material", className: "js-sell-raw-material", data: { "product-id": product.id } })
            : ""}
        </div>
      </div>
    </article>
  `;
}

function renderStockProductDetailsModal() {
  return `
    <div id="stock-product-details-modal" class="stock-modal-backdrop" tabindex="-1" hidden>
      <section class="stock-modal stock-product-details-modal" role="dialog" aria-modal="true" aria-labelledby="stock-product-details-title">
        <header class="stock-modal-header">
          <div>
            <span class="eyebrow">Stock product</span>
            <h2 id="stock-product-details-title">Product details</h2>
          </div>
          ${iconButton({ iconName: "x", label: "Close product details", className: "js-close-stock-product-details" })}
        </header>
        <div id="stock-product-details-content"></div>
      </section>
    </div>
  `;
}

function renderStockProductDetails(product, state) {
  const health = getStockHealth(product);
  const stock = Math.max(0, Number(product.stock || 0));
  const cartonStock = cartonStockBreakdown(product);
  const bulkTypes = productPackagingTypes(state.client, product).filter((type) => type !== "piece");
  const packageAvailability = bulkTypes.map((type) => {
    const option = packagingOption(type);
    const piecesContained = Math.max(0, Number(packagingMultiplier(product, type, state.client) || 0));
    const fullPackages = piecesContained ? Math.floor(stock / piecesContained) : 0;
    const loosePieces = piecesContained ? stock - (fullPackages * piecesContained) : stock;
    const packageName = fullPackages === 1 ? option.singular : option.label.toLowerCase();
    const packagePrice = Math.max(0, Number(product.packagingPrices?.[type] || 0));

    return `
      <article class="stock-product-package-card">
        <span>${escapeHtml(option.label)}</span>
        <strong>${formatNumber(fullPackages)} ${escapeHtml(packageName)}${loosePieces ? ` + ${formatNumber(loosePieces)} loose piece${loosePieces === 1 ? "" : "s"}` : ""}</strong>
        <small>${formatNumber(piecesContained)} pieces per ${escapeHtml(option.singular)} · ${packagePrice ? formatCurrency(packagePrice) : "No package price set"}</small>
      </article>
    `;
  }).join("");
  const isFinishedProduct = stockCategoryIdForProduct(product) === FINISHED_PRODUCTS_CATEGORY;
  const linkedBatches = isFinishedProduct ? productionBatchesForProduct(state, product.id) : [];

  return `
    <div class="stock-product-details-hero">
      <div class="stock-product-details-image">${renderProductImage(product)}</div>
      <div class="stock-product-details-summary">
        <div>
          <span class="eyebrow">${escapeHtml(product.category || "Stock item")}</span>
          <h3>${escapeHtml(stockProductBaseName(product))}</h3>
          <p>${escapeHtml(product.id)} · ${escapeHtml(product.productType || "Standard type")} · ${escapeHtml(product.size || "Standard size")}</p>
        </div>
        <div class="stock-product-details-status">
          ${statusPill(product.status || "active")}
          ${health.status === "ready" ? "" : statusPill(health.status)}
        </div>
        <div class="stock-product-primary-availability">
          <span>Available stock</span>
          <div class="stock-product-primary-totals">
            <strong>${formatNumber(stock)} pieces</strong>
            ${cartonStock.piecesPerCarton > 0
              ? `<b>${cartonStock.hasFullCarton
                  ? `${formatNumber(cartonStock.fullCartons)} ${cartonStock.cartonLabel}${cartonStock.loosePieces ? ` + ${formatNumber(cartonStock.loosePieces)} loose piece${cartonStock.loosePieces === 1 ? "" : "s"}` : ""}`
                  : `Below one carton (${formatNumber(cartonStock.piecesPerCarton)} pieces required)`}</b>`
              : '<b>Carton quantity not configured</b>'}
          </div>
          <small>${formatNumber(product.reorderPoint || 0)} piece reorder point · ${formatNumber(health.daysCover)} days cover</small>
        </div>
      </div>
    </div>

    <section class="stock-product-details-section">
      <div class="stock-product-details-section-heading">
        <div>
          <span class="eyebrow">Package equivalents</span>
          <h3>Available stock in packages</h3>
        </div>
        ${icon("package")}
      </div>
      <div class="stock-product-package-grid">
        ${packageAvailability || '<div class="stock-product-package-empty">No package conversion has been configured for this product.</div>'}
      </div>
    </section>

    <section class="stock-product-details-section">
      <span class="eyebrow">Complete stock record</span>
      <dl class="stock-product-details-grid">
        <div><dt>SKU</dt><dd>${escapeHtml(product.id)}</dd></div>
        <div><dt>Product name</dt><dd>${escapeHtml(stockProductBaseName(product))}</dd></div>
        <div><dt>Product type</dt><dd>${escapeHtml(product.productType || "Standard")}</dd></div>
        <div><dt>Product size</dt><dd>${escapeHtml(product.size || "Not specified")}</dd></div>
        <div><dt>Category</dt><dd>${escapeHtml(product.category || "Not specified")}</dd></div>
        <div><dt>Stock unit</dt><dd>${escapeHtml(product.unit || "piece")}</dd></div>
        <div><dt>Factory location</dt><dd>${escapeHtml(product.warehouse || "Factory")}</dd></div>
        <div><dt>Cost per piece</dt><dd>${formatCurrency(product.unitCost || 0)}</dd></div>
        <div><dt>Selling price per piece</dt><dd>${product.unitPrice ? formatCurrency(product.unitPrice) : "Factory use"}</dd></div>
        <div><dt>Catalogue status</dt><dd>${escapeHtml(statusText(product.status || "active"))}</dd></div>
        <div><dt>Production batches</dt><dd>${isFinishedProduct ? formatNumber(linkedBatches.length) : "Not applicable"}</dd></div>
      </dl>
    </section>
  `;
}

function currentStaffName(state) {
  const userEmail = String(state.user?.email || "").trim().toLowerCase();
  const account = (state.accounts || []).find((item) => (
    item.userId === state.user?.id ||
    (userEmail && String(item.email || "").trim().toLowerCase() === userEmail)
  ));

  return account?.name || state.user?.user_metadata?.full_name || "Store Keeper";
}

function dispatchRecipientOptions(state, recipientType) {
  const accountNames = salesRepresentativeNames(state);
  const representatives = new Set(accountNames.length
    ? accountNames
    : (state.stockAssignments || []).map((assignment) => assignment.repName).filter(Boolean));
  const normalizedType = String(recipientType || "").toLowerCase();

  if (normalizedType.includes("representative")) {
    const options = [...representatives].sort().map((name) => ({ value: name, label: name }));

    return options.length
      ? options
      : [{ value: "", label: "No saved sales representatives", disabled: true }];
  }

  if (normalizedType.includes("supermarket")) {
    return [
      ...(state.retailers || [])
        .filter((retailer) => retailer.status !== "inactive")
        .slice()
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
        .map((retailer) => ({
          value: retailer.name,
          label: [retailer.name, retailer.lga || retailer.city || retailer.stateName || retailer.region].filter(Boolean).join(" - ")
        })),
      { value: "__other__", label: "Other customer / supermarket" }
    ];
  }

  if (normalizedType.includes("internal")) {
    return [
      { value: "Production Line", label: "Production Line" },
      { value: "Packaging Store", label: "Packaging Store" },
      { value: "Finished Products Store", label: "Finished Products Store" },
      { value: "Raw Materials Store", label: "Raw Materials Store" },
      { value: "__other__", label: "Other internal location" }
    ];
  }

  return [{ value: "__other__", label: "Other recipient" }];
}

function renderDispatchRecipientOptions(state, recipientType) {
  return [
    '<option value="">Choose recipient</option>',
    ...dispatchRecipientOptions(state, recipientType).map((option) => `
      <option value="${escapeHtml(option.value)}" ${option.disabled ? "disabled" : ""}>${escapeHtml(option.label)}</option>
    `)
  ].join("");
}

function dispatchableProducts(state, recipientType) {
  const normalizedType = String(recipientType || "").toLowerCase();
  const requiresFinishedGoods = normalizedType.includes("representative") || normalizedType.includes("supermarket");

  return (state.products || []).filter((product) => (
    product.status !== "inactive" &&
    Number(product.stock || 0) > 0 &&
    (!requiresFinishedGoods || stockCategoryIdForProduct(product) === FINISHED_PRODUCTS_CATEGORY)
  ));
}

function renderDispatchProductOptions(state, recipientType, selectedProductId = "") {
  return [
    '<option value="">Choose stock item</option>',
    ...dispatchableProducts(state, recipientType).map((product) => `
      <option value="${escapeHtml(product.id)}" ${product.id === selectedProductId ? "selected" : ""}>
        ${escapeHtml(product.name)} (${formatNumber(product.stock)} available)
      </option>
    `)
  ].join("");
}

function renderDispatchItemRow(state, recipientType, { removable = false } = {}) {
  return `
    <div class="dispatch-item-row" data-dispatch-item-row>
      <label class="field">
        <span>Product</span>
        <select name="dispatchProductId" data-dispatch-product-select required>
          ${renderDispatchProductOptions(state, recipientType)}
        </select>
      </label>
      <label class="field">
        <span>Quantity</span>
        <input name="dispatchQuantity" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0" required>
      </label>
      <label class="field">
        <span>Packaging</span>
        <select name="dispatchPackagingType" data-dispatch-packaging-select required>
          <option value="piece">Pieces</option>
        </select>
      </label>
      <label class="field">
        <span>Unit price</span>
        <input data-dispatch-unit-price value="0" readonly aria-label="Selected product unit price">
      </label>
      <div class="dispatch-item-remove">
        ${iconButton({
          iconName: "trash",
          label: "Remove product from dispatch",
          className: "js-remove-dispatch-item warning-icon",
          disabled: !removable
        })}
      </div>
    </div>
  `;
}

function otherRecipientPlaceholder(recipientType) {
  const normalizedType = String(recipientType || "").toLowerCase();

  if (normalizedType.includes("supermarket")) return "Type customer or supermarket name";
  if (normalizedType.includes("internal")) return "Type internal location";
  return "Type recipient name";
}

function destinationPlaceholder(recipientType) {
  const normalizedType = String(recipientType || "").toLowerCase();

  if (normalizedType.includes("representative")) return "Van number or delivery area";
  if (normalizedType.includes("supermarket")) return "Outlet branch, city, or delivery address";
  if (normalizedType.includes("internal")) return "Store room, production line, or equipment bay";
  return "Where the stock is going";
}

function renderDispatchForm(state, permissions) {
  if (!permissions.canDispatchStock && !permissions.canManageStockMovements && !permissions.canAssignStock) return "";

  return `
    <section class="panel manager-tool-panel">
      ${panelHeader("Record factory dispatch", "Log stock leaving the factory for a representative, supermarket, or internal destination")}
      <form id="stock-dispatch-form" class="manager-form-grid" novalidate>
        <label class="field">
          <span>Recipient type</span>
          <select name="recipientType" required>
            <option value="Sales Representative">Sales Representative</option>
            <option value="Supermarket">Supermarket</option>
            <option value="Internal Location">Internal Location</option>
          </select>
        </label>
        <label class="field">
          <span>Recipient</span>
          <select name="recipientNameChoice" data-dispatch-recipient-select required>
            ${renderDispatchRecipientOptions(state, "Sales Representative")}
          </select>
          <input name="recipientNameOther" data-dispatch-recipient-other placeholder="Type recipient name" hidden>
        </label>
        <label class="field" data-dispatch-payment-field>
          <span>Payment method</span>
          <select name="paymentType" required>
            <option value="cash">Cash paid on dispatch</option>
            <option value="credit">Credit</option>
          </select>
        </label>
        <section class="span-full dispatch-items-builder">
          <header>
            <strong>Products being dispatched</strong>
            ${iconButton({ iconName: "plus", label: "Add another product", className: "js-add-dispatch-item" })}
          </header>
          <div class="dispatch-item-list" data-dispatch-item-list>
            ${renderDispatchItemRow(state, "Sales Representative")}
          </div>
          <template data-dispatch-item-template>
            ${renderDispatchItemRow(state, "Sales Representative", { removable: true })}
          </template>
        </section>
        <label class="field">
          <span>Destination / drop-off point</span>
          <input name="destination" placeholder="${escapeHtml(destinationPlaceholder("Sales Representative"))}" required>
        </label>
        <label class="field">
          <span>Dispatch date</span>
          <input name="dispatchDate" type="date" value="${escapeHtml(todayISO())}" required>
        </label>
        <label class="field">
          <span>Expected delivery date</span>
          <input name="expectedDeliveryAt" type="date" min="${escapeHtml(todayISO())}" value="${escapeHtml(todayISO())}" required>
        </label>
        <label class="field span-full">
          <span>Staff responsible</span>
          <input name="staffName" value="${escapeHtml(currentStaffName(state))}" required>
        </label>
        <div class="manager-form-actions span-full">
          ${textButton({
            iconName: "truck",
            label: "Record dispatch",
            className: "primary",
            type: "submit"
          })}
        </div>
        <span id="stock-dispatch-message" class="field-error span-full"></span>
      </form>
    </section>
  `;
}

export function renderCeoQuickStockActions(state) {
  const permissions = currentUserPermissions(state);

  return `
    <div class="ceo-quick-actions">
      <button class="button primary compact js-open-stock-modal" type="button">${icon("plus")}<span>Add stock</span></button>
      <button class="button compact js-open-dashboard-dispatch" type="button">${icon("truck")}<span>Factory dispatch</span></button>
    </div>
    ${renderStockProductModal(state, permissions)}
    ${renderDashboardDispatchModal(state, permissions)}
  `;
}

function renderDashboardDispatchModal(state, permissions) {
  return `
    <div id="dashboard-dispatch-modal" class="stock-modal-backdrop" hidden>
      <section class="stock-modal" role="dialog" aria-modal="true" aria-labelledby="dashboard-dispatch-title">
        <header class="stock-modal-header">
          <h2 id="dashboard-dispatch-title">Factory dispatch</h2>
          <button class="icon-button js-close-dashboard-dispatch" type="button" aria-label="Close factory dispatch">${icon("x")}</button>
        </header>
        ${renderDispatchForm(state, permissions)}
      </section>
    </div>
  `;
}

export function renderRecordCorrectionModal(submitLabel = "Send for approval") {
  const isDirectAdjustment = submitLabel === "Save adjustment";
  return `
    <div id="record-correction-modal" class="stock-modal-backdrop" hidden>
      <section class="stock-modal compact-record-modal" role="dialog" aria-modal="true" aria-labelledby="record-correction-title">
        <header class="stock-modal-header">
          <div>
            <span class="eyebrow">${isDirectAdjustment ? "CEO adjustment" : "Controlled adjustment"}</span>
            <h2 id="record-correction-title">${isDirectAdjustment ? "Adjust saved dispatch" : "Request a correction"}</h2>
          </div>
          ${iconButton({ iconName: "x", label: "Close correction request", className: "js-close-record-correction" })}
        </header>
        <form id="record-correction-form" class="manager-form-grid" novalidate>
          <input type="hidden" name="transactionId">
          <div class="client-id-box span-full">
            <span class="eyebrow">Saved record</span>
            <strong data-correction-record-label>Dispatch</strong>
          </div>
          <label class="field">
            <span>Correct quantity</span>
            <input name="requestedQuantity" type="number" min="0.01" step="0.01" inputmode="decimal" required>
            <small class="field-help" data-correction-quantity-limit hidden></small>
          </label>
          <label class="field">
            <span>Packaging</span>
            <select name="requestedPackagingType" data-correction-packaging required>
              <option value="piece">Pieces</option>
            </select>
            <small class="field-help" data-correction-package-summary>Enter the corrected quantity to see the exact pieces.</small>
          </label>
          <label class="field span-full">
            <span>Reason for adjustment</span>
            <textarea name="reason" rows="3" maxlength="500" placeholder="Explain the mistake and why this quantity should change" required></textarea>
          </label>
          <div class="manager-form-actions span-full">
            ${textButton({ iconName: "check", label: submitLabel, className: "primary", type: "submit" })}
          </div>
          <span id="record-correction-message" class="field-error span-full" role="status"></span>
        </form>
      </section>
    </div>
  `;
}

export function renderStoreKeeperDispatchAction(state) {
  const permissions = currentUserPermissions(state);

  return `
    <div class="ceo-quick-actions">
      <button class="button compact js-open-stock-modal" type="button">${icon("plus")}<span>Add stock</span></button>
      <button class="button primary compact js-open-dashboard-dispatch" type="button">
        ${icon("truck")}
        <span>Record dispatch</span>
      </button>
    </div>
    ${renderStockProductModal(state, permissions)}
    ${renderDashboardDispatchModal(state, permissions)}
    ${renderRecordCorrectionModal()}
  `;
}

function renderDispatchPage(state, permissions) {
  return `
    ${renderDispatchForm(state, permissions)}
    <section class="panel inventory-layout">
      ${panelHeader("Dispatch log", "Item, quantity, payment, delivery, recipient, destination, and staff responsible")}
      ${table(
        ["Item", "Quantity", "Payment / invoice", "Dispatched", "Expected", "Recipient", "Destination", "Staff", "Adjustment"],
        renderDispatchRows(state),
        "No factory dispatches recorded yet"
      )}
      <div class="activity-pagination" data-dispatch-pagination hidden>
        <button class="button" type="button" data-dispatch-page="prev">Previous</button>
        <span data-dispatch-page-status>Page 1 of 1</span>
        <button class="button" type="button" data-dispatch-page="next">Next</button>
      </div>
    </section>
  `;
}

function dispatchTransactions(state) {
  return (state.stockTransactions || []).filter((transaction) => {
    const type = String(transaction.type || "").toLowerCase();
    return transaction.dispatchDestination || type === "supply" || type === "internal movement";
  });
}

function renderDispatchRows(state) {
  const productMap = getProductMap(state.products);
  const role = currentUserRole(state);
  const pendingTransactionIds = new Set((state.correctionRequests || [])
    .filter((request) => request.status === "pending")
    .map((request) => request.transactionId));

  return [...dispatchTransactions(state)]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.id || "").localeCompare(String(a.id || "")))
    .map((transaction, index) => {
    const product = productMap.get(transaction.productId);
    const recipient = transaction.recipientName || transaction.partyName || "Factory";
    const destination = transaction.dispatchDestination || transaction.destination || transaction.partyType || "Factory";
    const staff = transaction.staffResponsible || transaction.recordedBy || "Store Keeper";
    const isAdjustableDispatch = transaction.movementDirection === "out" && ["supply", "internal movement"].includes(String(transaction.type || "").toLowerCase());
    const searchIndex = [
      product?.name,
      transaction.quantity,
      transaction.date,
      transaction.expectedDeliveryAt,
      transaction.paymentType,
      transaction.invoiceId,
      transaction.dispatchId,
      recipient,
      destination,
      staff
    ].join(" ").toLowerCase();

    return `
      <tr ${index >= DISPATCH_PAGE_SIZE ? "hidden " : ""}data-dispatch-row data-search-index="${escapeHtml(searchIndex)}">
        <td>
          <strong>${escapeHtml(product?.name || transaction.productId)}</strong>
          <div class="muted">${escapeHtml(transaction.id)}</div>
        </td>
        <td>
          ${transaction.packagingType && transaction.packagingType !== "piece" && transaction.packagingQuantity
            ? `<strong>${escapeHtml(packagingQuantityLabel(transaction.packagingQuantity, transaction.packagingType))}</strong><div class="muted">${formatNumber(transaction.quantity)} pieces</div>`
            : formatNumber(transaction.quantity)}
        </td>
        <td>
          ${escapeHtml(statusText(transaction.paymentType || "none"))}
          <div class="muted">${escapeHtml(transaction.invoiceId || transaction.dispatchId || "Internal movement")}</div>
        </td>
        <td>${formatDate(transaction.date)}</td>
        <td>${transaction.expectedDeliveryAt ? formatDate(transaction.expectedDeliveryAt) : '<span class="muted">Not set</span>'}</td>
        <td>
          ${escapeHtml(recipient)}
          <div class="muted">${escapeHtml(transaction.partyType || "Recipient")}</div>
        </td>
        <td>${escapeHtml(destination)}</td>
        <td>${escapeHtml(staff)}</td>
        <td>
          ${!isAdjustableDispatch ? '<span class="muted">—</span>' : pendingTransactionIds.has(transaction.id) && role !== "ceo"
            ? iconButton({ iconName: "clock", label: "Correction awaiting approval", disabled: true })
            : iconButton({
                iconName: "refresh",
                label: role === "ceo" ? "Adjust dispatch" : "Request dispatch correction",
                className: "js-open-record-correction",
                data: {
                  "transaction-id": transaction.id,
                  "record-label": `${product?.name || transaction.productId} dispatch`,
                  quantity: transaction.quantity
                }
              })}
        </td>
      </tr>
    `;
  });
}

function movementDirection(transaction) {
  if (transaction.movementDirection) return transaction.movementDirection;
  const type = String(transaction.type || "").toLowerCase();
  if (type === "return" || type.includes("intake") || type.includes("restock")) return "in";
  return "out";
}

function renderMovementRows(state) {
  const productMap = getProductMap(state.products);

  return [...(state.stockTransactions || [])]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.id || "").localeCompare(String(a.id || "")))
    .map((transaction, index) => {
      const product = productMap.get(transaction.productId);
      const direction = movementDirection(transaction);
      const searchIndex = [
        transaction.type,
        direction,
        product?.name,
        transaction.partyName,
        transaction.recordedBy
      ].join(" ").toLowerCase();

      return `
        <tr ${index >= MOVEMENT_PAGE_SIZE ? "hidden " : ""}data-movement-row data-search-index="${escapeHtml(searchIndex)}">
          <td>
            ${statusPill(direction === "in" ? "in_stock" : "dispatched")}
            <div class="muted">${escapeHtml(statusText(transaction.type))}</div>
          </td>
          <td>
            <strong>${escapeHtml(product?.name || transaction.productId)}</strong>
            <div class="muted">${escapeHtml(transaction.id)}</div>
          </td>
          <td>${formatNumber(transaction.quantity)}</td>
          <td>${formatDate(transaction.date)}</td>
          <td>
            ${escapeHtml(transaction.partyName || transaction.recipientName || "Factory")}
            <div class="muted">${escapeHtml(transaction.dispatchDestination || transaction.partyType || "Movement")}</div>
          </td>
          <td>${escapeHtml(transaction.staffResponsible || transaction.recordedBy || "Team member")}</td>
        </tr>
      `;
    });
}

function assignmentDisplayStatus(assignment) {
  if (assignment.varianceFlagged && assignment.status !== "reconciled") return "variance";
  return assignment.status;
}

function assignmentInHand(assignment) {
  return Number(assignment.assigned || 0) - Number(assignment.sold || 0) - Number(assignment.returned || 0);
}

function hasStockInHand(assignment) {
  return Math.abs(assignmentInHand(assignment)) > 0.0001;
}

function renderAssignmentRows(state, permissions) {
  const productMap = getProductMap(state.products);

  return state.stockAssignments.map((assignment) => {
    const product = productMap.get(assignment.productId);
    const inHand = assignmentInHand(assignment);
    const hasOutstandingStock = hasStockInHand(assignment);
    const hasVariance = Boolean(assignment.varianceFlagged) && hasOutstandingStock;
    const soldPercent = assignment.assigned ? (assignment.sold / assignment.assigned) * 100 : 0;
    const searchIndex = [
      assignment.id,
      assignment.repName,
      assignment.routeId,
      product?.name,
      assignment.status
    ].join(" ").toLowerCase();

    return `
      <tr
        class="assignment-ledger-row js-open-assignment-details"
        data-assignment-row
        data-assignment-id="${escapeHtml(assignment.id)}"
        data-assignment-rep="${escapeHtml(assignment.repName)}"
        data-assignment-date="${escapeHtml(String(assignment.assignedAt || "").slice(0, 10))}"
        data-assignment-variance="${hasVariance ? "true" : "false"}"
        data-search-index="${escapeHtml(searchIndex)}"
        tabindex="0"
        role="button"
        aria-label="View ${escapeHtml(assignment.repName)} stock assignment details"
      >
        <td>
          <strong>${escapeHtml(assignment.id)}</strong>
          <div class="muted">${formatDate(assignment.assignedAt)} - ${escapeHtml(assignment.routeId)}</div>
        </td>
        <td>${escapeHtml(assignment.repName)}</td>
        <td>${escapeHtml(product?.name || assignment.productId)}</td>
        <td>${formatNumber(assignment.assigned)}</td>
        <td>
          <div class="stock-line">
            <div class="stock-meta">
              <span>${formatNumber(assignment.sold)}</span>
              <span>${formatPercent(soldPercent)}</span>
            </div>
            ${progressBar(soldPercent)}
          </div>
        </td>
        <td>${formatNumber(assignment.returned)}</td>
        <td>
          <strong>${formatNumber(inHand)}</strong>
          <div class="muted">Still with representative</div>
        </td>
        <td>
          ${statusPill(assignmentDisplayStatus(assignment))}
        </td>
        <td>
          <span class="ledger-row-view" aria-hidden="true">${icon("eye")}</span>
        </td>
      </tr>
    `;
  });
}

function renderAssignmentDetails(assignment, state, permissions) {
  const product = getProductMap(state.products).get(assignment.productId);
  const inHand = assignmentInHand(assignment);
  const hasOutstandingStock = hasStockInHand(assignment);
  const variance = assignment.varianceFlagged && hasOutstandingStock ? inHand : 0;
  const reconcileBlocked = hasOutstandingStock && !assignment.varianceFlagged;

  return `
    <div class="assignment-detail-heading">
      <div>
        <span class="eyebrow">${escapeHtml(assignment.id)}</span>
        <h3>${escapeHtml(product?.name || assignment.productId)}</h3>
        <p>${escapeHtml(assignment.repName)} - assigned ${formatDate(assignment.assignedAt)}</p>
      </div>
      ${statusPill(assignmentDisplayStatus(assignment))}
    </div>
    <div class="assignment-detail-grid">
      <div><span>Assigned</span><strong>${formatNumber(assignment.assigned)}</strong></div>
      <div><span>Sold</span><strong>${formatNumber(assignment.sold)}</strong></div>
      <div><span>Returned</span><strong>${formatNumber(assignment.returned)}</strong></div>
      <div><span>Still with representative</span><strong>${formatNumber(inHand)}</strong></div>
    </div>
    <section class="assignment-variance-summary ${variance ? "is-discrepant" : ""}">
      <div>
        <span class="eyebrow">Variance</span>
        <strong>${formatNumber(variance)}</strong>
      </div>
      <p>${variance
        ? `These ${formatNumber(variance)} items were flagged because they still need an explanation before this assignment can be closed.`
        : "No variance has been flagged. Products still with the representative are normal while the assignment is open."}</p>
      ${assignment.varianceNote ? `<p><strong>Note:</strong> ${escapeHtml(assignment.varianceNote)}</p>` : ""}
    </section>
    ${permissions.canReconcileStock && assignment.status !== "reconciled" ? `
      <div class="assignment-detail-actions">
        ${hasOutstandingStock ? `<input class="table-note-input" data-modal-variance-note placeholder="Optional explanation">` : ""}
        ${textButton({
          iconName: "alert",
          label: "Flag variance",
          className: "js-modal-flag-assignment",
          disabled: !hasOutstandingStock,
          data: { "assignment-id": assignment.id }
        })}
        <span class="reconcile-action-wrap">
          ${textButton({
            iconName: "check",
            label: assignment.varianceFlagged ? "Close assignment" : "Reconcile",
            className: "primary js-modal-reconcile-assignment",
            disabled: reconcileBlocked,
            data: { "assignment-id": assignment.id }
          })}
          ${reconcileBlocked ? '<span class="assignment-action-hint" role="tooltip">Flag the unexplained stock before closing.</span>' : ""}
        </span>
      </div>
    ` : ""}
  `;
}

function renderAssignmentDetailsModal() {
  return `
    <div id="assignment-details-modal" class="stock-modal-backdrop" tabindex="-1" hidden>
      <section class="stock-modal assignment-details-modal" role="dialog" aria-modal="true" aria-labelledby="assignment-details-title">
        <header class="stock-modal-header">
          <div>
            <span class="eyebrow">Representative stock</span>
            <h2 id="assignment-details-title">Assignment details</h2>
          </div>
          ${textButton({ iconName: "x", label: "Close", className: "js-close-assignment-details" })}
        </header>
        <div id="assignment-details-content"></div>
      </section>
    </div>
  `;
}

function renderTransactionRows(state) {
  const productMap = getProductMap(state.products);

  return state.stockTransactions.map((transaction) => {
    const product = productMap.get(transaction.productId);
    const searchIndex = [
      transaction.id,
      transaction.type,
      product?.name,
      transaction.partyName,
      transaction.recordedBy,
      transaction.paymentType
    ].join(" ").toLowerCase();

    return `
      <tr data-search-index="${escapeHtml(searchIndex)}">
        <td>
          <strong>${escapeHtml(transaction.id)}</strong>
          <div class="muted">${formatDate(transaction.date)}</div>
        </td>
        <td>${statusPill(transaction.type)}</td>
        <td>
          ${escapeHtml(product?.name || transaction.productId)}
          <div class="muted">${formatNumber(transaction.quantity)} ${escapeHtml(transaction.unit || productUnit(product || {}))}</div>
        </td>
        <td>
          <strong>${formatCurrency(transaction.amount)}</strong>
          <div class="muted">${escapeHtml(statusText(transaction.paymentType))}</div>
        </td>
        <td>
          ${escapeHtml(transaction.partyName)}
          <div class="muted">${escapeHtml(transaction.partyType)}</div>
        </td>
        <td>
          ${escapeHtml(transaction.recordedBy)}
          <div class="muted">${transaction.creditImpact ? formatCurrency(transaction.creditImpact) : "No credit impact"}</div>
        </td>
      </tr>
    `;
  });
}

function renderStockHealthPage(state, permissions) {
  const canAddStock = permissions.canManageProducts || permissions.canAddStock;
  const visibleProducts = permissions.canManageProducts
    ? state.products
    : state.products.filter((product) => product.status !== "inactive");

  return `
    <section class="panel inventory-layout">
      <div class="toolbar stock-health-toolbar">
        ${panelHeader("Stock health", "Raw materials, finished products, equipment, days remaining, and low-stock warnings")}
        <div class="toolbar-group">
          <div class="stock-health-view-toggle" role="group" aria-label="Stock item view">
            ${iconButton({ iconName: "orders", label: "List view", className: stockHealthView === "list" ? "is-active" : "", data: { "stock-view": "list" } })}
            ${iconButton({ iconName: "dashboard", label: "Grid view", className: stockHealthView === "grid" ? "is-active" : "", data: { "stock-view": "grid" } })}
          </div>
          ${permissions.canManageProducts
            ? textButton({
                iconName: "trash",
                label: "Delete selected",
                className: "warning js-delete-selected-stock",
                disabled: true
              })
            : ""}
          ${canAddStock
            ? textButton({
                iconName: "plus",
                label: "Add stock",
                className: "primary js-open-stock-modal"
              })
            : ""}
          <label class="field stock-health-type-filter">
            <span>Stock type</span>
            <select id="inventory-category-filter">
              <option value="all">All stock</option>
              ${state.stockCategories.map((category) => `
                <option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>
              `).join("")}
            </select>
          </label>
        </div>
      </div>

      <div class="table-wrap stock-health-list" data-stock-view-panel="list" ${stockHealthView === "list" ? "" : "hidden"}>
        <table class="data-table stock-health-table">
          <thead>
            <tr>
              ${permissions.canManageProducts ? '<th class="stock-select-cell"><input class="js-select-all-stock" type="checkbox" aria-label="Select all visible stock records"></th>' : ""}
              <th>Stock item</th>
              <th>Category</th>
              <th>Product type</th>
              <th>Size</th>
              <th>Available</th>
              <th>Health</th>
              <th>Pricing</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${visibleProducts.length
              ? visibleProducts.map((product) => renderProductListRow(product, state, permissions)).join("")
              : `<tr><td colspan="${permissions.canManageProducts ? 9 : 8}"><div class="empty-state">No active stock items available</div></td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="stock-health-grid" data-stock-view-panel="grid" ${stockHealthView === "grid" ? "" : "hidden"}>
        ${visibleProducts.length
          ? visibleProducts.map((product) => renderStockGridCard(product, state, permissions)).join("")
          : '<div class="empty-state">No active stock items available</div>'}
      </div>
    </section>
  `;
}

function renderStockDeletionModal(permissions) {
  if (!permissions.canManageProducts) return "";

  return `
    <div id="stock-delete-confirmation-modal" class="stock-modal-backdrop" tabindex="-1" hidden>
      <section class="stock-modal stock-delete-confirmation-modal" role="alertdialog" aria-modal="true" aria-labelledby="stock-delete-confirmation-title" aria-describedby="stock-delete-confirmation-summary">
        <header class="stock-modal-header">
          <div class="stock-delete-confirmation-heading">
            <span class="stock-delete-confirmation-icon" aria-hidden="true">${icon("trash")}</span>
            <div>
              <span class="eyebrow">Permanent deletion</span>
              <h2 id="stock-delete-confirmation-title">Delete selected stock?</h2>
            </div>
          </div>
          ${iconButton({ iconName: "x", label: "Close deletion confirmation", className: "js-close-stock-delete-confirmation" })}
        </header>
        <p id="stock-delete-confirmation-summary" class="stock-delete-confirmation-summary" data-stock-delete-summary></p>
        <div class="stock-delete-preview" data-stock-delete-preview></div>
        <div class="stock-delete-impact">
          ${icon("alert")}
          <p>Factory quantities and representative allocations for these records will be removed. Historical transactions will remain in the activity records.</p>
        </div>
        <div class="stock-delete-confirmation-actions">
          <button class="button subtle js-close-stock-delete-confirmation" type="button"><span>Cancel</span></button>
          <button class="button warning js-confirm-stock-delete" type="button">${icon("trash")}<span>Delete records</span></button>
        </div>
      </section>
    </div>
  `;
}

function renderOverviewPage(state) {
  return `
    ${renderLifecycle(state)}
  `;
}

function renderAssignmentsPage(state, permissions) {
  const representativeNames = managerRepOptions(state);

  return `
    <section class="panel inventory-layout assignment-ledger-panel">
      ${panelHeader(
        "Representative stock ledger",
        "Created automatically when factory dispatch goes to a sales representative",
        textButton({
          iconName: "download",
          label: "Export PDF",
          className: "subtle js-export-assignment-pdf",
          disabled: !state.stockAssignments.length
        })
      )}
      <div class="assignment-filter-grid">
        <label class="field">
          <span>Sales representative</span>
          <select data-assignment-rep-filter>
            <option value="">All representatives</option>
            ${representativeNames.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>From</span>
          <input type="date" data-assignment-date-from>
        </label>
        <label class="field">
          <span>To</span>
          <input type="date" data-assignment-date-to>
        </label>
        <button class="button subtle" type="button" data-assignment-filter-reset>
          <span>Clear filters</span>
        </button>
      </div>
      ${table(
        ["Assignment", "Representative", "Product", "Assigned", "Sold", "Returned", "In hand", "Status", ""],
        renderAssignmentRows(state, permissions),
        "No representative stock ledger entries yet"
      )}
      <div class="muted assignment-filter-status" data-assignment-filter-status></div>
    </section>
  `;
}

function renderTransactionsPage(state) {
  return `
    <section class="panel inventory-layout">
      ${panelHeader("Movement history", "All stock movement in and out of the factory")}
      ${table(
        ["Direction", "Item", "Quantity", "Date", "Party / destination", "Staff"],
        renderMovementRows(state),
        "No stock movement recorded"
      )}
      <div class="activity-pagination" data-movement-pagination hidden>
        <button class="button" type="button" data-movement-page="prev">Previous</button>
        <span data-movement-page-status>Page 1 of 1</span>
        <button class="button" type="button" data-movement-page="next">Next</button>
      </div>
    </section>
  `;
}

function renderBatchMaterialRow(rawMaterials) {
  return `
    <div class="batch-material-row" data-batch-material-row>
      <label class="field">
        <span>Raw material</span>
        <select name="batchMaterialId">
          <option value="">Choose material</option>
          ${rawMaterials.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} - ${formatNumber(product.stock)} ${escapeHtml(productUnit(product))} available</option>`).join("")}
        </select>
      </label>
      <label class="field">
        <span>Quantity used</span>
        <input name="batchMaterialQuantity" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0">
      </label>
      <button class="icon-button js-remove-batch-material" type="button" title="Remove material" aria-label="Remove material">${icon("x")}</button>
    </div>
  `;
}

function renderProductionTraceabilityModal() {
  return `
    <div id="production-traceability-modal" class="stock-modal-backdrop" tabindex="-1" hidden>
      <section class="stock-modal production-traceability-modal" role="dialog" aria-modal="true" aria-labelledby="production-traceability-title">
        <header class="stock-modal-header">
          <div>
            <span class="eyebrow">Production traceability</span>
            <h2 id="production-traceability-title">Stock materials used</h2>
          </div>
          ${textButton({ iconName: "x", label: "Close", className: "js-close-production-traceability" })}
        </header>
        <div id="production-traceability-content"></div>
      </section>
    </div>
  `;
}

function renderProductionTraceabilityDetails(product, state) {
  const batches = productionBatchesForProduct(state, product.id);
  const productMap = getProductMap(state.products || []);
  const materialIds = new Set(batches.flatMap((batch) => (batch.materials || []).map((material) => material.productId)).filter(Boolean));
  const quantityProduced = batches.reduce((total, batch) => total + Number(batch.quantityProduced || 0), 0);

  return `
    <div class="production-traceability-heading">
      <div>
        <span class="eyebrow">${escapeHtml(product.id)}</span>
        <h3>${escapeHtml(product.name)}</h3>
        <p>Every recorded batch and the stock materials consumed.</p>
      </div>
      <span class="production-traceability-badge">${icon("package")}<span>Traceable output</span></span>
    </div>
    <div class="production-traceability-summary" aria-label="Production traceability summary">
      <div><span>Linked batches</span><strong>${formatNumber(batches.length)}</strong></div>
      <div><span>Raw materials</span><strong>${formatNumber(materialIds.size)}</strong></div>
      <div><span>Total recorded output</span><strong>${formatNumber(quantityProduced)} ${escapeHtml(productUnit(product))}</strong></div>
    </div>
    ${batches.length ? `
      <div class="production-traceability-list">
        ${batches.map((batch) => {
          const materials = batch.materials || [];
          return `
            <article class="production-traceability-batch">
              <header>
                <div>
                  <span class="eyebrow">${escapeHtml(productionBatchReference(batch))}</span>
                  <h4>${escapeHtml(batchOutputDescription(batch, product))}</h4>
                </div>
                <time datetime="${escapeHtml(String(batch.batchDate || ""))}">${formatDate(batch.batchDate)}</time>
              </header>
              ${batch.notes ? `<div class="production-traceability-purpose"><span>Production note</span><p>${escapeHtml(batch.notes)}</p></div>` : ""}
              <div>
                <span class="production-traceability-label">Raw materials used</span>
                ${materials.length ? `
                  <ul class="production-material-list">
                    ${materials.map((material) => `<li>${escapeHtml(batchMaterialDescription(material, productMap))}</li>`).join("")}
                  </ul>
                ` : '<p class="muted">No stock materials were recorded for this batch.</p>'}
              </div>
              <footer>Recorded by ${escapeHtml(batch.recordedBy || "Factory staff")}</footer>
            </article>
          `;
        }).join("")}
      </div>
    ` : '<div class="empty-state">No production batches are linked to this finished product yet.</div>'}
  `;
}

function renderRawMaterialCustomerOptions(state) {
  const customers = (state.retailers || [])
    .filter((customer) => customer.id && customer.name && customer.status !== "inactive")
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  return [
    ...customers.map((customer) => `<option value="${escapeHtml(customer.id)}">${escapeHtml(customer.name)}${customer.city || customer.stateName ? ` - ${escapeHtml(customer.city || customer.stateName)}` : ""}</option>`),
    '<option value="__other__">Other customer</option>'
  ].join("");
}

function renderRawMaterialSaleModal(state) {
  const rawMaterials = (state.products || []).filter((product) => product.status !== "inactive" && stockCategoryIdForProduct(product) === RAW_MATERIALS_CATEGORY);
  const saleableRawMaterials = rawMaterials.filter((product) => Number(product.stock || 0) > 0);

  return `
    <div id="raw-material-sale-modal" class="stock-modal-backdrop" hidden>
      <section class="stock-modal raw-material-sale-modal" role="dialog" aria-modal="true" aria-labelledby="raw-material-sale-title">
        <header class="stock-modal-header">
          <div>
            <span class="eyebrow">Stock sale</span>
            <h2 id="raw-material-sale-title">Sell raw material</h2>
            <p>Record a normal sale directly from available raw-material stock.</p>
          </div>
          ${textButton({ iconName: "x", label: "Close", className: "js-close-raw-sale-modal" })}
        </header>
      <form id="raw-material-sale-form" class="manager-form-grid" novalidate>
        <label class="field">
          <span>Raw material</span>
          <select name="productId" data-raw-sale-product required>
            <option value="">Choose raw material</option>
            ${saleableRawMaterials.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} - ${formatNumber(product.stock)} ${escapeHtml(productUnit(product))} available</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Quantity to sell</span>
          <input name="quantity" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0" required>
        </label>
        <label class="field">
          <span>Customer</span>
          <select name="customerChoice" data-raw-sale-customer required>
            ${renderRawMaterialCustomerOptions(state)}
          </select>
          <input name="customerNameOther" data-raw-sale-other-customer placeholder="Type customer name" hidden>
        </label>
        <label class="field">
          <span>Payment type</span>
          <select name="paymentType" data-raw-sale-payment required>
            <option value="cash">Cash</option>
            <option value="credit">Credit</option>
          </select>
          <small class="field-help" data-raw-sale-credit-help>Credit is available only for a saved customer.</small>
        </label>
        <label class="field">
          <span>Unit selling price</span>
          <input name="unitPrice" data-raw-sale-unit-price type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00" required>
        </label>
        <label class="field">
          <span>Sale date</span>
          <input name="saleDate" type="date" value="${escapeHtml(todayISO())}" required>
        </label>
        <label class="field span-full">
          <span>Sale notes (optional)</span>
          <textarea name="notes" rows="3" maxlength="500" placeholder="Delivery arrangement, reference, or other useful details"></textarea>
        </label>
        <div class="manager-form-actions span-full">
          <button class="button primary" type="submit" ${saleableRawMaterials.length ? "" : "disabled"}>${icon("wallet")}<span>Record raw material sale</span></button>
        </div>
        <span id="raw-material-sale-message" class="field-error span-full" role="status">${saleableRawMaterials.length ? "" : "No raw material stock is currently available to sell."}</span>
      </form>
      </section>
    </div>
  `;
}

function renderStockTabPage({ activeTabId, state, permissions }) {
  if (activeTabId === "dispatch") return renderDispatchPage(state, permissions);
  if (activeTabId === "overview") return renderOverviewPage(state);
  if (activeTabId === "assignments") return renderAssignmentsPage(state, permissions);
  if (activeTabId === "movement-history") return renderTransactionsPage(state);
  if (activeTabId === "adjustments") return renderAdjustmentContent(state);
  return renderStockHealthPage(state, permissions);
}

export function renderInventory({ state }) {
  const permissions = currentUserPermissions(state);
  const activeTabId = activeStockTabId(permissions, state);

  return `
    <section class="view inventory-view">
      ${renderStockSubtabs(activeTabId, permissions, state)}
      ${renderStockTabPage({ activeTabId, state, permissions })}
      ${renderStockProductModal(state, permissions)}
      ${renderRestockModal(permissions)}
      ${renderStockReductionModal(permissions)}
      ${renderAssignmentDetailsModal()}
      ${renderProductionTraceabilityModal()}
      ${renderStockProductDetailsModal()}
      ${renderRawMaterialSaleModal(state)}
      ${renderRecordCorrectionModal(currentUserRole(state) === "ceo" ? "Save adjustment" : "Send for approval")}
      ${renderStockDeletionModal(permissions)}
    </section>
  `;
}

export function bindInventory({ root, store, signal }) {
  bindAdjustments({ root, store, signal });
  const imageRefreshState = store.getState();
  if (isBackendConfigured() && imageRefreshState.client?.id) {
    const refreshSharedStockPictures = () => {
      loadSharedProductImages(imageRefreshState.client.id).then((images) => {
        if (signal?.aborted) return;
        const currentProducts = new Map((store.getState().products || []).map((product) => [String(product.id), product]));
        const changedImages = images.filter((image) => {
          const product = currentProducts.get(String(image.productId || ""));
          return product && (
            String(product.imageUrl || "") !== String(image.imageUrl || "") ||
            !product.imageRemoteSynced
          );
        });
        if (changedImages.length) {
          store.dispatch({
            type: "HYDRATE_PRODUCT_IMAGES",
            images: changedImages,
            authoritative: true
          });
        }
      }).catch((error) => {
        console.warn("Shared stock pictures could not be refreshed:", error.message);
      });
    };
    refreshSharedStockPictures();
    if (signal) {
      const sharedPictureRefreshTimer = globalThis.setInterval(refreshSharedStockPictures, 15000);
      signal.addEventListener("abort", () => globalThis.clearInterval(sharedPictureRefreshTimer), { once: true });
    }
  }
  const categoryFilter = qs("#inventory-category-filter", root);
  const selectAllStock = qs(".js-select-all-stock", root);
  const deleteSelectedStockButton = qs(".js-delete-selected-stock", root);
  const stockDeleteConfirmationModal = qs("#stock-delete-confirmation-modal", root);
  const stockDeleteSummary = qs("[data-stock-delete-summary]", root);
  const stockDeletePreview = qs("[data-stock-delete-preview]", root);
  const confirmStockDeleteButton = qs(".js-confirm-stock-delete", root);
  const stockModal = qs("#stock-product-modal", root);
  const stockModalTitle = qs("#stock-product-modal-title", root);
  const restockModal = qs("#restock-modal", root);
  const restockForm = qs("#restock-form", root);
  const restockMessage = qs("#restock-form-message", root);
  const reduceStockModal = qs("#reduce-stock-modal", root);
  const reduceStockForm = qs("#reduce-stock-form", root);
  const reduceStockMessage = qs("#reduce-stock-form-message", root);
  const productForm = qs("#manager-product-form", root);
  const productMessage = qs("#manager-product-message", root);
  const stockImageUploadField = qs("#stock-image-upload-field", root);
  const stockImageInput = qs("#stock-image-input", root);
  const stockImageUploadTitle = qs("#stock-image-upload-title", root);
  const stockImageFileName = qs("#stock-image-file-name", root);
  const clearStockImageButton = qs("#clear-stock-image-file", root);
  const dispatchForm = qs("#stock-dispatch-form", root);
  const dashboardDispatchModal = qs("#dashboard-dispatch-modal", root);
  const dispatchRecipientType = dispatchForm ? qs('select[name="recipientType"]', dispatchForm) : null;
  const dispatchItemList = dispatchForm ? qs("[data-dispatch-item-list]", dispatchForm) : null;
  const dispatchItemTemplate = dispatchForm ? qs("[data-dispatch-item-template]", dispatchForm) : null;
  const addDispatchItemButton = dispatchForm ? qs(".js-add-dispatch-item", dispatchForm) : null;
  const dispatchRecipientSelect = dispatchForm ? qs("[data-dispatch-recipient-select]", dispatchForm) : null;
  const dispatchOtherRecipient = dispatchForm ? qs("[data-dispatch-recipient-other]", dispatchForm) : null;
  const dispatchPaymentField = dispatchForm ? qs("[data-dispatch-payment-field]", dispatchForm) : null;
  const dispatchPaymentSelect = dispatchForm ? qs('select[name="paymentType"]', dispatchForm) : null;
  const dispatchDestinationInput = dispatchForm ? qs('input[name="destination"]', dispatchForm) : null;
  const dispatchDateInput = dispatchForm ? qs('input[name="dispatchDate"]', dispatchForm) : null;
  const expectedDeliveryInput = dispatchForm ? qs('input[name="expectedDeliveryAt"]', dispatchForm) : null;
  const routeParams = inventoryRouteParams();
  const requestedProductId = routeParams.get("product");
  const requestedStockType = routeParams.get("type");
  const requestedAction = routeParams.get("action");
  let stockImageDataUrl = stockEntrySession.imageUrl || "";
  let stockImageCleared = false;
  const batchMaterialList = qs("[data-batch-material-list]", root);
  const productionStockUpdate = productForm ? qs("[data-production-stock-update]", productForm) : null;
  const rawMaterialSaleModal = qs("#raw-material-sale-modal", root);
  const rawMaterialSaleForm = qs("#raw-material-sale-form", root);
  const rawSaleProductSelect = rawMaterialSaleForm ? qs("[data-raw-sale-product]", rawMaterialSaleForm) : null;
  const rawSaleCustomerSelect = rawMaterialSaleForm ? qs("[data-raw-sale-customer]", rawMaterialSaleForm) : null;
  const rawSaleOtherCustomer = rawMaterialSaleForm ? qs("[data-raw-sale-other-customer]", rawMaterialSaleForm) : null;
  const rawSalePaymentSelect = rawMaterialSaleForm ? qs("[data-raw-sale-payment]", rawMaterialSaleForm) : null;
  const rawSaleUnitPriceInput = rawMaterialSaleForm ? qs("[data-raw-sale-unit-price]", rawMaterialSaleForm) : null;
  const productionTraceabilityModal = qs("#production-traceability-modal", root);
  const productionTraceabilityContent = qs("#production-traceability-content", root);
  const stockProductDetailsModal = qs("#stock-product-details-modal", root);
  const stockProductDetailsContent = qs("#stock-product-details-content", root);
  const stockProductDetailsTitle = qs("#stock-product-details-title", root);
  const correctionModal = qs("#record-correction-modal", root);
  const correctionForm = qs("#record-correction-form", root);
  const correctionMessage = qs("#record-correction-message", root);
  const correctionPackagingSelect = qs("[data-correction-packaging]", correctionForm || root);
  const correctionPackageSummary = qs("[data-correction-package-summary]", correctionForm || root);
  const affiliatedProductProgress = qs("[data-affiliated-product-progress]", productForm || root);
  const affiliatedProductList = qs("[data-affiliated-product-list]", productForm || root);
  const addAffiliatedProductButton = qs(".js-add-affiliated-product", productForm || root);
  const saveStockEntryButton = qs(".js-save-stock-entry", productForm || root);
  const stockEntryFields = qs("[data-stock-entry-fields]", productForm || root);
  const sizeUnitSelect = productForm?.elements.sizeUnit;
  const customSizeUnitInput = productForm?.elements.sizeUnitOther;
  const stockEntryModeSelect = productForm?.elements.stockEntryMode;
  const stockPackageTypeSelect = productForm?.elements.stockPackagingType;
  const stockPackageTypeField = productForm ? qs("[data-stock-package-type]", productForm) : null;
  const stockPieceTotal = productForm ? qs("[data-stock-piece-total]", productForm) : null;
  const stockQuantityLabel = productForm ? qs("[data-stock-quantity-label]", productForm) : null;
  const stockPackageLabel = productForm ? qs("[data-stock-package-label]", productForm) : null;
  const stockFormSteps = productForm ? qsa("[data-stock-form-step]", productForm) : [];
  const stockStepIndicators = productForm ? qsa("[data-stock-step-indicator]", productForm) : [];
  const previousStockStepButton = productForm ? qs("[data-stock-step-previous]", productForm) : null;
  const nextStockStepButton = productForm ? qs("[data-stock-step-next]", productForm) : null;
  let activeStockFormStep = Math.min(3, Math.max(1, Number(stockEntrySession.step || 1)));
  let sessionAddedProductIds = [...stockEntrySession.productIds];
  let activeProductFamily = stockEntrySession.family;
  let entrySaved = sessionAddedProductIds.length > 0 && !stockEntrySession.adding;

  function updateCustomSizeUnitVisibility() {
    if (!sizeUnitSelect || !customSizeUnitInput) return;
    const usesCustomUnit = sizeUnitSelect.value === "other";
    customSizeUnitInput.hidden = !usesCustomUnit;
    customSizeUnitInput.required = usesCustomUnit;
    if (!usesCustomUnit) customSizeUnitInput.value = "";
  }

  sizeUnitSelect?.addEventListener("change", () => {
    updateCustomSizeUnitVisibility();
    if (!customSizeUnitInput.hidden) customSizeUnitInput.focus();
  });

  function updateFactoryStockEntry() {
    if (!productForm || !stockEntryModeSelect) return;
    const usesPackage = stockEntryModeSelect.value === "package";
    const hasPackageTypes = Boolean(stockPackageTypeSelect?.options.length);
    if (stockPackageTypeField) stockPackageTypeField.hidden = !hasPackageTypes;
    if (stockPackageTypeSelect) stockPackageTypeSelect.required = hasPackageTypes;
    if (stockQuantityLabel) stockQuantityLabel.textContent = usesPackage ? "Number of packages" : "Factory stock in pieces";
    if (stockPackageLabel) stockPackageLabel.textContent = usesPackage ? "Package type" : "Calculate packages as";
    if (productForm.elements.stock) {
      productForm.elements.stock.step = usesPackage ? "1" : "0.01";
      productForm.elements.stock.min = "0";
      productForm.elements.stock.inputMode = usesPackage ? "numeric" : "decimal";
    }
    if (!stockPieceTotal) return;
    stockPieceTotal.hidden = !hasPackageTypes;
    const packageType = stockPackageTypeSelect?.value || "";
    const enteredQuantity = Math.max(0, Number(productForm.elements.stock?.value || 0));
    const piecesContained = Math.max(0, Number(productForm.elements[`packagingConversion-${packageType}`]?.value || 0));
    const totalLabel = qs("strong", stockPieceTotal);
    if (!totalLabel) return;
    if (!piecesContained) {
      totalLabel.textContent = "Enter pieces contained";
      return;
    }
    if (usesPackage) {
      totalLabel.textContent = `${formatNumber(enteredQuantity * piecesContained)} pieces`;
      return;
    }
    const completePackages = Math.floor(enteredQuantity / piecesContained);
    const loosePieces = enteredQuantity - (completePackages * piecesContained);
    const option = packagingOption(packageType);
    const packageLabel = completePackages === 1 ? option.singular : option.label.toLowerCase();
    totalLabel.textContent = completePackages
      ? `${formatNumber(completePackages)} ${packageLabel}${loosePieces ? ` + ${formatNumber(loosePieces)} pieces` : ""}`
      : `${formatNumber(enteredQuantity)} pieces — below one ${option.singular}`;
  }

  stockEntryModeSelect?.addEventListener("change", updateFactoryStockEntry);
  stockPackageTypeSelect?.addEventListener("change", updateFactoryStockEntry);

  function setStockFormStep(step) {
    activeStockFormStep = Math.min(3, Math.max(1, Number(step || 1)));
    stockEntrySession.step = activeStockFormStep;
    stockFormSteps.forEach((section) => { section.hidden = Number(section.dataset.stockFormStep) !== activeStockFormStep; });
    stockStepIndicators.forEach((indicator) => {
      const indicatorStep = Number(indicator.dataset.stockStepIndicator);
      indicator.classList.toggle("is-active", indicatorStep === activeStockFormStep);
      indicator.classList.toggle("is-complete", indicatorStep < activeStockFormStep);
    });
    if (previousStockStepButton) previousStockStepButton.hidden = activeStockFormStep === 1;
    if (nextStockStepButton) nextStockStepButton.hidden = activeStockFormStep === 3;
    if (saveStockEntryButton) saveStockEntryButton.hidden = activeStockFormStep !== 3;
    if (productMessage) productMessage.textContent = "";
  }

  function validateStockFormStep(step) {
    const section = stockFormSteps.find((item) => Number(item.dataset.stockFormStep) === step);
    if (!section) return true;
    const requiredControls = [...section.querySelectorAll("input[required], select[required]")]
      .filter((control) => !control.disabled && !control.closest("[hidden]"));
    const invalidControl = requiredControls.find((control) => !String(control.value || "").trim() || !control.checkValidity());
    if (invalidControl) {
      invalidControl.classList.add("is-required-invalid");
      invalidControl.setAttribute("aria-invalid", "true");
      if (productMessage) productMessage.textContent = "Please complete the required fields";
      invalidControl.focus();
      return false;
    }
    if (step === 2 && stockEntryModeSelect?.value === "package") {
      const packageCount = Number(productForm.elements.stock?.value || 0);
      if (!Number.isInteger(packageCount) || packageCount < 1) {
        productForm.elements.stock.classList.add("is-required-invalid");
        productForm.elements.stock.setAttribute("aria-invalid", "true");
        if (productMessage) productMessage.textContent = "Enter at least one complete package";
        productForm.elements.stock.focus();
        return false;
      }
    }
    return true;
  }

  previousStockStepButton?.addEventListener("click", () => setStockFormStep(activeStockFormStep - 1));
  nextStockStepButton?.addEventListener("click", () => {
    if (validateStockFormStep(activeStockFormStep)) setStockFormStep(activeStockFormStep + 1);
  });
  productForm?.addEventListener("input", (event) => {
    event.target.classList?.remove("is-required-invalid");
    event.target.removeAttribute?.("aria-invalid");
    if (productMessage) productMessage.textContent = "";
  });
  productForm?.addEventListener("change", (event) => {
    event.target.classList?.remove("is-required-invalid");
    event.target.removeAttribute?.("aria-invalid");
    if (productMessage) productMessage.textContent = "";
  });
  productForm?.addEventListener("submit", (event) => {
    if (activeStockFormStep === 3) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (validateStockFormStep(activeStockFormStep)) setStockFormStep(activeStockFormStep + 1);
  });
  setStockFormStep(activeStockFormStep);

  qsa(".js-open-record-correction", root).forEach((button) => {
    button.addEventListener("click", () => {
      if (!correctionModal || !correctionForm) return;
      const state = store.getState();
      const transaction = (state.stockTransactions || []).find((item) => item.id === button.dataset.transactionId);
      const product = (state.products || []).find((item) => item.id === transaction?.productId);
      correctionForm.reset();
      correctionForm.elements.transactionId.value = button.dataset.transactionId || "";
      if (correctionPackagingSelect) {
        correctionPackagingSelect.innerHTML = productPackagingTypes(state.client, product)
          .map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(packagingOption(type).label)}</option>`)
          .join("");
        correctionPackagingSelect.value = [...correctionPackagingSelect.options].some((option) => option.value === String(transaction?.packagingType || "piece"))
          ? String(transaction?.packagingType || "piece")
          : "piece";
      }
      correctionForm.elements.requestedQuantity.value = transaction?.packagingQuantity || button.dataset.quantity || "";
      const label = qs("[data-correction-record-label]", correctionModal);
      if (label) label.textContent = button.dataset.recordLabel || "Saved record";
      if (correctionMessage) correctionMessage.textContent = "";
      updateCorrectionPackageSummary();
      correctionModal.hidden = false;
      correctionForm.elements.requestedQuantity.focus();
    });
  });

  function correctionQuantityInPieces() {
    if (!correctionForm) return 0;
    const transaction = (store.getState().stockTransactions || []).find((item) => item.id === correctionForm.elements.transactionId.value);
    const product = (store.getState().products || []).find((item) => item.id === transaction?.productId);
    return quantityInPieces(
      product,
      Number(correctionForm.elements.requestedQuantity.value || 0),
      correctionPackagingSelect?.value || "piece",
      store.getState().client
    );
  }

  function updateCorrectionPackageSummary() {
    if (!correctionForm || !correctionPackageSummary) return;
    const enteredQuantity = Number(correctionForm.elements.requestedQuantity.value || 0);
    const packagingType = correctionPackagingSelect?.value || "piece";
    const exactPieces = correctionQuantityInPieces();
    correctionPackageSummary.textContent = enteredQuantity > 0
      ? `${packagingQuantityLabel(enteredQuantity, packagingType)} = ${formatNumber(exactPieces)} piece${exactPieces === 1 ? "" : "s"}`
      : "Enter the corrected quantity to see the exact pieces.";
  }

  correctionPackagingSelect?.addEventListener("change", () => {
    correctionForm.elements.requestedQuantity.value = "";
    updateCorrectionPackageSummary();
    correctionForm.elements.requestedQuantity.focus();
  });
  correctionForm?.elements.requestedQuantity?.addEventListener("input", updateCorrectionPackageSummary);

  qsa(".js-close-record-correction", root).forEach((button) => {
    button.addEventListener("click", () => { correctionModal.hidden = true; });
  });
  correctionModal?.addEventListener("click", (event) => {
    if (event.target === correctionModal) correctionModal.hidden = true;
  });
  correctionForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(correctionForm);
    const transactionId = String(formData.get("transactionId") || "");
    const requestedPackagingQuantity = Number(formData.get("requestedQuantity") || 0);
    const requestedPackagingType = String(formData.get("requestedPackagingType") || "piece");
    const requestedQuantity = correctionQuantityInPieces();
    const reason = String(formData.get("reason") || "").trim();
    const transaction = (store.getState().stockTransactions || []).find((item) => item.id === transactionId);

    if (correctionMessage) correctionMessage.textContent = "";
    if (!transaction || !requestedQuantity || requestedQuantity <= 0 || requestedQuantity === Number(transaction.quantity || 0) || !reason) {
      if (correctionMessage) correctionMessage.textContent = "Enter a different quantity and explain the reason for the adjustment.";
      return;
    }

    const actorRole = currentUserRole(store.getState());
    store.dispatch(actorRole === "ceo" ? {
      type: "DIRECT_RECORD_CORRECTION",
      transactionId,
      requestedQuantity,
      requestedPackagingType,
      requestedPackagingQuantity,
      reason,
      message: "Dispatch adjustment saved"
    } : {
      type: "REQUEST_RECORD_CORRECTION",
      transactionId,
      requestedQuantity,
      requestedPackagingType,
      requestedPackagingQuantity,
      reason,
      message: "Correction sent for approval"
    });
    correctionModal.hidden = true;
  });

  function bindBatchMaterialRemoveButtons() {
    if (!batchMaterialList) return;
    qsa(".js-remove-batch-material", batchMaterialList).forEach((button) => {
      button.onclick = () => {
        if (qsa("[data-batch-material-row]", batchMaterialList).length > 1) button.closest("[data-batch-material-row]")?.remove();
      };
    });
  }

  qs("[data-add-batch-material]", root)?.addEventListener("click", () => {
    const firstRow = qs("[data-batch-material-row]", batchMaterialList);
    if (!firstRow || !batchMaterialList) return;
    const row = firstRow.cloneNode(true);
    row.querySelectorAll("input, select").forEach((control) => { control.value = ""; });
    batchMaterialList.appendChild(row);
    bindBatchMaterialRemoveButtons();
  });
  bindBatchMaterialRemoveButtons();

  function updateRawSaleCustomerFields() {
    if (!rawSaleCustomerSelect || !rawSaleOtherCustomer || !rawSalePaymentSelect) return;

    const isOtherCustomer = rawSaleCustomerSelect.value === "__other__";
    const creditOption = [...rawSalePaymentSelect.options].find((option) => option.value === "credit");

    rawSaleOtherCustomer.hidden = !isOtherCustomer;
    rawSaleOtherCustomer.required = isOtherCustomer;
    if (!isOtherCustomer) rawSaleOtherCustomer.value = "";
    if (creditOption) creditOption.disabled = isOtherCustomer;
    if (isOtherCustomer && rawSalePaymentSelect.value === "credit") rawSalePaymentSelect.value = "cash";
  }

  function updateRawSaleUnitPrice() {
    if (!rawSaleProductSelect || !rawSaleUnitPriceInput) return;

    const product = store.getState().products.find((item) => item.id === rawSaleProductSelect.value);
    rawSaleUnitPriceInput.value = product ? String(Number(product.unitPrice || 0) || "") : "";
  }

  function closeRawMaterialSaleModal() {
    if (rawMaterialSaleModal) rawMaterialSaleModal.hidden = true;
  }

  function openRawMaterialSaleModal(productId) {
    if (!rawMaterialSaleModal || !rawMaterialSaleForm || !rawSaleProductSelect) return;

    rawMaterialSaleForm.reset();
    rawSaleProductSelect.value = productId || "";
    const saleDateInput = rawMaterialSaleForm.elements.saleDate;
    if (saleDateInput) saleDateInput.value = todayISO();
    updateRawSaleCustomerFields();
    updateRawSaleUnitPrice();
    const message = qs("#raw-material-sale-message", root);
    if (message) message.textContent = "";
    rawMaterialSaleModal.hidden = false;
    rawMaterialSaleForm.elements.quantity?.focus();
  }

  updateRawSaleCustomerFields();
  rawSaleCustomerSelect?.addEventListener("change", updateRawSaleCustomerFields);
  rawSaleProductSelect?.addEventListener("change", updateRawSaleUnitPrice);

  rawMaterialSaleForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const state = store.getState();
    const formData = new FormData(rawMaterialSaleForm);
    const productId = String(formData.get("productId") || "");
    const product = state.products.find((item) => item.id === productId);
    const quantity = Number(formData.get("quantity") || 0);
    const customerChoice = String(formData.get("customerChoice") || "");
    const savedCustomer = (state.retailers || []).find((customer) => customer.id === customerChoice);
    const isOtherCustomer = customerChoice === "__other__";
    const customerName = isOtherCustomer
      ? String(formData.get("customerNameOther") || "").trim()
      : String(savedCustomer?.name || "").trim();
    const customerId = savedCustomer?.id || "";
    const paymentType = String(formData.get("paymentType") || "").trim();
    const unitPrice = Number(formData.get("unitPrice") || 0);
    const saleDate = String(formData.get("saleDate") || "");
    const notes = String(formData.get("notes") || "").trim();
    const message = qs("#raw-material-sale-message", root);

    if (message) message.textContent = "";
    if (
      !product ||
      stockCategoryIdForProduct(product) !== RAW_MATERIALS_CATEGORY ||
      product.status === "inactive" ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !customerName ||
      !paymentType ||
      !Number.isFinite(unitPrice) ||
      unitPrice <= 0 ||
      !saleDate
    ) {
      if (message) message.textContent = "Choose a raw material and enter the quantity, customer, payment type, unit price, and sale date.";
      return;
    }
    if (quantity > Number(product.stock || 0)) {
      if (message) message.textContent = `Only ${formatNumber(product.stock)} ${productUnit(product)} of ${product.name} is available.`;
      return;
    }
    if (paymentType === "credit" && !savedCustomer) {
      if (message) message.textContent = "Credit sales require a saved customer. Select a saved customer or use cash.";
      return;
    }
    if (paymentType === "credit") {
      const creditLimit = getCreditLimitForParty(state.creditLimits || [], savedCustomer.name);
      const projectedBalance = Number(creditLimit?.balance || 0) + quantity * unitPrice;

      if (!creditLimit || Number(creditLimit.limit || 0) <= 0) {
        if (message) message.textContent = "This customer does not have an approved credit limit. Use cash or set a credit limit first.";
        return;
      }
      if (projectedBalance > Number(creditLimit.limit || 0)) {
        if (message) message.textContent = "This sale would exceed the customer's credit limit.";
        return;
      }
    }

    store.dispatch({
      type: "RECORD_RAW_MATERIAL_SALE",
      productId,
      quantity,
      customerId,
      customerName,
      paymentType,
      unitPrice,
      saleDate,
      notes,
      message: "Raw material sale recorded"
    });
    closeRawMaterialSaleModal();
  });

  qsa(".js-sell-raw-material", root).forEach((button) => {
    button.addEventListener("click", () => openRawMaterialSaleModal(button.dataset.productId));
  });
  qsa(".js-close-raw-sale-modal", root).forEach((button) => {
    button.addEventListener("click", closeRawMaterialSaleModal);
  });
  rawMaterialSaleModal?.addEventListener("click", (event) => {
    if (event.target === rawMaterialSaleModal) closeRawMaterialSaleModal();
  });
  rawMaterialSaleModal?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeRawMaterialSaleModal();
  });

  function closeProductionTraceability() {
    if (productionTraceabilityModal) productionTraceabilityModal.hidden = true;
  }

  qsa(".js-open-production-traceability", root).forEach((button) => {
    button.addEventListener("click", () => {
      const state = store.getState();
      const product = state.products.find((item) => item.id === button.dataset.productId);
      if (!product || !productionTraceabilityModal || !productionTraceabilityContent) return;

      productionTraceabilityContent.innerHTML = renderProductionTraceabilityDetails(product, state);
      productionTraceabilityModal.hidden = false;
      qs(".js-close-production-traceability", productionTraceabilityModal)?.focus();
    });
  });

  qsa(".js-close-production-traceability", root).forEach((button) => {
    button.addEventListener("click", closeProductionTraceability);
  });

  productionTraceabilityModal?.addEventListener("click", (event) => {
    if (event.target === productionTraceabilityModal) closeProductionTraceability();
  });

  productionTraceabilityModal?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeProductionTraceability();
  });

  function closeStockProductDetails() {
    if (stockProductDetailsModal) stockProductDetailsModal.hidden = true;
  }

  function openStockProductDetails(productId) {
    const state = store.getState();
    const product = (state.products || []).find((item) => item.id === productId);
    if (!product || !stockProductDetailsModal || !stockProductDetailsContent) return;

    if (stockProductDetailsTitle) stockProductDetailsTitle.textContent = stockProductBaseName(product);
    stockProductDetailsContent.innerHTML = renderStockProductDetails(product, state);
    stockProductDetailsModal.hidden = false;
    qs(".js-close-stock-product-details", stockProductDetailsModal)?.focus();
  }

  function productDetailsEventIsFromControl(event) {
    return Boolean(event.target.closest("button, input, select, textarea, a, label"));
  }

  qsa("[data-open-stock-product]", root).forEach((item) => {
    item.addEventListener("click", (event) => {
      if (productDetailsEventIsFromControl(event)) return;
      openStockProductDetails(item.dataset.productId);
    });
    item.addEventListener("keydown", (event) => {
      if (!['Enter', ' '].includes(event.key) || productDetailsEventIsFromControl(event)) return;
      event.preventDefault();
      openStockProductDetails(item.dataset.productId);
    });
  });

  qsa(".js-close-stock-product-details", root).forEach((button) => {
    button.addEventListener("click", closeStockProductDetails);
  });
  stockProductDetailsModal?.addEventListener("click", (event) => {
    if (event.target === stockProductDetailsModal) closeStockProductDetails();
  });
  stockProductDetailsModal?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeStockProductDetails();
  });

  const assignmentRepFilter = qs("[data-assignment-rep-filter]", root);
  const assignmentDateFrom = qs("[data-assignment-date-from]", root);
  const assignmentDateTo = qs("[data-assignment-date-to]", root);
  const assignmentFilterStatus = qs("[data-assignment-filter-status]", root);
  const assignmentDetailsModal = qs("#assignment-details-modal", root);
  const assignmentDetailsContent = qs("#assignment-details-content", root);

  function closeAssignmentDetails() {
    if (assignmentDetailsModal) assignmentDetailsModal.hidden = true;
  }

  function openAssignmentDetails(assignmentId) {
    const state = store.getState();
    const assignment = (state.stockAssignments || []).find((item) => item.id === assignmentId);
    if (!assignment || !assignmentDetailsModal || !assignmentDetailsContent) return;

    assignmentDetailsContent.innerHTML = renderAssignmentDetails(assignment, state, currentUserPermissions(state));
    assignmentDetailsModal.hidden = false;
    assignmentDetailsModal.focus();
  }

  qsa(".js-open-assignment-details", root).forEach((row) => {
    row.addEventListener("click", () => openAssignmentDetails(row.dataset.assignmentId));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openAssignmentDetails(row.dataset.assignmentId);
      }
    });
  });

  assignmentDetailsModal?.addEventListener("click", (event) => {
    if (event.target === assignmentDetailsModal || event.target.closest(".js-close-assignment-details")) {
      closeAssignmentDetails();
      return;
    }

    const flagButton = event.target.closest(".js-modal-flag-assignment");
    if (flagButton) {
      const note = qs("[data-modal-variance-note]", assignmentDetailsModal)?.value || "Variance needs explanation";
      store.dispatch({
        type: "FLAG_ASSIGNMENT_VARIANCE",
        assignmentId: flagButton.dataset.assignmentId,
        note,
        message: "Variance flagged"
      });
      closeAssignmentDetails();
      return;
    }

    const reconcileButton = event.target.closest(".js-modal-reconcile-assignment");
    if (reconcileButton) {
      store.dispatch({
        type: "RECONCILE_ASSIGNMENT",
        assignmentId: reconcileButton.dataset.assignmentId,
        message: "Assignment reconciled"
      });
      closeAssignmentDetails();
    }
  });

  assignmentDetailsModal?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAssignmentDetails();
  });

  function visibleAssignmentRows() {
    return qsa("[data-assignment-row]", root).filter((row) => !row.hidden);
  }

  function applyAssignmentFilters() {
    const repName = String(assignmentRepFilter?.value || "");
    const dateFrom = String(assignmentDateFrom?.value || "");
    const dateTo = String(assignmentDateTo?.value || "");
    const allRows = qsa("[data-assignment-row]", root);

    allRows.forEach((row) => {
      const assignedDate = String(row.dataset.assignmentDate || "");
      const repMatches = !repName || row.dataset.assignmentRep === repName;
      const hasDateRange = Boolean(dateFrom || dateTo);
      const dateMatches = !hasDateRange || dateIsWithinRange(assignedDate, dateFrom, dateTo);
      row.hidden = !(repMatches && dateMatches);
    });

    if (assignmentFilterStatus) {
      const visibleCount = visibleAssignmentRows().length;
      assignmentFilterStatus.textContent = `${formatNumber(visibleCount)} of ${formatNumber(allRows.length)} ledger entries shown`;
    }
  }

  [assignmentRepFilter, assignmentDateFrom, assignmentDateTo].filter(Boolean).forEach((control) => {
    control.addEventListener("input", applyAssignmentFilters);
    control.addEventListener("change", applyAssignmentFilters);
  });

  qs("[data-assignment-filter-reset]", root)?.addEventListener("click", () => {
    if (assignmentRepFilter) assignmentRepFilter.value = "";
    if (assignmentDateFrom) assignmentDateFrom.value = "";
    if (assignmentDateTo) assignmentDateTo.value = "";
    applyAssignmentFilters();
  });

  qs(".js-export-assignment-pdf", root)?.addEventListener("click", () => {
    const rows = visibleAssignmentRows().map((row) => {
      const state = store.getState();
      const assignment = (state.stockAssignments || []).find((item) => item.id === row.dataset.assignmentId);
      const product = (state.products || []).find((item) => item.id === assignment?.productId);
      const inHand = assignment ? assignmentInHand(assignment) : 0;
      const variance = assignment?.varianceFlagged ? inHand : 0;

      return {
        cells: assignment ? [
          `${assignment.id} - ${formatDate(assignment.assignedAt)}`,
          assignment.repName,
          product?.name || assignment.productId,
          formatNumber(assignment.assigned),
          formatNumber(assignment.sold),
          formatNumber(assignment.returned),
          formatNumber(inHand),
          formatNumber(variance),
          statusText(assignmentDisplayStatus(assignment))
        ] : [],
        isVariance: row.dataset.assignmentVariance === "true"
      };
    });
    const repLabel = assignmentRepFilter?.value || "All representatives";
    const periodLabel = [assignmentDateFrom?.value, assignmentDateTo?.value].filter(Boolean).join(" to ") || "All dates";

    printTabularReport({
      title: "DistroIQ Representative Stock Ledger",
      subtitle: `${repLabel} - ${periodLabel} - Generated ${new Date().toLocaleString()}`,
      filename: `distroiq-representative-stock-ledger-${todayISO()}.html`,
      sections: [{
        title: "Assignments and variances",
        headers: ["Assignment", "Representative", "Product", "Assigned", "Sold", "Returned", "In hand", "Variance", "Status"],
        rows
      }]
    });
  });

  applyAssignmentFilters();

  function applyStockTypeFilter() {
    const query = String(qs("#global-search", document)?.value || "").trim().toLowerCase();
    qsa("[data-stock-category]", root).forEach((row) => {
      const categoryMatches = !categoryFilter || categoryFilter.value === "all" || row.dataset.stockCategory === categoryFilter.value;
      const searchMatches = !query || String(row.dataset.searchIndex || "").includes(query);
      row.hidden = !(categoryMatches && searchMatches);
    });
    updateStockSelectionControls();
  }

  function setStockHealthView(view) {
    stockHealthView = view === "grid" ? "grid" : "list";
    qsa("[data-stock-view]", root).forEach((button) => {
      const isActive = button.dataset.stockView === stockHealthView;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    qsa("[data-stock-view-panel]", root).forEach((panel) => {
      panel.hidden = panel.dataset.stockViewPanel !== stockHealthView;
    });
  }

  qsa("[data-stock-view]", root).forEach((button) => {
    button.addEventListener("click", () => setStockHealthView(button.dataset.stockView));
  });
  setStockHealthView(stockHealthView);

  function stockSelectionCheckboxes() {
    return qsa(".js-select-stock", root);
  }

  function visibleStockSelectionCheckboxes() {
    return stockSelectionCheckboxes().filter((checkbox) => !checkbox.closest("tr")?.hidden);
  }

  function updateStockSelectionControls() {
    const selectedCount = stockSelectionCheckboxes().filter((checkbox) => checkbox.checked).length;
    const visibleCheckboxes = visibleStockSelectionCheckboxes();
    const visibleSelectedCount = visibleCheckboxes.filter((checkbox) => checkbox.checked).length;

    if (deleteSelectedStockButton) {
      deleteSelectedStockButton.disabled = selectedCount === 0;
      const label = qs("span", deleteSelectedStockButton);
      if (label) label.textContent = selectedCount ? `Delete selected (${selectedCount})` : "Delete selected";
    }

    if (selectAllStock) {
      selectAllStock.checked = visibleCheckboxes.length > 0 && visibleSelectedCount === visibleCheckboxes.length;
      selectAllStock.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleCheckboxes.length;
    }
  }

  let pendingStockDeletionIds = [];

  function closeStockDeletionConfirmation() {
    if (stockDeleteConfirmationModal) stockDeleteConfirmationModal.hidden = true;
    pendingStockDeletionIds = [];
  }

  function openStockDeletionConfirmation(productIds) {
    const products = store.getState().products.filter((product) => productIds.includes(product.id));
    if (!products.length || !stockDeleteConfirmationModal) return;

    pendingStockDeletionIds = products.map((product) => product.id);
    if (stockDeleteSummary) {
      stockDeleteSummary.textContent = products.length === 1
        ? `You are about to permanently delete ${products[0].name}.`
        : `You are about to permanently delete ${products.length} selected stock records.`;
    }
    if (stockDeletePreview) {
      stockDeletePreview.innerHTML = products.slice(0, 5).map((product) => `
        <div class="stock-delete-preview-item">
          <span>${escapeHtml(String(product.name || "ST").slice(0, 2).toUpperCase())}</span>
          <div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.id)} · ${formatNumber(product.stock || 0)} available</small></div>
        </div>
      `).join("") + (products.length > 5
        ? `<small class="stock-delete-preview-more">+ ${formatNumber(products.length - 5)} more selected record${products.length - 5 === 1 ? "" : "s"}</small>`
        : "");
    }
    stockDeleteConfirmationModal.hidden = false;
    qs(".js-close-stock-delete-confirmation", stockDeleteConfirmationModal)?.focus();
  }

  stockSelectionCheckboxes().forEach((checkbox) => {
    checkbox.addEventListener("change", updateStockSelectionControls);
  });

  selectAllStock?.addEventListener("change", () => {
    visibleStockSelectionCheckboxes().forEach((checkbox) => {
      checkbox.checked = selectAllStock.checked;
    });
    updateStockSelectionControls();
  });

  deleteSelectedStockButton?.addEventListener("click", () => {
    const productIds = stockSelectionCheckboxes()
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => checkbox.value);
    openStockDeletionConfirmation(productIds);
  });

  qsa(".js-delete-product", root).forEach((button) => {
    button.addEventListener("click", () => {
      const productId = button.dataset.productId;
      openStockDeletionConfirmation([productId]);
    });
  });

  qsa(".js-close-stock-delete-confirmation", root).forEach((button) => {
    button.addEventListener("click", closeStockDeletionConfirmation);
  });

  stockDeleteConfirmationModal?.addEventListener("click", (event) => {
    if (event.target === stockDeleteConfirmationModal) closeStockDeletionConfirmation();
  });

  stockDeleteConfirmationModal?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeStockDeletionConfirmation();
  });

  confirmStockDeleteButton?.addEventListener("click", () => {
    if (!pendingStockDeletionIds.length) return;
    const productIds = [...pendingStockDeletionIds];
    closeStockDeletionConfirmation();
    store.dispatch({
      type: "DELETE_PRODUCTS",
      productIds,
      message: `${productIds.length} stock record${productIds.length === 1 ? "" : "s"} deleted`
    });
  });

  categoryFilter?.addEventListener("change", applyStockTypeFilter);
  qs("#global-search", document)?.addEventListener("input", applyStockTypeFilter, { signal });

  updateStockSelectionControls();

  if (categoryFilter && requestedStockType && [...categoryFilter.options].some((option) => option.value === requestedStockType)) {
    categoryFilter.value = requestedStockType;
    applyStockTypeFilter();
  }

  function setupDispatchPagination() {
    const rows = qsa("[data-dispatch-row]", root);
    const pagination = qs("[data-dispatch-pagination]", root);
    const status = qs("[data-dispatch-page-status]", root);
    const prevButton = qs('[data-dispatch-page="prev"]', root);
    const nextButton = qs('[data-dispatch-page="next"]', root);
    const globalSearch = qs("#global-search", document);
    let currentPage = 1;

    if (!rows.length || !pagination || !status) return;

    function matchedRows() {
      const query = String(globalSearch?.value || "").trim().toLowerCase();
      return rows.filter((row) => !query || String(row.dataset.searchIndex || "").includes(query));
    }

    function applyPage() {
      const visibleRows = matchedRows();
      const totalPages = Math.max(1, Math.ceil(visibleRows.length / DISPATCH_PAGE_SIZE));

      currentPage = Math.min(Math.max(1, currentPage), totalPages);
      rows.forEach((row) => {
        row.hidden = true;
      });
      visibleRows.forEach((row, index) => {
        const page = Math.floor(index / DISPATCH_PAGE_SIZE) + 1;
        row.hidden = page !== currentPage;
      });

      pagination.hidden = visibleRows.length <= DISPATCH_PAGE_SIZE;
      status.textContent = `${formatNumber(visibleRows.length)} dispatch${visibleRows.length === 1 ? "" : "es"} - page ${formatNumber(currentPage)} of ${formatNumber(totalPages)}`;
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
    globalSearch?.addEventListener("input", () => {
      currentPage = 1;
      applyPage();
    }, { signal });

    window.setTimeout(applyPage, 0);
  }

  setupDispatchPagination();

  function setupMovementPagination() {
    const rows = qsa("[data-movement-row]", root);
    const pagination = qs("[data-movement-pagination]", root);
    const status = qs("[data-movement-page-status]", root);
    const prevButton = qs('[data-movement-page="prev"]', root);
    const nextButton = qs('[data-movement-page="next"]', root);
    const globalSearch = qs("#global-search", document);
    let currentPage = 1;

    if (!rows.length || !pagination || !status) return;

    function matchedRows() {
      const query = String(globalSearch?.value || "").trim().toLowerCase();
      return rows.filter((row) => !query || String(row.dataset.searchIndex || "").includes(query));
    }

    function applyPage() {
      const visibleRows = matchedRows();
      const totalPages = Math.max(1, Math.ceil(visibleRows.length / MOVEMENT_PAGE_SIZE));

      currentPage = Math.min(Math.max(1, currentPage), totalPages);
      rows.forEach((row) => {
        row.hidden = true;
      });
      visibleRows.forEach((row, index) => {
        row.hidden = Math.floor(index / MOVEMENT_PAGE_SIZE) + 1 !== currentPage;
      });

      pagination.hidden = visibleRows.length <= MOVEMENT_PAGE_SIZE;
      status.textContent = `${formatNumber(visibleRows.length)} movement${visibleRows.length === 1 ? "" : "s"} - page ${formatNumber(currentPage)} of ${formatNumber(totalPages)}`;
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
    globalSearch?.addEventListener("input", () => {
      currentPage = 1;
      applyPage();
    }, { signal });

    window.setTimeout(applyPage, 0);
  }

  setupMovementPagination();

  function setStockImageUploadState({ fileName = "", error = "" } = {}) {
    if (!stockImageUploadField) return;

    stockImageUploadField.classList.toggle("has-file", Boolean(fileName || stockImageDataUrl));
    stockImageUploadField.classList.toggle("has-error", Boolean(error));

    if (stockImageUploadTitle) {
      stockImageUploadTitle.textContent = error
        ? "Picture not accepted"
        : fileName
          ? "Picture selected"
          : stockImageDataUrl
            ? "Picture is set"
            : "Choose picture file";
    }

    if (stockImageFileName) {
      stockImageFileName.textContent = error || fileName || LOGO_HELP_TEXT;
    }

    if (clearStockImageButton) {
      clearStockImageButton.hidden = !stockImageDataUrl && !fileName;
    }
  }

  const stockDraftFields = [
    "productId",
    "name",
    "productType",
    "sizeValue",
    "sizeUnit",
    "sizeUnitOther",
    "sku",
    "stockCategory",
    "stock",
    "stockEntryMode",
    "stockPackagingType",
    "reorderPoint",
    "unitCost",
    "unitPrice",
    "status",
    "productionBatchReference",
    "productionBatchDate",
    "productionQuantity",
    "productionNotes",
    ...enabledPackagingTypes(store.getState().client).filter((type) => type !== "piece").flatMap((type) => [
    `packagingConversion-${type}`,
    `packagingPrice-${type}`,
    `productionPackageQuantity-${type}`
  ])];

  function captureStockEditDraft() {
    if (!productForm?.elements.productId?.value) return;
    stockEntrySession.editingProductId = productForm.elements.productId.value;
    stockEntrySession.draft = Object.fromEntries(stockDraftFields
      .map((name) => [name, productForm.elements[name]?.value])
      .filter(([, value]) => value !== undefined));
    stockEntrySession.imageUrl = stockImageDataUrl;
  }

  function restoreStockEditDraft() {
    if (!productForm || !stockEntrySession.draft) return;
    Object.entries(stockEntrySession.draft).forEach(([name, value]) => {
      if (productForm.elements[name] && name !== "productId") productForm.elements[name].value = value;
    });
  }

  function updateProductionStockVisibility() {
    if (!productForm || !productionStockUpdate) return;

    const isExistingFinishedProduct = Boolean(productForm.elements.productId.value) &&
      productForm.elements.stockCategory.value === FINISHED_PRODUCTS_CATEGORY;
    productionStockUpdate.hidden = !isExistingFinishedProduct;
  }

  function resetProductionStockFields() {
    if (!productForm || !batchMaterialList) return;

    ["productionBatchReference", "productionQuantity", "productionNotes"].forEach((name) => {
      if (productForm.elements[name]) productForm.elements[name].value = "";
    });
    enabledPackagingTypes(store.getState().client).filter((type) => type !== "piece").forEach((type) => {
      const input = productForm.elements[`productionPackageQuantity-${type}`];
      if (input) input.value = "";
    });
    if (productForm.elements.productionBatchDate) productForm.elements.productionBatchDate.value = todayISO();
    const rows = qsa("[data-batch-material-row]", batchMaterialList);
    rows.slice(1).forEach((row) => row.remove());
    rows[0]?.querySelectorAll("input, select").forEach((control) => { control.value = ""; });
    updateProductionOutputTotal();
  }

  function updateProductionOutputTotal() {
    if (!productForm) return;
    const totalTarget = qs("[data-production-output-total]", productForm);
    if (!totalTarget) return;
    let totalPieces = Math.max(0, Number(productForm.elements.productionQuantity?.value || 0));
    enabledPackagingTypes(store.getState().client).filter((type) => type !== "piece").forEach((type) => {
      const packageQuantity = Math.max(0, Number(productForm.elements[`productionPackageQuantity-${type}`]?.value || 0));
      const piecesPerPackage = Math.max(0, Number(productForm.elements[`packagingConversion-${type}`]?.value || 0));
      totalPieces += packageQuantity * piecesPerPackage;
    });
    totalTarget.textContent = `${formatNumber(totalPieces)} pieces`;
  }

  productForm?.addEventListener("input", (event) => {
    if (event.target.name === "productionQuantity" || String(event.target.name || "").startsWith("productionPackageQuantity-") || String(event.target.name || "").startsWith("packagingConversion-")) {
      updateProductionOutputTotal();
    }
    if (event.target.name === "stock" || String(event.target.name || "").startsWith("packagingConversion-")) {
      updateFactoryStockEntry();
    }
  });

  function resetProductForm() {
    if (!productForm) return;

    productForm.reset();
    productForm.elements.productId.value = "";
    productForm.elements.sku.value = nextAutomaticProductId(store.getState().products, store.getState().client?.skuFormat);
    productForm.elements.name.readOnly = false;
    sessionAddedProductIds = [];
    activeProductFamily = "";
    entrySaved = false;
    stockEntrySession.family = "";
    stockEntrySession.productIds = [];
    stockEntrySession.adding = false;
    stockEntrySession.editingProductId = "";
    stockEntrySession.draft = {};
    stockEntrySession.imageUrl = "";
    stockEntrySession.defaults = {};
    stockEntrySession.step = 1;
    if (affiliatedProductList) affiliatedProductList.innerHTML = "";
    if (affiliatedProductProgress) affiliatedProductProgress.hidden = true;
    if (stockEntryFields) stockEntryFields.hidden = false;
    if (saveStockEntryButton) saveStockEntryButton.disabled = false;
    resetProductionStockFields();
    updateProductionStockVisibility();
    updateCustomSizeUnitVisibility();
    updateFactoryStockEntry();
    setStockFormStep(1);
    stockImageDataUrl = "";
    stockImageCleared = false;
    if (stockImageInput) stockImageInput.value = "";
    setStockImageUploadState();
    if (stockModalTitle) stockModalTitle.textContent = "Add stock";
    if (productMessage) productMessage.textContent = "";
  }

  function renderAffiliatedProductProgress() {
    if (!affiliatedProductList || !affiliatedProductProgress) return;
    const products = sessionAddedProductIds
      .map((productId) => store.getState().products.find((product) => product.id === productId))
      .filter(Boolean);
    affiliatedProductList.innerHTML = products.map((product) => `
      <article class="affiliated-product-item">
        <span>${icon("check")}</span>
        <div>
          <strong>${escapeHtml(product.productType || "Standard")} · ${escapeHtml(product.size || "Standard")}</strong>
          <small>${escapeHtml(product.id)} · ${formatNumber(product.stock || 0)} available</small>
        </div>
      </article>
    `).join("");
    affiliatedProductProgress.hidden = products.length === 0;
    if (stockEntryFields) stockEntryFields.hidden = entrySaved;
  }

  function prepareAffiliatedProductForm() {
    if (!productForm || !activeProductFamily) return;
    const previousCategory = stockEntrySession.defaults.stockCategory || productForm.elements.stockCategory.value;
    const previousReorderPoint = stockEntrySession.defaults.reorderPoint ?? productForm.elements.reorderPoint.value;
    const previousUnitCost = stockEntrySession.defaults.unitCost ?? productForm.elements.unitCost.value;
    const previousUnitPrice = stockEntrySession.defaults.unitPrice ?? productForm.elements.unitPrice.value;
    const previousStatus = stockEntrySession.defaults.status || productForm.elements.status.value;

    productForm.reset();
    productForm.elements.productId.value = "";
    productForm.elements.name.value = activeProductFamily;
    productForm.elements.name.readOnly = true;
    productForm.elements.sku.value = nextAutomaticProductId(store.getState().products, store.getState().client?.skuFormat);
    productForm.elements.stockCategory.value = previousCategory || FINISHED_PRODUCTS_CATEGORY;
    productForm.elements.reorderPoint.value = previousReorderPoint;
    productForm.elements.unitCost.value = previousUnitCost;
    productForm.elements.unitPrice.value = previousUnitPrice;
    productForm.elements.status.value = previousStatus || "active";
    resetProductionStockFields();
    updateProductionStockVisibility();
    updateCustomSizeUnitVisibility();
    updateFactoryStockEntry();
    setStockImageUploadState();
    entrySaved = false;
    stockEntrySession.adding = true;
    stockEntrySession.editingProductId = "";
    stockEntrySession.draft = {};
    stockEntrySession.step = 1;
    setStockFormStep(1);
    if (stockEntryFields) stockEntryFields.hidden = false;
    if (saveStockEntryButton) saveStockEntryButton.disabled = false;
    if (productMessage) productMessage.textContent = `Add another type or size for ${activeProductFamily}.`;
    productForm.elements.productType.focus();
  }

  addAffiliatedProductButton?.addEventListener("click", prepareAffiliatedProductForm);

  if (stockEntrySession.open && sessionAddedProductIds.length) {
    productForm.elements.name.value = activeProductFamily;
    productForm.elements.name.readOnly = true;
    if (saveStockEntryButton) saveStockEntryButton.disabled = entrySaved;
    if (productMessage && entrySaved) productMessage.textContent = `${sessionAddedProductIds.length} product record${sessionAddedProductIds.length === 1 ? "" : "s"} added successfully.`;
    renderAffiliatedProductProgress();
    setStockImageUploadState();
  }

  function openStockModal() {
    if (!stockModal || !productForm) return;

    stockEntrySession.open = true;
    stockModal.hidden = false;
    productForm.elements.name?.focus();
  }

  function closeStockModal() {
    stockEntrySession.open = false;
    stockEntrySession.family = "";
    stockEntrySession.productIds = [];
    stockEntrySession.adding = false;
    stockEntrySession.editingProductId = "";
    stockEntrySession.draft = {};
    stockEntrySession.imageUrl = "";
    stockEntrySession.defaults = {};
    stockEntrySession.step = 1;
    if (stockModal) stockModal.hidden = true;
  }

  function closeRestockModal() {
    if (restockModal) restockModal.hidden = true;
  }

  function closeReduceStockModal() {
    if (reduceStockModal) reduceStockModal.hidden = true;
  }

  function openRestockModal(productId) {
    const product = store.getState().products.find((item) => item.id === productId);
    if (!restockModal || !restockForm || !product) return;

    restockForm.reset();
    restockForm.elements.productId.value = product.id;
    restockForm.elements.productName.value = `${product.name} (${formatNumber(product.stock)} currently available)`;
    if (restockMessage) restockMessage.textContent = "";
    restockModal.hidden = false;
    restockForm.elements.quantity.focus();
  }

  function openReduceStockModal(productId) {
    const product = store.getState().products.find((item) => item.id === productId);
    if (!reduceStockModal || !reduceStockForm || !product) return;

    reduceStockForm.reset();
    reduceStockForm.elements.productId.value = product.id;
    reduceStockForm.elements.productName.value = `${product.name} (${formatNumber(product.stock)} currently available)`;
    if (reduceStockMessage) reduceStockMessage.textContent = "";
    reduceStockModal.hidden = false;
    reduceStockForm.elements.quantity.focus();
  }

  function finishStockImagePicker() {
    delete document.documentElement.dataset.filePickerActive;
  }

  stockImageInput?.addEventListener("click", () => {
    captureStockEditDraft();
    document.documentElement.dataset.filePickerActive = "true";
    window.addEventListener("focus", () => {
      window.setTimeout(finishStockImagePicker, 500);
    }, { once: true });
  });

  stockImageInput?.addEventListener("cancel", finishStockImagePicker);

  stockImageInput?.addEventListener("change", async () => {
    const file = stockImageInput.files?.[0];
    const previousImageDataUrl = stockImageDataUrl;

    if (!file) {
      setStockImageUploadState();
      finishStockImagePicker();
      return;
    }

    const fileError = validateLogoFile(file).replace("logo", "picture");

    if (fileError) {
      stockImageDataUrl = previousImageDataUrl;
      stockEntrySession.imageUrl = previousImageDataUrl;
      stockImageInput.value = "";
      setStockImageUploadState({
        error: fileError
      });
      finishStockImagePicker();
      return;
    }

    try {
      stockImageDataUrl = await readLogoFile(file);
      stockImageCleared = false;
      stockEntrySession.imageUrl = stockImageDataUrl;
      captureStockEditDraft();
      setStockImageUploadState({
        fileName: file.name
      });
    } catch (error) {
      stockImageDataUrl = previousImageDataUrl;
      stockEntrySession.imageUrl = previousImageDataUrl;
      stockImageInput.value = "";
      setStockImageUploadState({
        error: error.message.replace("Logo", "Picture")
      });
    } finally {
      finishStockImagePicker();
    }
  });

  clearStockImageButton?.addEventListener("click", () => {
    stockImageDataUrl = "";
    stockImageCleared = true;
    stockEntrySession.imageUrl = "";
    if (stockImageInput) stockImageInput.value = "";
    captureStockEditDraft();
    setStockImageUploadState();
  });

  productForm?.addEventListener("input", captureStockEditDraft);
  productForm?.addEventListener("change", (event) => {
    if (event.target !== stockImageInput) captureStockEditDraft();
  });

  productForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(productForm);
    const sku = String(formData.get("sku") || "").trim();
    const existingProductId = String(formData.get("productId") || "").trim();
    const productId = String(existingProductId || sku).trim();
    const rawProductName = String(formData.get("name") || "").trim();
    const productType = String(formData.get("productType") || "").trim();
    const sizeValue = String(formData.get("sizeValue") || "").trim();
    const selectedSizeUnit = String(formData.get("sizeUnit") || "").trim();
    const customSizeUnit = normalizeProductSizeUnit(formData.get("sizeUnitOther"));
    const sizeUnit = selectedSizeUnit === "other" ? customSizeUnit : selectedSizeUnit;
    const primarySize = formatProductSize(sizeValue, sizeUnit);
    const productFamily = String(activeProductFamily || rawProductName).trim();
    const primaryProductName = productFamily;
    const requiredFields = [
      ["name", "product name"],
      ["productType", "product type"],
      ["sizeValue", "product size"],
      ["sizeUnit", "size unit"],
      ["sku", "SKU"],
      ["stockCategory", "category"],
      ["stock", "factory stock"],
      ["reorderPoint", "reorder point"],
      ["unitCost", "cost price"],
      ["unitPrice", "selling price"],
      ["status", "catalogue status"]
    ];
    const missingFields = requiredFields
      .filter(([fieldName]) => String(formData.get(fieldName) ?? "").trim() === "")
      .map(([, label]) => label);
    const numberFields = ["sizeValue", "stock", "reorderPoint", "unitCost", "unitPrice"];
    const invalidNumberField = numberFields.find((fieldName) => {
      const rawValue = String(formData.get(fieldName) ?? "").trim();
      const numberValue = Number(rawValue);
      return rawValue !== "" && (!Number.isFinite(numberValue) || numberValue < 0);
    });
    const productionBatchDate = String(formData.get("productionBatchDate") || "");
    const productionBatchReferenceValue = String(formData.get("productionBatchReference") || "").trim();
    const productionQuantityRaw = String(formData.get("productionQuantity") || "").trim();
    const looseProductionQuantity = Number(productionQuantityRaw || 0);
    const productionPackageQuantities = Object.fromEntries(enabledPackagingTypes(store.getState().client)
      .filter((type) => type !== "piece")
      .map((type) => [type, Math.max(0, Number(formData.get(`productionPackageQuantity-${type}`) || 0))]));
    const productionNotes = String(formData.get("productionNotes") || "").trim();
    const productionMaterialIds = formData.getAll("batchMaterialId").map((value) => String(value || ""));
    const productionMaterialQuantities = formData.getAll("batchMaterialQuantity").map((value) => Number(value || 0));
    const productionMaterials = productionMaterialIds.map((materialId, index) => ({
      productId: materialId,
      quantity: productionMaterialQuantities[index]
    })).filter((material) => material.productId || material.quantity > 0);
    const hasProductionUsage = Boolean(
      productionBatchReferenceValue || productionQuantityRaw || productionNotes ||
      Object.values(productionPackageQuantities).some((quantity) => quantity > 0) ||
      productionMaterialIds.some(Boolean) || productionMaterialQuantities.some((quantity) => quantity > 0)
    );
    const state = store.getState();
    const existingProduct = state.products.find((product) => product.id === existingProductId);
    const packagingConversions = Object.fromEntries(enabledPackagingTypes(state.client)
      .filter((type) => type !== "piece")
      .map((type) => [type, Math.max(0, Number(formData.get(`packagingConversion-${type}`) || 0))])
      .filter(([, multiplier]) => multiplier > 0));
    const packagingPrices = Object.fromEntries(enabledPackagingTypes(state.client)
      .filter((type) => type !== "piece")
      .map((type) => [type, Math.max(0, Number(formData.get(`packagingPrice-${type}`) || 0))])
      .filter(([, price]) => price > 0));
    const stockEntryMode = String(formData.get("stockEntryMode") || "piece");
    const stockPackagingType = String(formData.get("stockPackagingType") || "");
    const enteredStockQuantity = Math.max(0, Number(formData.get("stock") || 0));
    const selectedPackageMultiplier = Number(packagingConversions[stockPackagingType] || 0);
    const factoryStockInPieces = stockEntryMode === "package"
      ? enteredStockQuantity * selectedPackageMultiplier
      : enteredStockQuantity;
    const productionQuantity = looseProductionQuantity + Object.entries(productionPackageQuantities)
      .reduce((total, [type, packageQuantity]) => total + packageQuantity * Number(packagingConversions[type] || 0), 0);
    const productionPackagingBreakdown = [
      ...(looseProductionQuantity > 0 ? [{ packagingType: "piece", packagingQuantity: looseProductionQuantity, quantity: looseProductionQuantity }] : []),
      ...Object.entries(productionPackageQuantities)
        .filter(([, packageQuantity]) => packageQuantity > 0)
        .map(([type, packageQuantity]) => ({ packagingType: type, packagingQuantity: packageQuantity, quantity: packageQuantity * Number(packagingConversions[type] || 0) }))
    ];

    if (productMessage) productMessage.textContent = "";

    if (missingFields.length) {
      if (productMessage) productMessage.textContent = `Fill in ${missingFields.join(", ")}. Only the picture is optional.`;
      return;
    }

    if (selectedSizeUnit === "other" && !customSizeUnit) {
      if (productMessage) productMessage.textContent = "Enter the custom product size unit.";
      return;
    }

    if (!Number.isFinite(Number(sizeValue)) || Number(sizeValue) <= 0) {
      if (productMessage) productMessage.textContent = "Product size must be greater than zero.";
      return;
    }

    if (invalidNumberField) {
      if (productMessage) productMessage.textContent = "Stock quantities and prices must be zero or higher.";
      return;
    }

    if (stockEntryMode === "package" && (!stockPackagingType || !Number.isFinite(selectedPackageMultiplier) || selectedPackageMultiplier <= 0)) {
      if (productMessage) productMessage.textContent = "Enter how many pieces the selected package contains.";
      return;
    }

    if (stockEntryMode === "package" && (!Number.isInteger(enteredStockQuantity) || enteredStockQuantity < 1)) {
      if (productMessage) productMessage.textContent = "Enter at least one complete package.";
      return;
    }

    if (duplicateProductVariant(store.getState(), {
      productFamily,
      productType,
      size: primarySize,
      productId: existingProductId
    })) {
      if (productMessage) productMessage.textContent = "This product type and size already exists.";
      return;
    }

    if (duplicateProductSku(store.getState(), sku, existingProductId)) {
      if (productMessage) productMessage.textContent = "A product with this SKU already exists.";
      return;
    }

    if (hasProductionUsage) {
      const duplicateMaterial = productionMaterialIds.find((materialId, index) => materialId && productionMaterialIds.indexOf(materialId) !== index);
      const invalidMaterial = productionMaterials.find((material) => {
        const stockMaterial = state.products.find((item) => item.id === material.productId);
        return !material.productId || !Number.isFinite(material.quantity) || material.quantity <= 0 ||
          !stockMaterial || stockMaterial.status === "inactive" ||
          stockCategoryIdForProduct(stockMaterial) !== RAW_MATERIALS_CATEGORY;
      });
      const insufficientMaterial = productionMaterials.find((material) => (
        Number(state.products.find((item) => item.id === material.productId)?.stock || 0) < material.quantity
      ));
      const duplicateBatch = (state.productionBatches || []).some((batch) => (
        productionBatchReference(batch).toLowerCase() === productionBatchReferenceValue.toLowerCase()
      ));

      if (!existingProductId || formData.get("stockCategory") !== FINISHED_PRODUCTS_CATEGORY) {
        if (productMessage) productMessage.textContent = "Raw-material usage can only be recorded while updating an existing finished product.";
        return;
      }
      if (!productionBatchDate || !productionBatchReferenceValue || !Number.isFinite(productionQuantity) || productionQuantity <= 0 || invalidMaterial) {
        if (productMessage) productMessage.textContent = "Enter the production date, batch number, quantity produced, and every raw material used.";
        return;
      }
      if (duplicateBatch) {
        if (productMessage) productMessage.textContent = "This batch name or number has already been recorded.";
        return;
      }
      if (duplicateMaterial) {
        if (productMessage) productMessage.textContent = "Choose each raw material only once per batch.";
        return;
      }
      if (insufficientMaterial) {
        const stockMaterial = state.products.find((item) => item.id === insufficientMaterial.productId);
        if (productMessage) productMessage.textContent = `Only ${formatNumber(stockMaterial?.stock || 0)} ${productUnit(stockMaterial || {})} of ${stockMaterial?.name || "this material"} is available.`;
        return;
      }
    }

    let imageStorageKey = String(existingProduct?.imageStorageKey || "");
    let imageUrlForState = stockImageCleared ? "" : (stockImageDataUrl || existingProduct?.imageUrl || "");
    const shouldStoreImage = imageUrlForState.startsWith("data:image/") && (
      Boolean(stockImageInput?.files?.[0]) || !imageStorageKey
    );

    if (shouldStoreImage) {
      try {
        imageStorageKey = await saveProductImage({
          clientId: state.client?.id,
          productId,
          dataUrl: imageUrlForState
        });
        if (!imageStorageKey) throw new Error("Product image storage key was not created.");
      } catch (error) {
        if (productMessage) productMessage.textContent = "The picture could not be saved permanently. Try selecting it again.";
        return;
      }
    } else if (stockImageCleared && imageStorageKey) {
      try {
        await removeProductImage(imageStorageKey);
      } catch {
        // The stock record can still remove its picture if stale browser image data cannot be deleted.
      }
      imageStorageKey = "";
      imageUrlForState = "";
    }

    const sharedImageChanged = shouldStoreImage || stockImageCleared || Boolean(
      imageUrlForState && (
        !existingProduct?.imageRemoteSynced ||
        (existingProduct && existingProduct.id !== sku)
      )
    );
    if (sharedImageChanged && isBackendConfigured()) {
      try {
        await saveSharedProductImage({
          clientId: state.client?.id,
          sku,
          previousSku: existingProduct?.id || "",
          name: primaryProductName,
          unit: sizeUnit,
          status: String(formData.get("status") || "active"),
          imageUrl: imageUrlForState
        });
      } catch (error) {
        if (productMessage) productMessage.textContent = error.message;
        return;
      }
    }

    if (existingProductId) {
      stockEntrySession.open = false;
    } else {
      activeProductFamily = productFamily;
      sessionAddedProductIds = [...new Set([...sessionAddedProductIds, productId])];
      entrySaved = true;
      stockEntrySession.open = true;
      stockEntrySession.family = productFamily;
      stockEntrySession.productIds = sessionAddedProductIds;
      stockEntrySession.adding = false;
      stockEntrySession.imageUrl = stockImageDataUrl;
      stockEntrySession.defaults = {
        stockCategory: String(formData.get("stockCategory") || FINISHED_PRODUCTS_CATEGORY),
        reorderPoint: String(formData.get("reorderPoint") || ""),
        unitCost: String(formData.get("unitCost") || ""),
        unitPrice: String(formData.get("unitPrice") || ""),
        status: String(formData.get("status") || "active")
      };
    }

    store.dispatch({
      type: "UPSERT_PRODUCT",
      productId,
      sku,
      name: primaryProductName,
      productFamily,
      productType,
      size: primarySize,
      sizeValue,
      sizeUnit,
      stockCategory: formData.get("stockCategory"),
      unit: sizeUnit,
      stock: factoryStockInPieces,
      reorderPoint: Number(formData.get("reorderPoint") || 0),
      unitCost: Number(formData.get("unitCost") || 0),
      unitPrice: Number(formData.get("unitPrice") || 0),
      packagingConversions,
      packagingPrices,
      status: formData.get("status"),
      imageUrl: imageUrlForState,
      imageStorageKey,
      imageRemoteSynced: sharedImageChanged && isBackendConfigured()
        ? true
        : existingProduct?.imageRemoteSynced,
      message: existingProductId ? "Stock updated" : "Stock added"
    });

    if (hasProductionUsage) {
      store.dispatch({
        type: "RECORD_PRODUCTION_USAGE",
        batchDate: productionBatchDate,
        batchReference: productionBatchReferenceValue,
        finishedProductId: productId,
        quantityProduced: productionQuantity,
        packagingBreakdown: productionPackagingBreakdown,
        purpose: "Stock production",
        notes: productionNotes,
        materials: productionMaterials,
        message: "Stock and raw-material usage updated"
      });
    }

    if (existingProductId) closeStockModal();
  });

  qs(".js-clear-product-form", root)?.addEventListener("click", () => {
    if (sessionAddedProductIds.length && activeProductFamily) prepareAffiliatedProductForm();
    else resetProductForm();
  });

  function fillProductForm(productId, { restoreDraft = false } = {}) {
    const product = store.getState().products.find((item) => item.id === productId);
    if (!productForm || !product) return false;

    if (stockModalTitle) stockModalTitle.textContent = "Update stock";
    if (productMessage) productMessage.textContent = "";
    productForm.elements.productId.value = product.id;
    productForm.elements.sku.value = product.id;
    productForm.elements.name.value = stockProductBaseName(product);
    productForm.elements.name.readOnly = false;
    productForm.elements.productType.value = product.productType || "";
    const parsedSize = splitProductSize(product.size, product.sizeUnit || product.unit);
    productForm.elements.sizeValue.value = product.sizeValue || parsedSize.value;
    productForm.elements.sizeUnit.value = product.sizeUnit || parsedSize.unit;
    productForm.elements.sizeUnitOther.value = product.sizeUnit && product.sizeUnit !== "other" && !PRODUCT_SIZE_UNITS.some((option) => option.value === product.sizeUnit)
      ? product.sizeUnit
      : parsedSize.customUnit;
    if (productForm.elements.sizeUnitOther.value) productForm.elements.sizeUnit.value = "other";
    updateCustomSizeUnitVisibility();
    sessionAddedProductIds = [];
    activeProductFamily = "";
    entrySaved = false;
    if (affiliatedProductProgress) affiliatedProductProgress.hidden = true;
    if (stockEntryFields) stockEntryFields.hidden = false;
    productForm.elements.stockCategory.value = stockCategoryIdForProduct(product);
    productForm.elements.stock.value = product.stock || 0;
    if (productForm.elements.stockEntryMode) productForm.elements.stockEntryMode.value = "piece";
    productForm.elements.reorderPoint.value = product.reorderPoint || 0;
    productForm.elements.unitCost.value = product.unitCost || 0;
    productForm.elements.unitPrice.value = product.unitPrice || 0;
    enabledPackagingTypes(store.getState().client).filter((type) => type !== "piece").forEach((type) => {
      const input = productForm.elements[`packagingConversion-${type}`];
      if (input) input.value = product.packagingConversions?.[type] || "";
      const priceInput = productForm.elements[`packagingPrice-${type}`];
      if (priceInput) priceInput.value = product.packagingPrices?.[type] || "";
    });
    productForm.elements.status.value = product.status || "active";
    resetProductionStockFields();
    updateProductionOutputTotal();
    if (restoreDraft) restoreStockEditDraft();
    updateProductionStockVisibility();
    updateCustomSizeUnitVisibility();
    updateFactoryStockEntry();
    setStockFormStep(restoreDraft ? stockEntrySession.step : 1);
    stockImageDataUrl = restoreDraft ? (stockEntrySession.imageUrl || product.imageUrl || "") : (product.imageUrl || "");
    stockImageCleared = false;
    stockEntrySession.editingProductId = product.id;
    stockEntrySession.imageUrl = stockImageDataUrl;
    if (stockImageInput) stockImageInput.value = "";
    setStockImageUploadState();
    openStockModal();
    if (!restoreDraft) captureStockEditDraft();
    return true;
  }

  productForm?.elements.stockCategory?.addEventListener("change", updateProductionStockVisibility);

  if (stockEntrySession.open && stockEntrySession.editingProductId) {
    fillProductForm(stockEntrySession.editingProductId, { restoreDraft: true });
  } else if (requestedProductId) {
    fillProductForm(requestedProductId);
  }

  if (requestedAction === "add-stock") {
    resetProductForm();
    openStockModal();
  }

  qs(".js-open-dashboard-dispatch", root)?.addEventListener("click", () => {
    if (!dashboardDispatchModal || !dispatchForm) return;
    dashboardDispatchModal.hidden = false;
    dispatchForm.elements.recipientType?.focus();
  });

  qsa(".js-close-dashboard-dispatch", root).forEach((button) => {
    button.addEventListener("click", () => { dashboardDispatchModal.hidden = true; });
  });
  dashboardDispatchModal?.addEventListener("click", (event) => {
    if (event.target === dashboardDispatchModal) dashboardDispatchModal.hidden = true;
  });

  qs(".js-open-stock-modal", root)?.addEventListener("click", () => {
    resetProductForm();
    openStockModal();
  });

  qsa(".js-close-stock-modal", root).forEach((button) => {
    button.addEventListener("click", closeStockModal);
  });

  qsa(".js-close-restock-modal", root).forEach((button) => {
    button.addEventListener("click", closeRestockModal);
  });

  qsa(".js-close-reduce-stock-modal", root).forEach((button) => {
    button.addEventListener("click", closeReduceStockModal);
  });

  stockModal?.addEventListener("click", (event) => {
    if (event.target === stockModal) closeStockModal();
  });

  restockModal?.addEventListener("click", (event) => {
    if (event.target === restockModal) closeRestockModal();
  });

  reduceStockModal?.addEventListener("click", (event) => {
    if (event.target === reduceStockModal) closeReduceStockModal();
  });

  restockForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(restockForm);
    const productId = String(formData.get("productId") || "");
    const quantity = Number(formData.get("quantity") || 0);

    if (restockMessage) restockMessage.textContent = "";

    if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
      if (restockMessage) restockMessage.textContent = "Enter the quantity you want to add.";
      return;
    }

    store.dispatch({
      type: "RESTOCK_PRODUCT",
      productId,
      quantity,
      message: "Stock quantity added"
    });
    closeRestockModal();
  });

  reduceStockForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(reduceStockForm);
    const productId = String(formData.get("productId") || "");
    const quantity = Number(formData.get("quantity") || 0);
    const reason = String(formData.get("reason") || "").trim();
    const reasonDetails = String(formData.get("reasonDetails") || "").trim();
    const product = store.getState().products.find((item) => item.id === productId);

    if (reduceStockMessage) reduceStockMessage.textContent = "";

    if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
      if (reduceStockMessage) reduceStockMessage.textContent = "Enter the quantity you want to remove.";
      return;
    }

    if (product && quantity > Number(product.stock || 0)) {
      if (reduceStockMessage) reduceStockMessage.textContent = `Only ${formatNumber(product.stock)} available.`;
      return;
    }

    if (!reason) {
      if (reduceStockMessage) reduceStockMessage.textContent = "Choose a reason for reducing stock.";
      return;
    }

    store.dispatch({
      type: "REDUCE_PRODUCT_STOCK",
      productId,
      quantity,
      reason,
      reasonDetails,
      message: "Stock quantity reduced"
    });
    closeReduceStockModal();
  });

  qsa(".js-edit-product", root).forEach((button) => {
    button.addEventListener("click", () => {
      fillProductForm(button.dataset.productId);
    });
  });

  qsa(".js-toggle-product-status", root).forEach((button) => {
    button.addEventListener("click", () => {
      store.dispatch({
        type: "TOGGLE_PRODUCT_STATUS",
        productId: button.dataset.productId,
        message: "Product status updated"
      });
    });
  });

  function updateOtherRecipientField() {
    if (!dispatchOtherRecipient || !dispatchRecipientSelect || !dispatchRecipientType) return;

    const isOther = dispatchRecipientSelect.value === "__other__";
    dispatchOtherRecipient.hidden = !isOther;
    dispatchOtherRecipient.required = isOther;
    dispatchOtherRecipient.placeholder = otherRecipientPlaceholder(dispatchRecipientType.value);
    if (!isOther) dispatchOtherRecipient.value = "";
  }

  function updateDispatchRecipientOptions() {
    if (!dispatchRecipientType || !dispatchRecipientSelect) return;

    const recipientType = dispatchRecipientType.value;
    dispatchRecipientSelect.innerHTML = renderDispatchRecipientOptions(store.getState(), recipientType);
    if (dispatchDestinationInput) dispatchDestinationInput.placeholder = destinationPlaceholder(recipientType);
    updateOtherRecipientField();
  }

  function updateDispatchProductOptions() {
    if (!dispatchRecipientType || !dispatchForm) return;

    qsa("[data-dispatch-product-select]", dispatchForm).forEach((select) => {
      const selectedProductId = select.value;
      select.innerHTML = renderDispatchProductOptions(store.getState(), dispatchRecipientType.value, selectedProductId);
      if (selectedProductId && ![...select.options].some((option) => option.value === selectedProductId)) {
        select.value = "";
      }
      updateDispatchItemPrice(select.closest("[data-dispatch-item-row]"));
    });
  }

  function updateDispatchItemPrice(row) {
    if (!row) return;
    const productId = qs("[data-dispatch-product-select]", row)?.value;
    const product = store.getState().products.find((item) => item.id === productId);
    const packagingSelect = qs("[data-dispatch-packaging-select]", row);
    const selectedPackaging = packagingSelect?.value || "piece";
    if (packagingSelect) {
      packagingSelect.innerHTML = productPackagingTypes(store.getState().client, product)
        .map((type) => `<option value="${escapeHtml(type)}" ${type === selectedPackaging ? "selected" : ""}>${escapeHtml(packagingOption(type).label)}</option>`)
        .join("");
      if (![...packagingSelect.options].some((option) => option.value === selectedPackaging)) packagingSelect.value = "piece";
    }
    const priceInput = qs("[data-dispatch-unit-price]", row);
    if (priceInput) priceInput.value = product ? formatCurrency(packagingUnitPrice(product, packagingSelect?.value || "piece", store.getState().client)) : formatCurrency(0);
  }

  function syncDispatchItemRemoveButtons() {
    if (!dispatchItemList) return;
    const rows = qsa("[data-dispatch-item-row]", dispatchItemList);
    rows.forEach((row) => {
      const removeButton = qs(".js-remove-dispatch-item", row);
      if (removeButton) removeButton.disabled = rows.length === 1;
    });
  }

  function syncDispatchPaymentField() {
    if (!dispatchRecipientType || !dispatchPaymentField || !dispatchPaymentSelect) return;
    const isInternal = dispatchRecipientType.value.toLowerCase().includes("internal");
    dispatchPaymentField.hidden = isInternal;
    dispatchPaymentSelect.disabled = isInternal;
    dispatchPaymentSelect.required = !isInternal;
    if (isInternal) dispatchPaymentSelect.value = "cash";
  }

  updateDispatchRecipientOptions();
  updateDispatchProductOptions();
  syncDispatchItemRemoveButtons();
  syncDispatchPaymentField();

  function syncExpectedDeliveryDate() {
    if (!dispatchDateInput || !expectedDeliveryInput) return;

    const dispatchDate = dispatchDateInput.value || todayISO();
    expectedDeliveryInput.min = dispatchDate;
    if (!expectedDeliveryInput.value || expectedDeliveryInput.value < dispatchDate) {
      expectedDeliveryInput.value = dispatchDate;
    }
  }

  syncExpectedDeliveryDate();
  dispatchDateInput?.addEventListener("change", syncExpectedDeliveryDate);
  dispatchRecipientType?.addEventListener("change", () => {
    updateDispatchRecipientOptions();
    updateDispatchProductOptions();
    syncDispatchPaymentField();
  });
  dispatchRecipientSelect?.addEventListener("change", updateOtherRecipientField);
  addDispatchItemButton?.addEventListener("click", () => {
    if (!dispatchItemList || !dispatchItemTemplate) return;
    dispatchItemList.append(dispatchItemTemplate.content.cloneNode(true));
    updateDispatchProductOptions();
    syncDispatchItemRemoveButtons();
    qsa("[data-dispatch-item-row]", dispatchItemList).at(-1)?.querySelector("select")?.focus();
  });
  dispatchItemList?.addEventListener("change", (event) => {
    if (event.target.matches("[data-dispatch-product-select], [data-dispatch-packaging-select]")) {
      updateDispatchItemPrice(event.target.closest("[data-dispatch-item-row]"));
    }
  });
  dispatchItemList?.addEventListener("click", (event) => {
    const removeButton = event.target.closest(".js-remove-dispatch-item");
    if (!removeButton || removeButton.disabled) return;
    removeButton.closest("[data-dispatch-item-row]")?.remove();
    syncDispatchItemRemoveButtons();
  });

  dispatchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const state = store.getState();
    const formData = new FormData(dispatchForm);
    const items = qsa("[data-dispatch-item-row]", dispatchForm).map((row) => {
      const productId = String(qs("[data-dispatch-product-select]", row)?.value || "").trim();
      const product = state.products.find((candidate) => candidate.id === productId);
      const packagingType = String(qs("[data-dispatch-packaging-select]", row)?.value || "piece");
      const packagingQuantity = Number(qs('input[name="dispatchQuantity"]', row)?.value || 0);
      return {
        productId,
        quantity: quantityInPieces(product, packagingQuantity, packagingType, state.client),
        packagingType,
        packagingQuantity,
        packagingUnitPrice: packagingUnitPrice(product, packagingType, state.client),
        unitPrice: effectivePiecePrice(product, packagingType, state.client),
        amount: packagingLineAmount(product, packagingQuantity, packagingType, state.client)
      };
    });
    const recipientType = String(formData.get("recipientType") || "");
    const isInternalDispatch = recipientType.toLowerCase().includes("internal");
    const paymentType = isInternalDispatch ? "none" : String(formData.get("paymentType") || "");
    const recipientChoice = String(formData.get("recipientNameChoice") || "").trim();
    const otherRecipient = String(formData.get("recipientNameOther") || "").trim();
    const recipientName = recipientChoice === "__other__" ? otherRecipient : recipientChoice;
    const dispatchDate = String(formData.get("dispatchDate") || "");
    const expectedDeliveryAt = String(formData.get("expectedDeliveryAt") || "");
    const message = qs("#stock-dispatch-message", root);

    if (message) message.textContent = "";

    if (!items.length || items.some((item) => !item.productId || !item.packagingQuantity || item.packagingQuantity <= 0 || !item.quantity || item.quantity <= 0) || !recipientName || !formData.get("destination") || !dispatchDate || !expectedDeliveryAt || (!isInternalDispatch && !paymentType)) {
      if (message) message.textContent = "Complete every product, quantity, recipient, payment method, destination, and delivery date.";
      return;
    }

    const duplicateLine = items.find((item, index) => items.findIndex((candidate) => candidate.productId === item.productId && candidate.packagingType === item.packagingType) !== index);
    if (duplicateLine) {
      const duplicateProduct = state.products.find((product) => product.id === duplicateLine.productId);
      if (message) message.textContent = `${duplicateProduct?.name || "A product"} with ${packagingOption(duplicateLine.packagingType).label.toLowerCase()} is selected more than once. Combine it into one quantity.`;
      return;
    }

    if (expectedDeliveryAt < dispatchDate) {
      if (message) message.textContent = "Expected delivery cannot be before the dispatch date.";
      return;
    }

    const requestedByProduct = items.reduce((totals, item) => totals.set(item.productId, Number(totals.get(item.productId) || 0) + item.quantity), new Map());
    const unavailableItem = items.find((item) => {
      const product = state.products.find((candidate) => candidate.id === item.productId);
      return !product || Number(requestedByProduct.get(item.productId) || 0) > Number(product.stock || 0);
    });
    if (unavailableItem) {
      const product = state.products.find((candidate) => candidate.id === unavailableItem.productId);
      if (message) message.textContent = product
        ? `Only ${formatNumber(product.stock)} ${product.name} available.`
        : "One selected product is no longer available.";
      return;
    }

    if (
      recipientType.toLowerCase().includes("representative") &&
      items.some((item) => stockCategoryIdForProduct(state.products.find((product) => product.id === item.productId)) !== FINISHED_PRODUCTS_CATEGORY)
    ) {
      if (message) message.textContent = "Only finished products can be assigned to a sales representative.";
      return;
    }

    const invoiceIdsBeforeDispatch = new Set((state.invoices || []).map((invoice) => invoice.id));

    store.dispatch({
      type: "RECORD_STOCK_DISPATCH",
      items,
      recipientType,
      recipientName,
      paymentType,
      destination: formData.get("destination"),
      dispatchDate,
      expectedDeliveryAt,
      staffName: formData.get("staffName"),
      message: "Factory dispatch recorded"
    });

    const recordedState = store.getState();
    const recordedInvoice = getInvoiceRecords(recordedState).find((invoice) => !invoiceIdsBeforeDispatch.has(invoice.id));

    dispatchForm.reset();
    dispatchForm.elements.dispatchDate.value = todayISO();
    dispatchForm.elements.expectedDeliveryAt.value = todayISO();
    dispatchForm.elements.staffName.value = currentStaffName(store.getState());
    if (dispatchItemList) dispatchItemList.innerHTML = renderDispatchItemRow(store.getState(), "Sales Representative");
    syncExpectedDeliveryDate();
    updateDispatchRecipientOptions();
    updateDispatchProductOptions();
    syncDispatchItemRemoveButtons();
    syncDispatchPaymentField();
    if (dashboardDispatchModal) dashboardDispatchModal.hidden = true;
    if (recordedInvoice) openInvoiceQuickView(recordedInvoice, recordedState);
  });

  qsa(".js-restock-product", root).forEach((button) => {
    button.addEventListener("click", () => {
      openRestockModal(button.dataset.productId);
    });
  });

  qsa(".js-reduce-stock", root).forEach((button) => {
    button.addEventListener("click", () => {
      openReduceStockModal(button.dataset.productId);
    });
  });

}
