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
      body: `${formatNumber(totals.assignedStock)} units have been loaded to reps or sent directly to customers.`
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
        label: "Rep custody",
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

function renderProductCard(product, permissions) {
  const health = getStockHealth(product);
  const canRestock = permissions.canManageProducts || permissions.canManageStockMovements || permissions.canReconcileStock;
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
      class="product-card"
      data-category="${escapeHtml(product.category)}"
      data-search-index="${escapeHtml(searchIndex)}"
    >
      <header>
        <div>
          <span class="eyebrow">${escapeHtml(product.id)}</span>
          <h3>${escapeHtml(product.name)}</h3>
        </div>
        ${statusPill(health.status)}
      </header>

      <div class="stock-line">
        <div class="stock-meta">
          <span>${formatNumber(product.stock)} units</span>
          <span>${health.daysCover} days cover</span>
        </div>
        ${progressBar(health.percent, health.tone)}
      </div>

      <div class="split">
        <span class="muted">${escapeHtml(product.warehouse)}</span>
        <strong>${product.unitPrice ? formatCurrency(product.unitPrice) : "Factory use"}</strong>
      </div>

      <footer>
        <span class="muted">${escapeHtml(product.category)}</span>
        ${textButton({
          iconName: "plus",
          label: "Restock",
          className: "primary js-restock-product",
          disabled: !canRestock,
          data: { "product-id": product.id }
        })}
      </footer>
    </article>
  `;
}

function renderAssignmentRows(state) {
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
        <td>${statusPill(assignment.status)}</td>
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

export function renderInventory({ state }) {
  const categories = [...new Set(state.products.map((product) => product.category))].sort();
  const permissions = currentUserPermissions(state);
  const vision = calculateVisionMetrics(state);

  return `
    <section class="view inventory-view">
      ${renderCustodyMetrics(vision)}
      ${renderLifecycle(state)}

      <section class="panel inventory-layout">
        ${panelHeader("Stock categories", "Raw materials, finished products, and equipment behave differently")}
        ${table(
          ["Category", "Timeframe", "Operational behaviour"],
          renderCategoryRows(state),
          "No stock categories configured"
        )}
      </section>

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

      <section class="panel inventory-layout">
        ${panelHeader("Rep stock assignments", "Assigned, sold, returned, and outstanding quantities by sales rep")}
        ${table(
          ["Assignment", "Rep", "Product", "Assigned", "Sold", "Returned", "Outstanding", "Status"],
          renderAssignmentRows(state),
          "No stock assignments recorded"
        )}
      </section>

      <section class="panel inventory-layout">
        ${panelHeader("Transactions", "Sales, returns, supply, and internal stock movement records")}
        ${table(
          ["Transaction", "Type", "Product", "Amount", "Party", "Recorded by"],
          renderTransactionRows(state),
          "No stock transactions recorded"
        )}
      </section>

      <section class="panel inventory-layout">
        ${panelHeader("Credit limits", "Running balances against manager-approved limits")}
        ${table(
          ["Party", "Limit", "Balance usage", "Last change", "Changed by"],
          renderCreditRows(state),
          "No credit limits recorded"
        )}
      </section>
    </section>
  `;
}

export function bindInventory({ root, store }) {
  const categoryFilter = qs("#inventory-category-filter", root);

  categoryFilter.addEventListener("change", () => {
    qsa(".product-card", root).forEach((card) => {
      card.hidden = categoryFilter.value !== "all" && card.dataset.category !== categoryFilter.value;
    });
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
}
