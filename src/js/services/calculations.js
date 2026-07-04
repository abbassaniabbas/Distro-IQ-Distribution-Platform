export function getProductMap(products) {
  return new Map(products.map((product) => [product.id, product]));
}

export function getRetailerMap(retailers) {
  return new Map(retailers.map((retailer) => [retailer.id, retailer]));
}

export function getOrderTotal(order, products) {
  const productMap = Array.isArray(products) ? getProductMap(products) : products;

  return order.items.reduce((total, item) => {
    const product = productMap.get(item.productId);
    return total + (product?.unitPrice || 0) * item.quantity;
  }, 0);
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
    retailer: retailerMap.get(order.retailerId),
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
