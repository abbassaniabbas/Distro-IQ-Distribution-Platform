export const ROLE_OPTIONS = [
  {
    value: "sales_rep",
    label: "Sales Rep",
    description: "Own assigned stock, sales, returns, credit balance, and reports"
  },
  {
    value: "manager",
    label: "Manager",
    description: "Products, rep stock assignment, reconciliation, credit limits, supermarkets, and reports"
  },
  {
    value: "store_keeper",
    label: "Store Keeper",
    description: "Raw materials, finished goods, equipment, stock movement, and dispatch"
  },
  {
    value: "accountant",
    label: "Accountant",
    description: "Read-only sales reports, credit balances, revenue, profit, and exports"
  },
  {
    value: "ceo",
    label: "CEO",
    description: "Read-only company-wide dashboard across sales, stock, reps, supermarkets, and reports"
  }
];

const LEGACY_ROLE_MAP = {
  owner: "manager",
  admin: "manager",
  operations: "store_keeper",
  finance: "accountant",
  viewer: "ceo",
  super_admin: "manager"
};

const ROLE_PERMISSIONS = {
  sales_rep: {
    nav: ["dashboard", "orders", "inventory", "retailers", "finance", "settings"],
    canViewCompanyWide: false,
    canLogSalesReturns: true,
    canManageProducts: false,
    canAssignStock: false,
    canReconcileStock: false,
    canSetCreditLimits: false,
    canManageCustomers: false,
    canReviewReports: false,
    canManageStockMovements: false,
    canDispatchStock: false,
    canViewFinancialReports: false,
    canExportReports: false,
    canManageUsers: false,
    canConfigureFactory: false,
    canAuditRecords: false
  },
  manager: {
    nav: ["dashboard", "orders", "inventory", "routes", "retailers", "team", "finance", "activity-log", "settings"],
    canViewCompanyWide: true,
    canLogSalesReturns: true,
    canManageProducts: true,
    canAssignStock: true,
    canReconcileStock: true,
    canSetCreditLimits: true,
    canManageCustomers: true,
    canReviewReports: true,
    canManageStockMovements: false,
    canDispatchStock: false,
    canViewFinancialReports: true,
    canExportReports: true,
    canManageUsers: true,
    canConfigureFactory: true,
    canAuditRecords: true
  },
  store_keeper: {
    nav: ["dashboard", "inventory", "routes", "activity-log", "settings"],
    canViewCompanyWide: true,
    canLogSalesReturns: false,
    canManageProducts: false,
    canAssignStock: true,
    canReconcileStock: true,
    canSetCreditLimits: false,
    canManageCustomers: false,
    canReviewReports: false,
    canManageStockMovements: true,
    canDispatchStock: true,
    canViewFinancialReports: false,
    canExportReports: false,
    canManageUsers: false,
    canConfigureFactory: false,
    canAuditRecords: false
  },
  accountant: {
    nav: ["dashboard", "orders", "retailers", "finance", "activity-log", "settings"],
    canViewCompanyWide: true,
    canLogSalesReturns: false,
    canManageProducts: false,
    canAssignStock: false,
    canReconcileStock: false,
    canSetCreditLimits: false,
    canManageCustomers: false,
    canReviewReports: true,
    canManageStockMovements: false,
    canDispatchStock: false,
    canViewFinancialReports: true,
    canExportReports: true,
    canManageUsers: false,
    canConfigureFactory: false,
    canAuditRecords: false
  },
  ceo: {
    nav: ["dashboard", "orders", "inventory", "routes", "retailers", "finance", "activity-log", "settings"],
    canViewCompanyWide: true,
    canLogSalesReturns: false,
    canManageProducts: false,
    canAssignStock: false,
    canReconcileStock: false,
    canSetCreditLimits: false,
    canManageCustomers: false,
    canReviewReports: true,
    canManageStockMovements: false,
    canDispatchStock: false,
    canViewFinancialReports: true,
    canExportReports: true,
    canManageUsers: false,
    canConfigureFactory: false,
    canAuditRecords: true
  }
};

export function normalizeRole(role) {
  return LEGACY_ROLE_MAP[role] || role || "sales_rep";
}

export function roleLabel(role) {
  const normalizedRole = normalizeRole(role);
  return ROLE_OPTIONS.find((item) => item.value === normalizedRole)?.label || "Sales Rep";
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
  return normalizeRole(accountForUser(state)?.role || state.user?.user_metadata?.role || "sales_rep");
}

export function currentUserPermissions(state) {
  return getRolePermissions(currentUserRole(state));
}

export function canAccessRoute(state, routeId) {
  const setupRoutes = ["loading", "backend-setup", "login", "signup", "onboarding", "onboarding-confirmation", "reset-password", "platform-admin"];

  if (setupRoutes.includes(routeId)) return true;
  if (routeId === "platform-console") return Boolean(state.platformAdmin);
  if (!state.session || !state.client?.id) return true;

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
  const assignedRoutes = (state.routes || []).filter((route) => {
    const repName = String(route.driver || "").trim().toLowerCase();
    return route.repUserId === userId || (actorName && repName === actorName);
  });
  const assignedOrderIds = new Set(assignedRoutes.flatMap((route) => route.orderIds || []));
  const orders = (state.orders || []).filter((order) => assignedOrderIds.has(order.id) || order.repUserId === userId);
  const customerIds = new Set(orders.map((order) => order.retailerId));
  const productIds = new Set(orders.flatMap((order) => (order.items || []).map((item) => item.productId)));

  return {
    ...state,
    products: (state.products || []).filter((product) => productIds.has(product.id) || product.assignedRepUserId === userId),
    retailers: (state.retailers || []).filter((retailer) => customerIds.has(retailer.id) || retailer.assignedRepUserId === userId),
    orders,
    routes: assignedRoutes,
    invoices: (state.invoices || []).filter((invoice) => customerIds.has(invoice.retailerId) || invoice.repUserId === userId),
    stockAssignments: (state.stockAssignments || []).filter((assignment) => {
      const repName = String(assignment.repName || "").trim().toLowerCase();
      return assignment.repUserId === userId || (actorName && repName === actorName);
    }),
    stockTransactions: (state.stockTransactions || []).filter((transaction) => {
      const partyName = String(transaction.partyName || "").trim().toLowerCase();
      const recordedBy = String(transaction.recordedBy || "").trim().toLowerCase();
      return transaction.repUserId === userId || (actorName && (partyName === actorName || recordedBy === actorName));
    }),
    creditLimits: (state.creditLimits || []).filter((limit) => {
      const partyName = String(limit.partyName || "").trim().toLowerCase();
      return limit.repUserId === userId || (actorName && partyName === actorName);
    })
  };
}
