export function getProductMap(products) {
  return new Map(products.map((product) => [product.id, product]));
}

export function getRetailerMap(retailers) {
  return new Map(retailers.map((retailer) => [retailer.id, retailer]));
}

export function assignmentOutstanding(assignment) {
  return Math.max(0, Number(assignment.assigned || 0) - Number(assignment.sold || 0) - Number(assignment.returned || 0));
}

export const REPRESENTATIVE_RETURN_GRACE_DAYS = 7;

export function isRepresentativeReturnEligible(assignment, referenceDate = new Date().toISOString().slice(0, 10)) {
  const assignedDate = String(assignment?.assignedAt || assignment?.updatedAt || "").slice(0, 10);
  const reference = String(referenceDate || "").slice(0, 10);

  if (!assignedDate || !reference) return false;

  const assignedAt = Date.parse(`${assignedDate}T00:00:00Z`);
  const checkedAt = Date.parse(`${reference}T00:00:00Z`);

  if (Number.isNaN(assignedAt) || Number.isNaN(checkedAt)) return false;

  const daysSinceAssignment = Math.floor((checkedAt - assignedAt) / 86400000);
  return daysSinceAssignment >= 0 && daysSinceAssignment < REPRESENTATIVE_RETURN_GRACE_DAYS;
}

export function stockCategoryIdForProduct(product) {
  const category = String(product.stockCategory || product.category || "").toLowerCase();

  if (category.includes("raw") || category.includes("packaging")) return "raw_materials";
  if (category.includes("equipment")) return "equipment";
  return "finished_products";
}

export function getOrderTotal(order, products) {
  const productMap = Array.isArray(products) ? getProductMap(products) : products;

  return (order.items || []).reduce((total, item) => {
    const product = productMap.get(item.productId);
    const unitPrice = Number(item.unitPrice ?? item.unitPriceAtSale ?? product?.unitPrice ?? 0);
    return total + unitPrice * Number(item.quantity || 0);
  }, 0);
}

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function marginPercent(revenue, profit) {
  return revenue ? (Number(profit || 0) / Number(revenue || 0)) * 100 : 0;
}

function getOrderRouteMap(routes = []) {
  const routeMap = new Map();

  routes.forEach((route) => {
    (route.orderIds || []).forEach((orderId) => {
      routeMap.set(orderId, route);
    });
  });

  return routeMap;
}

export function getFinancialSalesLines(state) {
  const productMap = getProductMap(state.products || []);
  const retailerMap = getRetailerMap(state.retailers || []);
  const routeMap = getOrderRouteMap(state.routes || []);
  const orderLines = (state.orders || [])
    .filter((order) => order.source !== "quick_sale")
    .flatMap((order) => {
      const route = routeMap.get(order.id);
      const retailer = retailerMap.get(order.retailerId);

      return (order.items || []).map((item) => {
        const product = productMap.get(item.productId);
        const quantity = Number(item.quantity || 0);
        const revenue = quantity * Number(item.unitPrice ?? item.unitPriceAtSale ?? product?.unitPrice ?? 0);
        const cost = quantity * Number(item.unitCost ?? item.unitCostAtSale ?? product?.unitCost ?? 0);
        const profit = revenue - cost;

        return {
          id: `${order.id}-${item.productId}`,
          recordId: order.id,
          source: "Sales order",
          date: dateOnly(order.createdAt || order.updatedAt || order.dueAt),
          productId: item.productId,
          productName: item.productName || product?.name || "Unknown product",
          repName: route?.driver || order.repName || "Unassigned",
          customerName: retailer?.name || order.customerName || "Unknown customer",
          quantity,
          revenue,
          cost,
          profit,
          margin: marginPercent(revenue, profit),
          status: order.status,
          paymentType: order.paymentType,
          cashAmount: String(order.paymentType || "").toLowerCase().includes("credit") ? 0 : revenue,
          creditAmount: String(order.paymentType || "").toLowerCase().includes("credit") ? revenue : 0,
          returnAmount: 0
        };
      });
    });
  const transactionLines = (state.stockTransactions || [])
    .filter((transaction) => {
      const type = String(transaction.type || "").toLowerCase();
      return type === "sale" || type === "return";
    })
    .map((transaction) => {
      const product = productMap.get(transaction.productId);
      const type = String(transaction.type || "").toLowerCase();
      const isReturn = type === "return";
      const quantity = Number(transaction.quantity || 0);
      const signedQuantity = isReturn ? -quantity : quantity;
      const grossAmount = Number(transaction.amount || quantity * Number(product?.unitPrice || 0));
      const revenue = isReturn ? -grossAmount : grossAmount;
      const cost = signedQuantity * Number(transaction.unitCost ?? transaction.unitCostAtSale ?? product?.unitCost ?? 0);
      const profit = revenue - cost;
      const paymentType = transaction.paymentType || (isReturn ? "return" : "cash");
      const isCredit = String(paymentType || "").toLowerCase().includes("credit");

      return {
        id: transaction.id,
        recordId: transaction.orderId || transaction.id,
        source: isReturn ? "Customer return" : "Rep quick sale",
        date: dateOnly(transaction.date || transaction.createdAt),
        productId: transaction.productId,
        productName: transaction.productName || product?.name || "Unknown product",
        repName: transaction.recordedBy || "Sales Representative",
        customerName: transaction.partyName || "Customer",
        quantity: signedQuantity,
        revenue,
        cost,
        profit,
        margin: marginPercent(revenue, profit),
        status: isReturn ? "returned" : "sold",
        paymentType,
        cashAmount: !isReturn && !isCredit ? grossAmount : 0,
        creditAmount: !isReturn && isCredit ? grossAmount : 0,
        returnAmount: isReturn ? grossAmount : 0
      };
    });

  return [...orderLines, ...transactionLines];
}

