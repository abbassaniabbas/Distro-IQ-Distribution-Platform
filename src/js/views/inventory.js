import {
  calculateVisionMetrics,
  creditUsageTone,
  getProductMap,
  getStockHealth,
  stockCategoryIdForProduct
} from "../services/calculations.js";
import {
  formatCurrency,
  currencySymbolFor,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  statusText
} from "../services/formatters.js";
import { currentUserPermissions, salesRepresentativeNames } from "../services/rbac.js";
import { isModuleEnabled } from "../services/features.js";
import { printTabularReport } from "../services/report-export.js";
import { LOGO_ACCEPT, LOGO_HELP_TEXT, readLogoFile, validateLogoFile } from "../services/branding.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { metricCard, panelHeader, progressBar, statusPill, table, textButton } from "../ui/components.js";
import { icon } from "../ui/icons.js";

const DEFAULT_STOCK_TAB = "stock-health";
const DISPATCH_PAGE_SIZE = 10;
const FINISHED_PRODUCTS_CATEGORY = "finished_products";

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
      label: "Lifecycle"
    },
    {
      id: "assignments",
      label: "Rep stock ledger"
    },
    {
      id: "movement-history",
      label: "Movement history"
    },
    ...(isModuleEnabled(state, "credit_control") ? [{
      id: "credit",
      label: "Credit limits"
    }] : [])
  ];
}

