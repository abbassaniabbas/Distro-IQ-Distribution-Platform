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
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  statusText
} from "../services/formatters.js";
import { currentUserPermissions } from "../services/rbac.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { metricCard, panelHeader, progressBar, statusPill, table, textButton } from "../ui/components.js";

const DEFAULT_STOCK_TAB = "factory-health";

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
      id: "factory-health",
      label: "Factory stock health"
    },
    {
      id: "raw-materials",
      label: "Raw materials"
    },
    {
      id: "finished-goods",
      label: "Finished goods"
    },
    {
      id: "equipment",
      label: "Equipment"
    },
    ...(permissions.canManageProducts
      ? [{
          id: "add-stock",
          label: "Add/update stock"
        }]
      : []),
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
      id: "categories",
      label: "Categories"
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

  return tabs.some((tab) => tab.id === requestedTab) ? requestedTab : tabs[0].id;
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

function renderCategoryRows(state) {
  return state.stockCategories.map((category) => {
    const products = state.products.filter((product) => (
      stockCategoryIdForProduct(product) === category.id
    ));
    const units = products.reduce((total, product) => total + Number(product.stock || 0), 0);
    const searchIndex = [
      category.name,
      category.timeframe,
      category.behavior
    ].join(" ").toLowerCase();

    return `
      <tr data-search-index="${escapeHtml(searchIndex)}">
        <td>
          <strong>${escapeHtml(category.name)}</strong>
          <div class="muted">${formatNumber(units)} units across ${formatNumber(products.length)} item${products.length === 1 ? "" : "s"}</div>
        </td>
        <td>${escapeHtml(category.timeframe)}</td>
        <td>${escapeHtml(category.behavior)}</td>
      </tr>
    `;
  });
}

function stockCategoryLabel(stockCategory) {
  const labels = {
    raw_materials: "Raw Materials",
    finished_products: "Finished Products",
    equipment: "Equipment"
  };

  return labels[stockCategory] || "Finished Products";
}

function productUnit(product) {
  return product.unit || (stockCategoryIdForProduct(product) === "raw_materials" ? "kg" : "unit");
}

function renderProductImage(product) {
  if (product.imageUrl) {
    return `<img src="${escapeHtml(product.imageUrl)}" alt="">`;
  }

  return `<span>${escapeHtml(product.name.slice(0, 2).toUpperCase())}</span>`;
}

function renderManagerProductPanel(state, permissions) {
  if (!permissions.canManageProducts) return "";

  return `
    <section class="panel manager-tool-panel">
      ${panelHeader("Add or update stock", "Create products, update factory stock, pricing, and product images")}
      <form id="manager-product-form" class="manager-form-grid" novalidate>
        <input type="hidden" name="productId">
        <label class="field">
          <span>Product name</span>
          <input name="name" placeholder="Plantain Chips 50g" required>
        </label>
        <label class="field">
          <span>SKU</span>
          <input name="sku" placeholder="SKU-1008">
        </label>
        <label class="field">
          <span>Category</span>
          <select name="stockCategory">
            ${state.stockCategories.map((category) => `
              <option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>
            `).join("")}
          </select>
        </label>
        <label class="field">
          <span>Unit</span>
          <input name="unit" placeholder="pack, carton, kg">
        </label>
        <label class="field">
          <span>Factory stock</span>
          <input name="stock" type="number" min="0" step="1" inputmode="numeric" placeholder="0">
        </label>
        <label class="field">
          <span>Reorder point</span>
          <input name="reorderPoint" type="number" min="0" step="1" inputmode="numeric" placeholder="0">
        </label>
        <label class="field">
          <span>Cost price</span>
          <input name="unitCost" type="number" min="0" step="1" inputmode="numeric" placeholder="0">
        </label>
        <label class="field">
          <span>Selling price</span>
          <input name="unitPrice" type="number" min="0" step="1" inputmode="numeric" placeholder="0">
        </label>
        <label class="field span-full">
          <span>Image URL</span>
          <input name="imageUrl" type="url" placeholder="https://...">
        </label>
        <div class="manager-form-actions span-full">
          ${textButton({
            iconName: "check",
            label: "Save product",
            className: "primary",
            type: "submit"
          })}
          ${textButton({
            iconName: "refresh",
            label: "Clear",
            className: "js-clear-product-form"
          })}
        </div>
      </form>
    </section>
  `;
}