export function calculateMetrics(state) {
  const productMap = getProductMap(state.products);
  const orderRevenue = state.orders.reduce((total, order) => total + getOrderTotal(order, productMap), 0);
  const deliveredOrders = state.orders.filter((order) => order.status === "delivered").length;
  const openOrders = state.orders.filter((order) => order.status !== "delivered").length;
  const lowStockCount = state.products.filter((product) => getStockHealth(product).status === "low").length;
  const activeRoutes = state.routes.filter((route) => ["scheduled", "in_transit"].includes(route.status)).length;
  const receivables = state.invoices
    .filter((invoice) => invoice.status !== "paid")
    .reduce((total, invoice) => total + invoice.amount, 0);

  return {
    orderRevenue,
    openOrders,
    activeRoutes,
    lowStockCount,
    receivables,
    fillRate: state.orders.length ? (deliveredOrders / state.orders.length) * 100 : 0
  };
}

export function getCreditLimitForParty(creditLimits = [], partyName = "") {
  const normalizedPartyName = String(partyName || "").trim().toLowerCase();

  return (creditLimits || []).find((limit) => (
    String(limit.partyName || "").trim().toLowerCase() === normalizedPartyName
  )) || null;
}

export function getRepresentativeDailyCreditUsed(state = {}, repName = "", date = dateOnly(new Date().toISOString())) {
  const normalizedRepName = String(repName || "").trim().toLowerCase();
  const targetDate = dateOnly(date);

  if (!normalizedRepName || !targetDate) return 0;

  const total = (state.stockTransactions || []).reduce((sum, transaction) => {
    const type = String(transaction.type || "").toLowerCase();
    const paymentType = String(transaction.paymentType || "").toLowerCase();
    const transactionDate = dateOnly(transaction.date || transaction.createdAt);
    const recordedBy = String(transaction.recordedBy || "").trim().toLowerCase();

    if (recordedBy !== normalizedRepName || transactionDate !== targetDate || (type !== "sale" && type !== "return")) {
      return sum;
    }

    if (Number.isFinite(Number(transaction.creditImpact)) && Number(transaction.creditImpact || 0) !== 0) {
      return sum + Number(transaction.creditImpact || 0);
    }

    if (!paymentType.includes("credit")) return sum;

    const amount = Number(transaction.amount || 0);
    return sum + (type === "return" ? -amount : amount);
  }, 0);

  return Math.max(0, total);
}

