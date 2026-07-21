function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values) {
  const seen = new Set();
  return values.map(clean).filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function addRecord(index, { label, context, href, values = [], queryOnNavigate = true }) {
  const searchableValues = unique([label, ...values]);
  if (!clean(label) || !href || !searchableValues.length) return;

  index.push({
    label: clean(label),
    context: clean(context).split(/\s+/).slice(0, 2).join(" "),
    href,
    queryOnNavigate,
    values: searchableValues,
    searchText: searchableValues.join(" ").toLowerCase()
  });
}

function productValues(product) {
  const size = [product.size || product.productSize, product.unit].filter(Boolean).join("");
  return [
    product.id,
    product.sku,
    product.name,
    product.productName,
    product.productFamily,
    product.productType,
    product.type,
    size,
    product.category,
    product.status,
    product.catalogueStatus
  ];
}

const STOCK_SECTIONS = [
  ["Stock health", "stock-health"],
  ["Factory dispatch", "dispatch"],
  ["Stock journey", "overview"],
  ["Rep stock ledger", "assignments"],
  ["Movement history", "movement-history"],
  ["Adjustments", "adjustments"]
];

export function buildGlobalSearchIndex({ state, navigationItems, allowedRouteIds }) {
  const index = [];
  const allowed = new Set(allowedRouteIds || []);

  (navigationItems || []).filter((item) => allowed.has(item.id)).forEach((item) => {
    addRecord(index, {
      label: item.label,
      context: "Section",
      href: `#/${item.id}`,
      values: [item.id.replaceAll("-", " ")],
      queryOnNavigate: false
    });
  });

  if (allowed.has("inventory")) {
    STOCK_SECTIONS.forEach(([label, tab]) => addRecord(index, {
      label,
      context: "Stock",
      href: `#/inventory?tab=${tab}`,
      values: [tab.replaceAll("-", " ")],
      queryOnNavigate: false
    }));

    (state.products || []).forEach((product) => addRecord(index, {
      label: product.name || product.productName || product.sku || product.id,
      context: "Stock",
      href: "#/inventory?tab=stock-health",
      values: productValues(product)
    }));

    (state.stockAssignments || []).forEach((assignment) => addRecord(index, {
      label: assignment.repName || assignment.id,
      context: "Rep Stock",
      href: "#/inventory?tab=assignments",
      values: [assignment.id, assignment.repName, assignment.productName, assignment.productId, assignment.route, assignment.status]
    }));

    (state.stockTransactions || []).forEach((transaction) => addRecord(index, {
      label: transaction.productName || transaction.partyName || transaction.id,
      context: "Movement",
      href: "#/inventory?tab=movement-history",
      values: [transaction.id, transaction.productName, transaction.productId, transaction.partyName, transaction.recordedBy, transaction.type, transaction.status, transaction.destination]
    }));

    (state.correctionRequests || []).forEach((request) => addRecord(index, {
      label: request.repName || request.productName || request.id,
      context: "Adjustments",
      href: "#/inventory?tab=adjustments",
      values: [request.id, request.repName, request.productName, request.productId, request.reason, request.status, request.requestType]
    }));
  }

  if (allowed.has("retailers")) {
    (state.retailers || state.customers || []).forEach((customer) => addRecord(index, {
      label: customer.name || customer.outletName || customer.id,
      context: "Customers",
      href: "#/retailers",
      values: [customer.id, customer.name, customer.outletName, customer.contactName, customer.phone, customer.address, customer.state, customer.lga, customer.localGovernment, customer.location, customer.channel, customer.status, customer.rating]
    }));

    (state.routes || []).forEach((route) => addRecord(index, {
      label: route.name || route.label || route.id,
      context: "Locations",
      href: "#/retailers",
      values: [route.id, route.name, route.label, route.region, route.state, route.lga, route.location, route.address, route.status]
    }));
  }

  if (allowed.has("team")) {
    (state.accounts || []).forEach((account) => addRecord(index, {
      label: account.name || account.email || account.id,
      context: "Staff",
      href: "#/team",
      values: [account.id, account.name, account.email, account.phone, account.role, account.status]
    }));
  }

  if (allowed.has("orders")) {
    (state.orders || []).forEach((order) => addRecord(index, {
      label: order.customerName || order.retailerName || order.id,
      context: "Orders",
      href: "#/orders",
      values: [order.id, order.customerName, order.retailerName, order.repName, order.status, order.address, order.location, order.region, order.paymentType]
    }));
  }

  if (allowed.has("invoices")) {
    (state.invoices || []).forEach((invoice) => addRecord(index, {
      label: invoice.customerName || invoice.retailerName || invoice.id,
      context: "Invoices",
      href: "#/invoices",
      values: [invoice.id, invoice.invoiceNumber, invoice.customerName, invoice.retailerName, invoice.repName, invoice.status, invoice.paymentType, ...(invoice.items || []).flatMap(productValues)]
    }));
  }

  if (allowed.has("finance")) {
    (state.creditLimits || []).forEach((credit) => addRecord(index, {
      label: credit.partyName || credit.customerName || credit.repName || credit.id,
      context: "Finance",
      href: "#/finance?tab=credit-limits",
      values: [credit.id, credit.partyName, credit.customerName, credit.repName, credit.partyType, credit.status]
    }));
  }

  if (allowed.has("activity-log")) {
    (state.activityLogs || []).forEach((entry) => addRecord(index, {
      label: entry.recordLabel || entry.summary || entry.actorName || entry.id,
      context: "Activity",
      href: "#/activity-log",
      values: [entry.id, entry.recordLabel, entry.summary, entry.actorName, entry.actorEmail, entry.actionType, entry.recordType]
    }));

    const reportHref = allowed.has("finance")
      ? "#/activity-log?tab=submitted-reports"
      : allowed.has("orders")
        ? "#/dashboard"
        : "#/activity-log";
    (state.salesReports || []).forEach((report) => addRecord(index, {
      label: report.tripLabel || report.repName || report.id,
      context: "Reports",
      href: reportHref,
      values: [report.id, report.tripLabel, report.repName, report.status, report.reportDate]
    }));
  }

  return index;
}

function matchingLabel(record, query) {
  const starts = record.values.find((value) => value.toLowerCase().startsWith(query));
  const contains = record.values.find((value) => value.toLowerCase().includes(query));
  return clean(starts || contains || record.label);
}

export function findGlobalSearchSuggestions(index, queryValue, limit = 8) {
  const query = clean(queryValue).toLowerCase();
  if (query.length < 2) return [];

  const seen = new Set();
  return (index || [])
    .filter((record) => record.searchText.includes(query))
    .map((record) => {
      const label = matchingLabel(record, query);
      const normalizedLabel = label.toLowerCase();
      const rank = normalizedLabel === query ? 0 : normalizedLabel.startsWith(query) ? 1 : 2;
      return { ...record, label, rank };
    })
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
    .filter((record) => {
      const key = `${record.href}|${record.label.toLowerCase()}|${record.context.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}
