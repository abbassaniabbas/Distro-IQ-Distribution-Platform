import { isClientRouteEnabled } from "./features.js";

export const ROLE_OPTIONS = [
  {
    value: "sales_rep",
    label: "Sales Representative",
    description: "Own assigned stock, sales, returns, credit balance, and reports"
  },
  {
    value: "store_keeper",
    label: "Store Keeper",
    description: "Raw materials, finished products, equipment, stock movement, and dispatch"
  },
  {
    value: "admin",
    label: "Admin",
    description: "Sales documentation, representative stock requests, and Purchase Order coordination"
  },
  {
    value: "ceo",
    label: "CEO",
    description: "Full company leadership, sales operations, stock oversight, credit control, team access, and report review"
  }
];

const LEGACY_ROLE_MAP = {
  manager: "ceo",
  owner: "ceo",
  operations: "store_keeper",
  viewer: "ceo",
  super_admin: "ceo"
};

const ROLE_PERMISSIONS = {
  sales_rep: {
    nav: ["dashboard", "retailers", "invoices", "activity-log", "settings"],
    canViewCompanyWide: false,
    canLogSalesReturns: true,
    canManageProducts: false,
    canAddStock: false,
    canAssignStock: false,
    canReconcileStock: false,
    canSetCreditLimits: false,
    canAddCustomers: true,
    canManageCustomers: false,
    canReviewReports: false,
    canManageStockMovements: false,
    canDispatchStock: false,
    canViewFinancialReports: false,
    canExportReports: false,
    canManageUsers: false,
    canConfigureFactory: false,
    canAuditRecords: false,
    canRequestStock: true,
    canCoordinateStockRequests: false,
    canFulfillPurchaseOrders: false
  },
  store_keeper: {
    nav: ["dashboard", "purchase-orders", "inventory", "activity-log", "settings"],
    canViewCompanyWide: true,
    canLogSalesReturns: false,
    canManageProducts: false,
    canAddStock: true,
    canAssignStock: true,
    canReconcileStock: true,
    canSetCreditLimits: false,
    canAddCustomers: false,
    canManageCustomers: false,
    canReviewReports: false,
    canManageStockMovements: true,
    canDispatchStock: true,
    canViewFinancialReports: false,
    canExportReports: false,
    canManageUsers: false,
    canConfigureFactory: false,
    canAuditRecords: false,
    canRequestStock: false,
    canCoordinateStockRequests: false,
    canFulfillPurchaseOrders: true
  },
  admin: {
    nav: ["dashboard", "purchase-orders", "activity-log", "settings"],
    canViewCompanyWide: true,
    canLogSalesReturns: false,
    canManageProducts: false,
    canAddStock: false,
    canAssignStock: false,
    canReconcileStock: false,
    canSetCreditLimits: false,
    canAddCustomers: false,
    canManageCustomers: false,
    canReviewReports: false,
    canManageStockMovements: false,
    canDispatchStock: false,
    canViewFinancialReports: false,
    canExportReports: true,
    canManageUsers: false,
    canConfigureFactory: false,
    canAuditRecords: true,
    canRequestStock: false,
    canCoordinateStockRequests: true,
    canFulfillPurchaseOrders: false
  },
  ceo: {
    nav: ["dashboard", "orders", "purchase-orders", "inventory", "retailers", "team", "finance", "activity-log", "settings"],
    canViewCompanyWide: true,
    canLogSalesReturns: true,
    canManageProducts: true,
    canAddStock: true,
    canAssignStock: true,
    canReconcileStock: true,
    canSetCreditLimits: true,
    canAddCustomers: true,
    canManageCustomers: true,
    canReviewReports: true,
    canManageStockMovements: false,
    canDispatchStock: false,
    canViewFinancialReports: true,
    canExportReports: true,
    canManageUsers: true,
    canConfigureFactory: true,
    canAuditRecords: true,
    canRequestStock: false,
    canCoordinateStockRequests: false,
    canFulfillPurchaseOrders: false
  }
};

export function normalizeRole(role) {
  return LEGACY_ROLE_MAP[role] || role || "sales_rep";
}

export function roleLabel(role) {
  const normalizedRole = normalizeRole(role);
  return ROLE_OPTIONS.find((item) => item.value === normalizedRole)?.label || "Sales Representative";
}

export function salesRepresentativeAccounts(state) {
  return (state.accounts || []).filter((account) => normalizeRole(account.role) === "sales_rep");
}