function activeStockTabId(permissions, state) {
  const tabs = stockTabsForPermissions(permissions, state);
  const requestedTab = inventoryRouteParams().get("tab") || DEFAULT_STOCK_TAB;
  const normalizedTab = ["factory-health", "add-stock", "raw-materials", "finished-goods", "equipment", "categories"]
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

function lifecycleTotals(state) {
  const factoryStock = state.products.reduce((total, product) => total + Number(product.stock || 0), 0);
  const assignedStock = state.stockAssignments.reduce((total, assignment) => total + Number(assignment.assigned || 0), 0);
  const outcomes = state.stockTransactions.filter((transaction) =>
    ["sale", "return", "supply", "write off"].includes(String(transaction.type || "").toLowerCase())
  ).length;

  return {
    factoryStock,
    assignedStock,
    outcomes
  };
}

function renderLifecycle(state) {
  const totals = lifecycleTotals(state);
  const vision = calculateVisionMetrics(state);
  const stages = [
    {
      label: "Factory stock",
      value: `${formatNumber(totals.factoryStock)} units`,
      body: "Produced or received at the factory and held by stock category."
    },
    {
      label: "Assignment / dispatch",
      value: `${formatNumber(vision.repOutstandingUnits)} outstanding`,
      body: `${formatNumber(totals.assignedStock)} units have been loaded to representatives or sent directly to customers.`
    },
    {
      label: "Outcome",
      value: `${formatNumber(totals.outcomes)} records`,
      body: "Sold, returned, supplied, moved internally, or written off with traceability."
    },
    {
      label: "Paid / reconciled",
      value: formatPercent(vision.paymentCoveragePercent),
      body: `${formatCurrency(vision.receivables)} remains unpaid across open balances.`
    }
  ];

  return `
    <section class="panel">
      ${panelHeader("Stock lifecycle", "Produced or received -> assigned or dispatched -> sold or returned -> paid")}
      <div class="stock-lifecycle-grid">
        ${stages.map((stage, index) => `
          <article class="stock-lifecycle-step" data-search-index="${escapeHtml(`${stage.label} ${stage.body}`.toLowerCase())}">
            <span class="stock-step-number">${index + 1}</span>
            <div>
              <span class="eyebrow">${escapeHtml(stage.label)}</span>
              <strong>${escapeHtml(stage.value)}</strong>
              <p>${escapeHtml(stage.body)}</p>
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderCustodyMetrics(vision) {
  return `
    <div class="metric-grid">
      ${metricCard({
        label: "Finished stock",
        value: formatNumber(vision.finishedStockUnits),
        meta: `${vision.finishedGoodsRiskCount} finished item${vision.finishedGoodsRiskCount === 1 ? "" : "s"} need action`,
        iconName: "package"
      })}
      ${metricCard({
        label: "Representative custody",
        value: formatNumber(vision.repOutstandingUnits),
        meta: `${formatPercent(vision.repSellThroughPercent)} sold through from open loads`,
        iconName: "routes"
      })}
      ${metricCard({
        label: "Raw material risks",
        value: formatNumber(vision.rawMaterialRiskCount),
        meta: "Reorder before production stalls",
        iconName: "alert"
      })}
      ${metricCard({
        label: "Equipment available",
        value: formatNumber(vision.equipmentInStock),
        meta: "Tracked as in stock, assigned, or sold",
        iconName: "package"
      })}
    </div>
  `;
}

function productUnit(product) {
  return product.unit || (stockCategoryIdForProduct(product) === "raw_materials" ? "kg" : "unit");
}

function normalizedProductName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function duplicateProductName(state, name, productId = "") {
  const nextName = normalizedProductName(name);
  const currentProductId = String(productId || "").trim();

  if (!nextName) return false;

  return (state.products || []).some((product) => (
    product.id !== currentProductId && normalizedProductName(product.name) === nextName
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
    <div id="stock-product-modal" class="stock-modal-backdrop" hidden>
      <section class="stock-modal" role="dialog" aria-modal="true" aria-labelledby="stock-product-modal-title">
        <header class="stock-modal-header">
          <div>
            <span class="eyebrow">Stock record</span>
            <h2 id="stock-product-modal-title">Add stock</h2>
          </div>
          ${textButton({
            iconName: "x",
            label: "Close",
            className: "js-close-stock-modal"
          })}
        </header>
      <form id="manager-product-form" class="manager-form-grid" novalidate>
        <input type="hidden" name="productId">
        <label class="field">
          <span>Product name</span>
          <input name="name" placeholder="Plantain Chips 50g" required>
        </label>
        <label class="field">
          <span>SKU</span>
          <input name="sku" placeholder="SKU-1008" required>
        </label>
        <label class="field">
          <span>Category</span>
          <select name="stockCategory" required>
            ${state.stockCategories.map((category) => `
              <option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>
            `).join("")}
          </select>
        </label>
        <label class="field">
          <span>Unit</span>
          <input name="unit" placeholder="pack, carton, kg" required>
        </label>
        <label class="field">
          <span>Factory stock</span>
          <input name="stock" type="number" min="0" step="1" inputmode="numeric" placeholder="0" required>
        </label>
        <label class="field">
          <span>Reorder point</span>
          <input name="reorderPoint" type="number" min="0" step="1" inputmode="numeric" placeholder="0" required>
        </label>
        <label class="field">
          <span>Cost price (${escapeHtml(moneySymbol)})</span>
          <input name="unitCost" type="number" min="0" step="1" inputmode="numeric" placeholder="0" required>
        </label>
        <label class="field">
          <span>Selling price (${escapeHtml(moneySymbol)})</span>
          <input name="unitPrice" type="number" min="0" step="1" inputmode="numeric" placeholder="0" required>
        </label>
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
        <div class="manager-form-actions span-full">
          ${textButton({
            iconName: "check",
            label: "Save stock",
            className: "primary",
            type: "submit"
          })}
          ${textButton({
            iconName: "refresh",
            label: "Clear",
            className: "js-clear-product-form"
          })}
        </div>
        <span id="manager-product-message" class="field-error span-full" aria-live="polite"></span>
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
            <input name="quantity" type="number" min="1" step="1" inputmode="numeric" placeholder="Enter amount" required>
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
            <input name="quantity" type="number" min="1" step="1" inputmode="numeric" placeholder="Enter amount" required>
          </label>
          <label class="field">
            <span>Reason</span>
            <select name="reason" required>
              <option value="">Choose reason</option>
              <option value="Damaged stock">Damaged stock</option>
              <option value="Expired stock">Expired stock</option>
              <option value="Production use">Used for production</option>
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

function renderProductCard(product, permissions) {
  const health = getStockHealth(product);
  const canRestock = permissions.canManageProducts || permissions.canManageStockMovements || permissions.canReconcileStock;
  const canReduceStock = permissions.canManageStockMovements;
  const canManageProducts = permissions.canManageProducts;
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
        ${statusPill(product.status === "inactive" ? "inactive" : health.status)}
      </header>

      <div class="stock-line">
        <div class="stock-meta">
          <span>${formatNumber(product.stock)} ${escapeHtml(productUnit(product))}</span>
          <span>${health.daysCover} days cover</span>
        </div>
        ${progressBar(health.percent, health.tone)}
      </div>

      <div class="split">
        <span class="muted">Cost ${formatCurrency(product.unitCost)}</span>
        <strong>${product.unitPrice ? formatCurrency(product.unitPrice) : "Factory use"}</strong>
      </div>

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
        .slice()
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
        .map((retailer) => ({
          value: retailer.name,
          label: [retailer.name, retailer.city || retailer.stateName || retailer.region].filter(Boolean).join(" - ")
        })),
      { value: "__other__", label: "Other customer / supermarket" }
    ];
  }

  if (normalizedType.includes("internal")) {
    return [
      { value: "Production Line", label: "Production Line" },
      { value: "Packaging Store", label: "Packaging Store" },
      { value: "Finished Goods Store", label: "Finished Goods Store" },
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
        ${escapeHtml(product.name)} (${formatNumber(product.stock)} ${escapeHtml(productUnit(product))})
      </option>
    `)
  ].join("");
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
        <label class="field">
          <span>Item</span>
          <select name="productId" data-dispatch-product-select required>
            ${renderDispatchProductOptions(state, "Sales Representative")}
          </select>
        </label>
        <label class="field">
          <span>Quantity</span>
          <input name="quantity" type="number" min="1" step="1" inputmode="numeric" placeholder="0" required>
        </label>
        <label class="field">
          <span>Destination / drop-off point</span>
          <input name="destination" placeholder="${escapeHtml(destinationPlaceholder("Sales Representative"))}" required>
        </label>
        <label class="field">
          <span>Date</span>
          <input name="dispatchDate" type="date" value="${escapeHtml(todayISO())}" required>
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

function renderDispatchPage(state, permissions) {
  return `
    ${renderDispatchForm(state, permissions)}
    <section class="panel inventory-layout">
      ${panelHeader("Dispatch log", "Item, quantity, date, recipient, destination, and staff responsible")}
      ${table(
        ["Item", "Quantity", "Date", "Recipient", "Destination", "Staff"],
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

  return [...dispatchTransactions(state)]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.id || "").localeCompare(String(a.id || "")))
    .map((transaction, index) => {
    const product = productMap.get(transaction.productId);
    const recipient = transaction.recipientName || transaction.partyName || "Factory";
    const destination = transaction.dispatchDestination || transaction.destination || transaction.partyType || "Factory";
    const staff = transaction.staffResponsible || transaction.recordedBy || "Store Keeper";
    const searchIndex = [
      product?.name,
      transaction.quantity,
      transaction.date,
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
        <td>${formatNumber(transaction.quantity)}</td>
        <td>${formatDate(transaction.date)}</td>
        <td>
          ${escapeHtml(recipient)}
          <div class="muted">${escapeHtml(transaction.partyType || "Recipient")}</div>
        </td>
        <td>${escapeHtml(destination)}</td>
        <td>${escapeHtml(staff)}</td>
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
    .map((transaction) => {
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
        <tr data-search-index="${escapeHtml(searchIndex)}">
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

function assignmentVariance(assignment) {
  return Number(assignment.assigned || 0) - Number(assignment.sold || 0) - Number(assignment.returned || 0);
}

function hasAssignmentVariance(assignment) {
  return Math.abs(assignmentVariance(assignment)) > 0.0001;
}

function renderAssignmentRows(state, permissions) {
  const productMap = getProductMap(state.products);

  return state.stockAssignments.map((assignment) => {
    const product = productMap.get(assignment.productId);
    const variance = assignmentVariance(assignment);
    const hasVariance = hasAssignmentVariance(assignment);
    const soldPercent = assignment.assigned ? (assignment.sold / assignment.assigned) * 100 : 0;
    const reconcileBlocked = hasVariance && !assignment.varianceFlagged;
    const searchIndex = [
      assignment.id,
      assignment.repName,
      assignment.routeId,
      product?.name,
      assignment.status
    ].join(" ").toLowerCase();

    return `
      <tr
        data-assignment-row
        data-assignment-rep="${escapeHtml(assignment.repName)}"
        data-assignment-date="${escapeHtml(String(assignment.assignedAt || "").slice(0, 10))}"
        data-assignment-variance="${hasVariance ? "true" : "false"}"
        data-search-index="${escapeHtml(searchIndex)}"
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
        <td class="assignment-variance-cell ${hasVariance ? "is-discrepant" : ""}">
          <strong>${formatNumber(variance)}</strong>
          ${hasVariance ? '<div class="muted">Needs review</div>' : '<div class="muted">Balanced</div>'}
        </td>
        <td>
          ${statusPill(assignmentDisplayStatus(assignment))}
          ${assignment.varianceNote ? `<div class="muted">${escapeHtml(assignment.varianceNote)}</div>` : ""}
        </td>
        <td>
          ${
            permissions.canReconcileStock && assignment.status !== "reconciled"
              ? `
                <div class="assignment-actions">
                  ${
                    hasVariance
                      ? `<input class="table-note-input" data-variance-note="${escapeHtml(assignment.id)}" placeholder="Variance note">`
                      : ""
                  }
                  ${textButton({
                    iconName: "alert",
                    label: "Flag",
                    className: "js-flag-assignment",
                    disabled: !hasVariance,
                    data: { "assignment-id": assignment.id }
                  })}
                  <span class="reconcile-action-wrap">
                    ${textButton({
                      iconName: "check",
                      label: assignment.varianceFlagged ? "Close" : "Reconcile",
                      className: "primary js-reconcile-assignment",
                      disabled: reconcileBlocked,
                      data: { "assignment-id": assignment.id }
                    })}
                    ${
                      reconcileBlocked
                        ? '<span class="assignment-action-hint" role="tooltip">Flag the outstanding stock before closing.</span>'
                        : ""
                    }
                  </span>
                </div>
              `
              : ""
          }
        </td>
      </tr>
    `;
  });
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
          <div class="muted">${formatNumber(transaction.quantity)} units</div>
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

function renderCreditRows(state) {
  return state.creditLimits.map((limit) => {
    const percent = limit.limit ? (limit.balance / limit.limit) * 100 : 0;
    const searchIndex = [
      limit.partyName,
      limit.partyType,
      limit.changedBy
    ].join(" ").toLowerCase();

    return `
      <tr data-search-index="${escapeHtml(searchIndex)}">
        <td>
          <strong>${escapeHtml(limit.partyName)}</strong>
          <div class="muted">${escapeHtml(limit.partyType)}</div>
        </td>
        <td>${formatCurrency(limit.limit)}</td>
        <td>
          <div class="stock-line">
            <div class="stock-meta">
              <span>${formatCurrency(limit.balance)}</span>
              <span>${formatPercent(percent)}</span>
            </div>
            ${progressBar(percent, creditUsageTone(percent))}
          </div>
        </td>
        <td>${formatCurrency(limit.previousLimit)} -> ${formatCurrency(limit.limit)}</td>
        <td>
          ${escapeHtml(limit.changedBy)}
          <div class="muted">${formatDateTime(limit.changedAt)}</div>
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
      <div class="toolbar">
        ${panelHeader("Stock health", "Raw materials, finished goods, equipment, cover days, and replenishment risk")}
        <div class="toolbar-group">
          ${canAddStock
            ? textButton({
                iconName: "plus",
                label: "Add stock",
                className: "primary js-open-stock-modal"
              })
            : ""}
          <label class="field">
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

      <div class="product-grid">
        ${visibleProducts.length
          ? visibleProducts.map((product) => renderProductCard(product, permissions)).join("")
          : '<div class="empty-state">No active stock items available</div>'}
      </div>
    </section>
  `;
}

function renderOverviewPage(state, vision) {
  return `
    ${renderCustodyMetrics(vision)}
    ${renderLifecycle(state)}
  `;
}

function renderAssignmentsPage(state, permissions) {
  const representativeNames = managerRepOptions(state);

  return `
    <section class="panel inventory-layout">
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
        ["Assignment", "Representative", "Product", "Assigned", "Sold", "Returned", "Variance", "Status", ""],
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
    </section>
  `;
}

function renderCreditPage(state) {
  return `
    <section class="panel inventory-layout">
      ${panelHeader("Credit limits", "Running balances against manager-approved limits")}
      ${table(
        ["Party", "Limit", "Balance usage", "Last change", "Changed by"],
        renderCreditRows(state),
        "No credit limits recorded"
      )}
    </section>
  `;
}

function renderStockTabPage({ activeTabId, state, permissions, vision }) {
  if (activeTabId === "dispatch") return renderDispatchPage(state, permissions);
  if (activeTabId === "overview") return renderOverviewPage(state, vision);
  if (activeTabId === "assignments") return renderAssignmentsPage(state, permissions);
  if (activeTabId === "movement-history") return renderTransactionsPage(state);
  if (activeTabId === "credit") return renderCreditPage(state);

  return renderStockHealthPage(state, permissions);
}

export function renderInventory({ state }) {
  const permissions = currentUserPermissions(state);
  const vision = calculateVisionMetrics(state);
  const activeTabId = activeStockTabId(permissions, state);

  return `
    <section class="view inventory-view">
      ${renderStockSubtabs(activeTabId, permissions, state)}
      ${renderStockTabPage({ activeTabId, state, permissions, vision })}
      ${renderStockProductModal(state, permissions)}
      ${renderRestockModal(permissions)}
      ${renderStockReductionModal(permissions)}
    </section>
  `;
}

export function bindInventory({ root, store, signal }) {
  const categoryFilter = qs("#inventory-category-filter", root);
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
  const dispatchRecipientType = dispatchForm ? qs('select[name="recipientType"]', dispatchForm) : null;
  const dispatchProductSelect = dispatchForm ? qs("[data-dispatch-product-select]", dispatchForm) : null;
  const dispatchRecipientSelect = dispatchForm ? qs("[data-dispatch-recipient-select]", dispatchForm) : null;
  const dispatchOtherRecipient = dispatchForm ? qs("[data-dispatch-recipient-other]", dispatchForm) : null;
  const dispatchDestinationInput = dispatchForm ? qs('input[name="destination"]', dispatchForm) : null;
  const routeParams = inventoryRouteParams();
  const requestedProductId = routeParams.get("product");
  const requestedStockType = routeParams.get("type");
  const requestedAction = routeParams.get("action");
  let stockImageDataUrl = "";

  const assignmentRepFilter = qs("[data-assignment-rep-filter]", root);
  const assignmentDateFrom = qs("[data-assignment-date-from]", root);
  const assignmentDateTo = qs("[data-assignment-date-to]", root);
  const assignmentFilterStatus = qs("[data-assignment-filter-status]", root);

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
      const fromMatches = !dateFrom || assignedDate >= dateFrom;
      const toMatches = !dateTo || assignedDate <= dateTo;
      row.hidden = !(repMatches && fromMatches && toMatches);
    });

    if (assignmentFilterStatus) {
      const visibleCount = visibleAssignmentRows().length;
      assignmentFilterStatus.textContent = `${formatNumber(visibleCount)} of ${formatNumber(allRows.length)} ledger entries shown`;
    }
  }

  [assignmentRepFilter, assignmentDateFrom, assignmentDateTo].filter(Boolean).forEach((control) => {
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
      const cells = [...row.querySelectorAll("td")].slice(0, 8);

      return {
        cells: cells.map((cell) => String(cell.innerText || cell.textContent || "").replace(/\s+/g, " ").trim()),
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
        headers: ["Assignment", "Representative", "Product", "Assigned", "Sold", "Returned", "Variance", "Status"],
        rows
      }]
    });
  });

  applyAssignmentFilters();

  function applyStockTypeFilter() {
    qsa(".product-card", root).forEach((card) => {
      card.hidden = categoryFilter.value !== "all" && card.dataset.stockCategory !== categoryFilter.value;
    });
  }

  categoryFilter?.addEventListener("change", applyStockTypeFilter);

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

  function resetProductForm() {
    if (!productForm) return;

    productForm.reset();
    productForm.elements.productId.value = "";
    stockImageDataUrl = "";
    if (stockImageInput) stockImageInput.value = "";
    setStockImageUploadState();
    if (stockModalTitle) stockModalTitle.textContent = "Add stock";
    if (productMessage) productMessage.textContent = "";
  }

  function openStockModal() {
    if (!stockModal || !productForm) return;

    stockModal.hidden = false;
    productForm.elements.name?.focus();
  }

  function closeStockModal() {
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
    restockForm.elements.productName.value = `${product.name} (${formatNumber(product.stock)} ${productUnit(product)} currently)`;
    if (restockMessage) restockMessage.textContent = "";
    restockModal.hidden = false;
    restockForm.elements.quantity.focus();
  }

  function openReduceStockModal(productId) {
    const product = store.getState().products.find((item) => item.id === productId);
    if (!reduceStockModal || !reduceStockForm || !product) return;

    reduceStockForm.reset();
    reduceStockForm.elements.productId.value = product.id;
    reduceStockForm.elements.productName.value = `${product.name} (${formatNumber(product.stock)} ${productUnit(product)} currently)`;
    if (reduceStockMessage) reduceStockMessage.textContent = "";
    reduceStockModal.hidden = false;
    reduceStockForm.elements.quantity.focus();
  }

  stockImageInput?.addEventListener("change", async () => {
    const file = stockImageInput.files?.[0];

    if (!file) {
      stockImageDataUrl = "";
      setStockImageUploadState();
      return;
    }

    const fileError = validateLogoFile(file).replace("logo", "picture");

    if (fileError) {
      stockImageDataUrl = "";
      stockImageInput.value = "";
      setStockImageUploadState({
        error: fileError
      });
      return;
    }

    try {
      stockImageDataUrl = await readLogoFile(file);
      setStockImageUploadState({
        fileName: file.name
      });
    } catch (error) {
      stockImageDataUrl = "";
      stockImageInput.value = "";
      setStockImageUploadState({
        error: error.message.replace("Logo", "Picture")
      });
    }
  });

  clearStockImageButton?.addEventListener("click", () => {
    stockImageDataUrl = "";
    if (stockImageInput) stockImageInput.value = "";
    setStockImageUploadState();
  });

  productForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(productForm);
    const sku = String(formData.get("sku") || "").trim();
    const existingProductId = String(formData.get("productId") || "").trim();
    const productId = String(existingProductId || sku).trim();
    const requiredFields = [
      ["name", "product name"],
      ["sku", "SKU"],
      ["stockCategory", "category"],
      ["unit", "unit"],
      ["stock", "factory stock"],
      ["reorderPoint", "reorder point"],
      ["unitCost", "cost price"],
      ["unitPrice", "selling price"],
      ["status", "catalogue status"]
    ];
    const missingFields = requiredFields
      .filter(([fieldName]) => String(formData.get(fieldName) ?? "").trim() === "")
      .map(([, label]) => label);
    const numberFields = ["stock", "reorderPoint", "unitCost", "unitPrice"];
    const invalidNumberField = numberFields.find((fieldName) => {
      const rawValue = String(formData.get(fieldName) ?? "").trim();
      const numberValue = Number(rawValue);
      return rawValue !== "" && (!Number.isFinite(numberValue) || numberValue < 0);
    });

    if (productMessage) productMessage.textContent = "";

    if (missingFields.length) {
      if (productMessage) productMessage.textContent = `Fill in ${missingFields.join(", ")}. Only the picture is optional.`;
      return;
    }

    if (invalidNumberField) {
      if (productMessage) productMessage.textContent = "Stock quantities and prices must be zero or higher.";
      return;
    }

    if (duplicateProductName(store.getState(), formData.get("name"), existingProductId)) {
      if (productMessage) productMessage.textContent = "A product with this name already exists. Use a different product name.";
      return;
    }

    if (duplicateProductSku(store.getState(), sku, existingProductId)) {
      if (productMessage) productMessage.textContent = "A product with this SKU already exists. Use a different SKU.";
      return;
    }

    store.dispatch({
      type: "UPSERT_PRODUCT",
      productId,
      sku,
      name: formData.get("name"),
      stockCategory: formData.get("stockCategory"),
      unit: formData.get("unit"),
      stock: Number(formData.get("stock") || 0),
      reorderPoint: Number(formData.get("reorderPoint") || 0),
      unitCost: Number(formData.get("unitCost") || 0),
      unitPrice: Number(formData.get("unitPrice") || 0),
      status: formData.get("status"),
      imageUrl: stockImageDataUrl,
      message: existingProductId ? "Stock updated" : "Stock added"
    });

    closeStockModal();
  });

  qs(".js-clear-product-form", root)?.addEventListener("click", () => {
    resetProductForm();
  });

  function fillProductForm(productId) {
    const product = store.getState().products.find((item) => item.id === productId);
    if (!productForm || !product) return false;

    if (stockModalTitle) stockModalTitle.textContent = "Update stock";
    if (productMessage) productMessage.textContent = "";
    productForm.elements.productId.value = product.id;
    productForm.elements.sku.value = product.id;
    productForm.elements.name.value = product.name || "";
    productForm.elements.stockCategory.value = stockCategoryIdForProduct(product);
    productForm.elements.unit.value = productUnit(product);
    productForm.elements.stock.value = product.stock || 0;
    productForm.elements.reorderPoint.value = product.reorderPoint || 0;
    productForm.elements.unitCost.value = product.unitCost || 0;
    productForm.elements.unitPrice.value = product.unitPrice || 0;
    productForm.elements.status.value = product.status || "active";
    stockImageDataUrl = product.imageUrl || "";
    if (stockImageInput) stockImageInput.value = "";
    setStockImageUploadState();
    openStockModal();
    return true;
  }

  if (requestedProductId) {
    fillProductForm(requestedProductId);
  }

  if (requestedAction === "add-stock") {
    resetProductForm();
    openStockModal();
  }

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
    if (!dispatchRecipientType || !dispatchProductSelect) return;

    const selectedProductId = dispatchProductSelect.value;
    dispatchProductSelect.innerHTML = renderDispatchProductOptions(
      store.getState(),
      dispatchRecipientType.value,
      selectedProductId
    );
  }

  updateDispatchRecipientOptions();
  updateDispatchProductOptions();
  dispatchRecipientType?.addEventListener("change", () => {
    updateDispatchRecipientOptions();
    updateDispatchProductOptions();
  });
  dispatchRecipientSelect?.addEventListener("change", updateOtherRecipientField);

  dispatchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const state = store.getState();
    const formData = new FormData(dispatchForm);
    const productId = String(formData.get("productId") || "");
    const quantity = Number(formData.get("quantity") || 0);
    const product = state.products.find((item) => item.id === productId);
    const recipientChoice = String(formData.get("recipientNameChoice") || "").trim();
    const otherRecipient = String(formData.get("recipientNameOther") || "").trim();
    const recipientName = recipientChoice === "__other__" ? otherRecipient : recipientChoice;
    const message = qs("#stock-dispatch-message", root);

    if (message) message.textContent = "";

    if (!product || !quantity || quantity <= 0 || !recipientName || !formData.get("destination")) {
      if (message) message.textContent = "Choose an item, quantity, recipient, and destination.";
      return;
    }

    if (quantity > Number(product.stock || 0)) {
      if (message) message.textContent = `Only ${formatNumber(product.stock)} available.`;
      return;
    }

    if (
      String(formData.get("recipientType") || "").toLowerCase().includes("representative") &&
      stockCategoryIdForProduct(product) !== FINISHED_PRODUCTS_CATEGORY
    ) {
      if (message) message.textContent = "Only finished products can be assigned to a sales representative.";
      return;
    }

    store.dispatch({
      type: "RECORD_STOCK_DISPATCH",
      productId,
      quantity,
      recipientType: formData.get("recipientType"),
      recipientName,
      destination: formData.get("destination"),
      dispatchDate: formData.get("dispatchDate"),
      staffName: formData.get("staffName"),
      message: "Factory dispatch recorded"
    });

    dispatchForm.reset();
    dispatchForm.elements.dispatchDate.value = todayISO();
    dispatchForm.elements.staffName.value = currentStaffName(store.getState());
    updateDispatchRecipientOptions();
    updateDispatchProductOptions();
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

  qsa(".js-flag-assignment", root).forEach((button) => {
    button.addEventListener("click", () => {
      const noteInput = qs(`[data-variance-note="${button.dataset.assignmentId}"]`, root);
      store.dispatch({
        type: "FLAG_ASSIGNMENT_VARIANCE",
        assignmentId: button.dataset.assignmentId,
        note: noteInput?.value || "Variance needs explanation",
        message: "Variance flagged"
      });
    });
  });

  qsa(".js-reconcile-assignment", root).forEach((button) => {
    button.addEventListener("click", () => {
      store.dispatch({
        type: "RECONCILE_ASSIGNMENT",
        assignmentId: button.dataset.assignmentId,
        message: "Assignment reconciled"
      });
    });
  });
}
