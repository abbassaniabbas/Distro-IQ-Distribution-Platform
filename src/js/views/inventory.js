import { getStockHealth } from "../services/calculations.js";
import { formatCurrency, formatNumber } from "../services/formatters.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { panelHeader, progressBar, statusPill, textButton } from "../ui/components.js";

function renderProductCard(product) {
  const health = getStockHealth(product);
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
        <strong>${formatCurrency(product.unitPrice)}</strong>
      </div>

      <footer>
        <span class="muted">${escapeHtml(product.category)}</span>
        ${textButton({
          iconName: "plus",
          label: "Restock",
          className: "primary js-restock-product",
          data: { "product-id": product.id }
        })}
      </footer>
    </article>
  `;
}

export function renderInventory({ state }) {
  const categories = [...new Set(state.products.map((product) => product.category))].sort();

  return `
    <section class="view inventory-view">
      <section class="panel inventory-layout">
        <div class="toolbar">
          ${panelHeader("Inventory health", "Stock position, cover days, and replenishment risk")}
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
          ${state.products.map(renderProductCard).join("")}
        </div>
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
        message: "Inventory replenished"
      });
    });
  });
}
