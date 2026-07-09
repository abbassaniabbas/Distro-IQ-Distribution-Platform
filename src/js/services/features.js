import { stockCategoryIdForProduct } from "./calculations.js";

export const FEATURE_MODULES = [
  "raw_materials",
  "finished_products",
  "equipment_tracking",
  "credit_control",
  "delivery_notes",
  "field_reports"
];

const STOCK_MODULE_BY_CATEGORY = {
  raw_materials: "raw_materials",
  finished_products: "finished_products",
  equipment: "equipment_tracking"
};

export function isModuleEnabled(state, moduleKey) {
  if (!state?.client?.id) return true;

  const module = (state.featureModules || []).find((item) => (
    item.clientId === state.client.id && item.moduleKey === moduleKey
  ));

  return module ? module.enabled !== false : true;
}

export function enabledStockCategoryIds(state) {
  return Object.entries(STOCK_MODULE_BY_CATEGORY)
    .filter(([, moduleKey]) => isModuleEnabled(state, moduleKey))
    .map(([categoryId]) => categoryId);
}

export function isClientRouteEnabled(state, routeId) {
  if (!state?.session || !state?.client?.id) return true;

  if (routeId === "inventory") return enabledStockCategoryIds(state).length > 0;

  return true;
}

export function scopeStateForEnabledModules(state) {
  if (!state?.client?.id) return state;

  const enabledCategories = new Set(enabledStockCategoryIds(state));
  const products = (state.products || []).filter((product) => (
    enabledCategories.has(stockCategoryIdForProduct(product))
  ));
  const productIds = new Set(products.map((product) => product.id));
  const creditEnabled = isModuleEnabled(state, "credit_control");
  const reportsEnabled = isModuleEnabled(state, "field_reports");

  return {
    ...state,
    stockCategories: (state.stockCategories || []).filter((category) => enabledCategories.has(category.id)),
    products,
    stockAssignments: (state.stockAssignments || []).filter((assignment) => productIds.has(assignment.productId)),
    stockTransactions: (state.stockTransactions || []).filter((transaction) => productIds.has(transaction.productId)),
    orders: (state.orders || []).map((order) => ({
      ...order,
      items: (order.items || []).filter((item) => productIds.has(item.productId))
    })).filter((order) => order.items.length > 0),
    creditLimits: creditEnabled ? state.creditLimits : [],
    invoices: creditEnabled ? state.invoices : [],
    salesReports: reportsEnabled ? state.salesReports : []
  };
}