function managerRepOptions(state) {
  const names = new Set([
    ...(state.accounts || []).filter((account) => account.role === "sales_rep").map((account) => account.name),
    ...(state.routes || []).map((route) => route.driver),
    ...(state.stockAssignments || []).map((assignment) => assignment.repName)
  ].filter(Boolean));

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
                label: "Edit",
                className: "js-edit-product",
                data: { "product-id": product.id }
              })
            : ""}
          ${canManageProducts
            ? textButton({
                iconName: product.status === "inactive" ? "check" : "x",
                label: product.status === "inactive" ? "Reactivate" : "Deactivate",
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

function stockCategoryTitle(categoryId) {
  return {
    raw_materials: "Raw materials",
    finished_products: "Finished goods",
    equipment: "Equipment"
  }[categoryId] || "Factory stock";
}

function stockCategorySubtitle(categoryId) {
  return {
    raw_materials: "Production inputs, packaging, and consumables held inside the factory",
    finished_products: "Produced snacks ready for representatives, supermarkets, or customer dispatch",
    equipment: "Owned, assigned, or saleable equipment tracked by status"
  }[categoryId] || "Current factory stock levels";
}

function stockCategoryTone(product) {
  const health = getStockHealth(product);
  if (health.status === "low") return "danger";
  if (health.status === "partial") return "warning";
  return "good";
}

function renderCategoryStockPage(state, permissions, categoryId) {
  const products = state.products.filter((product) => stockCategoryIdForProduct(product) === categoryId);
  const lowCount = products.filter((product) => getStockHealth(product).status !== "ready").length;
  const totalUnits = products.reduce((total, product) => total + Number(product.stock || 0), 0);

  return `
    <div class="metric-grid stock-category-metrics">
      ${metricCard({
        label: "Items",
        value: formatNumber(products.length),
        meta: `${formatNumber(totalUnits)} units in stock`,
        iconName: "package"
      })}
      ${metricCard({
        label: "Low stock",
        value: formatNumber(lowCount),
        meta: lowCount ? "Needs attention" : "All clear",
        iconName: "alert"
      })}
    </div>
    <section class="panel inventory-layout">
      ${panelHeader(stockCategoryTitle(categoryId), stockCategorySubtitle(categoryId))}
      ${products.length
        ? `<div class="product-grid">${products.map((product) => renderProductCard(product, permissions)).join("")}</div>`
        : '<div class="empty-state">No items in this stock section yet</div>'}
    </section>
  `;
}

function recipientOptions(state) {
  const representatives = new Set([
    ...(state.accounts || []).filter((account) => account.role === "sales_rep").map((account) => account.name),
    ...(state.routes || []).map((route) => route.driver),
    ...(state.stockAssignments || []).map((assignment) => assignment.repName)
  ].filter(Boolean));

  return [
    ...[...representatives].sort().map((name) => ({ type: "Sales Representative", name })),
    ...(state.retailers || []).map((retailer) => ({ type: "Supermarket", name: retailer.name })),
    { type: "Internal Location", name: "Production Line" },
    { type: "Internal Location", name: "Packaging Store" }
  ];
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
          <input name="recipientName" list="dispatch-recipient-list" placeholder="Name or outlet" required>
          <datalist id="dispatch-recipient-list">
            ${recipientOptions(state).map((option) => `<option value="${escapeHtml(option.name)}">${escapeHtml(option.type)}</option>`).join("")}
          </datalist>
        </label>
        <label class="field">
          <span>Destination</span>
          <input name="destination" placeholder="Van, supermarket, production line" required>
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

function renderFactoryStockHealthPage(state, permissions, categories) {
  return `
    <section class="panel inventory-layout">
      <div class="toolbar">
        ${panelHeader("Factory stock health", "Raw materials, finished snacks, equipment, cover days, and replenishment risk")}
        <div class="toolbar-group">
          <label class="field">
            <span class="sr-only">Filter by category</span>
            <select id="inventory-category-filter">
              <option value="all">All categories</option>
              ${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}
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

function renderAddStockPage(state, permissions) {
  if (!permissions.canManageProducts) {
    return `
      <section class="panel inventory-layout">
        ${panelHeader("Add/update stock", "This stock page is not available for your role")}
        <p>Use the stock health view to monitor products assigned to your role.</p>
      </section>
    `;
  }

  return `
    ${renderManagerProductPanel(state, permissions)}
    <section class="panel inventory-layout">
      ${panelHeader("Product catalogue", "Pick a product to edit its stock, pricing, image, or status")}
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

function renderCategoriesPage(state) {
  return `
    <section class="panel inventory-layout">
      ${panelHeader("Stock categories", "Raw materials, finished products, and equipment behave differently")}
      ${table(
        ["Category", "Timeframe", "Operational behaviour"],
        renderCategoryRows(state),
        "No stock categories configured"
      )}
    </section>
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

function renderStockTabPage({ activeTabId, state, permissions, categories, vision }) {
  if (activeTabId === "add-stock") return renderAddStockPage(state, permissions);
  if (activeTabId === "raw-materials") return renderCategoryStockPage(state, permissions, "raw_materials");
  if (activeTabId === "finished-goods") return renderCategoryStockPage(state, permissions, "finished_products");
  if (activeTabId === "equipment") return renderCategoryStockPage(state, permissions, "equipment");
  if (activeTabId === "dispatch") return renderDispatchPage(state, permissions);
  if (activeTabId === "overview") return renderOverviewPage(state, vision);
  if (activeTabId === "categories") return renderCategoriesPage(state);
  if (activeTabId === "assignments") return renderAssignmentsPage(state, permissions);
  if (activeTabId === "movement-history") return renderTransactionsPage(state);
  if (activeTabId === "credit") return renderCreditPage(state);

  return renderFactoryStockHealthPage(state, permissions, categories);
}

export function renderInventory({ state }) {
  const categories = [...new Set(state.products.map((product) => product.category))].sort();
  const permissions = currentUserPermissions(state);
  const vision = calculateVisionMetrics(state);
  const activeTabId = activeStockTabId(permissions);

  return `
    <section class="view inventory-view">
      ${renderStockSubtabs(activeTabId, permissions)}
      ${renderStockTabPage({ activeTabId, state, permissions, categories, vision })}
    </section>
  `;
}

export function bindInventory({ root, store }) {
  const categoryFilter = qs("#inventory-category-filter", root);
  const productForm = qs("#manager-product-form", root);
  const assignmentForm = qs("#manager-assignment-form", root);
  const dispatchForm = qs("#stock-dispatch-form", root);
  const requestedProductId = inventoryRouteParams().get("product");

  categoryFilter?.addEventListener("change", () => {
    qsa(".product-card", root).forEach((card) => {
      card.hidden = categoryFilter.value !== "all" && card.dataset.category !== categoryFilter.value;
    });
  });

  productForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(productForm);
    const sku = String(formData.get("sku") || "").trim();
    const productId = String(formData.get("productId") || sku).trim();

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
      imageUrl: formData.get("imageUrl"),
      message: productId ? "Product saved" : "Product created"
    });
  });

  qs(".js-clear-product-form", root)?.addEventListener("click", () => {
    productForm?.reset();
    if (productForm?.elements.productId) productForm.elements.productId.value = "";
  });

  function fillProductForm(productId) {
    const product = store.getState().products.find((item) => item.id === productId);
    if (!productForm || !product) return false;

    productForm.elements.productId.value = product.id;
    productForm.elements.sku.value = product.id;
    productForm.elements.name.value = product.name || "";
    productForm.elements.stockCategory.value = stockCategoryIdForProduct(product);
    productForm.elements.unit.value = productUnit(product);
    productForm.elements.stock.value = product.stock || 0;
    productForm.elements.reorderPoint.value = product.reorderPoint || 0;
    productForm.elements.unitCost.value = product.unitCost || 0;
    productForm.elements.unitPrice.value = product.unitPrice || 0;
    productForm.elements.imageUrl.value = product.imageUrl || "";
    productForm.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }

  if (requestedProductId) {
    fillProductForm(requestedProductId);
  }

  qsa(".js-edit-product", root).forEach((button) => {
    button.addEventListener("click", () => {
      if (fillProductForm(button.dataset.productId)) return;

      window.location.hash = `#/inventory?tab=add-stock&product=${encodeURIComponent(button.dataset.productId || "")}`;
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

  dispatchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const state = store.getState();
    const formData = new FormData(dispatchForm);
    const productId = String(formData.get("productId") || "");
    const quantity = Number(formData.get("quantity") || 0);
    const product = state.products.find((item) => item.id === productId);
    const message = qs("#stock-dispatch-message", root);

    if (message) message.textContent = "";

    if (!product || !quantity || quantity <= 0 || !formData.get("recipientName") || !formData.get("destination")) {
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
      recipientName: formData.get("recipientName"),
      destination: formData.get("destination"),
      dispatchDate: formData.get("dispatchDate"),
      staffName: formData.get("staffName"),
      message: "Factory dispatch recorded"
    });

    dispatchForm.reset();
    dispatchForm.elements.dispatchDate.value = todayISO();
    dispatchForm.elements.staffName.value = currentStaffName(store.getState());
  });

  qsa(".js-restock-product", root).forEach((button) => {
    button.addEventListener("click", () => {
      store.dispatch({
        type: "RESTOCK_PRODUCT",
        productId: button.dataset.productId,
        message: "Snack stock replenished"
      });
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
