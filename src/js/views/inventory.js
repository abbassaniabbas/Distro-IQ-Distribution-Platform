import {
  assignmentOutstanding,
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
import { LOGO_ACCEPT, LOGO_HELP_TEXT, readLogoFile, validateLogoFile } from "../services/branding.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { metricCard, panelHeader, progressBar, statusPill, table, textButton } from "../ui/components.js";
import { icon } from "../ui/icons.js";

const DEFAULT_STOCK_TAB = "stock-health";

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

function stockTabsForPermissions(permissions) {
  return [
    {
      id: "stock-health",
      label: "Stock health"
    },
    ...(permissions.canDispatchStock || permissions.canManageStockMovements
      ? [{
          id: "dispatch",
          label: "Dispatch"
        }]
      : []),
    {
      id: "overview",
      label: "Lifecycle"
    },
    {
      id: "assignments",
      label: "Assignments"
    },
    {
      id: "movement-history",
      label: "Movement history"
    },
    {
      id: "credit",
      label: "Credit limits"
    }
  ];
}

function activeStockTabId(permissions) {
  const tabs = stockTabsForPermissions(permissions);
  const requestedTab = inventoryRouteParams().get("tab") || DEFAULT_STOCK_TAB;
  const normalizedTab = ["factory-health", "add-stock", "raw-materials", "finished-goods", "equipment", "categories"]
    .includes(requestedTab)
    ? DEFAULT_STOCK_TAB
    : requestedTab;

  return tabs.some((tab) => tab.id === normalizedTab) ? normalizedTab : tabs[0].id;
}

function renderStockSubtabs(activeTabId, permissions) {
  return `
    <nav class="subtab-nav stock-subtabs" aria-label="Stock pages">
      ${stockTabsForPermissions(permissions).map((tab) => `
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

function managerRepOptions(state) {
  const accountNames = salesRepresentativeNames(state);

  if (accountNames.length) {
    return accountNames;
  }

  const names = new Set((state.stockAssignments || []).map((assignment) => assignment.repName).filter(Boolean));

  return [...names].sort();
}

function renderAssignmentConsole(state, permissions) {
  if (!permissions.canAssignStock) return "";

  const reps = managerRepOptions(state);
  const assignableProducts = state.products.filter((product) => (
    product.status !== "inactive" && stockCategoryIdForProduct(product) === "finished_products"
  ));

  return `
    <section class="panel manager-tool-panel">
      ${panelHeader("Stock assignment", "Load finished stock onto a representative and reconcile variances")}
      <form id="manager-assignment-form" class="manager-form-grid" novalidate>
        <label class="field">
          <span>Sales representative</span>
          <select name="repName" required>
            <option value="">Choose representative</option>
            ${reps.map((rep) => `<option value="${escapeHtml(rep)}">${escapeHtml(rep)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Representative run</span>
          <select name="routeId">
            <option value="">No run selected</option>
            ${state.routes.map((route) => `<option value="${escapeHtml(route.id)}">${escapeHtml(route.name)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Product</span>
          <select name="productId" required>
            <option value="">Choose product</option>
            ${assignableProducts.map((product) => `
              <option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} (${formatNumber(product.stock)} ${escapeHtml(productUnit(product))})</option>
            `).join("")}
          </select>
        </label>
        <label class="field">
          <span>Quantity</span>
          <input name="quantity" type="number" min="1" step="1" inputmode="numeric" placeholder="0" required>
        </label>
        <div class="manager-form-actions span-full">
          ${textButton({
            iconName: "truck",
            label: "Load stock",
            className: "primary",
            type: "submit"
          })}
        </div>
        <span id="assignment-form-message" class="field-error span-full"></span>
      </form>
    </section>
  `;
}

function renderProductCard(product, permissions) {
  const health = getStockHealth(product);
  const canRestock = permissions.canManageProducts || permissions.canManageStockMovements || permissions.canReconcileStock;
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
            : textButton({
                iconName: "plus",
                label: "Restock",
                className: "primary js-restock-product",
                disabled: !canRestock,
                data: { "product-id": product.id }
              })}
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

function otherRecipientPlaceholder(recipientType) {
  const normalizedType = String(recipientType || "").toLowerCase();

  if (normalizedType.includes("supermarket")) return "Type customer or supermarket name";
  if (normalizedType.includes("internal")) return "Type internal location";
  return "Type recipient name";
}

function destinationPlaceholder(recipientType) {
  const normalizedType = String(recipientType || "").toLowerCase();

  if (normalizedType.includes("representative")) return "Van number, route, or run";
  if (normalizedType.includes("supermarket")) return "Outlet branch, city, or delivery address";
  if (normalizedType.includes("internal")) return "Store room, production line, or equipment bay";
  return "Where the stock is going";
}

function renderDispatchForm(state, permissions) {
  if (!permissions.canDispatchStock && !permissions.canManageStockMovements) return "";

  const dispatchableProducts = state.products.filter((product) => (
    product.status !== "inactive" && Number(product.stock || 0) > 0
  ));

  return `
    <section class="panel manager-tool-panel">
      ${panelHeader("Record factory dispatch", "Log stock leaving the factory for a representative, supermarket, or internal destination")}
      <form id="stock-dispatch-form" class="manager-form-grid" novalidate>
        <label class="field">
          <span>Item</span>
          <select name="productId" required>
            <option value="">Choose stock item</option>
            ${dispatchableProducts.map((product) => `
              <option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} (${formatNumber(product.stock)} ${escapeHtml(productUnit(product))})</option>
            `).join("")}
          </select>
        </label>
        <label class="field">
          <span>Quantity</span>
          <input name="quantity" type="number" min="1" step="1" inputmode="numeric" placeholder="0" required>
        </label>
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

  return dispatchTransactions(state).map((transaction) => {
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
      <tr data-search-index="${escapeHtml(searchIndex)}">
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

function renderAssignmentRows(state, permissions) {
  const productMap = getProductMap(state.products);

  return state.stockAssignments.map((assignment) => {
    const product = productMap.get(assignment.productId);
    const outstanding = assignmentOutstanding(assignment);
    const soldPercent = assignment.assigned ? (assignment.sold / assignment.assigned) * 100 : 0;
    const searchIndex = [
      assignment.id,
      assignment.repName,
      assignment.routeId,
      product?.name,
      assignment.status
    ].join(" ").toLowerCase();

    return `
      <tr data-search-index="${escapeHtml(searchIndex)}">
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
        <td><strong>${formatNumber(outstanding)}</strong></td>
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
                    outstanding > 0
                      ? `<input class="table-note-input" data-variance-note="${escapeHtml(assignment.id)}" placeholder="Variance note">`
                      : ""
                  }
                  ${textButton({
                    iconName: "alert",
                    label: "Flag",
                    className: "js-flag-assignment",
                    disabled: outstanding <= 0,
                    data: { "assignment-id": assignment.id }
                  })}
                  ${textButton({
                    iconName: "check",
                    label: assignment.varianceFlagged ? "Close" : "Reconcile",
                    className: "primary js-reconcile-assignment",
                    disabled: outstanding > 0 && !assignment.varianceFlagged,
                    data: { "assignment-id": assignment.id }
                  })}
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
        ${state.products.map((product) => renderProductCard(product, permissions)).join("")}
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
  return `
    ${renderAssignmentConsole(state, permissions)}
    <section class="panel inventory-layout">
      ${panelHeader("Representative stock assignments", "Assigned, sold, returned, and outstanding quantities by sales representative")}
      ${table(
        ["Assignment", "Representative", "Product", "Assigned", "Sold", "Returned", "Outstanding", "Status", ""],
        renderAssignmentRows(state, permissions),
        "No stock assignments recorded"
      )}
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
  const activeTabId = activeStockTabId(permissions);

  return `
    <section class="view inventory-view">
      ${renderStockSubtabs(activeTabId, permissions)}
      ${renderStockTabPage({ activeTabId, state, permissions, vision })}
      ${renderStockProductModal(state, permissions)}
      ${renderRestockModal(permissions)}
    </section>
  `;
}

export function bindInventory({ root, store }) {
  const categoryFilter = qs("#inventory-category-filter", root);
  const stockModal = qs("#stock-product-modal", root);
  const stockModalTitle = qs("#stock-product-modal-title", root);
  const restockModal = qs("#restock-modal", root);
  const restockForm = qs("#restock-form", root);
  const restockMessage = qs("#restock-form-message", root);
  const productForm = qs("#manager-product-form", root);
  const productMessage = qs("#manager-product-message", root);
  const stockImageUploadField = qs("#stock-image-upload-field", root);
  const stockImageInput = qs("#stock-image-input", root);
  const stockImageUploadTitle = qs("#stock-image-upload-title", root);
  const stockImageFileName = qs("#stock-image-file-name", root);
  const clearStockImageButton = qs("#clear-stock-image-file", root);
  const assignmentForm = qs("#manager-assignment-form", root);
  const dispatchForm = qs("#stock-dispatch-form", root);
  const dispatchRecipientType = dispatchForm ? qs('select[name="recipientType"]', dispatchForm) : null;
  const dispatchRecipientSelect = dispatchForm ? qs("[data-dispatch-recipient-select]", dispatchForm) : null;
  const dispatchOtherRecipient = dispatchForm ? qs("[data-dispatch-recipient-other]", dispatchForm) : null;
  const dispatchDestinationInput = dispatchForm ? qs('input[name="destination"]', dispatchForm) : null;
  const routeParams = inventoryRouteParams();
  const requestedProductId = routeParams.get("product");
  const requestedStockType = routeParams.get("type");
  const requestedAction = routeParams.get("action");
  let stockImageDataUrl = "";

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

    store.dispatch({
      type: "UPSERT_PRODUCT",
      productId,
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

  stockModal?.addEventListener("click", (event) => {
    if (event.target === stockModal) closeStockModal();
  });

  restockModal?.addEventListener("click", (event) => {
    if (event.target === restockModal) closeRestockModal();
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

  assignmentForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const state = store.getState();
    const formData = new FormData(assignmentForm);
    const productId = String(formData.get("productId") || "");
    const quantity = Number(formData.get("quantity") || 0);
    const product = state.products.find((item) => item.id === productId);
    const message = qs("#assignment-form-message", root);

    if (message) message.textContent = "";

    if (!product || !formData.get("repName") || !quantity || quantity <= 0) {
      if (message) message.textContent = "Choose a representative, product, and quantity.";
      return;
    }

    if (quantity > Number(product.stock || 0)) {
      if (message) message.textContent = `Only ${formatNumber(product.stock)} available.`;
      return;
    }

    store.dispatch({
      type: "LOAD_STOCK_ASSIGNMENT",
      repName: formData.get("repName"),
      routeId: formData.get("routeId"),
      productId,
      quantity,
      message: "Stock loaded to representative"
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

  updateDispatchRecipientOptions();
  dispatchRecipientType?.addEventListener("change", updateDispatchRecipientOptions);
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
  });

  qsa(".js-restock-product", root).forEach((button) => {
    button.addEventListener("click", () => {
      openRestockModal(button.dataset.productId);
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