function boundedScore(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

export function getCustomerRating(retailer, state = {}) {
  const orders = (state.orders || []).filter((order) => order.retailerId === retailer?.id);
  const invoices = (state.invoices || []).filter((invoice) => invoice.retailerId === retailer?.id);
  const creditLimit = getCreditLimitForParty(state.creditLimits || [], retailer?.name);
  const balance = Number(creditLimit?.balance ?? retailer?.outstanding ?? 0);
  const limit = Number(creditLimit?.limit || 0);
  const creditUsage = limit ? (balance / limit) * 100 : balance > 0 ? 100 : 0;
  const ordersCompletedScore = boundedScore(retailer?.fillRate ?? 0);
  const paidInvoices = invoices.filter((invoice) => String(invoice.status || "").toLowerCase() === "paid").length;
  const paymentScore = invoices.length ? (paidInvoices / invoices.length) * 100 : balance > 0 ? 100 - creditUsage : 70;
  const orderScore = boundedScore(orders.length * 15);

  if (!orders.length && !invoices.length && balance <= 0) {
    return {
      label: "New customer",
      status: "new_customer",
      score: 0,
      orderCount: 0,
      creditUsage
    };
  }

  const score = Math.round(
    ordersCompletedScore * 0.3 +
    boundedScore(paymentScore) * 0.3 +
    boundedScore(100 - creditUsage) * 0.25 +
    orderScore * 0.15
  );

  if (score >= 85) {
    return { label: "Excellent customer", status: "excellent_customer", score, orderCount: orders.length, creditUsage };
  }

  if (score >= 70) {
    return { label: "Good customer", status: "good_customer", score, orderCount: orders.length, creditUsage };
  }

  if (score >= 50) {
    return { label: "Needs attention", status: "needs_attention", score, orderCount: orders.length, creditUsage };
  }

  return { label: "High risk", status: "high_risk", score, orderCount: orders.length, creditUsage };
}

export function creditUsageTone(percent) {
  if (percent >= 100) return "danger";
  if (percent >= 85) return "warning";
  return "good";
}

export function getCreditGuardForOrder(order, state) {
  const productMap = getProductMap(state.products || []);
  const retailerMap = getRetailerMap(state.retailers || []);
  const retailer = retailerMap.get(order.retailerId) || {
    name: order.customerName || "",
    outstanding: 0
  };
  const limit = getCreditLimitForParty(state.creditLimits || [], retailer?.name);
  const orderTotal = getOrderTotal(order, productMap);
  const paymentType = String(order.paymentType || "credit").toLowerCase();
  const paymentStatus = String(order.paymentStatus || "").toLowerCase();
  const isCreditSale = paymentType.includes("credit") && paymentStatus !== "paid";
  const shouldProject = isCreditSale && order.status !== "delivered";
  const creditImpact = shouldProject ? orderTotal : 0;
  const currentBalance = Number(limit?.balance ?? retailer?.outstanding ?? 0);
  const limitAmount = Number(limit?.limit || 0);
  const projectedBalance = currentBalance + creditImpact;
  const usagePercent = limitAmount ? (projectedBalance / limitAmount) * 100 : 0;
  const availableCredit = limitAmount ? Math.max(0, limitAmount - projectedBalance) : 0;

  if (!isCreditSale) {
    return {
      status: "cash",
      label: "Cash / paid",
      tone: "good",
      orderTotal,
      currentBalance,
      projectedBalance: currentBalance,
      availableCredit: limitAmount ? Math.max(0, limitAmount - currentBalance) : 0,
      limitAmount,
      usagePercent: limitAmount ? (currentBalance / limitAmount) * 100 : 0
    };
  }

  if (!limitAmount) {
    return {
      status: "credit_hold",
      label: "No limit",
      tone: "danger",
      orderTotal,
      currentBalance,
      projectedBalance,
      availableCredit: 0,
      limitAmount,
      usagePercent: 100
    };
  }

  if (projectedBalance > limitAmount) {
    return {
      status: "credit_hold",
      label: "Credit hold",
      tone: "danger",
      orderTotal,
      currentBalance,
      projectedBalance,
      availableCredit,
      limitAmount,
      usagePercent
    };
  }

  if (usagePercent >= 85) {
    return {
      status: "credit_watch",
      label: "Limit watch",
      tone: "warning",
      orderTotal,
      currentBalance,
      projectedBalance,
      availableCredit,
      limitAmount,
      usagePercent
    };
  }

  return {
    status: "credit_clear",
    label: "Credit clear",
    tone: "good",
    orderTotal,
    currentBalance,
    projectedBalance,
    availableCredit,
    limitAmount,
    usagePercent
  };
}

export function calculateVisionMetrics(state) {
  const products = state.products || [];
  const assignments = state.stockAssignments || [];
  const transactions = state.stockTransactions || [];
  const orders = state.orders || [];
  const invoices = state.invoices || [];
  const creditLimits = state.creditLimits || [];
  const productMap = getProductMap(products);
  const retailerMap = getRetailerMap(state.retailers || []);
  const openAssignments = assignments.filter((assignment) => assignment.status !== "reconciled");
  const assignedUnits = openAssignments.reduce((total, assignment) => total + Number(assignment.assigned || 0), 0);
  const soldUnits = openAssignments.reduce((total, assignment) => total + Number(assignment.sold || 0), 0);
  const returnedUnits = openAssignments.reduce((total, assignment) => total + Number(assignment.returned || 0), 0);
  const repOutstandingUnits = openAssignments.reduce((total, assignment) => total + assignmentOutstanding(assignment), 0);
  const repOutstandingValue = openAssignments.reduce((total, assignment) => {
    const product = productMap.get(assignment.productId);
    return total + assignmentOutstanding(assignment) * Number(product?.unitPrice || product?.unitCost || 0);
  }, 0);
  const finishedStockUnits = products
    .filter((product) => stockCategoryIdForProduct(product) === "finished_products")
    .reduce((total, product) => total + Number(product.stock || 0), 0);
  const rawMaterialRiskCount = products.filter((product) => (
    stockCategoryIdForProduct(product) === "raw_materials" &&
    getStockHealth(product).status !== "ready"
  )).length;
  const finishedGoodsRiskCount = products.filter((product) => (
    stockCategoryIdForProduct(product) === "finished_products" &&
    getStockHealth(product).status !== "ready"
  )).length;
  const equipmentInStock = products
    .filter((product) => stockCategoryIdForProduct(product) === "equipment")
    .reduce((total, product) => total + Number(product.stock || 0), 0);
  const creditLimitTotal = creditLimits.reduce((total, limit) => total + Number(limit.limit || 0), 0);
  const creditBalanceTotal = creditLimits.reduce((total, limit) => total + Number(limit.balance || 0), 0);
  const creditExposurePercent = creditLimitTotal ? (creditBalanceTotal / creditLimitTotal) * 100 : 0;
  const creditHoldCount = creditLimits.filter((limit) => Number(limit.balance || 0) >= Number(limit.limit || 0)).length;
  const creditWatchCount = creditLimits.filter((limit) => {
    const percent = limit.limit ? (Number(limit.balance || 0) / Number(limit.limit || 0)) * 100 : 100;
    return percent >= 85 && percent < 100;
  }).length;
  const creditHoldOrders = orders.filter((order) => (
    String(order.paymentType || "").toLowerCase().includes("credit") &&
    String(order.paymentStatus || "").toLowerCase() !== "paid"
  )).length;
  const paidTotal = invoices
    .filter((invoice) => invoice.status === "paid")
    .reduce((total, invoice) => total + Number(invoice.amount || 0), 0);
  const invoiceTotal = invoices.reduce((total, invoice) => total + Number(invoice.amount || 0), 0);
  const receivables = invoices
    .filter((invoice) => invoice.status !== "paid")
    .reduce((total, invoice) => total + Number(invoice.amount || 0), 0);
  const paymentCoveragePercent = invoiceTotal ? (paidTotal / invoiceTotal) * 100 : 0;
  const traceChecks = [
    ...products.map((product) => Boolean(product.id && product.stockCategory && product.warehouse)),
    ...assignments.map((assignment) => Boolean(assignment.id && assignment.routeId && assignment.productId && assignment.repName && assignment.assignedAt)),
    ...transactions.map((transaction) => Boolean(transaction.id && transaction.type && transaction.productId && transaction.partyName && transaction.recordedBy && transaction.date)),
    ...orders.map((order) => Boolean(order.id && retailerMap.has(order.retailerId) && (order.items || []).every((item) => productMap.has(item.productId)))),
    ...invoices.map((invoice) => Boolean(invoice.id && retailerMap.has(invoice.retailerId) && invoice.amount && invoice.dueAt))
  ];
  const traceableRecords = traceChecks.filter(Boolean).length;
  const traceabilityPercent = traceChecks.length ? (traceableRecords / traceChecks.length) * 100 : 100;

  return {
    assignedUnits,
    soldUnits,
    returnedUnits,
    repOutstandingUnits,
    repOutstandingValue,
    repSellThroughPercent: assignedUnits ? (soldUnits / assignedUnits) * 100 : 0,
    finishedStockUnits,
    rawMaterialRiskCount,
    finishedGoodsRiskCount,
    equipmentInStock,
    creditLimitTotal,
    creditBalanceTotal,
    creditExposurePercent,
    creditHoldCount,
    creditWatchCount,
    creditHoldOrders,
    paidTotal,
    invoiceTotal,
    receivables,
    paymentCoveragePercent,
    traceableRecords,
    totalTraceableRecords: traceChecks.length,
    traceabilityPercent
  };
}

export function buildRepLedger(state) {
  const ledger = new Map();
  const validRepNames = new Set((state.accounts || [])
    .filter((account) => {
      const role = String(account.role || "").trim().toLowerCase();
      return role === "sales_rep" || role.includes("sales rep") || role.includes("sales representative");
    })
    .map((account) => String(account.name || "").trim().toLowerCase())
    .filter(Boolean));
  const shouldFilterByAccounts = validRepNames.size > 0;

  (state.stockAssignments || []).forEach((assignment) => {
    const key = assignment.repName || "Unassigned";
    const normalizedKey = String(key).trim().toLowerCase();

    if (shouldFilterByAccounts && !validRepNames.has(normalizedKey)) return;

    const row = ledger.get(key) || {
      repName: key,
      assignments: 0,
      assigned: 0,
      sold: 0,
      returned: 0,
      outstanding: 0,
      openAssignments: 0
    };

    row.assignments += 1;
    row.assigned += Number(assignment.assigned || 0);
    row.sold += Number(assignment.sold || 0);
    row.returned += Number(assignment.returned || 0);
    row.outstanding += assignmentOutstanding(assignment);
    if (assignment.status !== "reconciled") row.openAssignments += 1;
    ledger.set(key, row);
  });

  return [...ledger.values()].map((row) => {
    const limit = getCreditLimitForParty(state.creditLimits || [], row.repName);
    const limitAmount = Number(limit?.limit || 0);
    const balance = Number(limit?.balance || 0);

    return {
      ...row,
      sellThroughPercent: row.assigned ? (row.sold / row.assigned) * 100 : 0,
      creditLimit: limitAmount,
      creditBalance: balance,
      creditUsagePercent: limitAmount ? (balance / limitAmount) * 100 : 0
    };
  }).sort((a, b) => b.outstanding - a.outstanding);
}

export function buildRegionalSummary(state) {
  const productMap = getProductMap(state.products);
  const regionTotals = state.orders.reduce((summary, order) => {
    summary[order.region] = (summary[order.region] || 0) + getOrderTotal(order, productMap);
    return summary;
  }, {});

  const maxValue = Math.max(...Object.values(regionTotals), 1);

  return Object.entries(regionTotals)
    .map(([region, value]) => ({
      region,
      value,
      percent: (value / maxValue) * 100
    }))
    .sort((a, b) => b.value - a.value);
}

export function buildOrderStatusSummary(orders) {
  return orders.reduce((summary, order) => {
    summary[order.status] = (summary[order.status] || 0) + 1;
    return summary;
  }, {});
}

export function getStockHealth(product) {
  const ratio = product.reorderPoint ? (product.stock / product.reorderPoint) * 100 : 100;
  const daysCover = product.dailyVelocity ? Math.floor(product.stock / product.dailyVelocity) : 0;

  if (product.stock <= product.reorderPoint) {
    return {
      status: "low",
      percent: Math.max(8, Math.min(100, ratio)),
      daysCover,
      tone: "danger"
    };
  }

  if (ratio < 150) {
    return {
      status: "partial",
      percent: Math.min(100, ratio),
      daysCover,
      tone: "warning"
    };
  }

  return {
    status: "ready",
    percent: 100,
    daysCover,
    tone: "good"
  };
}

export function getLowStockProducts(products) {
  return products
    .map((product) => ({
      ...product,
      health: getStockHealth(product)
    }))
    .filter((product) => product.health.status !== "ready")
    .sort((a, b) => a.health.daysCover - b.health.daysCover);
}

export function getOrdersWithTotals(state) {
  const productMap = getProductMap(state.products);
  const retailerMap = getRetailerMap(state.retailers);

  return state.orders.map((order) => ({
    ...order,
    retailer: retailerMap.get(order.retailerId) || {
      name: order.customerName || "Walk-in customer"
    },
    total: getOrderTotal(order, productMap)
  }));
}

export function getInvoiceAging(invoices, today = new Date()) {
  const buckets = [
    { label: "Current", min: -Infinity, max: 0, total: 0 },
    { label: "1-15 days", min: 1, max: 15, total: 0 },
    { label: "16-30 days", min: 16, max: 30, total: 0 },
    { label: "31+ days", min: 31, max: Infinity, total: 0 }
  ];

  invoices
    .filter((invoice) => invoice.status !== "paid")
    .forEach((invoice) => {
      const dueDate = new Date(`${invoice.dueAt}T12:00:00`);
      const daysPastDue = Math.floor((today - dueDate) / 86400000);
      const bucket = buckets.find((item) => daysPastDue >= item.min && daysPastDue <= item.max);
      bucket.total += invoice.amount;
    });

  const maxValue = Math.max(...buckets.map((bucket) => bucket.total), 1);

  return buckets.map((bucket) => ({
    ...bucket,
    percent: (bucket.total / maxValue) * 100
  }));
}