export function salesRepresentativeNames(state) {
  return salesRepresentativeAccounts(state)
    .map((account) => String(account.name || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export function roleDescription(role) {
  const normalizedRole = normalizeRole(role);
  return ROLE_OPTIONS.find((item) => item.value === normalizedRole)?.description || "";
}

export function getRolePermissions(role) {
  return ROLE_PERMISSIONS[normalizeRole(role)] || ROLE_PERMISSIONS.sales_rep;
}

export function accountForUser(state) {
  return (state.accounts || []).find((account) => account.userId === state.user?.id) || null;
}

export function currentUserRole(state) {
  const account = accountForUser(state);

  if (
    !account ||
    String(account.status || "").toLowerCase() !== "active" ||
    account.passwordResetRequired
  ) {
    return "sales_rep";
  }

  const role = normalizeRole(account.role);
  return ROLE_OPTIONS.some((option) => option.value === role) ? role : "sales_rep";
}

export function currentUserPermissions(state) {
  return getRolePermissions(currentUserRole(state));
}

export function canAccessRoute(state, routeId) {
  const setupRoutes = ["loading", "backend-setup", "login", "signup", "onboarding", "onboarding-confirmation", "reset-password", "platform-admin"];

  if (setupRoutes.includes(routeId)) return true;
  if (routeId === "platform-console") return Boolean(state.platformAdmin);
  if (routeId === "messages") return Boolean(state.session && state.client?.id);
  if (!state.session || !state.client?.id) return true;
  if (!isClientRouteEnabled(state, routeId)) return false;

  return currentUserPermissions(state).nav.includes(routeId);
}

export function scopeStateForCurrentRole(state) {
  const role = currentUserRole(state);

  if (role !== "sales_rep" || !state.session || !state.client?.id) {
    return state;
  }

  const account = accountForUser(state);
  const actorName = String(account?.name || state.user?.user_metadata?.full_name || "").trim().toLowerCase();
  const userId = state.user?.id || "";
  const orders = (state.orders || []).filter((order) => {
    const repName = String(order.repName || "").trim().toLowerCase();
    return order.repUserId === userId || (actorName && repName === actorName);
  });
  const customerIds = new Set(orders.map((order) => order.retailerId));
  const activeProductIds = new Set((state.products || [])
    .filter((product) => product.status !== "inactive")
    .map((product) => product.id));
  const stockAssignments = (state.stockAssignments || []).filter((assignment) => {
    const repName = String(assignment.repName || "").trim().toLowerCase();
    const belongsToRepresentative = assignment.repUserId === userId || (actorName && repName === actorName);
    return belongsToRepresentative && activeProductIds.has(assignment.productId);
  });
  const assignedProductIds = new Set(stockAssignments.map((assignment) => assignment.productId));
  const productIds = new Set([
    ...orders.flatMap((order) => (order.items || []).map((item) => item.productId)),
    ...assignedProductIds
  ]);
  const retailers = (state.retailers || []).filter((retailer) => {
    const assignedRepUserId = String(retailer.assignedRepUserId || "");
    return customerIds.has(retailer.id) || assignedRepUserId === userId || !assignedRepUserId;
  });
  const visibleCustomerNames = new Set(retailers.map((retailer) => String(retailer.name || "").trim().toLowerCase()).filter(Boolean));

  return {
    ...state,
    products: (state.products || []).filter((product) => (
      productIds.has(product.id) ||
      product.assignedRepUserId === userId ||
      product.status !== "inactive"
    )),
    retailers,
    orders,
    routes: [],
    invoices: (state.invoices || []).filter((invoice) => {
      const invoiceRepName = String(invoice.repName || "").trim().toLowerCase();

      // A shared customer must never make another representative's invoice visible.
      // repName is retained only as a compatibility fallback for older invoices that
      // were saved before repUserId was recorded.
      if (invoice.repUserId) return invoice.repUserId === userId;
      return Boolean(actorName && invoiceRepName === actorName);
    }),
    stockAssignments,
    stockTransactions: (state.stockTransactions || []).filter((transaction) => {
      const partyName = String(transaction.partyName || "").trim().toLowerCase();
      const recordedBy = String(transaction.recordedBy || "").trim().toLowerCase();
      return transaction.repUserId === userId || (actorName && (partyName === actorName || recordedBy === actorName));
    }),
    creditLimits: (state.creditLimits || []).filter((limit) => {
      const partyName = String(limit.partyName || "").trim().toLowerCase();
      return limit.repUserId === userId || (actorName && partyName === actorName) || visibleCustomerNames.has(partyName);
    }),
    creditLimitHistory: (state.creditLimitHistory || []).filter((entry) => {
      const partyName = String(entry.partyName || "").trim().toLowerCase();
      return (actorName && partyName === actorName) || visibleCustomerNames.has(partyName);
    }),
    salesReports: (state.salesReports || []).filter((report) => {
      const repName = String(report.repName || "").trim().toLowerCase();
      return report.repUserId === userId || (actorName && repName === actorName);
    }),
    stockRequests: (state.stockRequests || []).filter((request) => {
      const repName = String(request.repName || "").trim().toLowerCase();
      return request.repUserId === userId || (actorName && repName === actorName);
    }),
    purchaseOrders: (state.purchaseOrders || []).filter((purchaseOrder) => {
      const repName = String(purchaseOrder.repName || "").trim().toLowerCase();
      return purchaseOrder.repUserId === userId || (actorName && repName === actorName);
    })
  };
}
