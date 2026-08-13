import seedData from "../data/seed-data.js?v=20260801d";
import { createActivityLog, getCurrentActor } from "../services/activity.js?v=20260805b";
import {
  assignmentOutstanding,
  getReturnableCustomerChoices,
  getFinancialSalesLines,
  isRepresentativeSellThroughInvoice,
  isRepresentativeSellThroughOrder,
  isRepresentativeSellThroughTransaction,
  isRepresentativeReturnEligible,
  stockCategoryIdForProduct
} from "../services/calculations.js?v=20260813a";
import { currentUserRole, normalizeRole, salesRepresentativeNames } from "../services/rbac.js?v=20260805g";
import { clearStoredState, loadStoredState, saveStoredState } from "../services/storage.js";
import { createAccountInvite, createClientProfile, createId, descriptiveProductSku, nextFormattedId } from "../services/tenant.js?v=20260805c";
import { effectivePiecePrice, packagingLineAmount, packagingQuantityLabel, packagingUnitPrice, quantityInPieces } from "../services/packaging.js";

function clone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function mergeSeedRecords(existing, defaults) {
  const existingRecords = Array.isArray(existing) ? clone(existing) : [];
  const defaultRecords = clone(defaults || []);
  const defaultsById = new Map(defaultRecords.map((item) => [item.id, item]));
  const existingIds = new Set(existingRecords.map((item) => item.id));
  const mergedExisting = existingRecords.map((item) => {
    const defaultRecord = defaultsById.get(item.id);
    return defaultRecord ? { ...defaultRecord, ...item } : item;
  });
  const missingDefaults = defaultRecords.filter((item) => !existingIds.has(item.id));

  return [...mergedExisting, ...missingDefaults];
}

function mergeCreditHistoryRecords(existing, remote) {
  const remoteRecords = Array.isArray(remote) ? clone(remote) : [];
  const localOnly = (Array.isArray(existing) ? clone(existing) : []).filter((localEntry) => (
    !remoteRecords.some((remoteEntry) => {
      const sameChange = (
        normalized(localEntry.partyName) === normalized(remoteEntry.partyName) &&
        Number(localEntry.previousLimit || 0) === Number(remoteEntry.previousLimit || 0) &&
        Number(localEntry.nextLimit || 0) === Number(remoteEntry.nextLimit || 0) &&
        normalized(localEntry.changedBy) === normalized(remoteEntry.changedBy)
      );
      const timeDifference = Math.abs(
        new Date(localEntry.changedAt || 0).getTime() - new Date(remoteEntry.changedAt || 0).getTime()
      );

      return sameChange && timeDifference <= 300000;
    })
  ));

  return [...remoteRecords, ...localOnly];
}

function mergeCreditLimitRecords(existing, remote) {
  const remoteRecords = Array.isArray(remote) ? clone(remote) : [];
  const localOnly = (Array.isArray(existing) ? clone(existing) : []).filter((localLimit) => (
    !remoteRecords.some((remoteLimit) => (
      (localLimit.repUserId && remoteLimit.repUserId && localLimit.repUserId === remoteLimit.repUserId) ||
      (
        normalized(localLimit.partyType) === normalized(remoteLimit.partyType) &&
        normalized(localLimit.partyName) === normalized(remoteLimit.partyName)
      )
    ))
  ));

  return [...remoteRecords, ...localOnly];
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function isValidISODate(value) {
  const candidate = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return false;

  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate;
}

function expectedDeliveryDate(order) {
  return dateOnly(order?.expectedDeliveryAt || (order?.source === "factory_dispatch" ? order?.dueAt : ""));
}

function daysBetween(startDate, endDate) {
  const start = Date.parse(`${dateOnly(startDate)}T00:00:00Z`);
  const end = Date.parse(`${dateOnly(endDate)}T00:00:00Z`);

  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 86400000));
}

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function currentActorName(state) {
  return getCurrentActor(state).name || "Sales Representative";
}

function isSalesRepresentativeName(state, name) {
  const normalizedName = String(name || "").trim().toLowerCase();

  if (!normalizedName) return false;

  return salesRepresentativeNames(state).some((repName) => (
    String(repName || "").trim().toLowerCase() === normalizedName
  ));
}

function updateCreditBalance(state, partyName, creditImpact) {
  if (!partyName || !creditImpact) return;

  const normalizedPartyName = String(partyName).trim().toLowerCase();
  const limit = state.creditLimits.find((item) => (
    String(item.partyName || "").trim().toLowerCase() === normalizedPartyName
  ));

  if (limit) {
    limit.balance = Math.max(0, Number(limit.balance || 0) + Number(creditImpact || 0));
  }
}

function deleteSalesOrders(state, orderIds, { includeAllSales = false } = {}) {
  const deletedOrderIds = new Set(orderIds.map(String));
  const deletedTransactionIds = new Set(
    [
      ...(state.orders || [])
        .filter((order) => deletedOrderIds.has(String(order.id || "")))
        .flatMap((order) => [
          order.transactionId,
          ...(order.transactionIds || []),
          ...(order.items || []).map((item) => item.transactionId)
        ]),
      ...(includeAllSales
        ? (state.stockTransactions || [])
          .filter((transaction) => normalized(transaction.type) === "sale")
          .map((transaction) => transaction.id)
        : [])
    ]
      .map(String)
      .filter(Boolean)
  );
  const deletedInvoices = (state.invoices || []).filter((invoice) => (
    deletedOrderIds.has(String(invoice.orderId || "")) ||
    [invoice.transactionId, ...(invoice.transactionIds || [])].some((id) => deletedTransactionIds.has(String(id || "")))
  ));

  deletedInvoices
    .filter((invoice) => normalized(invoice.paymentType).includes("credit") && normalized(invoice.status) !== "paid")
    .forEach((invoice) => updateCreditBalance(state, invoice.customerName || invoice.repName, -Number(invoice.amount || 0)));

  state.orders = (state.orders || []).filter((order) => !deletedOrderIds.has(String(order.id || "")));
  state.stockTransactions = (state.stockTransactions || []).filter((transaction) => (
    !deletedTransactionIds.has(String(transaction.id || ""))
  ));
  state.invoices = (state.invoices || []).filter((invoice) => !deletedInvoices.includes(invoice));
  state.routes = (state.routes || []).map((route) => ({
    ...route,
    orderIds: (route.orderIds || []).filter((orderId) => !deletedOrderIds.has(String(orderId || "")))
  }));
  state.correctionRequests = (state.correctionRequests || []).filter((request) => (
    !deletedTransactionIds.has(String(request.transactionId || ""))
  ));
  state.salesReports = (state.salesReports || []).map((report) => ({
    ...report,
    transactionIds: (report.transactionIds || []).filter((id) => !deletedTransactionIds.has(String(id || ""))),
    reportLines: (report.reportLines || []).filter((line) => !deletedTransactionIds.has(String(line.transactionId || "")))
  }));
  state.offlineSalesQueue = (state.offlineSalesQueue || []).filter((entry) => (
    !deletedTransactionIds.has(String(entry.transactionId || "")) &&
    !deletedOrderIds.has(String(entry.orderId || ""))
  ));
}

function deleteProductRevenueLines(state, lineIds) {
  const selected = new Set(lineIds.map(String));
  const lines = getFinancialSalesLines(state).filter((line) => selected.has(String(line.id || "")));
  const transactionIds = new Set(
    lines
      .filter((line) => line.source !== "Sales order")
      .map((line) => String(line.id || ""))
      .filter(Boolean)
  );
  const orderLineIds = new Set(
    lines
      .filter((line) => line.source === "Sales order")
      .map((line) => String(line.id || ""))
  );
  state.orders = (state.orders || []).map((order) => ({
    ...order,
    items: (order.items || []).map((item, itemIndex) => {
      const lineId = `${order.id}-${item.productId}-${item.packagingType || "piece"}-${itemIndex}`;
      return orderLineIds.has(lineId) ? { ...item, financeRevenueDeleted: true } : item;
    })
  }));

  state.stockTransactions = (state.stockTransactions || []).map((transaction) => (
    transactionIds.has(String(transaction.id || ""))
      ? { ...transaction, financeRevenueDeleted: true }
      : transaction
  ));
}

function boundedPercent(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

function matchingTransactionItem(items, transaction) {
  return (items || []).find((item) => item.transactionId && item.transactionId === transaction.id) ||
    (items || []).find((item) => item.productId === transaction.productId && String(item.packagingType || "piece") === String(transaction.packagingType || "piece"));
}

function syncPackagingQuantity(record, nextQuantity) {
  if (!record) return;
  const previousBaseQuantity = Number(record.quantity || 0);
  const previousPackagingQuantity = Number(record.packagingQuantity || 0);
  const multiplier = previousPackagingQuantity > 0 ? previousBaseQuantity / previousPackagingQuantity : 1;
  record.quantity = nextQuantity;
  record.packagingQuantity = String(record.packagingType || "piece") === "piece"
    ? nextQuantity
    : multiplier > 0 ? nextQuantity / multiplier : previousPackagingQuantity;
  record.lineAmount = String(record.packagingType || "piece") !== "piece" && Number(record.packagingUnitPrice || 0) > 0
    ? Number(record.packagingQuantity || 0) * Number(record.packagingUnitPrice || 0)
    : nextQuantity * Number(record.unitPrice || 0);
  if (Object.prototype.hasOwnProperty.call(record, "amount")) record.amount = record.lineAmount;
}

function normalizedPaymentPeriod(value, fallback = 14) {
  const nextValue = Number(value ?? fallback);
  return Math.max(0, Number.isFinite(nextValue) ? Math.round(nextValue) : fallback);
}

function stockAssignmentVariance(assignment) {
  return Number(assignment?.assigned || 0) - Number(assignment?.sold || 0) - Number(assignment?.returned || 0);
}

function quickSaleOrderId(transaction) {
  return transaction.orderId || `ORD-${String(transaction.id || "SALE").replace(/[^a-z0-9]+/gi, "-")}`.toUpperCase();
}

function orderFromSaleTransaction(transaction, state) {
  const customer = (state.retailers || []).find((item) => item.id === transaction.customerId);
  const product = (state.products || []).find((item) => item.id === transaction.productId);
  const representativeSellThrough = isRepresentativeSellThroughTransaction(transaction);
  const paymentType = transaction.paymentType || "cash";
  const paymentLabel = String(paymentType).toLowerCase();
  const date = String(transaction.date || transaction.createdAt || todayISO()).slice(0, 10);
  const quantity = Number(transaction.quantity || 0);
  const unitPrice = Number(transaction.unitPrice ?? transaction.unitPriceAtSale ?? (quantity ? Number(transaction.amount || 0) / quantity : product?.unitPrice ?? 0));
  const unitCost = Number(transaction.unitCost ?? transaction.unitCostAtSale ?? product?.unitCost ?? 0);

  return {
    id: quickSaleOrderId(transaction),
    clientId: state.client?.id || transaction.clientId || "",
    source: "quick_sale",
    financialImpact: !representativeSellThrough,
    accountingTreatment: representativeSellThrough ? "sell_through_only" : "factory_revenue",
    documentType: representativeSellThrough
      ? (paymentLabel.includes("credit") ? INVOICE_TYPES.REPRESENTATIVE_CUSTOMER_INVOICE : INVOICE_TYPES.REPRESENTATIVE_CUSTOMER_RECEIPT)
      : INVOICE_TYPES.FACTORY_CUSTOMER_INVOICE,
    transactionId: transaction.id,
    retailerId: customer?.id || transaction.customerId || "",
    customerName: customer?.name || transaction.partyName || "Walk-in customer",
    customerType: customer?.channel || transaction.partyType || "Customer",
    region: customer?.stateName || customer?.region || "Direct sales",
    priority: "Normal",
    status: "delivered",
    paymentType,
    paymentStatus: paymentLabel.includes("credit") ? "open" : "paid",
    dueAt: dateOnly(transaction.dueAt) || date,
    createdAt: date,
    updatedAt: date,
    repName: transaction.recordedBy || "Sales Representative",
    repUserId: transaction.repUserId || "",
    items: [
      {
        productId: transaction.productId,
        productName: transaction.productName || product?.name || transaction.productId,
        quantity,
        packagingType: transaction.packagingType || "piece",
        packagingQuantity: Number(transaction.packagingQuantity || quantity),
        packagingUnitPrice: Number(transaction.packagingUnitPrice || unitPrice),
        unitPrice,
        unitCost
      }
    ]
  };
}

function ensureQuickSaleOrders(state) {
  const existingOrderIds = new Set((state.orders || []).map((order) => order.id));
  const existingTransactionIds = new Set((state.orders || []).map((order) => order.transactionId).filter(Boolean));
  const generatedOrders = (state.stockTransactions || [])
    .filter((transaction) => String(transaction.type || "").toLowerCase() === "sale")
    .filter((transaction) => transaction.id && !existingTransactionIds.has(transaction.id))
    .map((transaction) => orderFromSaleTransaction(transaction, state))
    .filter((order) => order.items[0]?.productId && order.items[0]?.quantity > 0 && !existingOrderIds.has(order.id));

  if (!generatedOrders.length) return state;

  return {
    ...state,
    orders: [
      ...generatedOrders,
      ...(state.orders || [])
    ]
  };
}

function normalizedOrderStatus(status) {
  const value = String(status || "").toLowerCase();

  if (value === "processing" || value === "packed") return "in_transit";
  if (["in_transit", "delayed", "delivered"].includes(value)) return value;
  return "in_transit";
}

function normalizeOrders(orders = []) {
  return (orders || []).map((order) => ({
    ...order,
    status: normalizedOrderStatus(order.status),
    expectedDeliveryAt: order.expectedDeliveryAt || (order.source === "factory_dispatch" ? order.dueAt || "" : ""),
    originalExpectedDeliveryAt: order.originalExpectedDeliveryAt || order.expectedDeliveryAt || (order.source === "factory_dispatch" ? order.dueAt || "" : ""),
    delayHistory: Array.isArray(order.delayHistory) ? order.delayHistory : []
  }));
}

function ensureStateShape(value) {
  const state = clone(value || seedData);
  const supportedAccounts = Array.isArray(state.accounts)
    ? state.accounts.filter((account) => !["accountant", "finance"].includes(String(account.role || "").toLowerCase()))
    : [];
  const supportedInvites = Array.isArray(state.invites)
    ? state.invites.filter((invite) => !["accountant", "finance"].includes(String(invite.role || "").toLowerCase()))
    : [];

  return ensureQuickSaleOrders({
    ...clone(seedData),
    ...state,
    client: state.client || null,
    accounts: supportedAccounts,
    invites: supportedInvites,
    featureModules: Array.isArray(state.featureModules) ? state.featureModules : [],
    messages: Array.isArray(state.messages) ? state.messages : [],
    notificationReadAt: String(state.notificationReadAt || ""),
    notificationClearedAt: String(state.notificationClearedAt || ""),
    dismissedNotificationIds: Array.isArray(state.dismissedNotificationIds) ? state.dismissedNotificationIds.map(String) : [],
    activityLogs: Array.isArray(state.activityLogs) ? state.activityLogs : [],
    salesReports: mergeSeedRecords(state.salesReports, seedData.salesReports),
    creditLimitHistory: mergeSeedRecords(state.creditLimitHistory, seedData.creditLimitHistory),
    productionBatches: Array.isArray(state.productionBatches) ? state.productionBatches : [],
    productionPlans: Array.isArray(state.productionPlans) ? state.productionPlans : [],
    productionIssues: Array.isArray(state.productionIssues) ? state.productionIssues : [],
    offlineSalesQueue: Array.isArray(state.offlineSalesQueue) ? state.offlineSalesQueue : [],
    packagingChangeRequests: Array.isArray(state.packagingChangeRequests) ? state.packagingChangeRequests : [],
    correctionRequests: Array.isArray(state.correctionRequests) ? state.correctionRequests : [],
    stockRequests: Array.isArray(state.stockRequests) ? state.stockRequests : [],
    stockAdditionRequests: Array.isArray(state.stockAdditionRequests) ? state.stockAdditionRequests : [],
    purchaseOrders: Array.isArray(state.purchaseOrders) ? state.purchaseOrders : [],
    procurementOrders: Array.isArray(state.procurementOrders) ? state.procurementOrders : [],
    retailers: mergeSeedRecords(state.retailers, seedData.retailers),
    orders: normalizeOrders(mergeSeedRecords(state.orders, seedData.orders)),
    routes: mergeSeedRecords(state.routes, seedData.routes),
    products: mergeSeedRecords(state.products, seedData.products),
    stockCategories: mergeSeedRecords(state.stockCategories, seedData.stockCategories),
    stockAssignments: mergeSeedRecords(state.stockAssignments, seedData.stockAssignments),
    stockTransactions: mergeSeedRecords(state.stockTransactions, seedData.stockTransactions),
    creditLimits: mergeSeedRecords(state.creditLimits, seedData.creditLimits),
    invoices: mergeSeedRecords(state.invoices, seedData.invoices),
    backend: {
      ...clone(seedData.backend),
      ...(state.backend || {})
    },
    session: null,
    user: null,
    platformAdmin: false,
    platformOverview: Array.isArray(state.platformOverview) ? state.platformOverview : []
  });
}

function getPersistableState(state) {
  return {
    ...state,
    products: (state.products || []).map((product) => ({
      ...product,
      imageUrl: (product.imageStorageKey || product.imageRemoteSynced) && String(product.imageUrl || "").startsWith("data:image/")
        ? ""
        : product.imageUrl || ""
    })),
    accounts: (state.accounts || []).map(({ temporaryPassword: _temporaryPassword, ...account }) => account),
    invites: (state.invites || []).map(({ temporaryPassword: _temporaryPassword, ...invite }) => invite),
    backend: clone(seedData.backend),
    session: null,
    user: null,
    platformAdmin: false,
    platformOverview: []
  };
}

function applySharedProductImages(products, images) {
  if (!Array.isArray(images)) return products;
  const imagesByProductId = new Map(images.map((image) => [String(image.productId || ""), image]));
  return products.map((product) => {
    const image = imagesByProductId.get(String(product.id || ""));
    if (!image) {
      return {
        ...product,
        // A missing remote row is not proof that the browser copy was removed.
        // Allow IndexedDB restoration and a later backfill instead of deleting it.
        imageRemoteSynced: false
      };
    }
    if (product.imageRemoteSynced !== true && !product.imageStorageKey) {
      return {
        ...product,
        // A matching SKU alone is not proof that this picture belongs to the
        // current stock record. New records must explicitly synchronize their
        // own image (including an intentional empty image).
        imageRemoteSynced: false
      };
    }
    return {
      ...product,
      imageUrl: String(image.imageUrl || ""),
      imageRemoteSynced: true
    };
  });
}

function canManageOrderFlow(state) {
  return currentUserRole(state) === "ceo";
}

function canManageProductionFlow(state) {
  return ["production_manager", "ceo"].includes(currentUserRole(state));
}

const INVOICE_TYPES = {
  FACTORY_CUSTOMER_INVOICE: "factory_customer_invoice",
  REPRESENTATIVE_CUSTOMER_RECEIPT: "representative_customer_receipt",
  REPRESENTATIVE_CUSTOMER_INVOICE: "representative_customer_invoice",
  REPRESENTATIVE_DISPATCH_NOTE: "representative_dispatch_note",
  REPRESENTATIVE_PURCHASE_RECEIPT: "representative_purchase_receipt",
  REPRESENTATIVE_DEPOSIT_RECEIPT: "representative_deposit_receipt",
  REPRESENTATIVE_STOCK_TRANSFER_NOTE: "representative_stock_transfer_note"
};

function nextInvoiceId(state, documentType = INVOICE_TYPES.FACTORY_CUSTOMER_INVOICE) {
  const formats = {
    [INVOICE_TYPES.FACTORY_CUSTOMER_INVOICE]: state.client?.factoryInvoiceFormat || state.client?.invoiceFormat || "FAC-INV-{0000}",
    [INVOICE_TYPES.REPRESENTATIVE_CUSTOMER_RECEIPT]: state.client?.representativeReceiptFormat || "REP-REC-{0000}",
    [INVOICE_TYPES.REPRESENTATIVE_CUSTOMER_INVOICE]: state.client?.representativeCreditInvoiceFormat || "REP-INV-{0000}",
    [INVOICE_TYPES.REPRESENTATIVE_DISPATCH_NOTE]: state.client?.representativeDispatchFormat || "DSP-NOTE-{0000}",
    [INVOICE_TYPES.REPRESENTATIVE_PURCHASE_RECEIPT]: state.client?.representativePurchaseReceiptFormat || "SRP-{0000}",
    [INVOICE_TYPES.REPRESENTATIVE_DEPOSIT_RECEIPT]: state.client?.representativeDepositReceiptFormat || "DEP-REC-{0000}",
    [INVOICE_TYPES.REPRESENTATIVE_STOCK_TRANSFER_NOTE]: state.client?.representativeStockTransferFormat || "STK-TRF-{0000}"
  };
  const prefixes = {
    [INVOICE_TYPES.FACTORY_CUSTOMER_INVOICE]: "FAC-INV",
    [INVOICE_TYPES.REPRESENTATIVE_CUSTOMER_RECEIPT]: "REP-REC",
    [INVOICE_TYPES.REPRESENTATIVE_CUSTOMER_INVOICE]: "REP-INV",
    [INVOICE_TYPES.REPRESENTATIVE_DISPATCH_NOTE]: "DSP-NOTE",
    [INVOICE_TYPES.REPRESENTATIVE_PURCHASE_RECEIPT]: "SRP",
    [INVOICE_TYPES.REPRESENTATIVE_DEPOSIT_RECEIPT]: "DEP-REC",
    [INVOICE_TYPES.REPRESENTATIVE_STOCK_TRANSFER_NOTE]: "STK-TRF"
  };

  return nextFormattedId(
    formats[documentType] || state.client?.invoiceFormat || "INV-{0000}",
    (state.invoices || []).map((invoice) => invoice.id),
    prefixes[documentType] || "INV"
  );
}

function automaticallyDelayOrders(state, writeActivity = true) {
  const referenceDate = todayISO();
  let updatedCount = 0;

  (state.orders || []).forEach((order) => {
    const expectedAt = expectedDeliveryDate(order);
    if (normalizedOrderStatus(order.status) !== "in_transit" || !expectedAt || expectedAt >= referenceDate) return;

    order.status = "delayed";
    order.expectedDeliveryAt = order.expectedDeliveryAt || expectedAt;
    order.originalExpectedDeliveryAt = order.originalExpectedDeliveryAt || expectedAt;
    order.delaySource = "automatic";
    order.delayReason = order.delayReason || "Missed expected delivery date";
    order.delayDetectedAt = order.delayDetectedAt || new Date().toISOString();
    order.delayDays = daysBetween(expectedAt, referenceDate);
    order.updatedAt = referenceDate;
    updatedCount += 1;

    if (writeActivity) {
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "delayed",
        recordType: "order",
        recordLabel: order.id,
        summary: `${order.id} was automatically marked delayed after missing its expected delivery date`,
        actor: {
          userId: "",
          name: "DistroIQ system",
          email: ""
        }
      });
    }
  });

  return updatedCount;
}

function nextOrderStatus(status) {
  const flow = {
    in_transit: "delivered",
    processing: "in_transit",
    packed: "in_transit",
    delayed: "in_transit",
    delivered: "delivered"
  };

  return flow[status] || "in_transit";
}

function nextRouteStatus(status) {
  const flow = {
    scheduled: "in_transit",
    in_transit: "delivered",
    delivered: "delivered"
  };

  return flow[status] || "scheduled";
}

function textLabel(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function categoryNameForStockCategory(stockCategory) {
  if (stockCategory === "raw_materials") return "Raw Materials";
  if (stockCategory === "equipment") return "Equipment";
  return "Finished Products";
}

function currentActorLabel(state) {
  return getCurrentActor(state).name || "CEO";
}

function currentWorkspaceAccount(state) {
  const userEmail = String(state.user?.email || "").trim().toLowerCase();

  return (state.accounts || []).find((account) => (
    account.clientId === state.client?.id &&
    (
      (account.userId && account.userId === state.user?.id) ||
      (userEmail && String(account.email || "").trim().toLowerCase() === userEmail)
    )
  )) || null;
}

function messageBelongsToCurrentUser(state, message) {
  const account = currentWorkspaceAccount(state);
  const userEmail = String(state.user?.email || "").trim().toLowerCase();
  const accountEmail = String(account?.email || "").trim().toLowerCase();

  return (
    message.clientId === state.client?.id &&
    (
      (account?.id && message.toAccountId === account.id) ||
      (state.user?.id && message.toUserId === state.user.id) ||
      (accountEmail && String(message.toEmail || "").trim().toLowerCase() === accountEmail) ||
      (userEmail && String(message.toEmail || "").trim().toLowerCase() === userEmail)
    )
  );
}

function messageIsFromAccount(message, account) {
  const accountEmail = String(account?.email || "").trim().toLowerCase();

  return (
    (account?.id && message.fromAccountId === account.id) ||
    (account?.userId && message.fromUserId === account.userId) ||
    (accountEmail && String(message.fromEmail || "").trim().toLowerCase() === accountEmail)
  );
}

function messageIsToAccount(message, account) {
  const accountEmail = String(account?.email || "").trim().toLowerCase();

  return (
    (account?.id && message.toAccountId === account.id) ||
    (account?.userId && message.toUserId === account.userId) ||
    (accountEmail && String(message.toEmail || "").trim().toLowerCase() === accountEmail)
  );
}

function productFieldValue(key, value) {
  if (key === "imageUrl") return value ? "picture set" : "no picture";
  if (key === "stockCategory") return categoryNameForStockCategory(value);
  if (value === undefined || value === null || value === "") return "blank";
  return String(value);
}

function productChangeDetails(previousProduct, nextProduct) {
  if (!previousProduct) return [];

  const trackedFields = [
    ["id", "SKU"],
    ["name", "product name"],
    ["productFamily", "product group"],
    ["productType", "product type"],
    ["size", "product size"],
    ["stockCategory", "stock type"],
    ["stock", "stock"],
    ["reorderPoint", "reorder point"],
    ["unitCost", "cost price"],
    ["unitPrice", "selling price"],
    ["status", "status"],
    ["category", "category"],
    ["unit", "unit"],
    ["imageUrl", "picture"]
  ];

  return trackedFields
    .filter(([key]) => String(previousProduct[key] ?? "") !== String(nextProduct[key] ?? ""))
    .map(([key, label]) => ({
      field: key,
      label,
      previousValue: previousProduct[key] ?? "",
      nextValue: nextProduct[key] ?? "",
      summary: `${label}: ${productFieldValue(key, previousProduct[key])} -> ${productFieldValue(key, nextProduct[key])}`
    }));
}

function productActivitySummary(previousProduct, nextProduct) {
  if (!previousProduct) {
    return `Added stock ${nextProduct.name} with ${nextProduct.stock} ${nextProduct.unit}`;
  }

  if (Number(previousProduct.stock || 0) !== Number(nextProduct.stock || 0)) {
    const unit = nextProduct.stockCategory === "finished_products" ? "pieces" : nextProduct.unit || "units";
    return `Updated ${nextProduct.name} stock from ${Number(previousProduct.stock || 0).toLocaleString("en-NG")} to ${Number(nextProduct.stock || 0).toLocaleString("en-NG")} ${unit}.`;
  }

  if (String(previousProduct.imageUrl || "") !== String(nextProduct.imageUrl || "")) {
    return `${nextProduct.imageUrl ? "Updated" : "Removed"} the picture for ${nextProduct.name}.`;
  }

  if (String(previousProduct.name || "") !== String(nextProduct.name || "")) {
    return `Renamed ${previousProduct.name} to ${nextProduct.name}.`;
  }

  if (String(previousProduct.status || "") !== String(nextProduct.status || "")) {
    return `Changed ${nextProduct.name} status to ${nextProduct.status}.`;
  }

  if (
    Number(previousProduct.unitCost || 0) !== Number(nextProduct.unitCost || 0) ||
    Number(previousProduct.unitPrice || 0) !== Number(nextProduct.unitPrice || 0)
  ) {
    return `Updated pricing for ${nextProduct.name}.`;
  }

  return `Updated ${nextProduct.name}.`;
}

function freezeProductPricingOnExistingRecords(state, product) {
  if (!product?.id) return;

  const unitPrice = Number(product.unitPrice || 0);
  const unitCost = Number(product.unitCost || 0);

  (state.orders || []).forEach((order) => {
    (order.items || []).forEach((item) => {
      if (item.productId !== product.id) return;
      if (item.productName === undefined) item.productName = product.name;
      if (item.unitPrice === undefined && item.unitPriceAtSale === undefined) item.unitPrice = unitPrice;
      if (item.unitCost === undefined && item.unitCostAtSale === undefined) item.unitCost = unitCost;
    });
  });

  (state.stockTransactions || []).forEach((transaction) => {
    if (transaction.productId !== product.id) return;
    const quantity = Number(transaction.quantity || 0);
    const transactionUnitPrice = quantity && Number(transaction.amount || 0) > 0
      ? Number(transaction.amount || 0) / quantity
      : unitPrice;
    if (transaction.productName === undefined) transaction.productName = product.name;
    if (transaction.unitPrice === undefined && transaction.unitPriceAtSale === undefined) transaction.unitPrice = transactionUnitPrice;
    if (transaction.unitCost === undefined && transaction.unitCostAtSale === undefined) transaction.unitCost = unitCost;
  });
}

function remapProductReferences(state, previousProductId, nextProductId) {
  if (!previousProductId || !nextProductId || previousProductId === nextProductId) return;

  (state.stockAssignments || []).forEach((assignment) => {
    if (assignment.productId === previousProductId) assignment.productId = nextProductId;
  });
  (state.stockTransactions || []).forEach((transaction) => {
    if (transaction.productId === previousProductId) transaction.productId = nextProductId;
  });
  (state.orders || []).forEach((order) => {
    (order.items || []).forEach((item) => {
      if (item.productId === previousProductId) item.productId = nextProductId;
    });
  });
  (state.salesReports || []).forEach((report) => {
    (report.reportLines || []).forEach((line) => {
      if (line.productId === previousProductId) line.productId = nextProductId;
    });
  });
  (state.productionBatches || []).forEach((batch) => {
    if (batch.finishedProductId === previousProductId) batch.finishedProductId = nextProductId;
    (batch.materials || []).forEach((material) => {
      if (material.productId === previousProductId) material.productId = nextProductId;
    });
  });
}

function appendActivityLog(state, activity) {
  if (!activity?.clientId) return;

  state.activityLogs = [
    createActivityLog({
      ...activity,
      actor: activity.actor || getCurrentActor(state)
    }),
    ...state.activityLogs
  ];
}

function refreshAssignmentCompletion(state, assignment) {
  if (!assignment) return;

  const outstanding = assignmentOutstanding(assignment);
  const assigned = Number(assignment.assigned || 0);

  if (assigned > 0 && outstanding <= 0) {
    if (assignment.status !== "reconciled") {
      assignment.status = "reconciled";
      assignment.reconciledAt = new Date().toISOString();
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "reconciled",
        recordType: "inventory",
        recordLabel: assignment.id,
        summary: `${assignment.repName} assignment automatically reconciled`
      });
    }

    const dispatchAssignments = (state.stockAssignments || []).filter((item) => (
      assignment.dispatchId && item.dispatchId === assignment.dispatchId
    ));
    const dispatchReconciled = dispatchAssignments.length > 0 && dispatchAssignments.every((item) => assignmentOutstanding(item) <= 0);
    const order = dispatchReconciled
      ? (state.orders || []).find((item) => item.dispatchId === assignment.dispatchId)
      : null;
    if (order && order.status !== "delivered") {
      order.status = "delivered";
      order.deliveredAt = new Date().toISOString();
      order.updatedAt = order.deliveredAt;
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "completed",
        recordType: "order",
        recordLabel: order.id,
        summary: `${order.id} automatically delivered after all representative stock was reconciled`
      });
    }

    return;
  }

  if (assignment.status === "reconciled" && !assignment.varianceFlagged) {
    assignment.status = "open";
    assignment.reconciledAt = "";
  }
}

function createQuickSaleOrder(state, {
  transactionId,
  product,
  customer,
  customerName,
  customerType,
  quantity,
  packagingType = "piece",
  packagingQuantity = quantity,
  paymentType,
  repName,
  saleDate = todayISO(),
  unitPrice = Number(product?.unitPrice || 0),
  financialImpact = true,
  items = [],
  transactionIds = []
}) {
  const recordedPaymentType = String(paymentType || "cash").toLowerCase().includes("credit") ? "credit" : "cash";
  const paymentLabel = recordedPaymentType.toLowerCase();
  const today = dateOnly(saleDate) || todayISO();
  const orderId = createId("ORD");
  const isCreditSale = paymentLabel.includes("credit");
  const documentType = financialImpact
    ? INVOICE_TYPES.FACTORY_CUSTOMER_INVOICE
    : isCreditSale
      ? INVOICE_TYPES.REPRESENTATIVE_CUSTOMER_INVOICE
      : INVOICE_TYPES.REPRESENTATIVE_CUSTOMER_RECEIPT;
  const invoiceId = nextInvoiceId(state, documentType);
  const customerLimit = (state.creditLimits || []).find((limit) => (
    normalized(limit.partyName) === normalized(customer?.name || customerName)
  ));
  const dueDate = new Date(`${today}T12:00:00`);
  dueDate.setDate(dueDate.getDate() + Number(customerLimit?.paymentPeriodDays ?? 14));
  const dueAt = dueDate.toISOString().slice(0, 10);
  const saleItems = items.length ? items : [{
    product,
    quantity,
    packagingType,
    packagingQuantity,
    packagingUnitPrice: packagingUnitPrice(product, packagingType, state.client),
    unitPrice,
    transactionId
  }];
  const resolvedTransactionIds = transactionIds.length ? transactionIds : saleItems.map((item) => item.transactionId).filter(Boolean);
  const amount = saleItems.reduce((total, item) => total + Number(item.amount ?? (Number(item.quantity || 0) * Number(item.unitPrice || 0))), 0);
  const invoiceItems = saleItems.map((item) => ({
    transactionId: item.transactionId || "",
    productId: item.product.id,
    productName: item.product.name,
    quantity: Number(item.quantity || 0),
    packagingType: item.packagingType || "piece",
    packagingQuantity: Number(item.packagingQuantity || item.quantity || 0),
    packagingUnitPrice: Number(item.packagingUnitPrice || packagingUnitPrice(item.product, item.packagingType, state.client)),
    lineAmount: Number(item.amount ?? (Number(item.quantity || 0) * Number(item.unitPrice || 0))),
    unitPrice: Number(item.unitPrice || 0),
    unitCost: Number(item.product.unitCost || 0)
  }));

  state.orders = [
    {
      id: orderId,
      clientId: state.client?.id || "",
      source: "quick_sale",
      financialImpact,
      accountingTreatment: financialImpact ? "factory_revenue" : "sell_through_only",
      documentType,
      transactionId,
      transactionIds: resolvedTransactionIds,
      invoiceId,
      retailerId: customer?.id || "",
      customerName: customer?.name || customerName || "Walk-in customer",
      customerType: customer?.channel || customerType || "Customer",
      region: customer?.stateName || customer?.region || "Direct sales",
      priority: "Normal",
      status: "delivered",
      paymentType: recordedPaymentType,
      paymentStatus: isCreditSale ? "open" : "paid",
      dueAt: isCreditSale ? dueAt : today,
      createdAt: today,
      updatedAt: today,
      repName,
      repUserId: state.user?.id || "",
      items: invoiceItems
    },
    ...(state.orders || [])
  ];

      state.invoices = [
    {
      id: invoiceId,
      clientId: state.client?.id || "",
      orderId,
      transactionId,
      transactionIds: resolvedTransactionIds,
      retailerId: customer?.id || "",
      customerName: customer?.name || customerName || "Customer",
      customerAddress: customer?.address || "",
      customerPhone: customer?.contactPhone || "",
      issuedAt: today,
      dueAt: isCreditSale ? dueAt : today,
      amount,
      status: isCreditSale ? "open" : "paid",
      paymentType: recordedPaymentType,
      financialImpact,
      accountingTreatment: financialImpact ? "factory_revenue" : "sell_through_only",
      documentType,
      repName,
      repUserId: state.user?.id || "",
      items: invoiceItems
    },
    ...(state.invoices || [])
  ];

  return orderId;
}

function findRetailerByName(state, name) {
  const normalizedName = String(name || "").trim().toLowerCase();

  if (!normalizedName) return null;

  return (state.retailers || []).find((retailer) => (
    String(retailer.name || "").trim().toLowerCase() === normalizedName
  )) || null;
}

function createDispatchSalesOrder(state, {
  dispatchId,
  transactionIds,
  items,
  recipientName,
  recipientType,
  destination,
  dispatchDate,
  expectedDeliveryAt,
  paymentType,
  dispatchArrangement = "stock_transfer",
  depositAmount = 0,
  staffName,
  repUserId = ""
}) {
  const customer = findRetailerByName(state, recipientName);
  const dispatchesToRepresentative = String(recipientType || "").toLowerCase().includes("representative");
  const orderId = createId("ORD");
  const representativeArrangement = dispatchesToRepresentative && ["rep_purchase", "refundable_deposit", "stock_transfer"].includes(dispatchArrangement)
    ? dispatchArrangement
    : dispatchesToRepresentative ? "stock_transfer" : "";
  const documentType = !dispatchesToRepresentative
    ? INVOICE_TYPES.FACTORY_CUSTOMER_INVOICE
    : representativeArrangement === "rep_purchase"
      ? INVOICE_TYPES.REPRESENTATIVE_PURCHASE_RECEIPT
      : representativeArrangement === "refundable_deposit"
        ? INVOICE_TYPES.REPRESENTATIVE_DEPOSIT_RECEIPT
        : INVOICE_TYPES.REPRESENTATIVE_STOCK_TRANSFER_NOTE;
  const invoiceId = nextInvoiceId(state, documentType);
  const isCredit = !dispatchesToRepresentative && String(paymentType || "").toLowerCase().includes("credit");
  const creditLimit = (state.creditLimits || []).find((limit) => (
    normalized(limit.partyName) === normalized(customer?.name || recipientName)
  ));
  const dueDate = new Date(`${dispatchDate}T12:00:00`);
  dueDate.setDate(dueDate.getDate() + Number(creditLimit?.paymentPeriodDays ?? 14));
  const dueAt = isCredit ? dueDate.toISOString().slice(0, 10) : dispatchDate;
  const stockValue = items.reduce((total, item) => total + Number(item.amount ?? (Number(item.quantity || 0) * Number(item.unitPrice || 0))), 0);
  const refundableDeposit = representativeArrangement === "refundable_deposit" ? Math.max(0, Number(depositAmount || 0)) : 0;
  const amount = representativeArrangement === "refundable_deposit" ? refundableDeposit : stockValue;
  const isFactorySale = !dispatchesToRepresentative || representativeArrangement === "rep_purchase";
  const invoiceItems = items.map((item) => ({
    transactionId: item.transactionId || "",
    productId: item.product.id,
    productName: item.product.name,
    quantity: item.quantity,
    packagingType: item.packagingType || "piece",
    packagingQuantity: Number(item.packagingQuantity || item.quantity || 0),
    packagingUnitPrice: Number(item.packagingUnitPrice || packagingUnitPrice(item.product, item.packagingType, state.client)),
    lineAmount: Number(item.amount ?? (Number(item.quantity || 0) * Number(item.unitPrice || 0))),
    unitPrice: Number(item.unitPrice || 0),
    unitCost: Number(item.product.unitCost || 0)
  }));

  state.orders = [
    {
      id: orderId,
      clientId: state.client?.id || "",
      source: "factory_dispatch",
      documentType,
      dispatchArrangement: representativeArrangement,
      depositAmount: refundableDeposit,
      stockValue,
      financialImpact: isFactorySale,
      accountingTreatment: isFactorySale ? "factory_revenue" : representativeArrangement === "refundable_deposit" ? "refundable_deposit" : "representative_custody",
      dispatchId,
      transactionId: transactionIds[0] || "",
      transactionIds,
      invoiceId,
      retailerId: customer?.id || "",
      customerName: customer?.name || recipientName || "Customer",
      customerType: customer?.channel || recipientType || "Customer",
      region: customer?.stateName || customer?.region || destination || "Direct dispatch",
      priority: "Normal",
      status: isFactorySale ? "delivered" : "in_transit",
      paymentType,
      paymentStatus: representativeArrangement === "stock_transfer" ? "recorded" : isCredit ? "open" : "paid",
      creditApplied: isCredit,
      dueAt: expectedDeliveryAt || dispatchDate,
      expectedDeliveryAt: expectedDeliveryAt || dispatchDate,
      originalExpectedDeliveryAt: expectedDeliveryAt || dispatchDate,
      createdAt: dispatchDate,
      updatedAt: dispatchDate,
      deliveredAt: isFactorySale ? dispatchDate : "",
      repName: dispatchesToRepresentative ? recipientName : staffName,
      repUserId: dispatchesToRepresentative ? repUserId : state.user?.id || "",
      items: invoiceItems
    },
    ...(state.orders || [])
  ];

  state.invoices = [
    {
      id: invoiceId,
      clientId: state.client?.id || "",
      orderId,
      dispatchId,
      transactionId: transactionIds[0] || "",
      transactionIds,
      retailerId: customer?.id || "",
      customerName: customer?.name || recipientName || "Customer",
      customerAddress: customer?.address || destination || "",
      customerPhone: customer?.contactPhone || "",
      issuedAt: dispatchDate,
      dueAt,
      amount,
      stockValue,
      depositAmount: refundableDeposit,
      status: representativeArrangement === "stock_transfer" ? "recorded" : isCredit ? "open" : "paid",
      paymentType,
      documentType,
      dispatchArrangement: representativeArrangement,
      financialImpact: isFactorySale,
      accountingTreatment: isFactorySale ? "factory_revenue" : representativeArrangement === "refundable_deposit" ? "refundable_deposit" : "representative_custody",
      collectedBy: recipientName,
      repName: dispatchesToRepresentative ? recipientName : staffName,
      repUserId: dispatchesToRepresentative ? repUserId : state.user?.id || "",
      items: invoiceItems
    },
    ...(state.invoices || [])
  ];

  if (isCredit) updateCreditBalance(state, customer?.name || recipientName, amount);

  return { orderId, invoiceId };
}

function workspaceBaseState(currentState, clientId) {
  if (clientId && currentState.client?.id === clientId) return currentState;
  return ensureStateShape(loadStoredState(clientId) || seedData);
}

function reducer(currentState, action) {
  const state = clone(currentState);

  switch (action.type) {
    case "SET_BACKEND_STATUS": {
      return {
        ...state,
        backend: {
          ...state.backend,
          ...action.payload
        }
      };
    }

    case "SET_AUTH_CONTEXT": {
      return {
        ...state,
        session: action.session || null,
        user: action.user || null,
        backend: {
          ...state.backend,
          configured: true,
          status: action.session ? "authenticated" : "anonymous",
          error: ""
        },
        platformAdmin: false,
        platformOverview: []
      };
    }

    case "SET_WORKSPACE": {
      const baseState = workspaceBaseState(state, action.client?.id);
      baseState.products = applySharedProductImages(baseState.products, action.productImages);

      return {
        ...baseState,
        session: state.session,
        user: state.user,
        client: action.client || null,
        accounts: Array.isArray(action.accounts)
          ? action.accounts.filter((account) => !["accountant", "finance"].includes(String(account.role || "").toLowerCase()))
          : [],
        invites: Array.isArray(action.invites)
          ? action.invites.filter((invite) => !["accountant", "finance"].includes(String(invite.role || "").toLowerCase()))
          : [],
        featureModules: Array.isArray(action.featureModules) ? action.featureModules : baseState.featureModules,
        messages: Array.isArray(action.messages) ? action.messages : baseState.messages,
        notificationReadAt: action.notificationReadAt || baseState.notificationReadAt,
        activityLogs: Array.isArray(action.activityLogs) ? action.activityLogs : baseState.activityLogs,
        packagingChangeRequests: Array.isArray(action.packagingChangeRequests) ? action.packagingChangeRequests : baseState.packagingChangeRequests,
        creditLimits: Array.isArray(action.creditLimits) ? mergeCreditLimitRecords(baseState.creditLimits, action.creditLimits) : baseState.creditLimits,
        creditLimitHistory: Array.isArray(action.creditLimitHistory)
          ? mergeCreditHistoryRecords(baseState.creditLimitHistory, action.creditLimitHistory)
          : baseState.creditLimitHistory,
        backend: state.backend,
        platformAdmin: state.platformAdmin,
        platformOverview: state.platformOverview
      };
    }

    case "SET_AUTHENTICATED_WORKSPACE": {
      const baseState = workspaceBaseState(state, action.client?.id);
      baseState.products = applySharedProductImages(baseState.products, action.productImages);
      const nextState = {
        ...baseState,
        session: action.session || null,
        user: action.user || null,
        client: action.client || null,
        accounts: Array.isArray(action.accounts)
          ? action.accounts.filter((account) => !["accountant", "finance"].includes(String(account.role || "").toLowerCase()))
          : [],
        invites: Array.isArray(action.invites)
          ? action.invites.filter((invite) => !["accountant", "finance"].includes(String(invite.role || "").toLowerCase()))
          : [],
        featureModules: Array.isArray(action.featureModules) ? action.featureModules : baseState.featureModules,
        messages: Array.isArray(action.messages) ? action.messages : baseState.messages,
        notificationReadAt: action.notificationReadAt || baseState.notificationReadAt,
        activityLogs: Array.isArray(action.activityLogs) ? action.activityLogs : baseState.activityLogs,
        packagingChangeRequests: Array.isArray(action.packagingChangeRequests) ? action.packagingChangeRequests : baseState.packagingChangeRequests,
        creditLimits: Array.isArray(action.creditLimits) ? mergeCreditLimitRecords(baseState.creditLimits, action.creditLimits) : baseState.creditLimits,
        creditLimitHistory: Array.isArray(action.creditLimitHistory)
          ? mergeCreditHistoryRecords(baseState.creditLimitHistory, action.creditLimitHistory)
          : baseState.creditLimitHistory,
        backend: {
          ...baseState.backend,
          configured: true,
          status: action.session ? "authenticated" : "anonymous",
          error: ""
        },
        platformAdmin: false,
        platformOverview: []
      };

      automaticallyDelayOrders(nextState);
      return nextState;
    }

    case "SET_OPERATIONAL_RECORDS": {
      if (!state.client?.id || !action.collections || typeof action.collections !== "object") return state;
      const supportedCollections = new Set([
        "products", "stockCategories", "stockAssignments", "stockTransactions",
        "productionBatches", "productionPlans", "productionIssues", "retailers", "orders", "invoices", "salesReports",
        "correctionRequests", "stockRequests", "purchaseOrders", "procurementOrders",
        "stockAdditionRequests", "routes", "creditLimits", "creditLimitHistory", "activityLogs"
      ]);
      const nextState = { ...state };

      Object.entries(action.collections).forEach(([collection, records]) => {
        if (!supportedCollections.has(collection) || !Array.isArray(records)) return;
        if (collection === "products") {
          const localProducts = new Map((state.products || []).map((product) => [String(product.id || ""), product]));
          nextState.products = clone(records).map((product) => {
            const localProduct = localProducts.get(String(product.id || ""));
            const remoteImageSynced = product.imageRemoteSynced === true;
            const hasDurableLocalImage = Boolean(localProduct?.imageStorageKey || product.imageStorageKey);
            return {
              ...product,
              imageUrl: remoteImageSynced || hasDurableLocalImage
                ? (localProduct?.imageUrl || product.imageUrl || "")
                : "",
              imageStorageKey: localProduct?.imageStorageKey || product.imageStorageKey || "",
              imageRemoteSynced: remoteImageSynced
            };
          });
          return;
        }
        if (collection === "stockCategories") {
          nextState.stockCategories = mergeSeedRecords(records, seedData.stockCategories);
          return;
        }
        nextState[collection] = clone(records);
      });

      automaticallyDelayOrders(nextState, false);
      return ensureQuickSaleOrders(nextState);
    }

    case "SET_PLATFORM_CONTEXT": {
      return {
        ...ensureStateShape(seedData),
        session: action.session || null,
        user: action.user || null,
        client: null,
        accounts: [],
        invites: [],
        featureModules: [],
        activityLogs: [],
        platformAdmin: Boolean(action.session),
        platformOverview: action.platformOverview || [],
        backend: {
          ...state.backend,
          configured: true,
          status: action.session ? "platform_authenticated" : "anonymous",
          error: ""
        }
      };
    }

    case "SET_FEATURE_MODULES": {
      return {
        ...state,
        featureModules: Array.isArray(action.featureModules) ? action.featureModules : state.featureModules
      };
    }

    case "SET_PACKAGING_WORKSPACE_STATE": {
      return {
        ...state,
        client: state.client ? {
          ...state.client,
          packagingTypes: Array.isArray(action.packagingTypes) ? action.packagingTypes : state.client.packagingTypes,
          packagingDefaults: action.packagingDefaults && typeof action.packagingDefaults === "object"
            ? action.packagingDefaults
            : state.client.packagingDefaults
        } : state.client,
        packagingChangeRequests: Array.isArray(action.packagingChangeRequests)
          ? action.packagingChangeRequests
          : state.packagingChangeRequests
      };
    }

    case "CLEAR_AUTH_CONTEXT": {
      return {
        ...ensureStateShape(seedData),
        session: null,
        user: null,
        client: null,
        accounts: [],
        invites: [],
        activityLogs: [],
        platformAdmin: false,
        platformOverview: [],
        backend: {
          ...state.backend,
          status: "anonymous",
          error: ""
        }
      };
    }

    case "CREATE_CLIENT": {
      const client = createClientProfile(action.payload);
      const userEmail = String(state.user?.email || "").trim().toLowerCase();
      const userName = state.user?.user_metadata?.full_name || userEmail || "CEO";
      const hasCurrentUserAccount = state.accounts.some((account) => (
        account.userId === state.user?.id ||
        (userEmail && String(account.email || "").trim().toLowerCase() === userEmail)
      ));
      const ceoAccount = hasCurrentUserAccount
        ? null
        : {
            id: createId("USR"),
            clientId: client.id,
            userId: state.user?.id || "",
            name: userName,
            email: userEmail || "ceo@distroiq.local",
            role: "ceo",
            status: "active",
            temporaryPassword: "",
            passwordResetRequired: false,
            createdAt: new Date().toISOString()
          };

      state.client = client;
      if (ceoAccount) {
        state.accounts = [ceoAccount, ...state.accounts];
      }
      appendActivityLog(state, {
        clientId: client.id,
        actionType: "created",
        recordType: "company",
        recordLabel: client.companyName,
        summary: "Created factory workspace with CEO access"
      });

      return {
        ...state,
        client,
        accounts: state.accounts
      };
    }

    case "UPDATE_CLIENT_SETTINGS": {
      if (!state.client?.id) return state;

      appendActivityLog(state, {
        clientId: state.client.id,
        actionType: "updated",
        recordType: "company",
        recordLabel: action.payload.companyName || state.client.companyName,
        summary: "Updated factory settings"
      });

      return {
        ...state,
        client: {
          ...state.client,
          ...action.payload
        }
      };
    }

    case "SYNC_CLIENT_SETTINGS": {
      if (!state.client?.id) return state;

      return {
        ...state,
        client: {
          ...state.client,
          ...action.payload
        }
      };
    }

    case "REQUEST_PACKAGING_SETTINGS_CHANGE": {
      if (!state.client?.id || !["admin", "store_keeper"].includes(currentUserRole(state))) return state;
      const allowedTypes = new Set(["piece", "carton", "pack", "tray", "pouch", "sachet", "jar", "display_box"]);
      const packagingTypes = [...new Set(["piece", ...(action.packagingTypes || [])])].filter((type) => allowedTypes.has(type));
      const packagingDefaults = Object.fromEntries(packagingTypes.map((type) => [
        type,
        type === "piece" ? 1 : Math.floor(Number(action.packagingDefaults?.[type] || 0))
      ]));
      const alreadyPending = (state.packagingChangeRequests || []).some((request) => (
        request.status === "pending" && request.requestedByUserId === state.user?.id
      ));
      if (alreadyPending || packagingTypes.some((type) => packagingDefaults[type] < 1)) return state;

      const request = {
        id: createId("PKG"),
        clientId: state.client.id,
        requestedByUserId: state.user?.id || "",
        requestedBy: currentActorName(state),
        packagingTypes,
        packagingDefaults,
        status: "pending",
        requestedAt: new Date().toISOString()
      };
      state.packagingChangeRequests = [request, ...(state.packagingChangeRequests || [])];
      appendActivityLog(state, {
        clientId: state.client.id,
        actionType: "requested",
        recordType: "packaging_settings",
        recordLabel: request.id,
        summary: `${request.requestedBy} requested a Sales Packaging change`
      });
      return state;
    }

    case "APPROVE_PACKAGING_SETTINGS_CHANGE": {
      if (currentUserRole(state) !== "ceo") return state;
      const request = (state.packagingChangeRequests || []).find((item) => item.id === action.requestId);
      if (!request || request.status !== "pending") return state;
      request.status = "approved";
      request.reviewedAt = new Date().toISOString();
      request.reviewedBy = currentActorName(state);
      state.client.packagingTypes = [...request.packagingTypes];
      state.client.packagingDefaults = { ...request.packagingDefaults };
      appendActivityLog(state, {
        clientId: state.client.id,
        actionType: "approved",
        recordType: "packaging_settings",
        recordLabel: request.id,
        summary: `CEO approved the Sales Packaging change requested by ${request.requestedBy}`
      });
      return state;
    }

    case "REJECT_PACKAGING_SETTINGS_CHANGE": {
      if (currentUserRole(state) !== "ceo") return state;
      const request = (state.packagingChangeRequests || []).find((item) => item.id === action.requestId);
      const note = String(action.note || "").trim();
      if (!request || request.status !== "pending" || !note) return state;
      request.status = "rejected";
      request.reviewedAt = new Date().toISOString();
      request.reviewedBy = currentActorName(state);
      request.reviewNote = note.slice(0, 500);
      appendActivityLog(state, {
        clientId: state.client.id,
        actionType: "rejected",
        recordType: "packaging_settings",
        recordLabel: request.id,
        summary: `CEO rejected the Sales Packaging change requested by ${request.requestedBy}`
      });
      return state;
    }

    case "DELETE_CLIENT_ACCOUNT": {
      return {
        ...state,
        session: null,
        user: null,
        client: null,
        accounts: [],
        invites: [],
        messages: [],
        notificationReadAt: "",
        notificationClearedAt: "",
        dismissedNotificationIds: [],
        activityLogs: [],
        salesReports: [],
        creditLimitHistory: [],
        productionBatches: [],
        productionPlans: [],
        productionIssues: [],
        offlineSalesQueue: [],
        packagingChangeRequests: [],
        correctionRequests: [],
        stockRequests: [],
        stockAdditionRequests: [],
        purchaseOrders: [],
        procurementOrders: [],
        retailers: [],
        orders: [],
        routes: [],
        products: [],
        stockCategories: [],
        stockAssignments: [],
        stockTransactions: [],
        creditLimits: [],
        invoices: [],
        backend: {
          ...state.backend,
          status: "anonymous",
          error: ""
        }
      };
    }

    case "RESET_WORKSPACE_DATA_SCOPE": {
      if (!state.client?.id || currentUserRole(state) !== "ceo") return state;
      const scope = String(action.scope || "").trim().toLowerCase();
      const markerCreatedAt = action.createdAt || new Date().toISOString();
      const activityResetMarker = {
        id: action.markerId || `ACTIVITY-RESET-${Date.now()}`,
        clientId: state.client.id,
        actionType: "reset",
        recordType: "activity_reset_marker",
        recordLabel: "",
        actorUserId: state.user?.id || "",
        actorName: "CEO",
        actorEmail: state.user?.email || "",
        summary: "",
        hidden: true,
        createdAt: markerCreatedAt
      };

      if (scope === "adjustments") {
        state.correctionRequests = [];
        return state;
      }
      if (scope === "customers") {
        state.retailers = [];
        return state;
      }
      if (scope === "finance") {
        state.invoices = (state.invoices || []).filter((invoice) => isRepresentativeSellThroughInvoice(invoice, state));
        state.salesReports = [];
        state.creditLimits = [];
        state.creditLimitHistory = [];
        state.stockTransactions = (state.stockTransactions || []).filter((transaction) => (
          isRepresentativeSellThroughTransaction(transaction) ||
          !["sale", "return", "write off", "write_off"].includes(String(transaction.type || "").trim().toLowerCase())
        ));
        state.orders = (state.orders || []).filter((order) => (
          String(order.source || "").trim().toLowerCase() !== "quick_sale" ||
          isRepresentativeSellThroughOrder(order, state)
        ));
        return state;
      }
      if (scope === "activity") {
        state.activityLogs = [activityResetMarker];
        state.salesReports = [];
        return state;
      }
      if (scope !== "factory") return state;

      state.products = [];
      state.stockCategories = clone(seedData.stockCategories);
      state.stockAssignments = [];
      state.stockTransactions = [];
      state.productionBatches = [];
      state.productionPlans = [];
      state.productionIssues = [];
      state.retailers = [];
      state.orders = [];
      state.invoices = [];
      state.salesReports = [];
      state.correctionRequests = [];
      state.stockRequests = [];
      state.stockAdditionRequests = [];
      state.purchaseOrders = [];
      state.procurementOrders = [];
      state.routes = [];
      state.creditLimits = [];
      state.creditLimitHistory = [];
      state.activityLogs = [];
      state.packagingChangeRequests = [];
      state.offlineSalesQueue = [];
      state.notificationReadAt = "";
      state.notificationClearedAt = "";
      state.dismissedNotificationIds = [];
      return state;
    }

    case "DELETE_CEO_DATA_RECORDS": {
      if (!state.client?.id || currentUserRole(state) !== "ceo") return state;
      const scope = String(action.scope || "").trim().toLowerCase();
      const ids = [...new Set((action.ids || []).map((id) => String(id || "")).filter(Boolean))];
      const selected = new Set(ids);
      if (!ids.length) return state;

      if (scope === "sales_reports") {
        state.salesReports = (state.salesReports || []).filter((report) => !selected.has(String(report.id || "")));
        return state;
      }
      if (scope === "invoices") {
        const linkedOrderIds = new Set((state.invoices || [])
          .filter((invoice) => selected.has(String(invoice.id || "")))
          .map((invoice) => String(invoice.orderId || ""))
          .filter(Boolean));
        state.invoices = (state.invoices || []).filter((invoice) => !selected.has(String(invoice.id || "")));
        state.orders = (state.orders || []).map((order) => (
          linkedOrderIds.has(String(order.id || "")) || selected.has(`INV-${order.id}`)
            ? { ...order, invoiceDeleted: true }
            : order
        ));
        return state;
      }
      if (scope === "product_revenue") {
        deleteProductRevenueLines(state, ids);
        return state;
      }
      if (scope === "representative_credit_limits" || scope === "customer_credit_limits") {
        state.creditLimits = (state.creditLimits || []).filter((limit) => !selected.has(String(limit.id || "")));
        return state;
      }
      if (scope === "representative_credit_history" || scope === "customer_credit_history") {
        state.creditLimitHistory = (state.creditLimitHistory || []).filter((entry) => !selected.has(String(entry.id || "")));
        return state;
      }
      if (scope === "activity") {
        state.activityLogs = (state.activityLogs || []).filter((entry) => !selected.has(String(entry.id || "")));
        return state;
      }
      if (scope === "orders") {
        deleteSalesOrders(state, ids);
        return state;
      }
      return state;
    }

    case "DELETE_ALL_PRODUCT_REVENUE_DATA": {
      if (!state.client?.id || currentUserRole(state) !== "ceo") return state;

      const deletedTransactionIds = new Set(
        (state.stockTransactions || [])
          .filter((transaction) => (
            ["sale", "return"].includes(normalized(transaction.type)) &&
            !isRepresentativeSellThroughTransaction(transaction)
          ))
          .map((transaction) => String(transaction.id || ""))
          .filter(Boolean)
      );
      const deletedOrderIds = new Set(
        (state.orders || [])
          .filter((order) => !isRepresentativeSellThroughOrder(order, state))
          .map((order) => String(order.id || ""))
          .filter(Boolean)
      );
      const deletedInvoices = (state.invoices || []).filter((invoice) => !isRepresentativeSellThroughInvoice(invoice, state));

      deletedInvoices
        .filter((invoice) => normalized(invoice.paymentType).includes("credit") && normalized(invoice.status) !== "paid")
        .forEach((invoice) => updateCreditBalance(state, invoice.customerName || invoice.repName, -Number(invoice.amount || 0)));

      state.stockTransactions = (state.stockTransactions || []).filter((transaction) => (
        !deletedTransactionIds.has(String(transaction.id || ""))
      ));
      state.orders = (state.orders || []).filter((order) => !deletedOrderIds.has(String(order.id || "")));
      state.invoices = (state.invoices || []).filter((invoice) => !deletedInvoices.includes(invoice));
      state.routes = (state.routes || []).map((route) => ({
        ...route,
        orderIds: (route.orderIds || []).filter((orderId) => !deletedOrderIds.has(String(orderId || "")))
      }));
      state.correctionRequests = (state.correctionRequests || []).filter((request) => (
        !deletedTransactionIds.has(String(request.transactionId || ""))
      ));
      state.offlineSalesQueue = (state.offlineSalesQueue || []).filter((entry) => (
        !deletedTransactionIds.has(String(entry.transactionId || "")) &&
        !deletedOrderIds.has(String(entry.orderId || ""))
      ));

      appendActivityLog(state, {
        clientId: state.client.id,
        actionType: "deleted",
        recordType: "product_revenue",
        recordLabel: "All records",
        summary: "Deleted all product revenue records"
      });
      return state;
    }

    case "DELETE_ALL_SALES_ORDERS_DATA": {
      if (!state.client?.id || currentUserRole(state) !== "ceo") return state;
      deleteSalesOrders(state, (state.orders || []).map((order) => order.id), { includeAllSales: true });

      appendActivityLog(state, {
        clientId: state.client.id,
        actionType: "deleted",
        recordType: "sales_order",
        recordLabel: "All records",
        summary: "Deleted all sales orders"
      });
      return state;
    }

    case "UPDATE_MY_PROFILE": {
      if (state.client?.id) {
        appendActivityLog(state, {
          clientId: state.client.id,
          actionType: "updated",
          recordType: "account",
          recordLabel: action.name,
          summary: "Updated profile details"
        });
      }

      return {
        ...state,
        user: state.user
          ? {
              ...state.user,
              user_metadata: {
                ...(state.user.user_metadata || {}),
                full_name: action.name,
                avatar_url: String(action.staffImageUrl ?? state.user.user_metadata?.avatar_url ?? "")
              }
            }
          : state.user,
        accounts: state.accounts.map((account) =>
          account.userId === state.user?.id
            ? {
                ...account,
                name: action.name,
                phoneNumber: String(action.phoneNumber || account.phoneNumber || ""),
                staffImageUrl: String(action.staffImageUrl ?? account.staffImageUrl ?? "")
              }
            : account
        )
      };
    }

    case "CREATE_ACCOUNT": {
      if (!state.client?.id || !["sales_rep", "store_keeper", "production_manager", "production_supervisor", "admin"].includes(action.payload?.role)) return state;
      const { account, invite } = createAccountInvite({
        client: state.client,
        ...action.payload
      });
      appendActivityLog(state, {
        clientId: state.client.id,
        actionType: "invited",
        recordType: "account",
        recordLabel: account.email,
        summary: `Invited ${account.name}`
      });

      return {
        ...state,
        accounts: [...state.accounts, account],
        invites: [...state.invites, invite]
      };
    }

    case "SET_ACCOUNT_STATUS": {
      if (!state.client?.id || currentUserRole(state) !== "ceo") return state;
      const account = state.accounts.find((item) => item.id === action.accountId && item.clientId === state.client.id);
      if (!account || account.userId === state.user?.id) return state;

      account.status = action.active ? "active" : "disabled";
      appendActivityLog(state, {
        clientId: state.client.id,
        actionType: action.active ? "reactivated" : "deactivated",
        recordType: "account",
        recordLabel: account.email,
        summary: `${action.active ? "Activated" : "Deactivated"} ${account.name}`
      });
      return state;
    }

    case "SET_ACCOUNT_ROLE": {
      if (!state.client?.id || currentUserRole(state) !== "ceo") return state;
      const account = state.accounts.find((item) => item.id === action.accountId && item.clientId === state.client.id);
      const nextRole = normalizeRole(action.role);
      if (
        !account ||
        account.userId === state.user?.id ||
        normalizeRole(account.role) === "ceo" ||
        !["sales_rep", "store_keeper", "production_manager", "production_supervisor", "admin"].includes(nextRole)
      ) return state;

      const previousRole = normalizeRole(account.role);
      account.role = nextRole;
      appendActivityLog(state, {
        clientId: state.client.id,
        actionType: "updated",
        recordType: "account",
        recordLabel: account.email,
        summary: `Changed ${account.name} from ${textLabel(previousRole)} to ${textLabel(nextRole)}`
      });
      return state;
    }

    case "DELETE_ACCOUNT": {
      if (!state.client?.id || currentUserRole(state) !== "ceo") return state;
      const account = state.accounts.find((item) => item.id === action.accountId && item.clientId === state.client.id);
      if (!account || account.userId === state.user?.id || normalizeRole(account.role) === "ceo") return state;

      appendActivityLog(state, {
        clientId: state.client.id,
        actionType: "deleted",
        recordType: "account",
        recordLabel: account.email,
        summary: `Deleted staff account for ${account.name}`
      });
      state.accounts = state.accounts.filter((item) => item.id !== account.id);
      state.invites = state.invites.filter((invite) => (
        invite.membershipId !== account.id && String(invite.to || invite.email || "").toLowerCase() !== String(account.email || "").toLowerCase()
      ));
      return state;
    }

    case "COMPLETE_PASSWORD_RESET": {
      const account = state.accounts.find(
        (item) => item.id === action.accountId && item.clientId === action.clientId
      );

      if (account) {
        account.status = "active";
        account.temporaryPassword = "";
        account.passwordResetRequired = false;
        account.passwordLastSetAt = new Date().toISOString();
        appendActivityLog(state, {
          clientId: account.clientId,
          actionType: "completed",
          recordType: "account",
          recordLabel: account.email,
          summary: "Completed account setup"
        });
      }

      return state;
    }

    case "SEND_MESSAGE": {
      if (!state.client?.id) return state;

      const recipientAccountId = String(action.recipientAccountId || "").trim();
      const body = String(action.body || "").trim();
      const sender = currentWorkspaceAccount(state);
      const actor = getCurrentActor(state);
      const canSendToAllStaff = currentUserRole(state) === "ceo";
      const shouldSendToAllStaff = Boolean(action.sendToAllStaff) || recipientAccountId === "__all_staff__";
      const recipients = shouldSendToAllStaff && canSendToAllStaff
        ? (state.accounts || []).filter((account) => (
            account.clientId === state.client.id &&
            account.id !== sender?.id &&
            !["deactivated", "disabled"].includes(String(account.status || "").toLowerCase())
          ))
        : (state.accounts || []).filter((account) => (
            account.clientId === state.client.id && account.id === recipientAccountId
          ));

      if (!recipients.length || !body) return state;

      state.messages = [
        ...recipients.map((recipient) => ({
          id: createId("MSG"),
          clientId: state.client.id,
          fromAccountId: sender?.id || "",
          fromUserId: state.user?.id || sender?.userId || "",
          fromName: sender?.name || actor.name || "Team member",
          fromEmail: sender?.email || actor.email || state.user?.email || "",
          fromRole: sender?.role || "",
          toAccountId: recipient.id,
          toUserId: recipient.userId || "",
          toName: recipient.name,
          toEmail: recipient.email || "",
          toRole: recipient.role || "",
          body,
          audience: shouldSendToAllStaff ? "all_staff" : "direct",
          readAt: "",
          createdAt: new Date().toISOString()
        })),
        ...(state.messages || [])
      ];

      return state;
    }

    case "DELETE_MESSAGES_FOR_ME": {
      if (!state.client?.id) return state;

      const ids = new Set((action.messageIds || []).map(String).filter(Boolean));
      if (!ids.size) return state;

      state.messages = (state.messages || []).filter((message) => !(
        ids.has(String(message.id || "")) &&
        (
          messageBelongsToCurrentUser(state, message) ||
          messageIsFromAccount(message, currentWorkspaceAccount(state))
        )
      ));
      return state;
    }

    case "UNSEND_MESSAGES": {
      if (!state.client?.id) return state;

      const ids = new Set((action.messageIds || []).map(String).filter(Boolean));
      const currentAccount = currentWorkspaceAccount(state);
      if (!ids.size || !currentAccount) return state;

      state.messages = (state.messages || []).filter((message) => !(
        ids.has(String(message.id || "")) &&
        messageIsFromAccount(message, currentAccount)
      ));
      return state;
    }

    case "CLEAR_MESSAGE_CONVERSATION": {
      if (!state.client?.id) return state;

      const currentAccount = currentWorkspaceAccount(state);
      const allStaff = Boolean(action.allStaff);
      const peerAccount = allStaff
        ? null
        : (state.accounts || []).find((account) => account.id === action.peerAccountId);

      if (!currentAccount || (!allStaff && !peerAccount)) return state;

      state.messages = (state.messages || []).filter((message) => {
        if (message.clientId !== state.client.id) return true;
        if (allStaff) {
          return !(message.audience === "all_staff" && messageIsFromAccount(message, currentAccount));
        }

        const sentToPeer = messageIsFromAccount(message, currentAccount) && messageIsToAccount(message, peerAccount);
        const receivedFromPeer = messageIsFromAccount(message, peerAccount) && messageIsToAccount(message, currentAccount);
        return !sentToPeer && !receivedFromPeer;
      });
      return state;
    }

    case "MARK_CONVERSATION_READ": {
      if (!state.client?.id) return state;

      const peerAccountId = String(action.peerAccountId || "").trim();
      const currentAccount = currentWorkspaceAccount(state);

      if (!peerAccountId || !currentAccount) return state;

      const peerAccount = (state.accounts || []).find((account) => account.id === peerAccountId);
      if (!peerAccount) return state;

      const readAt = new Date().toISOString();
      (state.messages || []).forEach((message) => {
        if (
          messageBelongsToCurrentUser(state, message) &&
          messageIsFromAccount(message, peerAccount) &&
          !message.readAt
        ) {
          message.readAt = readAt;
        }
      });

      return state;
    }

    case "MARK_MESSAGES_READ": {
      if (!state.client?.id) return state;

      const readAt = new Date().toISOString();
      (state.messages || []).forEach((message) => {
        if (messageBelongsToCurrentUser(state, message) && !message.readAt) {
          message.readAt = readAt;
        }
      });

      return state;
    }

    case "MARK_NOTIFICATIONS_READ": {
      if (!state.client?.id) return state;

      state.notificationReadAt = new Date().toISOString();
      return state;
    }

    case "DISMISS_NOTIFICATIONS": {
      if (!state.client?.id) return state;

      state.dismissedNotificationIds = [...new Set([
        ...(state.dismissedNotificationIds || []).map(String),
        ...(action.notificationIds || []).map(String)
      ])].slice(-500);
      return state;
    }

    case "DISMISS_ALL_NOTIFICATIONS": {
      if (!state.client?.id) return state;
      state.notificationClearedAt = new Date().toISOString();
      state.dismissedNotificationIds = [];
      return state;
    }

    case "ADVANCE_ORDER": {
      if (!canManageOrderFlow(state)) return state;
      const order = state.orders.find((item) => item.id === action.orderId);
      if (order) {
        order.status = nextOrderStatus(order.status);
        order.updatedAt = todayISO();
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: "updated",
          recordType: "order",
          recordLabel: order.id,
          summary: `${order.id} sales order moved to ${textLabel(order.status)}`
        });
      }
      return state;
    }

    case "SET_ORDER_STATUS": {
      if (!canManageOrderFlow(state)) return state;
      const order = state.orders.find((item) => item.id === action.orderId);
      const requestedStatus = normalized(action.status);
      if (!["in_transit", "delayed", "delivered"].includes(requestedStatus)) return state;
      const nextStatus = normalizedOrderStatus(requestedStatus);

      if (order && order.status !== nextStatus) {
        order.status = nextStatus;
        order.updatedAt = todayISO();
        if (nextStatus === "delayed") {
          order.delaySource = "manual";
          order.delayDetectedAt = order.delayDetectedAt || new Date().toISOString();
          order.delayReason = order.delayReason || "Delivery issue under review";
        }
        if (nextStatus === "delivered") {
          order.deliveredAt = action.deliveredAt || new Date().toISOString();
        }
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: "updated",
          recordType: "order",
          recordLabel: order.id,
          summary: `${order.id} sales order set to ${textLabel(order.status)}`
        });
      }
      return state;
    }

    case "DELAY_ORDER": {
      if (!canManageOrderFlow(state)) return state;
      const order = state.orders.find((item) => item.id === action.orderId);
      if (order && order.status !== "delivered") {
        order.status = "delayed";
        order.updatedAt = todayISO();
        order.delaySource = "manual";
        order.delayDetectedAt = order.delayDetectedAt || new Date().toISOString();
        order.delayReason = String(action.reason || order.delayReason || "Delivery issue under review").trim();
        order.delayNote = String(action.note || order.delayNote || "").trim();
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: "delayed",
          recordType: "order",
          recordLabel: order.id,
          summary: `${order.id} sales order marked delayed`
        });
      }
      return state;
    }

    case "AUTO_UPDATE_DELAYED_ORDERS": {
      automaticallyDelayOrders(state);
      return state;
    }

    case "UPDATE_ORDER_DELAY_DETAILS": {
      if (!canManageOrderFlow(state)) return state;

      const order = state.orders.find((item) => item.id === action.orderId);
      if (!order || order.status === "delivered") return state;

      const previous = {
        reason: order.delayReason || "",
        note: order.delayNote || "",
        expectedDeliveryAt: order.expectedDeliveryAt || ""
      };
      const revisedExpectedDeliveryAt = dateOnly(action.revisedExpectedDeliveryAt);
      const actor = currentActorLabel(state);

      if (
        (action.revisedExpectedDeliveryAt && !isValidISODate(revisedExpectedDeliveryAt)) ||
        (revisedExpectedDeliveryAt && revisedExpectedDeliveryAt < todayISO())
      ) {
        return state;
      }

      order.status = "delayed";
      order.delaySource = order.delaySource || "manual";
      order.delayDetectedAt = order.delayDetectedAt || new Date().toISOString();
      order.delayReason = String(action.reason || "Delivery issue under review").trim().slice(0, 120);
      order.delayNote = String(action.note || "").trim().slice(0, 500);
      if (revisedExpectedDeliveryAt) order.expectedDeliveryAt = revisedExpectedDeliveryAt;
      order.delayUpdatedAt = new Date().toISOString();
      order.delayUpdatedBy = actor;
      order.delayDays = daysBetween(order.originalExpectedDeliveryAt || expectedDeliveryDate(order), todayISO());
      order.updatedAt = todayISO();
      order.delayHistory = [
        {
          id: createId("DLY"),
          changedAt: order.delayUpdatedAt,
          changedBy: actor,
          previous,
          reason: order.delayReason,
          note: order.delayNote,
          expectedDeliveryAt: order.expectedDeliveryAt
        },
        ...(order.delayHistory || [])
      ];

      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "updated",
        recordType: "order",
        recordLabel: order.id,
        summary: `${actor} updated the delay plan for ${order.id}`
      });
      return state;
    }

    case "RECORD_PRODUCTION_USAGE": {
      if (!["ceo", "store_keeper"].includes(currentUserRole(state))) return state;

      const materials = Array.isArray(action.materials) ? action.materials : [];
      const materialIds = materials.map((material) => String(material.productId || "").trim()).filter(Boolean);
      const uniqueMaterialIds = new Set(materialIds);
      const productRows = materials.map((material) => ({
        product: state.products.find((item) => item.id === material.productId),
        quantity: Number(material.quantity || 0)
      }));
      const finishedProduct = state.products.find((item) => item.id === action.finishedProductId);
      const quantityProduced = Number(action.quantityProduced || 0);
      const batchDate = dateOnly(action.batchDate);
      const batchReference = String(action.batchReference || "").trim();
      const purpose = String(action.purpose || "").trim();
      const duplicateReference = (state.productionBatches || []).some((batch) => (
        normalized(batch.reference) === normalized(batchReference)
      ));
      const valid = (
        isValidISODate(batchDate) &&
        batchReference &&
        batchReference.length <= 80 &&
        purpose &&
        purpose.length <= 160 &&
        !duplicateReference &&
        materialIds.length === productRows.length &&
        uniqueMaterialIds.size === materialIds.length &&
        finishedProduct &&
        finishedProduct.status !== "inactive" &&
        stockCategoryIdForProduct(finishedProduct) === "finished_products" &&
        Number.isFinite(Number(finishedProduct.stock)) &&
        Number.isFinite(quantityProduced) &&
        quantityProduced > 0 &&
        Number.isFinite(Number(finishedProduct.stock) + quantityProduced) &&
        productRows.every(({ product, quantity }) => (
          product &&
          product.status !== "inactive" &&
          stockCategoryIdForProduct(product) === "raw_materials" &&
          Number.isFinite(Number(product.stock)) &&
          Number.isFinite(quantity) &&
          quantity > 0 &&
          quantity <= Number(product.stock || 0)
        ))
      );

      if (!valid) return state;

      const batchId = createId("BATCH");
      const recordedBy = currentActorName(state);
      const recordedMaterials = productRows.map(({ product, quantity }) => {
        product.stock = Number(product.stock || 0) - quantity;
        product.updatedAt = todayISO();
        return {
          productId: product.id,
          productName: product.name,
          quantity,
          unit: product.unit || "unit",
          unitCostAtUse: Number(product.unitCost || 0)
        };
      });
      finishedProduct.stock = Number(finishedProduct.stock || 0) + quantityProduced;
      finishedProduct.updatedAt = todayISO();
      finishedProduct.soldOutAt = "";
      state.productionBatches = [{
        id: batchId,
        clientId: state.client?.id || "",
        reference: batchReference,
        batchDate,
        finishedProductId: finishedProduct.id,
        finishedProductName: finishedProduct.name,
        quantityProduced,
        packagingBreakdown: Array.isArray(action.packagingBreakdown) ? action.packagingBreakdown.map((item) => ({
          packagingType: String(item.packagingType || "piece"),
          packagingQuantity: Number(item.packagingQuantity || 0),
          quantity: Number(item.quantity || 0)
        })).filter((item) => item.packagingQuantity > 0 && item.quantity > 0) : [],
        outputUnit: finishedProduct.unit || "unit",
        purpose,
        notes: String(action.notes || "").trim().slice(0, 500),
        materials: recordedMaterials,
        recordedBy,
        createdAt: new Date().toISOString()
      }, ...(state.productionBatches || [])];
      const productionTransactions = recordedMaterials.map((material) => {
        return {
          id: createId("TXN"),
          clientId: state.client?.id || "",
          type: "production usage",
          productId: material.productId,
          productName: material.productName,
          quantity: material.quantity,
          unit: material.unit,
          amount: 0,
          partyType: "Production batch",
          partyName: batchReference,
          date: batchDate,
          createdAt: new Date().toISOString(),
          recordedBy,
          movementDirection: "out",
          batchId,
          batchReference,
          finishedProductId: finishedProduct.id,
          finishedProductName: finishedProduct.name,
          purpose
        };
      });
      state.stockTransactions = [
        ...productionTransactions,
        {
          id: createId("TXN"),
          clientId: state.client?.id || "",
          type: "production output",
          productId: finishedProduct.id,
          productName: finishedProduct.name,
          quantity: quantityProduced,
          packagingBreakdown: Array.isArray(action.packagingBreakdown) ? action.packagingBreakdown : [],
          unit: finishedProduct.unit || "unit",
          amount: 0,
          partyType: "Production batch",
          partyName: batchReference,
          date: batchDate,
          createdAt: new Date().toISOString(),
          recordedBy,
          movementDirection: "in",
          batchId,
          batchReference,
          purpose
        },
        ...(state.stockTransactions || [])
      ];
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "used",
        recordType: "production_batch",
        recordLabel: batchReference,
        summary: recordedMaterials.length
          ? `${recordedBy} used ${recordedMaterials.length} stock material${recordedMaterials.length === 1 ? "" : "s"} to produce ${quantityProduced} ${finishedProduct.name} for ${purpose}`
          : `${recordedBy} produced ${quantityProduced} ${finishedProduct.name} for ${purpose}`
      });
      return state;
    }

    case "CREATE_PRODUCTION_PLAN": {
      if (!canManageProductionFlow(state)) return state;
      const cadence = action.cadence === "weekly" ? "weekly" : "daily";
      const startDate = dateOnly(action.startDate);
      const endDate = dateOnly(action.endDate || action.startDate);
      const lines = (Array.isArray(action.lines) ? action.lines : []).map((line) => {
        const product = state.products.find((item) => item.id === line.productId);
        return {
          productId: String(line.productId || ""),
          productName: String(product?.name || line.productName || ""),
          quantity: Math.max(0, Number(line.quantity || 0))
        };
      }).filter((line) => line.productId && line.productName && line.quantity > 0);
      const uniqueProductIds = new Set(lines.map((line) => line.productId));
      const validProducts = lines.every((line) => state.products.some((product) => (
        product.id === line.productId &&
        product.status !== "inactive" &&
        stockCategoryIdForProduct(product) === "finished_products"
      )));
      if (
        !isValidISODate(startDate) || !isValidISODate(endDate) || endDate < startDate ||
        !lines.length || uniqueProductIds.size !== lines.length || !validProducts
      ) return state;

      const plan = {
        id: createId("PLAN"),
        clientId: state.client?.id || "",
        name: String(action.name || `${cadence === "weekly" ? "Weekly" : "Daily"} production plan`).trim().slice(0, 120),
        cadence,
        startDate,
        endDate,
        lines,
        team: String(action.team || "Production Team").trim().slice(0, 120),
        shift: String(action.shift || "Day shift").trim().slice(0, 80),
        machine: String(action.machine || "Production line").trim().slice(0, 120),
        notes: String(action.notes || "").trim().slice(0, 500),
        status: "planned",
        createdBy: currentActorName(state),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.productionPlans = [plan, ...(state.productionPlans || [])];
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "planned",
        recordType: "production_plan",
        recordLabel: plan.id,
        summary: `${plan.createdBy} created ${plan.name} for ${lines.length} product${lines.length === 1 ? "" : "s"}`
      });
      return state;
    }

    case "CREATE_ASSIGNED_PRODUCTION_PLAN": {
      if (!canManageProductionFlow(state)) return state;
      const product = state.products.find((item) => item.id === action.productId);
      const supervisor = (state.accounts || []).find((account) => (
        account.id === action.supervisorId &&
        normalizeRole(account.role) === "production_supervisor" &&
        String(account.status || "").toLowerCase() === "active"
      ));
      const productionDate = dateOnly(action.productionDate);
      const targetQuantity = Number(action.targetQuantity || 0);
      if (
        !product ||
        product.status === "inactive" ||
        stockCategoryIdForProduct(product) !== "finished_products" ||
        !supervisor ||
        !isValidISODate(productionDate) ||
        !Number.isInteger(targetQuantity) ||
        targetQuantity <= 0
      ) return state;

      const createdAt = new Date().toISOString();
      const plan = {
        id: createId("PLAN"),
        clientId: state.client?.id || "",
        name: String(action.name || `${product.name} production`).trim().slice(0, 120),
        cadence: "daily",
        productionDate,
        startDate: productionDate,
        endDate: productionDate,
        lines: [{ productId: product.id, productName: product.name, quantity: targetQuantity }],
        productId: product.id,
        productName: product.name,
        targetQuantity,
        assignedSupervisorId: supervisor.id,
        assignedSupervisorUserId: supervisor.userId || "",
        assignedSupervisorName: supervisor.name,
        notes: String(action.notes || "").trim().slice(0, 500),
        status: "planned",
        batchReference: "",
        startedAt: "",
        completedAt: "",
        submittedAt: "",
        approvedAt: "",
        closedAt: "",
        actualGoodQuantity: 0,
        quantityDamaged: 0,
        quantityRejected: 0,
        variance: -targetQuantity,
        createdBy: currentActorName(state),
        createdAt,
        updatedAt: createdAt
      };
      state.productionPlans = [plan, ...(state.productionPlans || [])];
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "assigned",
        recordType: "production_plan",
        recordLabel: plan.id,
        planId: plan.id,
        summary: `${plan.createdBy} assigned ${targetQuantity} ${product.name} to ${supervisor.name} for ${productionDate}`,
        notificationRoles: ["production_supervisor"],
        notificationUserIds: supervisor.userId ? [supervisor.userId] : [],
        relatedUserIds: supervisor.userId ? [supervisor.userId] : []
      });
      return state;
    }

    case "START_ASSIGNED_PRODUCTION_PLAN": {
      if (currentUserRole(state) !== "production_supervisor") return state;
      const plan = (state.productionPlans || []).find((item) => item.id === action.planId);
      const actor = getCurrentActor(state);
      const assignedToActor = plan && (
        String(plan.assignedSupervisorUserId || "") === String(actor.userId || "") ||
        normalized(plan.assignedSupervisorName) === normalized(actor.name)
      );
      if (!assignedToActor || plan.status !== "planned") return state;
      const existingReferences = [
        ...(state.productionBatches || []).map((batch) => batch.reference),
        ...(state.productionPlans || []).map((item) => item.batchReference)
      ].filter(Boolean);
      const startedAt = new Date().toISOString();
      plan.status = "in_progress";
      plan.batchReference = nextFormattedId("BAT-{0000}", existingReferences, "BAT");
      plan.startedAt = startedAt;
      plan.updatedAt = startedAt;
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "started",
        recordType: "production_plan",
        recordLabel: plan.id,
        planId: plan.id,
        summary: `${actor.name} started ${plan.name} as ${plan.batchReference}`,
        relatedUserIds: actor.userId ? [actor.userId] : []
      });
      return state;
    }

    case "SUBMIT_MANAGER_PRODUCTION_REPORT": {
      if (currentUserRole(state) !== "production_manager") return state;
      const product = state.products.find((item) => item.id === action.productId);
      const quantityProduced = Number(action.producedQuantity || 0);
      const productionDate = dateOnly(action.productionDate);
      if (
        !product ||
        product.status === "inactive" ||
        stockCategoryIdForProduct(product) !== "finished_products" ||
        !Number.isInteger(quantityProduced) || quantityProduced <= 0 || !isValidISODate(productionDate)
      ) return state;

      const actor = getCurrentActor(state);
      const submittedAt = new Date().toISOString();
      const reference = nextFormattedId("BAT-{0000}", (state.productionBatches || []).map((batch) => batch.reference), "BAT");
      const batch = {
        id: createId("BATCH"),
        clientId: state.client?.id || "",
        reference,
        batchDate: productionDate,
        finishedProductId: product.id,
        finishedProductName: product.name,
        outputUnit: product.unit || "unit",
        managerWorkflow: true,
        managerProducedQuantity: quantityProduced,
        managerReportedBy: actor.name,
        managerReportedByUserId: actor.userId || "",
        managerSubmittedAt: submittedAt,
        quantityProduced,
        quantityDamaged: 0,
        quantityRejected: 0,
        notes: String(action.notes || "").trim().slice(0, 500),
        status: "manager_submitted",
        storeReceiptStatus: "awaiting_supervisor",
        createdAt: submittedAt,
        updatedAt: submittedAt
      };
      state.productionBatches = [batch, ...(state.productionBatches || [])];
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "submitted",
        recordType: "production_output",
        recordLabel: batch.reference,
        summary: `${actor.name} submitted ${quantityProduced} ${product.name} produced for supervisor confirmation`,
        notificationRoles: ["production_supervisor", "admin", "ceo"],
        relatedUserIds: actor.userId ? [actor.userId] : []
      });
      return state;
    }

    case "CONFIRM_MANAGER_PRODUCTION_REPORT": {
      if (currentUserRole(state) !== "production_supervisor") return state;
      const batch = (state.productionBatches || []).find((item) => item.id === action.batchId && item.managerWorkflow);
      const managerProducedQuantity = Number(batch?.managerProducedQuantity ?? 0);
      const goodQuantity = Number(action.goodQuantity || 0);
      const damagedQuantity = Number(action.damagedQuantity || 0);
      const rejectedQuantity = Number(action.rejectedQuantity || 0);
      const countedTotal = goodQuantity + damagedQuantity + rejectedQuantity;
      if (
        !batch || batch.status !== "manager_submitted" ||
        [goodQuantity, damagedQuantity, rejectedQuantity].some((quantity) => !Number.isInteger(quantity) || quantity < 0) ||
        countedTotal <= 0 || countedTotal > managerProducedQuantity
      ) return state;

      const actor = getCurrentActor(state);
      const confirmedAt = new Date().toISOString();
      batch.quantityProduced = goodQuantity;
      batch.quantityDamaged = damagedQuantity;
      batch.quantityRejected = rejectedQuantity;
      batch.supervisorConfirmedBy = actor.name;
      batch.supervisorConfirmedByUserId = actor.userId || "";
      batch.supervisorConfirmedAt = confirmedAt;
      batch.supervisorNotes = String(action.notes || "").trim().slice(0, 500);
      batch.status = "supervisor_confirmed";
      batch.storeReceiptStatus = "awaiting_store_keeper";
      batch.updatedAt = confirmedAt;
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "confirmed",
        recordType: "production_output",
        recordLabel: batch.reference,
        summary: `${actor.name} confirmed ${batch.reference}: ${goodQuantity} good, ${damagedQuantity} damaged, ${rejectedQuantity} other`,
        notificationRoles: ["store_keeper", "admin", "ceo"],
        relatedUserIds: actor.userId ? [actor.userId] : []
      });
      return state;
    }

    case "SUBMIT_SUPERVISOR_BATCH_REPORT": {
      if (currentUserRole(state) !== "production_supervisor") return state;
      const plan = (state.productionPlans || []).find((item) => item.id === action.planId);
      const actor = getCurrentActor(state);
      const assignedToActor = plan && (
        String(plan.assignedSupervisorUserId || "") === String(actor.userId || "") ||
        normalized(plan.assignedSupervisorName) === normalized(actor.name)
      );
      const goodQuantity = Number(action.goodQuantity || 0);
      const damagedQuantity = Number(action.damagedQuantity || 0);
      const rejectedQuantity = Number(action.rejectedQuantity || 0);
      const quantities = [goodQuantity, damagedQuantity, rejectedQuantity];
      const planLine = plan?.lines?.[0];
      const targetQuantity = Number(plan?.targetQuantity || planLine?.quantity || 0);
      if (
        !assignedToActor ||
        !["in_progress", "flagged"].includes(plan.status) ||
        quantities.some((quantity) => !Number.isInteger(quantity) || quantity < 0) ||
        goodQuantity > targetQuantity ||
        goodQuantity + damagedQuantity + rejectedQuantity <= 0
      ) return state;
      const product = state.products.find((item) => item.id === (plan.productId || planLine?.productId));
      if (!product || stockCategoryIdForProduct(product) !== "finished_products") return state;

      const submittedAt = new Date().toISOString();
      const variance = goodQuantity - targetQuantity;
      let batch = (state.productionBatches || []).find((item) => item.planId === plan.id && item.supervisorWorkflow);
      if (!batch) {
        batch = {
          id: createId("BATCH"),
          clientId: state.client?.id || "",
          planId: plan.id,
          reference: plan.batchReference || nextFormattedId("BAT-{0000}", (state.productionBatches || []).map((item) => item.reference), "BAT"),
          batchDate: plan.productionDate || plan.startDate || todayISO(),
          finishedProductId: product.id,
          finishedProductName: product.name,
          plannedQuantity: targetQuantity,
          outputUnit: product.unit || "unit",
          materials: [],
          supervisorWorkflow: true,
          recordedBy: actor.name,
          recordedByUserId: actor.userId || "",
          createdAt: submittedAt,
          startedAt: plan.startedAt || submittedAt,
          transferredAt: ""
        };
        state.productionBatches = [batch, ...(state.productionBatches || [])];
      }
      batch.quantityProduced = goodQuantity;
      batch.quantityDamaged = damagedQuantity;
      batch.quantityRejected = rejectedQuantity;
      batch.quantityWasted = 0;
      batch.variance = variance;
      batch.notes = String(action.notes || "").trim().slice(0, 500);
      batch.status = "submitted";
      batch.completedAt = batch.completedAt || submittedAt;
      batch.submittedAt = submittedAt;
      batch.resubmittedAt = batch.reviewNote ? submittedAt : batch.resubmittedAt || "";
      batch.reviewNote = "";
      batch.reviewedAt = "";
      batch.reviewedBy = "";

      plan.status = "submitted";
      plan.batchReference = batch.reference;
      plan.actualGoodQuantity = goodQuantity;
      plan.quantityDamaged = damagedQuantity;
      plan.quantityRejected = rejectedQuantity;
      plan.variance = variance;
      plan.completedAt = plan.completedAt || submittedAt;
      plan.submittedAt = submittedAt;
      plan.updatedAt = submittedAt;
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "submitted",
        recordType: "production_batch",
        recordLabel: batch.reference,
        planId: plan.id,
        summary: `${actor.name} submitted ${batch.reference}: ${goodQuantity} good, ${damagedQuantity} damaged, ${rejectedQuantity} rejected`,
        details: [`Variance against plan: ${variance}`],
        notificationRoles: ["production_manager", "admin", "ceo"],
        relatedUserIds: actor.userId ? [actor.userId] : []
      });
      return state;
    }

    case "APPROVE_SUPERVISOR_BATCH_REPORT": {
      if (!canManageProductionFlow(state)) return state;
      const batch = (state.productionBatches || []).find((item) => item.id === action.batchId && item.supervisorWorkflow);
      const plan = (state.productionPlans || []).find((item) => item.id === batch?.planId);
      const product = state.products.find((item) => item.id === batch?.finishedProductId);
      if (!batch || batch.status !== "submitted" || !plan || !product || batch.transferredAt) return state;
      const approvedAt = new Date().toISOString();
      const goodQuantity = Math.max(0, Number(batch.quantityProduced || 0));
      if (goodQuantity > 0) {
        product.stock = Number(product.stock || 0) + goodQuantity;
        product.updatedAt = todayISO();
        product.soldOutAt = "";
        state.stockTransactions = [{
          id: createId("TXN"),
          clientId: state.client?.id || "",
          type: "production output",
          productId: product.id,
          productName: product.name,
          quantity: goodQuantity,
          unit: product.unit || "unit",
          amount: 0,
          partyType: "Production batch",
          partyName: batch.reference,
          date: todayISO(),
          createdAt: approvedAt,
          recordedBy: currentActorName(state),
          movementDirection: "in",
          batchId: batch.id,
          batchReference: batch.reference,
          purpose: "Approved supervisor batch report",
          supervisorBatchReport: true
        }, ...(state.stockTransactions || [])];
      }
      batch.status = "approved";
      batch.approvedBy = currentActorName(state);
      batch.approvedAt = approvedAt;
      batch.transferredBy = currentActorName(state);
      batch.transferredAt = approvedAt;
      batch.transferredQuantity = goodQuantity;
      batch.reviewNote = String(action.note || "").trim().slice(0, 500);
      plan.status = "completed";
      plan.approvedAt = approvedAt;
      plan.updatedAt = approvedAt;
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "approved",
        recordType: "production_transfer",
        recordLabel: batch.reference,
        planId: plan.id,
        summary: `${batch.reference} approved; ${goodQuantity} good ${product.name} added to finished stock while ${Number(batch.quantityDamaged || 0)} damaged and ${Number(batch.quantityRejected || 0)} rejected stayed out`,
        notificationRoles: ["production_supervisor"],
        notificationUserIds: plan.assignedSupervisorUserId ? [plan.assignedSupervisorUserId] : [],
        relatedUserIds: plan.assignedSupervisorUserId ? [plan.assignedSupervisorUserId] : []
      });
      return state;
    }

    case "FLAG_SUPERVISOR_BATCH_REPORT":
    case "REJECT_SUPERVISOR_BATCH_REPORT": {
      if (!canManageProductionFlow(state)) return state;
      const batch = (state.productionBatches || []).find((item) => item.id === action.batchId && item.supervisorWorkflow);
      const plan = (state.productionPlans || []).find((item) => item.id === batch?.planId);
      const note = String(action.note || "").trim().slice(0, 500);
      if (!batch || batch.status !== "submitted" || !plan || !note) return state;
      const rejected = action.type === "REJECT_SUPERVISOR_BATCH_REPORT";
      const status = rejected ? "rejected" : "flagged";
      const reviewedAt = new Date().toISOString();
      batch.status = status;
      batch.reviewNote = note;
      batch.reviewedAt = reviewedAt;
      batch.reviewedBy = currentActorName(state);
      plan.status = status;
      plan.reviewNote = note;
      plan.updatedAt = reviewedAt;
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: rejected ? "rejected" : "flagged",
        recordType: "production_batch",
        recordLabel: batch.reference,
        planId: plan.id,
        summary: `${batch.reference} ${status}: ${note}`,
        notificationRoles: ["production_supervisor"],
        notificationUserIds: plan.assignedSupervisorUserId ? [plan.assignedSupervisorUserId] : [],
        relatedUserIds: plan.assignedSupervisorUserId ? [plan.assignedSupervisorUserId] : []
      });
      return state;
    }

    case "CLOSE_PRODUCTION_PLAN": {
      if (!canManageProductionFlow(state)) return state;
      const plan = (state.productionPlans || []).find((item) => item.id === action.planId);
      const hasOpenIssues = (state.productionIssues || []).some((issue) => issue.planId === plan?.id && issue.status === "open");
      if (!plan || plan.status !== "completed" || hasOpenIssues) return state;
      plan.status = "closed";
      plan.closedAt = new Date().toISOString();
      plan.closedBy = currentActorName(state);
      plan.updatedAt = plan.closedAt;
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "completed",
        recordType: "production_plan",
        recordLabel: plan.id,
        planId: plan.id,
        summary: `${plan.name} closed after approved production was completed`,
        relatedUserIds: plan.assignedSupervisorUserId ? [plan.assignedSupervisorUserId] : []
      });
      return state;
    }

    case "RECORD_MANAGED_PRODUCTION_BATCH": {
      if (!canManageProductionFlow(state)) return state;
      const plan = (state.productionPlans || []).find((item) => item.id === action.planId && !["cancelled", "completed"].includes(item.status));
      const finishedProduct = state.products.find((item) => item.id === action.finishedProductId);
      const planLine = plan?.lines?.find((line) => line.productId === action.finishedProductId);
      const reference = String(action.batchReference || "").trim().slice(0, 80);
      const batchDate = dateOnly(action.batchDate);
      const expiryDate = dateOnly(action.expiryDate);
      const quantityProduced = Math.max(0, Number(action.quantityProduced || 0));
      const quantityRejected = Math.max(0, Number(action.quantityRejected || 0));
      const quantityDamaged = Math.max(0, Number(action.quantityDamaged || 0));
      const quantityWasted = Math.max(0, Number(action.quantityWasted || 0));
      const materials = (Array.isArray(action.materials) ? action.materials : []).map((material) => {
        const product = state.products.find((item) => item.id === material.productId);
        return {
          product,
          name: String(material.name || "").trim().slice(0, 120),
          unit: String(material.unit || "").trim().slice(0, 40),
          quantity: Math.max(0, Number(material.quantity || 0))
        };
      }).filter(({ product, name, quantity }) => product || name || quantity > 0);
      const materialKeys = materials.map(({ product, name }) => product?.id || normalized(name)).filter(Boolean);
      const validMaterials = materials.every(({ product, name, quantity }) => (
        quantity > 0 && (
          (product && product.status !== "inactive" && stockCategoryIdForProduct(product) === "raw_materials" && quantity <= Number(product.stock || 0)) ||
          (!product && Boolean(name))
        )
      ));
      if (
        !plan || !planLine || !reference ||
        (state.productionBatches || []).some((batch) => normalized(batch.reference) === normalized(reference)) ||
        !isValidISODate(batchDate) || !isValidISODate(expiryDate) || expiryDate < batchDate ||
        !finishedProduct || stockCategoryIdForProduct(finishedProduct) !== "finished_products" ||
        quantityProduced <= 0 || !validMaterials || new Set(materialKeys).size !== materialKeys.length
      ) return state;

      const batchId = createId("BATCH");
      const recordedBy = currentActorName(state);
      const recordedMaterials = materials.map(({ product, name, unit, quantity }) => {
        if (product) {
          product.stock = Number(product.stock || 0) - quantity;
          product.updatedAt = todayISO();
        }
        return {
          productId: product?.id || "",
          productName: product?.name || name,
          quantity,
          unit: product?.unit || unit || "unit",
          unitCostAtUse: Number(product?.unitCost || 0),
          inventoryLinked: Boolean(product)
        };
      });
      const batch = {
        id: batchId,
        clientId: state.client?.id || "",
        planId: plan.id,
        reference,
        batchDate,
        expiryDate,
        finishedProductId: finishedProduct.id,
        finishedProductName: finishedProduct.name,
        plannedQuantity: Number(planLine.quantity || 0),
        quantityProduced,
        quantityRejected,
        quantityDamaged,
        quantityWasted,
        outputUnit: finishedProduct.unit || "unit",
        materials: recordedMaterials,
        team: String(action.team || plan.team || "Production Team").trim().slice(0, 120),
        shift: String(action.shift || plan.shift || "Day shift").trim().slice(0, 80),
        machine: String(action.machine || plan.machine || "Production line").trim().slice(0, 120),
        notes: String(action.notes || "").trim().slice(0, 500),
        qualityStatus: "pending",
        qualityChecks: {},
        qualityNotes: "",
        status: "awaiting_qc",
        recordedBy,
        createdAt: new Date().toISOString(),
        approvedAt: "",
        transferredAt: ""
      };
      state.productionBatches = [batch, ...(state.productionBatches || [])];
      plan.status = "in_progress";
      plan.updatedAt = new Date().toISOString();
      state.stockTransactions = [
        ...recordedMaterials.map((material) => ({
          id: createId("TXN"),
          clientId: state.client?.id || "",
          type: "production usage",
          productId: material.productId,
          productName: material.productName,
          quantity: material.quantity,
          unit: material.unit,
          amount: 0,
          partyType: "Production batch",
          partyName: reference,
          date: batchDate,
          createdAt: new Date().toISOString(),
          recordedBy,
          movementDirection: "out",
          batchId,
          batchReference: reference,
          finishedProductId: finishedProduct.id,
          finishedProductName: finishedProduct.name,
          purpose: "Production"
        })),
        ...(state.stockTransactions || [])
      ];
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "recorded",
        recordType: "production_batch",
        recordLabel: reference,
        summary: `${recordedBy} recorded ${quantityProduced} ${finishedProduct.name}; QC approval pending`
      });
      return state;
    }

    case "RECORD_PRODUCTION_QC": {
      if (!canManageProductionFlow(state)) return state;
      const batch = (state.productionBatches || []).find((item) => item.id === action.batchId);
      const outcome = action.outcome === "passed" ? "passed" : action.outcome === "failed" ? "failed" : "";
      const checks = action.checks && typeof action.checks === "object" ? {
        appearance: Boolean(action.checks.appearance),
        weight: Boolean(action.checks.weight),
        packaging: Boolean(action.checks.packaging),
        safety: Boolean(action.checks.safety)
      } : {};
      const notes = String(action.notes || "").trim().slice(0, 500);
      if (
        !batch || !["awaiting_qc", "qc_failed"].includes(batch.status) || !outcome ||
        (outcome === "passed" && !Object.values(checks).every(Boolean)) ||
        (outcome === "failed" && !notes)
      ) return state;
      batch.qualityStatus = outcome;
      batch.qualityChecks = checks;
      batch.qualityNotes = notes;
      batch.qualityCheckedBy = currentActorName(state);
      batch.qualityCheckedAt = new Date().toISOString();
      batch.status = outcome === "passed" ? "qc_passed" : "qc_failed";
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: outcome === "passed" ? "passed" : "failed",
        recordType: "production_qc",
        recordLabel: batch.reference,
        summary: `${batch.reference} quality control ${outcome}`
      });
      return state;
    }

    case "APPROVE_PRODUCTION_BATCH": {
      if (!canManageProductionFlow(state)) return state;
      const batch = (state.productionBatches || []).find((item) => item.id === action.batchId);
      if (!batch || batch.status !== "qc_passed" || batch.qualityStatus !== "passed") return state;
      batch.status = "approved";
      batch.approvedBy = currentActorName(state);
      batch.approvedAt = new Date().toISOString();
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "approved",
        recordType: "production_batch",
        recordLabel: batch.reference,
        summary: `${batch.reference} approved for finished-goods transfer`
      });
      return state;
    }

    case "TRANSFER_PRODUCTION_BATCH": {
      if (!canManageProductionFlow(state)) return state;
      const batch = (state.productionBatches || []).find((item) => item.id === action.batchId);
      const product = state.products.find((item) => item.id === batch?.finishedProductId);
      if (!batch || batch.status !== "approved" || !product || batch.transferredAt) return state;
      const quantity = Math.max(0, Number(batch.quantityProduced || 0));
      if (quantity <= 0) return state;
      product.stock = Number(product.stock || 0) + quantity;
      product.updatedAt = todayISO();
      product.soldOutAt = "";
      batch.status = "transferred";
      batch.transferredQuantity = quantity;
      batch.transferredBy = currentActorName(state);
      batch.transferredAt = new Date().toISOString();
      state.stockTransactions = [{
        id: createId("TXN"),
        clientId: state.client?.id || "",
        type: "production output",
        productId: product.id,
        productName: product.name,
        quantity,
        unit: product.unit || "unit",
        amount: 0,
        partyType: "Production batch",
        partyName: batch.reference,
        date: todayISO(),
        createdAt: new Date().toISOString(),
        recordedBy: currentActorName(state),
        movementDirection: "in",
        batchId: batch.id,
        batchReference: batch.reference,
        purpose: "Approved finished-goods transfer"
      }, ...(state.stockTransactions || [])];
      const plan = (state.productionPlans || []).find((item) => item.id === batch.planId);
      if (plan) {
        const transferredBatches = (state.productionBatches || []).filter((item) => item.planId === plan.id && item.status === "transferred");
        const completed = (plan.lines || []).every((line) => {
          const transferredQuantity = transferredBatches
            .filter((item) => item.finishedProductId === line.productId)
            .reduce((total, item) => total + Number(item.transferredQuantity || item.quantityProduced || 0), 0);
          return transferredQuantity >= Number(line.quantity || 0);
        });
        if (completed) plan.status = "completed";
        plan.updatedAt = new Date().toISOString();
      }
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "transferred",
        recordType: "production_transfer",
        recordLabel: batch.reference,
        summary: `${quantity} ${product.name} transferred into finished-goods stock from ${batch.reference}`
      });
      return state;
    }

    case "REPORT_PRODUCTION_ISSUE": {
      const reportingRole = currentUserRole(state);
      if (!["production_manager", "production_supervisor", "ceo"].includes(reportingRole)) return state;
      const relatedPlan = (state.productionPlans || []).find((item) => item.id === action.planId);
      const actor = getCurrentActor(state);
      if (reportingRole === "production_supervisor") {
        const assignedToActor = relatedPlan && (
          String(relatedPlan.assignedSupervisorUserId || "") === String(actor.userId || "") ||
          normalized(relatedPlan.assignedSupervisorName) === normalized(actor.name)
        );
        if (!assignedToActor || ["closed", "rejected"].includes(relatedPlan.status)) return state;
      }
      const issueType = ["machine_downtime", "material_shortage", "delay", "quality", "other"].includes(action.issueType)
        ? action.issueType : "other";
      const description = String(action.description || "").trim();
      const downtimeMinutes = Math.max(0, Number(action.downtimeMinutes || 0));
      if (!description || (issueType === "machine_downtime" && downtimeMinutes <= 0)) return state;
      const issue = {
        id: createId("ISSUE"),
        clientId: state.client?.id || "",
        planId: String(action.planId || ""),
        issueType,
        severity: ["low", "medium", "high", "critical"].includes(action.severity) ? action.severity : "medium",
        machine: String(action.machine || "").trim().slice(0, 120),
        description: description.slice(0, 500),
        downtimeMinutes,
        status: "open",
        reportedBy: actor.name,
        reportedByUserId: actor.userId || "",
        reportedAt: new Date().toISOString(),
        resolvedAt: "",
        resolution: ""
      };
      state.productionIssues = [issue, ...(state.productionIssues || [])];
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "reported",
        recordType: "production_issue",
        recordLabel: issue.id,
        planId: issue.planId,
        summary: `${textLabel(issueType)} reported${issue.machine ? ` for ${issue.machine}` : ""}`,
        notificationRoles: reportingRole === "production_supervisor" ? ["production_manager", "admin", "ceo"] : [],
        relatedUserIds: actor.userId ? [actor.userId] : []
      });
      return state;
    }

    case "RESOLVE_PRODUCTION_ISSUE": {
      if (!canManageProductionFlow(state)) return state;
      const issue = (state.productionIssues || []).find((item) => item.id === action.issueId && item.status === "open");
      const resolution = String(action.resolution || "").trim();
      if (!issue || !resolution) return state;
      issue.status = "resolved";
      issue.resolution = resolution.slice(0, 500);
      issue.resolvedBy = currentActorName(state);
      issue.resolvedAt = new Date().toISOString();
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "resolved",
        recordType: "production_issue",
        recordLabel: issue.id,
        summary: `${textLabel(issue.issueType)} resolved`
      });
      return state;
    }

    case "RECORD_RAW_MATERIAL_SALE": {
      if (!["ceo", "store_keeper"].includes(currentUserRole(state))) return state;

      const product = state.products.find((item) => item.id === action.productId);
      const quantity = Number(action.quantity || 0);
      const unitPrice = Number(action.unitPrice ?? product?.unitPrice ?? 0);
      const customer = (state.retailers || []).find((item) => item.id === action.customerId);
      const customerName = String(customer?.name || action.customerName || "").trim();
      const requestedPaymentType = normalized(action.paymentType || "cash");
      const paymentType = requestedPaymentType;
      const requestedSaleDate = String(action.saleDate || "").trim();
      const saleDate = requestedSaleDate ? dateOnly(requestedSaleDate) : todayISO();
      const amount = quantity * unitPrice;
      const customerCreditLimit = (state.creditLimits || []).find((limit) => (
        normalized(limit.partyName) === normalized(customerName)
      ));
      const creditWouldExceedLimit = paymentType === "credit" && (
        !customerCreditLimit ||
        Number(customerCreditLimit.limit || 0) <= 0 ||
        Number(customerCreditLimit.balance || 0) + amount > Number(customerCreditLimit.limit || 0)
      );

      if (
        !product ||
        product.status === "inactive" ||
        stockCategoryIdForProduct(product) !== "raw_materials" ||
        !Number.isFinite(Number(product.stock)) ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        quantity > Number(product.stock || 0) ||
        !Number.isFinite(unitPrice) ||
        unitPrice <= 0 ||
        !Number.isFinite(amount) ||
        !isValidISODate(saleDate) ||
        !["cash", "credit"].includes(requestedPaymentType) ||
        !customerName ||
        (paymentType === "credit" && !customer) ||
        creditWouldExceedLimit
      ) {
        return state;
      }

      const recordedBy = currentActorName(state);
      const transactionId = createId("TXN");
      const orderId = createQuickSaleOrder(state, {
        transactionId,
        product,
        customer,
        customerName,
        customerType: customer?.channel || "Factory customer",
        quantity,
        unit: product.unit || "unit",
        paymentType,
        repName: recordedBy,
        saleDate,
        unitPrice
      });

      product.stock = Number(product.stock || 0) - quantity;
      product.updatedAt = saleDate;
      product.soldOutAt = product.stock <= 0 ? saleDate : "";
      if (paymentType === "credit") updateCreditBalance(state, customerName, amount);
      state.stockTransactions = [{
        id: transactionId,
        clientId: state.client?.id || "",
        type: "sale",
        productId: product.id,
        productName: product.name,
        quantity,
        amount,
        unitPrice,
        unitCost: Number(product.unitCost || 0),
        paymentType,
        partyType: customer?.channel || "Factory customer",
        partyName: customerName,
        customerId: customer?.id || "",
        date: saleDate,
        createdAt: new Date().toISOString(),
        recordedBy,
        movementDirection: "out",
        creditImpact: paymentType === "credit" ? amount : 0,
        reason: String(action.notes || "Raw material sold directly from factory").trim().slice(0, 500),
        orderId
      }, ...(state.stockTransactions || [])];

      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "sold",
        recordType: "stock_movement",
        recordLabel: product.id,
        summary: `${recordedBy} sold ${quantity} ${product.unit || "units"} of ${product.name} to ${customerName}`
      });
      return state;
    }

    case "RETURN_REP_STOCK_TO_FACTORY": {
      const quantity = Math.max(0, Number(action.quantity || 0));
      const repName = action.repName || currentActorName(state);
      const requestedIds = new Set((action.assignmentIds || []).map((id) => String(id || "")));
      const product = state.products.find((item) => item.id === action.productId);
      const packagingType = String(action.packagingType || "piece");
      const packagingQuantity = Number(action.packagingQuantity ?? quantity);
      const calculatedQuantity = quantityInPieces(product, packagingQuantity, packagingType, state.client);
      const assignments = (state.stockAssignments || [])
        .filter((assignment) => requestedIds.has(String(assignment.id)))
        .filter((assignment) => assignment.productId === action.productId)
        .filter((assignment) => normalized(assignment.repName) === normalized(repName))
        .filter((assignment) => assignmentOutstanding(assignment) > 0)
        .sort((a, b) => String(a.assignedAt || "").localeCompare(String(b.assignedAt || "")));
      const available = assignments.reduce((total, assignment) => total + assignmentOutstanding(assignment), 0);

      if (!product || !quantity || calculatedQuantity !== quantity || quantity > available) return state;

      let remaining = quantity;
      const assignmentAllocations = [];
      assignments.forEach((assignment) => {
        if (remaining <= 0) return;
        const allocated = Math.min(assignmentOutstanding(assignment), remaining);
        assignment.returned = Number(assignment.returned || 0) + allocated;
        assignment.updatedAt = todayISO();
        refreshAssignmentCompletion(state, assignment);
        assignmentAllocations.push({ assignmentId: assignment.id, quantity: allocated });
        remaining -= allocated;
      });

      product.stock = Number(product.stock || 0) + quantity;
      product.updatedAt = todayISO();
      product.soldOutAt = "";
      const transactionId = createId("TXN");
      state.stockTransactions = [{
        id: transactionId,
        type: "return to factory",
        productId: product.id,
        productName: product.name,
        quantity,
        packagingType,
        packagingQuantity,
        amount: 0,
        partyType: "Sales Representative",
        partyName: repName,
        date: todayISO(),
        createdAt: new Date().toISOString(),
        recordedBy: repName,
        reason: String(action.reason || "Unsold stock"),
        movementDirection: "in",
        returnDestination: product.warehouse || "Factory",
        assignmentId: assignmentAllocations[0]?.assignmentId || "",
        assignmentIds: assignmentAllocations.map((allocation) => allocation.assignmentId),
        assignmentAllocations
      }, ...(state.stockTransactions || [])];

      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "returned",
        recordType: "stock_movement",
        recordLabel: product.id,
        summary: `${repName} returned ${packagingQuantityLabel(packagingQuantity, packagingType)} (${quantity} pieces) of ${product.name} to the factory - ${action.reason || "Unsold stock"}`
      });
      return state;
    }

    case "LOG_REP_SALE": {
      const repName = action.repName || currentActorName(state);
      const customer = state.retailers.find((item) => item.id === action.customerId);
      const customerName = customer?.name || action.customerName || "Walk-in customer";
      const customerType = customer?.channel || customer?.type || action.customerType || "Customer";
      const paymentType = String(action.paymentType || "cash").toLowerCase().includes("credit") ? "credit" : "cash";
      const requestedItems = Array.isArray(action.items) ? action.items : [];
      const saleItems = requestedItems.map((item) => {
        const product = state.products.find((candidate) => candidate.id === item.productId);
        const packagingType = String(item.packagingType || "piece");
        const packagingQuantity = Number(item.packagingQuantity || 0);
        return {
          product,
          packagingType,
          packagingQuantity,
          quantity: quantityInPieces(product, packagingQuantity, packagingType, state.client),
          packagingUnitPrice: packagingUnitPrice(product, packagingType, state.client),
          unitPrice: effectivePiecePrice(product, packagingType, state.client),
          amount: packagingLineAmount(product, packagingQuantity, packagingType, state.client),
          transactionId: createId("TXN")
        };
      });
      const lineKeys = saleItems.map((item) => `${item.product?.id || ""}:${item.packagingType}`);
      const requestedByProduct = saleItems.reduce((totals, item) => {
        if (item.product) totals.set(item.product.id, Number(totals.get(item.product.id) || 0) + item.quantity);
        return totals;
      }, new Map());
      const eligibleAssignmentsForProduct = (productId) => (state.stockAssignments || [])
        .filter((assignment) => assignment.productId === productId)
        .filter((assignment) => normalized(assignment.repName) === normalized(repName))
        .filter((assignment) => assignmentOutstanding(assignment) > 0)
        .sort((a, b) => String(a.assignedAt || "").localeCompare(String(b.assignedAt || "")));
      const invalid = (
        !saleItems.length ||
        new Set(lineKeys).size !== lineKeys.length ||
        saleItems.some((item) => !item.product || item.product.status === "inactive" || !Number.isFinite(item.packagingQuantity) || item.packagingQuantity <= 0 || !Number.isFinite(item.quantity) || item.quantity <= 0 || item.unitPrice < 0) ||
        [...requestedByProduct].some(([productId, quantity]) => quantity > eligibleAssignmentsForProduct(productId).reduce((total, assignment) => total + assignmentOutstanding(assignment), 0)) ||
        !customerName
      );
      if (invalid) return state;

      const transactions = saleItems.map((item) => {
        let remaining = item.quantity;
        const assignmentAllocations = [];
        eligibleAssignmentsForProduct(item.product.id).forEach((assignment) => {
          if (remaining <= 0) return;
          const allocatedQuantity = Math.min(assignmentOutstanding(assignment), remaining);
          assignment.sold = Number(assignment.sold || 0) + allocatedQuantity;
          assignment.updatedAt = todayISO();
          refreshAssignmentCompletion(state, assignment);
          assignmentAllocations.push({ assignmentId: assignment.id, quantity: allocatedQuantity });
          remaining -= allocatedQuantity;
        });
        return {
          id: item.transactionId,
          type: "sale",
          productId: item.product.id,
          productName: item.product.name,
          quantity: item.quantity,
          packagingType: item.packagingType,
          packagingQuantity: item.packagingQuantity,
          packagingUnitPrice: item.packagingUnitPrice,
          amount: item.amount,
          unitPrice: item.unitPrice,
          unitCost: Number(item.product.unitCost || 0),
          paymentType,
          partyType: customerType,
          partyName: customerName,
          customerId: customer?.id || action.customerId || "",
          date: todayISO(),
          createdAt: new Date().toISOString(),
          recordedBy: repName,
          creditImpact: 0,
          financialImpact: false,
          accountingTreatment: "sell_through_only",
          repUserId: state.user?.id || "",
          assignmentId: assignmentAllocations[0]?.assignmentId || "",
          assignmentIds: assignmentAllocations.map((allocation) => allocation.assignmentId),
          assignmentAllocations,
          syncStatus: action.offline ? "pending" : "synced"
        };
      });
      const totalAmount = transactions.reduce((total, transaction) => total + transaction.amount, 0);
      const orderId = createQuickSaleOrder(state, {
        transactionId: transactions[0].id,
        transactionIds: transactions.map((transaction) => transaction.id),
        product: saleItems[0].product,
        customer,
        customerName,
        customerType,
        quantity: saleItems[0].quantity,
        paymentType,
        repName,
        items: saleItems,
        financialImpact: false
      });
      transactions.forEach((transaction) => { transaction.orderId = orderId; });
      state.stockTransactions = [...transactions, ...(state.stockTransactions || [])];
      if (paymentType === "credit") updateCreditBalance(state, customerName, totalAmount);

      if (action.offline) {
        state.offlineSalesQueue = [
          ...transactions.map((transaction) => ({
            id: `OFFLINE-${transaction.id}`,
            transactionId: transaction.id,
            clientId: state.client?.id || "",
            repUserId: state.user?.id || "",
            createdAt: new Date().toISOString(),
            status: "pending"
          })),
          ...(state.offlineSalesQueue || [])
        ];
      }

      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "updated",
        recordType: "customer_supply",
        recordLabel: orderId,
        summary: `${repName} recorded customer sales of ${transactions.reduce((total, transaction) => total + transaction.quantity, 0)} pieces across ${transactions.length} line${transactions.length === 1 ? "" : "s"} to ${customerName}`
      });
      const invoice = state.invoices.find((item) => item.orderId === orderId);
      if (invoice) appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "created",
        recordType: "customer_supply",
        recordLabel: invoice.id,
        summary: `${invoice.id} ${paymentType === "credit" ? "customer credit invoice" : "customer receipt"} created for ${customerName} by ${repName}`
      });
      return state;
    }

    case "LOG_REP_TRANSACTION": {
      const customer = state.retailers.find((item) => item.id === action.customerId);
      const quantity = Math.max(0, Number(action.quantity || 0));
      const transactionType = action.transactionType === "return" ? "return" : "sale";
      const paymentType = transactionType === "sale" && String(action.paymentType || "cash").toLowerCase().includes("credit") ? "credit" : "cash";
      const returnDisposition = transactionType === "return"
        ? (action.returnDisposition === "to_store" ? "to_store" : "held_by_rep")
        : "";
      const repName = action.repName || currentActorName(state);
      const requestedIds = Array.isArray(action.assignmentIds)
        ? action.assignmentIds
        : [action.assignmentId];
      const requestedAssignmentIds = new Set(requestedIds.map((id) => String(id || "")).filter(Boolean));
      const requestedProductId = String(action.productId || "");
      const selectedAssignments = (state.stockAssignments || [])
        .filter((assignment) => requestedAssignmentIds.has(String(assignment.id)))
        .filter((assignment) => !requestedProductId || assignment.productId === requestedProductId)
        .filter((assignment) => normalized(assignment.repName) === normalized(repName));
      const productId = requestedProductId || selectedAssignments[0]?.productId || "";
      const product = state.products.find((item) => item.id === productId);
      const eligibleAssignments = selectedAssignments
        .filter((assignment) => assignment.productId === productId)
        .filter((assignment) => transactionType !== "return" || isRepresentativeReturnEligible(assignment, todayISO()))
        .filter((assignment) => (
          transactionType === "return"
            ? Number(assignment.sold || 0) > 0
            : assignmentOutstanding(assignment) > 0
        ))
        .sort((a, b) => String(a.assignedAt || "").localeCompare(String(b.assignedAt || "")));
      const availableQuantity = eligibleAssignments.reduce((total, assignment) => (
        total + (transactionType === "return" ? Number(assignment.sold || 0) : assignmentOutstanding(assignment))
      ), 0);
      const transactionPackagingType = String(action.packagingType || "piece");
      const transactionPackagingQuantity = Number(action.packagingQuantity || quantity);
      const calculatedPackagingQuantity = quantityInPieces(product, transactionPackagingQuantity, transactionPackagingType, state.client);
      const transactionUnitPrice = effectivePiecePrice(product, transactionPackagingType, state.client);
      const transactionPackagingUnitPrice = packagingUnitPrice(product, transactionPackagingType, state.client);
      const amount = transactionPackagingType === "piece"
        ? quantity * transactionUnitPrice
        : transactionPackagingQuantity * transactionPackagingUnitPrice;
      const customerName = customer?.name || action.customerName || "Walk-in customer";
      const customerType = customer?.channel || customer?.type || action.customerType || "Customer";
      const returnableCustomer = transactionType === "return"
        ? getReturnableCustomerChoices(state, {
            productId,
            repName,
            repUserId: state.user?.id || "",
            assignmentIds: eligibleAssignments.map((assignment) => assignment.id)
          }).find((choice) => (
            (customer?.id && choice.customerId === customer.id) ||
            (!customer?.id && normalized(choice.customerName) === normalized(customerName))
          ))
        : null;

      if (!product || !quantity || calculatedPackagingQuantity !== quantity || !eligibleAssignments.length || quantity > availableQuantity) return state;
      if (transactionType === "return" && (!returnableCustomer || quantity > returnableCustomer.quantity)) return state;

      let remainingQuantity = quantity;
      const assignmentAllocations = [];

      eligibleAssignments.forEach((assignment) => {
        if (remainingQuantity <= 0) return;

        const available = transactionType === "return"
          ? Number(assignment.sold || 0)
          : assignmentOutstanding(assignment);
        const allocatedQuantity = Math.min(available, remainingQuantity);

        if (transactionType === "sale") {
          assignment.sold = Number(assignment.sold || 0) + allocatedQuantity;
        } else {
          assignment.sold = Math.max(0, Number(assignment.sold || 0) - allocatedQuantity);

          if (returnDisposition === "to_store") {
            assignment.returned = Number(assignment.returned || 0) + allocatedQuantity;
          } else {
            assignment.heldReturns = Number(assignment.heldReturns || 0) + allocatedQuantity;
          }
        }

        assignment.updatedAt = todayISO();
        refreshAssignmentCompletion(state, assignment);
        assignmentAllocations.push({ assignmentId: assignment.id, quantity: allocatedQuantity });
        remainingQuantity -= allocatedQuantity;
      });

      if (transactionType === "return" && returnDisposition === "to_store") {
        product.stock = Number(product.stock || 0) + quantity;
        product.updatedAt = todayISO();
        product.soldOutAt = "";
      }

      const transactionId = createId("TXN");
      const orderId = transactionType === "sale"
        ? createQuickSaleOrder(state, {
            transactionId,
            product,
            customer,
            customerName,
            customerType,
            quantity,
            packagingType: transactionPackagingType,
            packagingQuantity: transactionPackagingQuantity,
            paymentType,
            repName,
            unitPrice: transactionUnitPrice,
            financialImpact: false
          })
        : "";

      state.stockTransactions = [
        {
          id: transactionId,
          type: transactionType,
          productId,
          productName: product.name,
          quantity,
          packagingType: transactionPackagingType,
          packagingQuantity: transactionPackagingQuantity,
          packagingUnitPrice: transactionPackagingUnitPrice,
          amount,
          unitPrice: transactionUnitPrice,
          unitCost: Number(product.unitCost || 0),
          paymentType,
          partyType: customerType,
          partyName: customerName,
          customerId: customer?.id || action.customerId || "",
          date: todayISO(),
          createdAt: new Date().toISOString(),
          recordedBy: repName,
          creditImpact: 0,
          financialImpact: false,
          accountingTreatment: "sell_through_only",
          repUserId: state.user?.id || "",
          returnDisposition: transactionType === "return" ? returnDisposition : "",
          returnDestination: transactionType === "return"
            ? (returnDisposition === "to_store" ? "Store stock" : "Held by sales representative")
            : "",
          movementDirection: transactionType === "return" && returnDisposition === "to_store" ? "in" : "",
          orderId,
          assignmentId: assignmentAllocations[0]?.assignmentId || "",
          assignmentIds: assignmentAllocations.map((allocation) => allocation.assignmentId),
          assignmentAllocations,
          syncStatus: action.offline ? "pending" : "synced",
          returnReviewStatus: transactionType === "return" ? "pending" : ""
        },
        ...(state.stockTransactions || [])
      ];

      if (transactionType === "sale" && paymentType === "credit") {
        updateCreditBalance(state, customerName, amount);
      }

      if (transactionType === "sale" && action.offline) {
        state.offlineSalesQueue = [
          ...(state.offlineSalesQueue || []).filter((entry) => entry.transactionId !== transactionId),
          {
            id: `OFFLINE-${transactionId}`,
            transactionId,
            clientId: state.client?.id || "",
            repUserId: state.user?.id || "",
            createdAt: new Date().toISOString(),
            status: "pending"
          }
        ];
      }

      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: transactionType === "sale" ? "updated" : "returned",
        recordType: "customer_supply",
        recordLabel: product.name,
        summary: transactionType === "sale"
          ? `${repName} recorded a customer sale of ${quantity} ${product.name} to ${customerName}`
          : `${repName} recorded ${quantity} ${product.name} returned by ${customerName} - ${returnDisposition === "to_store" ? "to store stock" : "held for resale"}`
      });

      if (transactionType === "sale") {
        const invoice = state.invoices.find((item) => item.transactionId === transactionId);
        if (invoice) {
          appendActivityLog(state, {
            clientId: state.client?.id,
            actionType: "created",
            recordType: "customer_supply",
            recordLabel: invoice.id,
            summary: `${invoice.id} ${paymentType === "credit" ? "customer credit invoice" : "customer receipt"} created for ${customerName} by ${repName}`
          });
        }
      }

      if (orderId) {
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: "created",
          recordType: "customer_supply",
          recordLabel: orderId,
          summary: `${orderId} saved as ${repName}'s customer sell-through record`
        });
      }

      if (transactionType === "return" && returnDisposition === "to_store") {
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: "returned",
          recordType: "stock_movement",
          recordLabel: product.id,
          summary: `${quantity} ${product.name} returned to store stock by ${repName}`
        });
      }

      return state;
    }

    case "REVIEW_REP_RETURN": {
      if (!["ceo", "admin"].includes(currentUserRole(state))) return state;
      const transaction = (state.stockTransactions || []).find((item) => item.id === action.transactionId && normalized(item.type) === "return");
      if (!transaction || transaction.returnReviewStatus !== "pending") return state;
      transaction.returnReviewStatus = "reviewed";
      transaction.returnReviewedAt = new Date().toISOString();
      transaction.returnReviewedBy = currentActorLabel(state);
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "approved",
        recordType: "customer_return",
        recordLabel: transaction.id,
        summary: `${transaction.quantity} ${transaction.productName || "product"} return from ${transaction.partyName || "customer"} reviewed`
      });
      return state;
    }

    case "FLAG_REP_RETURN": {
      if (!["ceo", "admin"].includes(currentUserRole(state))) return state;
      const transaction = (state.stockTransactions || []).find((item) => item.id === action.transactionId && normalized(item.type) === "return");
      const note = String(action.note || "").trim();
      if (!transaction || transaction.returnReviewStatus !== "pending" || !note) return state;
      transaction.returnReviewStatus = "flagged";
      transaction.returnReviewNote = note.slice(0, 500);
      transaction.returnReviewedAt = new Date().toISOString();
      transaction.returnReviewedBy = currentActorLabel(state);
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "flagged",
        recordType: "customer_return",
        recordLabel: transaction.id,
        summary: `${transaction.partyName || "Customer"} return flagged for clarification`,
        details: transaction.returnReviewNote
      });
      return state;
    }

    case "SYNC_OFFLINE_SALES": {
      const pendingIds = new Set((state.offlineSalesQueue || []).map((entry) => entry.transactionId));
      if (!pendingIds.size) return state;
      (state.stockTransactions || []).forEach((transaction) => {
        if (pendingIds.has(transaction.id)) transaction.syncStatus = "synced";
      });
      state.offlineSalesQueue = [];
      return state;
    }

    case "SUBMIT_REP_REPORT": {
      const report = {
        id: action.reportId || createId("RPT"),
        clientId: state.client?.id || "",
        repName: action.repName || currentActorName(state),
        reportDate: action.reportDate || todayISO(),
        tripLabel: action.tripLabel || "Today",
        salesAmount: Number(action.salesAmount || 0),
        grossSales: Number(action.grossSales ?? action.salesAmount ?? 0),
        netSales: Number(action.netSales ?? (
          Number(action.grossSales ?? action.salesAmount ?? 0) -
          Number(action.returnAmount || 0) -
          Number(action.discountAmount || 0) -
          Number(action.otherDeductions || 0)
        )),
        discountAmount: Number(action.discountAmount || 0),
        otherDeductions: Number(action.otherDeductions || 0),
        cashAmount: 0,
        creditAmount: 0,
        returnAmount: Number(action.returnAmount || 0),
        unitsSold: Number(action.unitsSold || 0),
        unitsReturned: Number(action.unitsReturned || 0),
        unitsReturnedToFactory: Number(action.unitsReturnedToFactory || 0),
        transactionIds: Array.isArray(action.transactionIds) ? action.transactionIds : [],
        reportLines: Array.isArray(action.reportLines) ? action.reportLines.map((line) => ({
          transactionId: String(line.transactionId || ""),
          type: String(line.type || "Sale"),
          productId: String(line.productId || ""),
          productName: String(line.productName || "Unknown snack"),
          customerName: String(line.customerName || "Customer"),
          quantity: Number(line.quantity || 0),
          amount: Number(line.amount || 0),
          paymentType: "not_tracked",
          returnDisposition: String(line.returnDisposition || "")
        })) : [],
        status: "submitted",
        reviewNote: "",
        submittedAt: new Date().toISOString()
      };
      const sameReport = (item) => (
        String(item.repName || "").toLowerCase() === String(report.repName || "").toLowerCase() &&
        item.reportDate === report.reportDate
      );
      const existingReport = (state.salesReports || []).find(sameReport);
      if (existingReport) {
        report.id = action.reportId || existingReport.id;
        report.reviewHistory = [...(existingReport.reviewHistory || [])];
        report.flagReason = existingReport.flagReason || "";
        report.flaggedAt = existingReport.flaggedAt || "";
      }

      state.salesReports = [
        report,
        ...(state.salesReports || []).filter((item) => !sameReport(item))
      ];

      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "submitted",
        recordType: "report",
        recordLabel: `${report.repName} - ${report.reportDate}`,
        summary: `${report.repName} submitted a sales report`
      });

      return state;
    }

    case "UPSERT_PRODUCT": {
      if (!["ceo", "admin"].includes(currentUserRole(state))) return state;
      const productId = String(action.productId || "").trim();
      const existingProduct = state.products.find((item) => item.id === productId);
      const previousProduct = existingProduct ? { ...existingProduct } : null;
      const requestedStockCategory = action.stockCategory || existingProduct?.stockCategory || "finished_products";
      const nextProductId = String(action.sku || productId || "").trim() || descriptiveProductSku({
        name: action.productFamily || action.name,
        sizeValue: action.sizeValue,
        sizeUnit: action.sizeUnit || action.unit
      }, state.products.map((product) => product.id));
      const normalizedNextProductId = nextProductId.toLowerCase();
      const duplicateProductId = state.products.some((item) => (
        item.id !== productId && String(item.id || "").trim().toLowerCase() === normalizedNextProductId
      ));
      if (duplicateProductId) return state;

      if (previousProduct) {
        freezeProductPricingOnExistingRecords(state, previousProduct);
      }

      const stockCategory = action.stockCategory || existingProduct?.stockCategory || "finished_products";
      const status = ["active", "inactive"].includes(String(action.status || "")) ? action.status : existingProduct?.status || "active";
      const productFamily = String(action.productFamily ?? existingProduct?.productFamily ?? "").trim();
      const product = {
        id: nextProductId,
        name: String(productFamily || action.name || existingProduct?.name || "New product").trim(),
        productFamily,
        productType: String(action.productType ?? existingProduct?.productType ?? "").trim(),
        size: String(action.size ?? existingProduct?.size ?? "").trim(),
        sizeValue: String(action.sizeValue ?? existingProduct?.sizeValue ?? "").trim(),
        sizeUnit: String(action.sizeUnit ?? existingProduct?.sizeUnit ?? "").trim(),
        category: categoryNameForStockCategory(stockCategory),
        stockCategory,
        unit: String(action.unit || existingProduct?.unit || "unit").trim(),
        warehouse: String(action.warehouse || existingProduct?.warehouse || "Finished Products Store").trim(),
        region: "Factory",
        stock: Math.max(0, Number(action.stock ?? existingProduct?.stock ?? 0)),
        reorderPoint: Math.max(0, Number(action.reorderPoint ?? existingProduct?.reorderPoint ?? 0)),
        dailyVelocity: Math.max(0, Number(action.dailyVelocity ?? existingProduct?.dailyVelocity ?? 0)),
        unitCost: Math.max(0, Number(action.unitCost ?? existingProduct?.unitCost ?? 0)),
        unitPrice: Math.max(0, Number(action.unitPrice ?? existingProduct?.unitPrice ?? 0)),
        packagingConversions: action.packagingConversions && typeof action.packagingConversions === "object"
          ? { ...action.packagingConversions }
          : { ...(existingProduct?.packagingConversions || {}) },
        packagingPrices: action.packagingPrices && typeof action.packagingPrices === "object"
          ? { ...action.packagingPrices }
          : { ...(existingProduct?.packagingPrices || {}) },
        imageUrl: String(action.imageUrl ?? existingProduct?.imageUrl ?? "").trim(),
        imageStorageKey: String(action.imageStorageKey ?? existingProduct?.imageStorageKey ?? "").trim(),
        imageRemoteSynced: Boolean(action.imageRemoteSynced ?? existingProduct?.imageRemoteSynced),
        status,
        soldOutAt: Math.max(0, Number(action.stock ?? existingProduct?.stock ?? 0)) > 0 ? "" : (existingProduct?.soldOutAt || ""),
        equipmentStatus: stockCategory === "equipment" ? (existingProduct?.equipmentStatus || "in_stock") : undefined,
        updatedAt: todayISO()
      };

      if (existingProduct) {
        Object.assign(existingProduct, product);
        remapProductReferences(state, previousProduct.id, product.id);
      } else {
        state.products = [product, ...state.products];
      }

      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: existingProduct ? "updated" : "created",
        recordType: "inventory",
        recordLabel: product.id,
        summary: productActivitySummary(previousProduct, product),
        details: productChangeDetails(previousProduct, product)
      });

      return state;
    }

    case "HYDRATE_PRODUCT_IMAGES": {
      const imagesByProductId = new Map((action.images || []).map((image) => [image.productId, image]));
      state.products.forEach((product) => {
        const image = imagesByProductId.get(product.id);
        if (!image) return;
        product.imageUrl = action.authoritative
          ? String(image.imageUrl || "")
          : String(image.imageUrl || product.imageUrl || "");
        product.imageStorageKey = String(image.imageStorageKey || product.imageStorageKey || "");
        if (action.authoritative || image.remoteSynced) product.imageRemoteSynced = true;
      });
      return state;
    }

    case "DELETE_PRODUCTS": {
      if (currentUserRole(state) !== "ceo") return state;

      const requestedIds = new Set((action.productIds || []).map((id) => String(id || "").trim()).filter(Boolean));
      const deletedProducts = state.products.filter((product) => requestedIds.has(product.id));
      if (!deletedProducts.length) return state;

      deletedProducts.forEach((product) => {
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: "deleted",
          recordType: "inventory",
          recordLabel: product.id,
          summary: `Deleted stock record for ${product.name}`,
          details: `${product.id} · ${Number(product.stock || 0)} ${product.unit || "units"} removed from current stock`
        });
      });

      state.products = state.products.filter((product) => !requestedIds.has(product.id));
      state.stockAssignments = (state.stockAssignments || []).filter((assignment) => !requestedIds.has(assignment.productId));
      return state;
    }

    case "TOGGLE_PRODUCT_STATUS": {
      const product = state.products.find((item) => item.id === action.productId);
      if (product) {
        product.status = product.status === "inactive" ? "active" : "inactive";
        product.updatedAt = todayISO();
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: product.status === "inactive" ? "deactivated" : "updated",
          recordType: "inventory",
          recordLabel: product.id,
          summary: `${product.name} marked ${product.status}`
        });
      }
      return state;
    }

    case "SUBMIT_STOCK_REQUEST": {
      if (!state.client?.id || currentUserRole(state) !== "sales_rep") return state;

      const account = currentWorkspaceAccount(state);
      const requestedItems = Array.isArray(action.items) ? action.items : [];
      const productIds = requestedItems.map((item) => String(item.productId || "")).filter(Boolean);
      const items = requestedItems.map((item) => {
        const product = state.products.find((candidate) => candidate.id === item.productId);
        const packagingType = String(item.packagingType || "piece").trim().toLowerCase();
        const packagingQuantity = Number(item.packagingQuantity ?? item.quantity ?? 0);
        return {
          productId: product?.id || "",
          productName: product?.name || "",
          sku: product?.id || "",
          unit: "pieces",
          packagingType,
          packagingQuantity,
          quantity: quantityInPieces(product, packagingQuantity, packagingType, state.client)
        };
      });
      const neededBy = dateOnly(action.neededBy);
      const priority = normalized(action.priority || "normal");

      if (
        !items.length ||
        new Set(productIds).size !== productIds.length ||
        items.some((item) => {
          const product = state.products.find((candidate) => candidate.id === item.productId);
          return !product || product.status === "inactive" || stockCategoryIdForProduct(product) !== "finished_products" || !["piece", "carton"].includes(item.packagingType) || !Number.isFinite(item.packagingQuantity) || item.packagingQuantity <= 0 || !Number.isFinite(item.quantity) || item.quantity <= 0;
        }) ||
        !isValidISODate(neededBy) ||
        neededBy < todayISO() ||
        !["normal", "urgent"].includes(priority)
      ) return state;

      const request = {
        id: nextFormattedId("REQ-{0000}", state.stockRequests.map((item) => item.id), "REQ"),
        clientId: state.client.id,
        repUserId: state.user?.id || "",
        repMembershipId: account?.id || "",
        repName: account?.name || currentActorLabel(state),
        requestedAt: new Date().toISOString(),
        neededBy,
        priority,
        notes: String(action.notes || "").trim(),
        status: "submitted",
        items
      };

      state.stockRequests = [request, ...state.stockRequests];
      appendActivityLog(state, {
        clientId: state.client.id,
        actionType: "submitted",
        recordType: "stock_request",
        recordLabel: request.id,
        summary: `${request.repName} submitted ${request.id}`,
        details: items.map((item) => `${packagingQuantityLabel(item.packagingQuantity, item.packagingType)} ${item.productName} (${item.quantity} pieces)`).join(", ")
      });
      return state;
    }

    case "PREPARE_PURCHASE_ORDER": {
      if (!state.client?.id || currentUserRole(state) !== "admin") return state;

      const request = state.stockRequests.find((item) => item.id === action.requestId && item.status === "submitted");
      if (!request) return state;
      const items = (Array.isArray(action.items) && action.items.length ? action.items : request.items).map((item) => {
        const requestedItem = request.items.find((candidate) => candidate.productId === item.productId);
        return requestedItem ? {
          ...requestedItem,
          packagingType: String(item.packagingType || requestedItem.packagingType || "piece"),
          packagingQuantity: Number(item.packagingQuantity ?? requestedItem.packagingQuantity ?? item.quantity ?? 0),
          quantity: Number(item.quantity || 0)
        } : null;
      }).filter(Boolean);
      const destination = String(action.destination || "").trim();
      const paymentType = normalized(action.paymentType || "credit");

      if (
        !items.length ||
        items.some((item) => !Number.isFinite(item.quantity) || item.quantity <= 0) ||
        !destination ||
        !["cash", "credit"].includes(paymentType)
      ) return state;

      const purchaseOrder = {
        id: nextFormattedId("PO-{0000}", state.purchaseOrders.map((item) => item.id), "PO"),
        clientId: state.client.id,
        requestId: request.id,
        repUserId: request.repUserId,
        repMembershipId: request.repMembershipId,
        repName: request.repName,
        items,
        paymentType,
        destination,
        neededBy: request.neededBy,
        priority: request.priority,
        requestNotes: request.notes,
        adminNotes: String(action.adminNotes || "").trim(),
        status: "forwarded",
        preparedBy: currentActorLabel(state),
        preparedAt: new Date().toISOString(),
        forwardedAt: new Date().toISOString()
      };

      request.status = "po_prepared";
      request.purchaseOrderId = purchaseOrder.id;
      state.purchaseOrders = [purchaseOrder, ...state.purchaseOrders];
      appendActivityLog(state, {
        clientId: state.client.id,
        actionType: "forwarded",
        recordType: "purchase_order",
        recordLabel: purchaseOrder.id,
        summary: `${purchaseOrder.id} forwarded to the Store Keeper`,
        details: `${purchaseOrder.repName} · ${items.length} product${items.length === 1 ? "" : "s"}`
      });
      return state;
    }

    case "DECLINE_STOCK_REQUEST": {
      if (!state.client?.id || currentUserRole(state) !== "admin") return state;
      const request = state.stockRequests.find((item) => item.id === action.requestId && item.status === "submitted");
      const reason = String(action.reason || "").trim();
      if (!request || !reason) return state;

      request.status = "declined";
      request.declineReason = reason;
      request.reviewedBy = currentActorLabel(state);
      request.reviewedAt = new Date().toISOString();
      appendActivityLog(state, {
        clientId: state.client.id,
        actionType: "declined",
        recordType: "stock_request",
        recordLabel: request.id,
        summary: `${request.id} declined`,
        details: reason
      });
      return state;
    }

    case "MARK_PURCHASE_ORDER_ISSUED": {
      if (!state.client?.id || currentUserRole(state) !== "store_keeper") return state;
      const purchaseOrder = state.purchaseOrders.find((item) => item.id === action.purchaseOrderId && item.status === "forwarded");
      if (!purchaseOrder || !action.dispatchId || !action.invoiceId) return state;

      purchaseOrder.status = "issued";
      purchaseOrder.dispatchId = String(action.dispatchId);
      purchaseOrder.invoiceId = String(action.invoiceId);
      purchaseOrder.issuedBy = currentActorLabel(state);
      purchaseOrder.issuedAt = new Date().toISOString();
      const request = state.stockRequests.find((item) => item.id === purchaseOrder.requestId);
      if (request) {
        request.status = "fulfilled";
        request.fulfilledAt = purchaseOrder.issuedAt;
      }
      appendActivityLog(state, {
        clientId: state.client.id,
        actionType: "issued",
        recordType: "purchase_order",
        recordLabel: purchaseOrder.id,
        summary: `${purchaseOrder.id} issued to ${purchaseOrder.repName}`,
        details: `Dispatch ${purchaseOrder.dispatchId} · Invoice ${purchaseOrder.invoiceId}`
      });
      return state;
    }

    case "CREATE_PROCUREMENT_ORDER": {
      if (!state.client?.id || currentUserRole(state) !== "admin") return state;

      const product = state.products.find((item) => item.id === action.productId);
      const quantity = Number(action.quantity || 0);
      const unitCost = Number(action.unitCost || 0);
      const supplierName = String(action.supplierName || "").trim();
      const expectedAt = dateOnly(action.expectedAt);

      if (
        !product ||
        stockCategoryIdForProduct(product) !== "raw_materials" ||
        !supplierName ||
        !Number.isFinite(quantity) || quantity <= 0 ||
        !Number.isFinite(unitCost) || unitCost < 0 ||
        !isValidISODate(expectedAt) || expectedAt < todayISO()
      ) return state;

      const procurementOrder = {
        id: nextFormattedId("PROC-{0000}", (state.procurementOrders || []).map((item) => item.id), "PROC"),
        clientId: state.client.id,
        supplierName,
        supplierContact: String(action.supplierContact || "").trim(),
        productId: product.id,
        productName: product.name,
        sku: product.id,
        quantity,
        unit: product.unit || "unit",
        unitCost,
        expectedAt,
        notes: String(action.notes || "").trim(),
        status: "requested",
        preparedBy: currentActorLabel(state),
        preparedAt: new Date().toISOString()
      };

      state.procurementOrders = [procurementOrder, ...(state.procurementOrders || [])];
      appendActivityLog(state, {
        clientId: state.client.id,
        actionType: "created",
        recordType: "procurement_order",
        recordLabel: procurementOrder.id,
        summary: `${procurementOrder.id} prepared for ${supplierName}`,
        details: `${quantity} ${procurementOrder.unit} ${product.name}`
      });
      return state;
    }

    case "MARK_PROCUREMENT_ORDERED": {
      if (currentUserRole(state) !== "admin") return state;
      const order = (state.procurementOrders || []).find((item) => item.id === action.procurementOrderId);
      if (!order || order.status !== "requested") return state;
      order.status = "ordered";
      order.orderedAt = new Date().toISOString();
      order.orderedBy = currentActorLabel(state);
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "forwarded",
        recordType: "procurement_order",
        recordLabel: order.id,
        summary: `${order.id} sent to ${order.supplierName}`
      });
      return state;
    }

    case "CANCEL_PROCUREMENT_ORDER": {
      if (currentUserRole(state) !== "admin") return state;
      const order = (state.procurementOrders || []).find((item) => item.id === action.procurementOrderId);
      const reason = String(action.reason || "").trim();
      if (!order || !["requested", "ordered"].includes(order.status) || !reason) return state;
      order.status = "cancelled";
      order.cancelReason = reason.slice(0, 500);
      order.cancelledAt = new Date().toISOString();
      order.cancelledBy = currentActorLabel(state);
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "cancelled",
        recordType: "procurement_order",
        recordLabel: order.id,
        summary: `${order.id} cancelled`,
        details: order.cancelReason
      });
      return state;
    }

    case "RECEIVE_PROCUREMENT_ORDER": {
      if (currentUserRole(state) !== "store_keeper") return state;
      const order = (state.procurementOrders || []).find((item) => item.id === action.procurementOrderId);
      const product = state.products.find((item) => item.id === order?.productId);
      const receivedQuantity = Number(action.receivedQuantity || 0);
      if (!order || order.status !== "ordered" || !product || !Number.isFinite(receivedQuantity) || receivedQuantity <= 0) return state;

      product.stock = Number(product.stock || 0) + receivedQuantity;
      product.updatedAt = todayISO();
      product.soldOutAt = "";
      order.status = "received";
      order.receivedQuantity = receivedQuantity;
      order.receivedBy = currentActorLabel(state);
      order.receivedAt = new Date().toISOString();
      order.receiptNote = String(action.receiptNote || "").trim();
      state.stockTransactions = [{
        id: createId("TXN"),
        clientId: state.client?.id || "",
        type: "supplier intake",
        movementDirection: "in",
        productId: product.id,
        productName: product.name,
        quantity: receivedQuantity,
        amount: receivedQuantity * Number(order.unitCost || 0),
        partyType: "Supplier",
        partyName: order.supplierName,
        recordedBy: currentActorLabel(state),
        procurementOrderId: order.id,
        date: todayISO(),
        createdAt: new Date().toISOString()
      }, ...(state.stockTransactions || [])];
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "received",
        recordType: "procurement_order",
        recordLabel: order.id,
        summary: `${receivedQuantity} ${order.unit} ${product.name} received into factory stock`,
        details: `${order.supplierName} · ${order.id}`
      });
      return state;
    }

    case "RECORD_STOCK_DISPATCH": {
      if (!["ceo", "store_keeper"].includes(currentUserRole(state))) return state;

      const recipientType = String(action.recipientType || "Recipient").trim();
      const recipientName = String(action.recipientName || "Recipient").trim();
      const normalizedRecipientType = recipientType.toLowerCase();
      const isInternalDispatch = normalizedRecipientType.includes("internal");
      const isWalkInDispatch = normalizedRecipientType.includes("walk-in") || normalizedRecipientType.includes("walk in");
      const isRepresentativeDispatch = normalizedRecipientType.includes("representative");
      const requestedArrangement = normalized(action.dispatchArrangement || "stock_transfer").replaceAll("-", "_");
      const dispatchArrangement = isRepresentativeDispatch && ["rep_purchase", "refundable_deposit", "stock_transfer"].includes(requestedArrangement)
        ? requestedArrangement
        : isRepresentativeDispatch ? "stock_transfer" : "";
      const depositAmount = dispatchArrangement === "refundable_deposit"
        ? Math.max(0, Number(action.depositAmount || 0))
        : 0;
      const paymentType = isInternalDispatch
        ? "none"
        : isWalkInDispatch
          ? "cash"
          : isRepresentativeDispatch
            ? dispatchArrangement === "rep_purchase" ? "cash" : dispatchArrangement === "refundable_deposit" ? "deposit" : "none"
            : normalized(action.paymentType || "cash");
      const destination = String(action.destination || "").trim();
      const routeId = String(action.routeId || "").trim();
      const staffName = String(action.staffName || currentActorName(state)).trim();
      const dispatchDate = dateOnly(action.dispatchDate) || todayISO();
      const expectedDeliveryAt = dateOnly(action.expectedDeliveryAt) || dispatchDate;
      const dispatchId = createId("DSP");
      const representativeAccount = isRepresentativeDispatch
        ? (state.accounts || []).find((account) => (
            normalized(account.name) === normalized(recipientName) &&
            ["sales_rep", "sales representative"].includes(normalized(account.role).replaceAll("-", "_"))
          ))
        : null;
      const requestedItems = Array.isArray(action.items) && action.items.length
        ? action.items
        : [{ productId: action.productId, quantity: action.quantity }];
      const dispatchItems = requestedItems.map((item) => {
        const product = state.products.find((candidate) => candidate.id === item.productId);
        const packagingType = String(item.packagingType || "piece");
        const packagingQuantity = Number(item.packagingQuantity || item.quantity || 0);
        return {
          product,
          quantity: quantityInPieces(product, packagingQuantity, packagingType, state.client),
          packagingType,
          packagingQuantity,
          packagingUnitPrice: packagingUnitPrice(product, packagingType, state.client),
          unitPrice: effectivePiecePrice(product, packagingType, state.client),
          amount: packagingLineAmount(product, packagingQuantity, packagingType, state.client),
          transactionId: createId("TXN")
        };
      });
      const lineKeys = dispatchItems.map((item) => `${item.product?.id || ""}:${item.packagingType}`);
      const hasDuplicateLines = new Set(lineKeys).size !== lineKeys.length;
      const dispatchStockValue = dispatchItems.reduce((total, item) => total + Number(item.amount || 0), 0);
      const requestedByProduct = dispatchItems.reduce((totals, item) => {
        if (item.product) totals.set(item.product.id, Number(totals.get(item.product.id) || 0) + item.quantity);
        return totals;
      }, new Map());
      let orderId = "";
      let invoiceId = "";

      if (
        !dispatchItems.length ||
        hasDuplicateLines ||
        dispatchItems.some(({ product, quantity }) => (
          !product ||
          product.status === "inactive" ||
          !Number.isFinite(quantity) ||
          quantity <= 0 ||
          !Number.isFinite(Number(product.stock)) ||
          Number(product.stock || 0) < Number(requestedByProduct.get(product.id) || 0) ||
          ((isRepresentativeDispatch || isWalkInDispatch) && stockCategoryIdForProduct(product) !== "finished_products")
        )) ||
        !isValidISODate(dispatchDate) ||
        (!isInternalDispatch && !isValidISODate(expectedDeliveryAt)) ||
        (!isInternalDispatch && expectedDeliveryAt < dispatchDate) ||
        (!isInternalDispatch && !isRepresentativeDispatch && !["cash", "credit"].includes(paymentType)) ||
        (dispatchArrangement === "refundable_deposit" && (!Number.isFinite(depositAmount) || depositAmount <= 0)) ||
        !recipientName
      ) {
        return state;
      }

      if (isRepresentativeDispatch && !isSalesRepresentativeName(state, recipientName)) {
        return state;
      }

      if (!isInternalDispatch) {
        const dispatchRecords = createDispatchSalesOrder(state, {
          dispatchId,
          transactionIds: dispatchItems.map((item) => item.transactionId),
          items: dispatchItems,
          recipientName,
          recipientType,
          destination,
          dispatchDate,
          expectedDeliveryAt,
          paymentType,
          dispatchArrangement,
          depositAmount,
          staffName,
          repUserId: representativeAccount?.userId || ""
        });
        orderId = dispatchRecords.orderId;
        invoiceId = dispatchRecords.invoiceId;
      }

      const transactions = dispatchItems.map(({ product, quantity, packagingType, packagingQuantity, packagingUnitPrice: packagePrice, unitPrice, amount, transactionId }) => {
        product.stock = Math.max(0, Number(product.stock || 0) - quantity);
        product.updatedAt = dispatchDate;
        product.soldOutAt = product.stock <= 0 ? dispatchDate : "";

        if (isRepresentativeDispatch) {
          state.stockAssignments = [
            {
              id: createId("ASN"),
              dispatchId,
              routeId: routeId || destination || "Factory dispatch",
              repName: recipientName,
              repUserId: representativeAccount?.userId || "",
              repMembershipId: representativeAccount?.id || "",
              productId: product.id,
              assignedAt: dispatchDate,
              transactionId,
              invoiceId,
              paymentType,
              dispatchArrangement,
              depositAmount: dispatchArrangement === "refundable_deposit" && dispatchStockValue > 0
                ? depositAmount * (Number(amount || 0) / dispatchStockValue)
                : 0,
              assigned: quantity,
              sold: 0,
              returned: 0,
              status: dispatchArrangement === "rep_purchase" ? "reconciled" : "open",
              reconciledAt: dispatchArrangement === "rep_purchase" ? dispatchDate : "",
              varianceFlagged: false,
              varianceNote: ""
            },
            ...state.stockAssignments
          ];
        }

        return {
          id: transactionId,
          dispatchId,
          clientId: state.client?.id || "",
          type: isInternalDispatch ? "internal movement" : "supply",
          productId: product.id,
          productName: product.name,
          quantity,
          packagingType,
          packagingQuantity,
          packagingUnitPrice: packagePrice,
          unit: product.unit || "unit",
          amount,
          unitPrice,
          unitCost: Number(product.unitCost || 0),
          paymentType,
          dispatchArrangement,
          depositAmount: dispatchArrangement === "refundable_deposit" && dispatchStockValue > 0
            ? depositAmount * (Number(amount || 0) / dispatchStockValue)
            : 0,
          financialImpact: !isRepresentativeDispatch || dispatchArrangement === "rep_purchase",
          accountingTreatment: !isRepresentativeDispatch || dispatchArrangement === "rep_purchase"
            ? "factory_revenue"
            : dispatchArrangement === "refundable_deposit" ? "refundable_deposit" : "representative_custody",
          partyType: recipientType,
          partyName: recipientName,
          recipientName,
          dispatchDestination: destination,
          staffResponsible: staffName,
          date: dispatchDate,
          recordedBy: staffName,
          recordedByUserId: state.user?.id || "",
          movementDirection: "out",
          creditImpact: paymentType === "credit" ? amount : 0,
          orderId,
          invoiceId,
          expectedDeliveryAt: isInternalDispatch ? "" : expectedDeliveryAt,
          soldOutAfterDispatch: product.stock <= 0
        };
      });

      state.stockTransactions = [...transactions, ...(state.stockTransactions || [])];

      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "dispatched",
        recordType: "stock_movement",
        recordLabel: dispatchId,
        summary: `Dispatched ${dispatchItems.length} product${dispatchItems.length === 1 ? "" : "s"} to ${recipientName}`,
        details: dispatchItems.map(({ product, quantity }) => `${quantity} ${product.name}`).join(", ")
      });

      if (orderId) {
        const dispatchRecordDescription = isRepresentativeDispatch
          ? dispatchArrangement === "rep_purchase"
            ? "sales rep purchase"
            : dispatchArrangement === "refundable_deposit" ? "stock deposit" : "stock transfer"
          : "factory sale";
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: "created",
          recordType: "order",
          recordLabel: orderId,
          summary: `${orderId} recorded as ${dispatchRecordDescription} for ${recipientName}`
        });
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: "created",
          recordType: isRepresentativeDispatch && dispatchArrangement === "stock_transfer" ? "stock_transfer_note" : "receipt",
          recordLabel: invoiceId,
          summary: `${invoiceId} created for ${recipientName} (${dispatchRecordDescription})`
        });
      }

      return state;
    }

    case "DIRECT_RECORD_CORRECTION": {
      if (currentUserRole(state) !== "ceo") return state;

      const transaction = (state.stockTransactions || []).find((item) => item.id === action.transactionId);
      const product = state.products.find((item) => item.id === transaction?.productId);
      const nextQuantity = Number(action.requestedQuantity || 0);
      const requestedPackagingType = String(action.requestedPackagingType || "piece");
      const requestedPackagingQuantity = Number(action.requestedPackagingQuantity ?? nextQuantity);
      const calculatedQuantity = quantityInPieces(product, requestedPackagingQuantity, requestedPackagingType, state.client);
      const previousQuantity = Number(transaction?.quantity || 0);
      const previousAmount = Number(transaction?.amount || 0);
      const reason = String(action.reason || "CEO adjustment").trim();
      const transactionType = normalized(transaction?.type);
      const isDispatch = transaction?.movementDirection === "out" && ["supply", "internal movement"].includes(transactionType);
      const delta = nextQuantity - previousQuantity;

      if (!transaction || !product || !isDispatch || !Number.isFinite(nextQuantity) || nextQuantity <= 0 || calculatedQuantity !== nextQuantity || delta === 0) return state;

      const assignment = (state.stockAssignments || []).find((item) => (
        item.transactionId === transaction.id || (
          item.productId === transaction.productId &&
          normalized(item.repName) === normalized(transaction.partyName) &&
          dateOnly(item.assignedAt) === dateOnly(transaction.date)
        )
      ));
      const nextAssigned = assignment ? Number(assignment.assigned || 0) + delta : 0;
      const committed = assignment ? Number(assignment.sold || 0) + Number(assignment.returned || 0) : 0;

      if (delta > Number(product.stock || 0) || (assignment && nextAssigned < committed)) return state;

      product.stock = Number(product.stock || 0) - delta;
      product.updatedAt = todayISO();
      product.soldOutAt = product.stock <= 0 ? todayISO() : "";
      syncPackagingQuantity(transaction, nextQuantity);
      transaction.amount = transaction.lineAmount;
      transaction.correctedAt = new Date().toISOString();
      transaction.correctionReason = reason.slice(0, 500);
      transaction.correctedBy = currentActorName(state);
      if (assignment) assignment.assigned = nextAssigned;

      const order = (state.orders || []).find((item) => item.id === transaction.orderId);
      const orderItem = matchingTransactionItem(order?.items, transaction);
      if (orderItem) syncPackagingQuantity(orderItem, nextQuantity);
      const invoice = (state.invoices || []).find((item) => (
        item.id === transaction.invoiceId ||
        item.orderId === transaction.orderId ||
        (item.transactionIds || []).includes(transaction.id)
      ));
      const invoiceItem = matchingTransactionItem(invoice?.items, transaction);
      if (invoiceItem) syncPackagingQuantity(invoiceItem, nextQuantity);
      if (invoice) invoice.amount = invoice.items.reduce((total, item) => (
        total + Number(item.lineAmount ?? (Number(item.quantity || 0) * Number(item.unitPrice || 0)))
      ), 0);
      if (String(transaction.paymentType || "").toLowerCase().includes("credit")) {
        updateCreditBalance(state, transaction.partyName, transaction.amount - previousAmount);
      }

      (state.correctionRequests || []).forEach((request) => {
        if (request.transactionId !== transaction.id || request.status !== "pending") return;
        request.status = "superseded";
        request.reviewedAt = new Date().toISOString();
        request.reviewedBy = currentActorName(state);
        request.reviewNote = "CEO saved a direct adjustment for this record.";
      });

      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "updated",
        recordType: "record_correction",
        recordLabel: transaction.id,
        summary: `CEO adjusted ${transaction.id} from ${previousQuantity} to ${nextQuantity}`,
        details: reason.slice(0, 500)
      });
      return state;
    }

    case "REQUEST_RECORD_CORRECTION": {
      const role = currentUserRole(state);
      const transaction = (state.stockTransactions || []).find((item) => item.id === action.transactionId);
      const product = state.products.find((item) => item.id === transaction?.productId);
      const requestedQuantity = Number(action.requestedQuantity || 0);
      const requestedPackagingType = String(action.requestedPackagingType || "piece");
      const requestedPackagingQuantity = Number(action.requestedPackagingQuantity ?? requestedQuantity);
      const calculatedQuantity = quantityInPieces(product, requestedPackagingQuantity, requestedPackagingType, state.client);
      const reason = String(action.reason || "").trim();
      const actorName = currentActorName(state);
      const transactionType = normalized(transaction?.type);
      const isDispatch = transaction?.movementDirection === "out" && ["supply", "internal movement"].includes(transactionType);
      const isRepSale = transactionType === "sale" && (
        transaction?.repUserId === state.user?.id || normalized(transaction?.recordedBy) === normalized(actorName)
      );
      const ownsDispatch = transaction?.recordedByUserId
        ? transaction.recordedByUserId === state.user?.id
        : normalized(transaction?.recordedBy) === normalized(actorName);
      const mayRequest = (role === "store_keeper" && isDispatch && ownsDispatch) || (role === "sales_rep" && isRepSale);
      const alreadyPending = (state.correctionRequests || []).some((request) => (
        request.transactionId === transaction?.id && request.status === "pending"
      ));

      if (!transaction || !product || !mayRequest || alreadyPending || !reason || !Number.isFinite(requestedQuantity) || requestedQuantity <= 0 || calculatedQuantity !== requestedQuantity || requestedQuantity === Number(transaction.quantity || 0)) {
        return state;
      }

      state.correctionRequests = [{
        id: createId("COR"),
        clientId: state.client?.id || "",
        transactionId: transaction.id,
        recordType: isDispatch ? "dispatch" : "sale",
        productId: transaction.productId,
        productName: transaction.productName || state.products.find((product) => product.id === transaction.productId)?.name || transaction.productId,
        originalQuantity: Number(transaction.quantity || 0),
        originalPackagingType: String(transaction.packagingType || "piece"),
        originalPackagingQuantity: Number(transaction.packagingQuantity ?? transaction.quantity ?? 0),
        requestedQuantity,
        requestedPackagingType,
        requestedPackagingQuantity,
        reason: reason.slice(0, 500),
        requestedBy: actorName,
        requestedByUserId: state.user?.id || "",
        requestedByRole: role,
        status: "pending",
        createdAt: new Date().toISOString()
      }, ...(state.correctionRequests || [])];

      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "requested",
        recordType: "record_correction",
        recordLabel: transaction.id,
        summary: `${actorName} requested a ${isDispatch ? "dispatch" : "sale"} correction: ${reason}`
      });
      return state;
    }

    case "APPROVE_RECORD_CORRECTION": {
      if (!["ceo", "admin"].includes(currentUserRole(state))) return state;

      const request = (state.correctionRequests || []).find((item) => item.id === action.requestId);
      if (!request || request.status !== "pending") return state;

      const transaction = (state.stockTransactions || []).find((item) => item.id === request.transactionId);
      const product = state.products.find((item) => item.id === transaction?.productId);
      const nextQuantity = Number(request.requestedQuantity || 0);
      const previousQuantity = Number(transaction?.quantity || 0);
      const previousAmount = Number(transaction?.amount || 0);
      const delta = nextQuantity - previousQuantity;
      let applied = false;

      if (transaction && product && request.recordType === "dispatch") {
        const assignment = (state.stockAssignments || []).find((item) => (
          item.transactionId === transaction.id || (
            item.productId === transaction.productId &&
            normalized(item.repName) === normalized(transaction.partyName) &&
            dateOnly(item.assignedAt) === dateOnly(transaction.date)
          )
        ));
        const nextAssigned = assignment ? Number(assignment.assigned || 0) + delta : 0;
        const committed = assignment ? Number(assignment.sold || 0) + Number(assignment.returned || 0) : 0;

        if (nextQuantity > 0 && delta <= Number(product.stock || 0) && (!assignment || nextAssigned >= committed)) {
          product.stock = Number(product.stock || 0) - delta;
          product.updatedAt = todayISO();
          product.soldOutAt = product.stock <= 0 ? todayISO() : "";
          syncPackagingQuantity(transaction, nextQuantity);
          transaction.amount = transaction.lineAmount;
          transaction.correctedAt = new Date().toISOString();
          transaction.correctionReason = request.reason;
          if (assignment) assignment.assigned = nextAssigned;
          const order = (state.orders || []).find((item) => item.id === transaction.orderId);
          const orderItem = matchingTransactionItem(order?.items, transaction);
          if (orderItem) syncPackagingQuantity(orderItem, nextQuantity);
          const invoice = (state.invoices || []).find((item) => (
            item.id === transaction.invoiceId ||
            item.orderId === transaction.orderId ||
            (item.transactionIds || []).includes(transaction.id)
          ));
          const invoiceItem = matchingTransactionItem(invoice?.items, transaction);
          if (invoiceItem) syncPackagingQuantity(invoiceItem, nextQuantity);
          if (invoice) invoice.amount = invoice.items.reduce((total, item) => (
            total + Number(item.lineAmount ?? (Number(item.quantity || 0) * Number(item.unitPrice || 0)))
          ), 0);
          if (
            String(transaction.paymentType || "").toLowerCase().includes("credit") &&
            !isRepresentativeSellThroughTransaction(transaction)
          ) {
            updateCreditBalance(state, transaction.partyName, transaction.amount - previousAmount);
          }
          applied = true;
        }
      }

      if (transaction && request.recordType === "sale") {
        const assignmentIds = transaction.assignmentIds || [transaction.assignmentId].filter(Boolean);
        const assignments = (state.stockAssignments || []).filter((item) => assignmentIds.includes(item.id));
        const availableToAdd = assignments.reduce((total, item) => total + assignmentOutstanding(item), 0);
        const recordedAllocations = new Map((transaction.assignmentAllocations || []).map((item) => [item.assignmentId, Number(item.quantity || 0)]));
        const removable = [...recordedAllocations.values()].reduce((total, quantity) => total + quantity, 0);

        if (nextQuantity > 0 && ((delta >= 0 && delta <= availableToAdd) || (delta < 0 && -delta <= removable))) {
          let remaining = Math.abs(delta);
          const orderedAssignments = delta >= 0 ? assignments : [...assignments].reverse();
          orderedAssignments.forEach((assignment) => {
            if (remaining <= 0) return;
            const currentAllocation = recordedAllocations.get(assignment.id) || 0;
            const adjustable = delta >= 0 ? assignmentOutstanding(assignment) : currentAllocation;
            const change = Math.min(adjustable, remaining);
            assignment.sold = Number(assignment.sold || 0) + (delta >= 0 ? change : -change);
            recordedAllocations.set(assignment.id, currentAllocation + (delta >= 0 ? change : -change));
            refreshAssignmentCompletion(state, assignment);
            remaining -= change;
          });

          syncPackagingQuantity(transaction, nextQuantity);
          transaction.amount = transaction.lineAmount;
          transaction.assignmentAllocations = [...recordedAllocations.entries()]
            .filter(([, quantity]) => quantity > 0)
            .map(([assignmentId, quantity]) => ({ assignmentId, quantity }));
          transaction.correctedAt = new Date().toISOString();
          transaction.correctionReason = request.reason;
          const order = (state.orders || []).find((item) => item.id === transaction.orderId);
          const orderItem = matchingTransactionItem(order?.items, transaction);
          if (orderItem) syncPackagingQuantity(orderItem, nextQuantity);
          const invoice = (state.invoices || []).find((item) => item.transactionId === transaction.id || (item.transactionIds || []).includes(transaction.id));
          const invoiceItem = matchingTransactionItem(invoice?.items, transaction);
          if (invoiceItem) syncPackagingQuantity(invoiceItem, nextQuantity);
          if (invoice) invoice.amount = invoice.items.reduce((total, item) => (
            total + Number(item.lineAmount ?? (Number(item.quantity || 0) * Number(item.unitPrice || 0)))
          ), 0);
          if (
            String(transaction.paymentType || "").toLowerCase().includes("credit") &&
            !isRepresentativeSellThroughTransaction(transaction)
          ) {
            updateCreditBalance(state, transaction.partyName, transaction.amount - previousAmount);
          }
          applied = true;
        }
      }

      if (!applied) return state;

      request.status = "approved";
      request.reviewedAt = new Date().toISOString();
      request.reviewedBy = currentActorName(state);
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "approved",
        recordType: "record_correction",
        recordLabel: request.transactionId,
        summary: `Approved ${request.recordType} correction from ${request.originalQuantity} to ${request.requestedQuantity}: ${request.reason}`
      });
      return state;
    }

    case "REJECT_RECORD_CORRECTION": {
      if (!["ceo", "admin"].includes(currentUserRole(state))) return state;
      const request = (state.correctionRequests || []).find((item) => item.id === action.requestId);
      if (!request || request.status !== "pending") return state;
      request.status = "rejected";
      request.reviewedAt = new Date().toISOString();
      request.reviewedBy = currentActorName(state);
      request.reviewNote = String(action.note || "Correction not approved").trim().slice(0, 500);
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "rejected",
        recordType: "record_correction",
        recordLabel: request.transactionId,
        summary: `Rejected ${request.recordType} correction requested by ${request.requestedBy}`
      });
      return state;
    }

    case "FLAG_ASSIGNMENT_VARIANCE": {
      const assignment = state.stockAssignments.find((item) => item.id === action.assignmentId);
      if (assignment && Math.abs(stockAssignmentVariance(assignment)) > 0.0001) {
        assignment.status = "variance";
        assignment.varianceFlagged = true;
        assignment.varianceNote = String(action.note || "CEO requested explanation").trim();
        assignment.flaggedAt = new Date().toISOString();
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: "flagged",
          recordType: "inventory",
          recordLabel: assignment.id,
          summary: `${assignment.repName} assignment flagged for variance`
        });
      }
      return state;
    }

    case "RECONCILE_ASSIGNMENT": {
      const assignment = state.stockAssignments.find((item) => item.id === action.assignmentId);
      if (assignment) {
        const hasVariance = Math.abs(stockAssignmentVariance(assignment)) > 0.0001;
        if (hasVariance && !assignment.varianceFlagged) return state;

        assignment.status = "reconciled";
        assignment.reconciledAt = new Date().toISOString();
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: "reconciled",
          recordType: "inventory",
          recordLabel: assignment.id,
          summary: `${assignment.repName} assignment reconciled`
        });
      }
      return state;
    }

    case "UPDATE_CREDIT_LIMIT": {
      const limit = state.creditLimits.find((item) => item.id === action.creditLimitId);
      const nextLimit = Math.max(0, Number(action.limit || 0));
      if (!limit || !nextLimit) return state;

      const previousLimit = Number(limit.limit || 0);
      const discountPercent = boundedPercent(action.discountPercent ?? limit.discountPercent ?? 0);
      const paymentPeriodDays = normalizedPaymentPeriod(action.paymentPeriodDays ?? limit.paymentPeriodDays ?? 14);
      const latePenaltyPercent = boundedPercent(action.latePenaltyPercent ?? limit.latePenaltyPercent ?? 0);
      const changedBy = currentActorLabel(state);
      const changedAt = new Date().toISOString();
      limit.previousLimit = previousLimit;
      limit.limit = nextLimit;
      limit.discountPercent = discountPercent;
      limit.paymentPeriodDays = paymentPeriodDays;
      limit.latePenaltyPercent = latePenaltyPercent;
      limit.changedBy = changedBy;
      limit.changedAt = changedAt;

      state.creditLimitHistory = [
        {
          id: createId("CLH"),
          creditLimitId: limit.id,
          partyType: limit.partyType,
          partyName: limit.partyName,
          previousLimit,
          nextLimit,
          discountPercent,
          paymentPeriodDays,
          latePenaltyPercent,
          changedBy,
          reason: String(action.reason || "CEO adjustment").trim(),
          changedAt
        },
        ...(state.creditLimitHistory || [])
      ];

      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "updated",
        recordType: "credit_limit",
        recordLabel: limit.partyName,
        summary: `Credit terms updated for ${limit.partyName}`
      });

      return state;
    }

    case "UPSERT_REP_CREDIT_LIMIT": {
      const repName = String(action.repName || "").trim();
      const repUserId = String(action.repUserId || "").trim();
      const nextLimit = Math.max(0, Number(action.limit || 0));
      if (!repName || !nextLimit) return state;

      const normalizedRepName = repName.toLowerCase();
      const paymentPeriodDays = normalizedPaymentPeriod(action.paymentPeriodDays ?? 1, 1);
      const changedBy = currentActorLabel(state);
      const changedAt = new Date().toISOString();
      let limit = state.creditLimits.find((item) => (
        (repUserId && item.repUserId === repUserId) ||
        (
          String(item.partyType || "").toLowerCase().includes("representative") &&
          String(item.partyName || "").trim().toLowerCase() === normalizedRepName
        )
      ));
      const previousLimit = Number(limit?.limit || 0);

      if (!limit) {
        limit = {
          id: createId("CRD"),
          partyType: "Sales Representative",
          partyName: repName,
          repUserId,
          limit: nextLimit,
          balance: 0,
          previousLimit: 0,
          discountPercent: 0,
          paymentPeriodDays,
          latePenaltyPercent: 0,
          changedBy,
          changedAt
        };
        state.creditLimits = [limit, ...state.creditLimits];
      } else {
        limit.previousLimit = previousLimit;
        limit.partyType = "Sales Representative";
        limit.partyName = repName;
        limit.repUserId = repUserId || limit.repUserId || "";
        limit.limit = nextLimit;
        limit.paymentPeriodDays = paymentPeriodDays;
        limit.changedBy = changedBy;
        limit.changedAt = changedAt;
      }

      state.creditLimitHistory = [
        {
          id: createId("CLH"),
          creditLimitId: limit.id,
          partyType: limit.partyType,
          partyName: limit.partyName,
          previousLimit,
          nextLimit,
          discountPercent: Number(limit.discountPercent || 0),
          paymentPeriodDays,
          latePenaltyPercent: Number(limit.latePenaltyPercent || 0),
          changedBy,
          reason: String(action.reason || "Representative working credit limit updated").trim(),
          changedAt
        },
        ...(state.creditLimitHistory || [])
      ];

      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: previousLimit ? "updated" : "created",
        recordType: "credit_limit",
        recordLabel: repName,
        summary: `Representative credit limit set for ${repName}`
      });

      return state;
    }

    case "UPSERT_CUSTOMER_CREDIT_LIMIT": {
      const customer = state.retailers.find((item) => item.id === action.customerId);
      const nextLimit = Math.max(0, Number(action.limit || 0));

      if (!customer || !nextLimit) return state;

      const customerName = String(customer.name || "").trim();
      const normalizedCustomerName = customerName.toLowerCase();
      const paymentPeriodDays = normalizedPaymentPeriod(action.paymentPeriodDays ?? 14);
      const discountPercent = boundedPercent(action.discountPercent);
      const latePenaltyPercent = boundedPercent(action.latePenaltyPercent);
      const changedBy = currentActorLabel(state);
      const changedAt = new Date().toISOString();
      let limit = state.creditLimits.find((item) => (
        item.retailerId === customer.id ||
        (
          String(item.partyType || "").toLowerCase().includes("supermarket") &&
          String(item.partyName || "").trim().toLowerCase() === normalizedCustomerName
        )
      ));
      const previousLimit = Number(limit?.limit || 0);

      if (!limit) {
        limit = {
          id: createId("CRD"),
          partyType: "Supermarket",
          partyName: customerName,
          retailerId: customer.id,
          limit: nextLimit,
          balance: Number(customer.outstanding || 0),
          previousLimit: 0,
          discountPercent,
          paymentPeriodDays,
          latePenaltyPercent,
          changedBy,
          changedAt
        };
        state.creditLimits = [limit, ...state.creditLimits];
      } else {
        limit.previousLimit = previousLimit;
        limit.partyType = "Supermarket";
        limit.partyName = customerName;
        limit.retailerId = customer.id;
        limit.limit = nextLimit;
        limit.discountPercent = discountPercent;
        limit.paymentPeriodDays = paymentPeriodDays;
        limit.latePenaltyPercent = latePenaltyPercent;
        limit.changedBy = changedBy;
        limit.changedAt = changedAt;
      }

      state.creditLimitHistory = [
        {
          id: createId("CLH"),
          creditLimitId: limit.id,
          partyType: limit.partyType,
          partyName: limit.partyName,
          previousLimit,
          nextLimit,
          discountPercent,
          paymentPeriodDays,
          latePenaltyPercent,
          changedBy,
          reason: String(action.reason || "Customer credit terms updated").trim(),
          changedAt
        },
        ...(state.creditLimitHistory || [])
      ];

      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: previousLimit ? "updated" : "created",
        recordType: "credit_limit",
        recordLabel: customerName,
        summary: `Customer credit terms set for ${customerName}`
      });

      return state;
    }

    case "REVIEW_SALES_REPORT": {
      if (!["ceo", "admin"].includes(currentUserRole(state))) return state;
      const report = state.salesReports.find((item) => item.id === action.reportId);
      if (report) {
        const reviewedAt = new Date().toISOString();
        const reviewNote = String(action.note || "Reviewed by CEO").trim().slice(0, 500);
        report.status = "reviewed";
        report.reviewedAt = reviewedAt;
        report.reviewNote = reviewNote;
        report.reviewHistory = [{
          id: createId("RNOTE"),
          status: "reviewed",
          note: reviewNote,
          recordedBy: currentActorName(state),
          recordedAt: reviewedAt
        }, ...(report.reviewHistory || [])];
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: "completed",
          recordType: "report",
          recordLabel: report.id,
          summary: `${report.repName} report reviewed`
        });
      }
      return state;
    }

    case "FLAG_SALES_REPORT": {
      if (!["ceo", "admin"].includes(currentUserRole(state))) return state;
      const report = state.salesReports.find((item) => item.id === action.reportId);
      const flagReason = String(action.note || "").trim().slice(0, 500);
      if (report && flagReason) {
        const flaggedAt = new Date().toISOString();
        report.status = "flagged";
        report.reviewNote = flagReason;
        report.flagReason = flagReason;
        report.flaggedAt = flaggedAt;
        report.reviewHistory = [{
          id: createId("RNOTE"),
          status: "flagged",
          note: flagReason,
          recordedBy: currentActorName(state),
          recordedAt: flaggedAt
        }, ...(report.reviewHistory || [])];
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: "flagged",
          recordType: "report",
          recordLabel: report.id,
          summary: `${report.repName} report flagged for correction`,
          details: flagReason
        });
      }
      return state;
    }

    case "RESTOCK_PRODUCT": {
      if (!["ceo", "admin"].includes(currentUserRole(state))) return state;
      const product = state.products.find((item) => item.id === action.productId);
      const quantity = Math.max(0, Number(action.quantity || 0));
      if (product && quantity > 0) {
        product.stock = Number(product.stock || 0) + quantity;
        product.updatedAt = todayISO();
        product.soldOutAt = "";
        state.stockTransactions = [
          {
            id: createId("TXN"),
            type: "internal movement",
            productId: product.id,
            productName: product.name,
            quantity,
            amount: 0,
            unitPrice: Number(product.unitPrice || 0),
            unitCost: Number(product.unitCost || 0),
            paymentType: "none",
            partyType: "Factory",
            partyName: "Stock replenishment",
            recipientName: "Factory stock",
            dispatchDestination: product.warehouse || "Factory",
            staffResponsible: currentActorName(state),
            date: todayISO(),
            recordedBy: currentActorName(state),
            movementDirection: "in",
            creditImpact: 0
          },
          ...(state.stockTransactions || [])
        ];
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: "restocked",
          recordType: "inventory",
          recordLabel: product.id,
          summary: `${product.name} restocked by ${quantity}`
        });
      }
      return state;
    }

    case "SUBMIT_STOCK_ADDITION_REQUEST": {
      if (currentUserRole(state) !== "store_keeper") return state;
      const kind = action.kind === "restock" ? "restock" : "new_product";
      const quantity = Math.max(0, Number(action.quantity ?? action.product?.stock ?? 0));
      const requestedProduct = action.product && typeof action.product === "object" ? clone(action.product) : null;
      const productId = String(action.productId || requestedProduct?.id || "").trim();
      const existingProduct = state.products.find((item) => item.id === productId);
      if (!productId || (kind === "restock" && (!existingProduct || quantity <= 0))) return state;
      if (kind === "new_product" && (!requestedProduct?.name || existingProduct)) return state;
      const hasPendingDuplicate = (state.stockAdditionRequests || []).some((request) => (
        request.status === "pending" && request.kind === kind && request.productId === productId
      ));
      if (hasPendingDuplicate) return state;

      const request = {
        id: createId("SAR"),
        clientId: state.client?.id,
        kind,
        productId,
        productName: String(existingProduct?.name || requestedProduct?.name || productId),
        quantity,
        product: kind === "new_product" ? requestedProduct : null,
        requestedByUserId: String(state.user?.id || ""),
        requestedBy: currentActorName(state),
        requestedAt: new Date().toISOString(),
        status: "pending",
        reviewNote: "",
        reviewedAt: "",
        reviewedBy: ""
      };
      state.stockAdditionRequests = [request, ...(state.stockAdditionRequests || [])];
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "requested",
        recordType: "stock_addition",
        recordLabel: request.id,
        summary: `${request.requestedBy} requested ${kind === "restock" ? `a stock increase for ${request.productName}` : `new stock ${request.productName}`}`
      });
      return state;
    }

    case "SUBMIT_PRODUCTION_STORE_RECEIPT": {
      if (currentUserRole(state) !== "store_keeper") return state;
      const batch = (state.productionBatches || []).find((item) => item.id === action.batchId && item.managerWorkflow);
      const physicalQuantity = Number(action.physicalQuantity || 0);
      const confirmedGoodQuantity = Number(batch?.quantityProduced || 0);
      const product = state.products.find((item) => item.id === batch?.finishedProductId);
      if (
        !batch || batch.status !== "supervisor_confirmed" || !product ||
        !Number.isInteger(physicalQuantity) || physicalQuantity <= 0 || physicalQuantity > confirmedGoodQuantity
      ) return state;
      const actor = getCurrentActor(state);
      const receivedAt = new Date().toISOString();
      const request = {
        id: createId("SAR"),
        clientId: state.client?.id,
        kind: "production_receipt",
        productionBatchId: batch.id,
        batchReference: batch.reference,
        productId: product.id,
        productName: product.name,
        quantity: physicalQuantity,
        supervisorConfirmedQuantity: confirmedGoodQuantity,
        managerProducedQuantity: Number(batch.managerProducedQuantity || 0),
        requestedByUserId: String(state.user?.id || ""),
        requestedBy: actor.name,
        requestedAt: receivedAt,
        physicalReceiptNote: String(action.note || "").trim().slice(0, 500),
        status: "pending",
        reviewNote: "",
        reviewedAt: "",
        reviewedBy: ""
      };
      state.stockAdditionRequests = [request, ...(state.stockAdditionRequests || [])];
      batch.status = "store_keeper_submitted";
      batch.storeReceiptStatus = "awaiting_ceo_admin_approval";
      batch.storeKeeperSubmittedBy = actor.name;
      batch.storeKeeperSubmittedByUserId = actor.userId || "";
      batch.storeKeeperSubmittedAt = receivedAt;
      batch.storeKeeperPhysicalQuantity = physicalQuantity;
      batch.storeKeeperReceiptNote = request.physicalReceiptNote;
      batch.updatedAt = receivedAt;
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "submitted",
        recordType: "production_store_receipt",
        recordLabel: batch.reference,
        summary: `${actor.name} physically confirmed ${physicalQuantity} ${product.name} from ${batch.reference}; CEO or Admin approval is required before stock is added`,
        notificationRoles: ["admin", "ceo"],
        relatedUserIds: actor.userId ? [actor.userId] : []
      });
      return state;
    }

    case "APPROVE_STOCK_ADDITION_REQUEST": {
      if (!["ceo", "admin"].includes(currentUserRole(state))) return state;
      const request = (state.stockAdditionRequests || []).find((item) => item.id === action.requestId);
      if (!request || request.status !== "pending") return state;

      if (request.kind === "new_product") {
        if (!request.product || state.products.some((item) => item.id === request.productId)) return state;
        state.products = [{ ...clone(request.product), updatedAt: todayISO() }, ...state.products];
      } else {
        const product = state.products.find((item) => item.id === request.productId);
        const quantity = Math.max(0, Number(request.quantity || 0));
        if (!product || quantity <= 0) return state;
        product.stock = Number(product.stock || 0) + quantity;
        product.updatedAt = todayISO();
        product.soldOutAt = "";
        state.stockTransactions = [{
          id: createId("TXN"),
          type: "internal movement",
          productId: product.id,
          productName: product.name,
          quantity,
          amount: 0,
          unitPrice: Number(product.unitPrice || 0),
          unitCost: Number(product.unitCost || 0),
          paymentType: "none",
          partyType: "Factory",
          partyName: "Approved stock replenishment",
          recipientName: "Factory stock",
          dispatchDestination: product.warehouse || "Factory",
          staffResponsible: request.requestedBy,
          date: todayISO(),
          recordedBy: currentActorName(state),
          movementDirection: "in",
          creditImpact: 0
        }, ...(state.stockTransactions || [])];
      }

      request.status = "approved";
      request.reviewNote = String(action.note || "Approved").trim().slice(0, 500);
      request.reviewedAt = new Date().toISOString();
      request.reviewedBy = currentActorName(state);
      if (request.kind === "production_receipt") {
        const batch = (state.productionBatches || []).find((item) => item.id === request.productionBatchId && item.managerWorkflow);
        if (batch) {
          batch.status = "approved";
          batch.storeReceiptStatus = "stock_added";
          batch.approvedAt = request.reviewedAt;
          batch.approvedBy = request.reviewedBy;
          batch.transferredAt = request.reviewedAt;
          batch.transferredQuantity = Number(request.quantity || 0);
          batch.updatedAt = request.reviewedAt;
        }
      }
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "approved",
        recordType: "stock_addition",
        recordLabel: request.id,
        summary: `${request.productName} stock addition approved by ${request.reviewedBy}`
      });
      return state;
    }

    case "REJECT_STOCK_ADDITION_REQUEST": {
      if (!["ceo", "admin"].includes(currentUserRole(state))) return state;
      const request = (state.stockAdditionRequests || []).find((item) => item.id === action.requestId);
      if (!request || request.status !== "pending") return state;
      request.status = "rejected";
      request.reviewNote = String(action.note || "Rejected").trim().slice(0, 500);
      request.reviewedAt = new Date().toISOString();
      request.reviewedBy = currentActorName(state);
      if (request.kind === "production_receipt") {
        const batch = (state.productionBatches || []).find((item) => item.id === request.productionBatchId && item.managerWorkflow);
        if (batch) {
          batch.status = "supervisor_confirmed";
          batch.storeReceiptStatus = "awaiting_store_keeper";
          batch.storeKeeperRejectionNote = request.reviewNote;
          batch.updatedAt = request.reviewedAt;
        }
      }
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "rejected",
        recordType: "stock_addition",
        recordLabel: request.id,
        summary: `${request.productName} stock addition rejected by ${request.reviewedBy}`
      });
      return state;
    }

    case "REDUCE_PRODUCT_STOCK": {
      const product = state.products.find((item) => item.id === action.productId);
      const quantity = Math.max(0, Number(action.quantity || 0));
      const reason = String(action.reason || "").trim();
      const reasonDetails = String(action.reasonDetails || "").trim();
      const reasonSummary = reasonDetails ? `${reason} - ${reasonDetails}` : reason;

      if (product && quantity > 0 && quantity <= Number(product.stock || 0) && reason) {
        product.stock = Math.max(0, Number(product.stock || 0) - quantity);
        product.updatedAt = todayISO();
        product.soldOutAt = product.stock <= 0 ? todayISO() : "";
        state.stockTransactions = [
          {
            id: createId("TXN"),
            type: "write off",
            productId: product.id,
            productName: product.name,
            quantity,
            amount: 0,
            unitPrice: Number(product.unitPrice || 0),
            unitCost: Number(product.unitCost || 0),
            paymentType: "none",
            partyType: "Factory",
            partyName: reason,
            recipientName: "Factory stock",
            dispatchDestination: product.warehouse || "Factory",
            staffResponsible: currentActorName(state),
            date: todayISO(),
            recordedBy: currentActorName(state),
            movementDirection: "out",
            reason,
            reasonDetails,
            creditImpact: 0
          },
          ...(state.stockTransactions || [])
        ];
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: "reduced",
          recordType: "inventory",
          recordLabel: product.id,
          summary: `${product.name} reduced by ${quantity}: ${reasonSummary}`
        });
      }
      return state;
    }

    case "ADVANCE_ROUTE": {
      const route = state.routes.find((item) => item.id === action.routeId);
      if (route) {
        route.status = nextRouteStatus(route.status);
        route.updatedAt = todayISO();
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: "updated",
          recordType: "route",
          recordLabel: route.id,
          summary: `${route.name} dispatch moved to ${textLabel(route.status)}`
        });
      }
      return state;
    }

    case "UPSERT_RETAILER": {
      if (!state.client?.id) return state;
      const retailerId = String(action.retailerId || "").trim();
      const existingRetailer = state.retailers.find((item) => item.id === retailerId);
      const actorRole = currentUserRole(state);
      if (!["ceo", "sales_rep"].includes(actorRole) || (existingRetailer && actorRole === "sales_rep")) return state;
      const previousName = existingRetailer?.name;
      const nextName = String(action.name || existingRetailer?.name || "New customer").trim();
      const stateName = String(action.stateName ?? action.region ?? existingRetailer?.stateName ?? existingRetailer?.region ?? "").trim();
      const actorName = currentActorLabel(state);
      const changedAt = new Date().toISOString();
      const retailer = {
        id: retailerId || createId("RTL"),
        name: nextName,
        city: String(action.city ?? existingRetailer?.city ?? "").trim(),
        lga: String(action.lga ?? existingRetailer?.lga ?? "").trim(),
        region: stateName,
        stateName,
        address: String(action.address ?? existingRetailer?.address ?? "").trim(),
        channel: String(action.channel ?? existingRetailer?.channel ?? "Supermarket").trim(),
        contact: String(action.contact ?? existingRetailer?.contact ?? "").trim(),
        contactPhone: String(action.contactPhone ?? existingRetailer?.contactPhone ?? "").trim(),
        assignedRepUserId: String(action.assignedRepUserId ?? existingRetailer?.assignedRepUserId ?? "").trim(),
        assignedRepName: String(action.assignedRepName ?? existingRetailer?.assignedRepName ?? "").trim(),
        createdByUserId: String(existingRetailer?.createdByUserId || action.createdByUserId || state.user?.id || "").trim(),
        createdByName: String(existingRetailer?.createdByName || action.createdByName || existingRetailer?.assignedRepName || actorName).trim(),
        createdAt: existingRetailer?.createdAt || action.createdAt || changedAt,
        updatedByUserId: String(state.user?.id || "").trim(),
        updatedByName: actorName,
        fillRate: Math.max(0, Math.min(100, Number(action.fillRate ?? existingRetailer?.fillRate ?? 0))),
        outstanding: Math.max(0, Number(action.outstanding ?? existingRetailer?.outstanding ?? 0)),
        lastOrder: existingRetailer?.lastOrder || todayISO(),
        lastContact: existingRetailer?.lastContact || todayISO(),
        status: String(action.status || existingRetailer?.status || "active"),
        updatedAt: changedAt
      };

      if (existingRetailer) {
        Object.assign(existingRetailer, retailer);
        delete existingRetailer.tier;
      } else {
        state.retailers = [retailer, ...state.retailers];
      }

      const requestedLimit = Math.max(0, Number(action.creditLimit || 0));
      const discountPercent = boundedPercent(action.discountPercent || 0);
      const paymentPeriodDays = normalizedPaymentPeriod(action.paymentPeriodDays || 14);
      const latePenaltyPercent = boundedPercent(action.latePenaltyPercent || 0);
      const changedBy = actorName;
      let creditLimit = state.creditLimits.find((item) => (
        String(item.partyName || "").trim().toLowerCase() === String(previousName || nextName).trim().toLowerCase()
      ));

      if (requestedLimit > 0) {
        if (!creditLimit) {
          creditLimit = {
            id: createId("CRD"),
          partyType: "Customer",
          partyName: nextName,
          retailerId: retailer.id,
          limit: requestedLimit,
            balance: retailer.outstanding,
            previousLimit: 0,
            changedBy,
            changedAt
          };
          state.creditLimits = [creditLimit, ...state.creditLimits];
        } else {
          creditLimit.previousLimit = Number(creditLimit.limit || 0);
          creditLimit.partyName = nextName;
          creditLimit.retailerId = retailer.id;
          creditLimit.limit = requestedLimit;
          creditLimit.balance = retailer.outstanding;
          creditLimit.changedBy = changedBy;
          creditLimit.changedAt = changedAt;
        }

        creditLimit.discountPercent = discountPercent;
        creditLimit.paymentPeriodDays = paymentPeriodDays;
        creditLimit.latePenaltyPercent = latePenaltyPercent;

        state.creditLimitHistory = [
          {
            id: createId("CLH"),
            creditLimitId: creditLimit.id,
            partyType: creditLimit.partyType,
            partyName: creditLimit.partyName,
            previousLimit: Number(creditLimit.previousLimit || 0),
            nextLimit: requestedLimit,
            discountPercent,
            paymentPeriodDays,
            latePenaltyPercent,
            changedBy,
            reason: "Customer payment terms updated",
            changedAt
          },
          ...(state.creditLimitHistory || [])
        ];
      }

      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: existingRetailer ? "updated" : "created",
        recordType: "retailer",
        recordLabel: retailer.name,
        summary: existingRetailer
          ? `Updated customer profile for ${retailer.name}`
          : `${actorName} added ${retailer.name} to the shared customer directory`
      });

      return state;
    }

    case "LOG_RETAILER_TOUCH": {
      const retailer = state.retailers.find((item) => item.id === action.retailerId);
      if (retailer) {
        retailer.lastContact = todayISO();
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: "contacted",
          recordType: "retailer",
          recordLabel: retailer.id,
          summary: `Customer contact logged for ${retailer.name}`
        });
      }
      return state;
    }

    case "TOGGLE_RETAILER_STATUS": {
      if (!state.client?.id || currentUserRole(state) !== "ceo") return state;
      const retailer = state.retailers.find((item) => item.id === action.retailerId);
      if (!retailer) return state;
      retailer.status = retailer.status === "inactive" ? "active" : "inactive";
      retailer.updatedAt = todayISO();
      appendActivityLog(state, {
        clientId: state.client.id,
        actionType: retailer.status === "inactive" ? "deactivated" : "reactivated",
        recordType: "retailer",
        recordLabel: retailer.name,
        summary: `${retailer.status === "inactive" ? "Deactivated" : "Activated"} customer outlet ${retailer.name}`
      });
      return state;
    }

    case "UPDATE_REP_CREDIT_INVOICE": {
      if (currentUserRole(state) !== "sales_rep") return state;
      const invoice = state.invoices.find((item) => item.id === action.invoiceId);
      const account = (state.accounts || []).find((item) => item.userId === state.user?.id);
      const isOwnedByRepresentative = invoice && (
        (invoice.repUserId && invoice.repUserId === state.user?.id) ||
        (!invoice.repUserId && normalized(invoice.repName) === normalized(account?.name || currentActorName(state)))
      );
      const isRepresentativeCreditInvoice = (
        isOwnedByRepresentative &&
        invoice.documentType === INVOICE_TYPES.REPRESENTATIVE_CUSTOMER_INVOICE &&
        normalized(invoice.paymentType).includes("credit")
      );
      const nextStatus = action.status === "paid" ? "paid" : "open";
      const nextDueAt = dateOnly(action.dueAt);

      if (!isRepresentativeCreditInvoice || !isValidISODate(nextDueAt)) return state;

      const wasPaid = normalized(invoice.status) === "paid";
      const willBePaid = nextStatus === "paid";
      const order = state.orders.find((item) => item.id === invoice.orderId);
      invoice.status = nextStatus;
      invoice.dueAt = nextDueAt;
      invoice.paymentNote = String(action.paymentNote || "").trim();
      invoice.paidAt = willBePaid ? (invoice.paidAt || todayISO()) : "";
      invoice.updatedAt = new Date().toISOString();
      if (order) {
        order.paymentStatus = nextStatus;
        order.dueAt = nextDueAt;
        order.paymentNote = invoice.paymentNote;
        order.updatedAt = todayISO();
      }
      if (wasPaid !== willBePaid) {
        updateCreditBalance(state, invoice.customerName, willBePaid ? -Number(invoice.amount || 0) : Number(invoice.amount || 0));
      }
      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: willBePaid ? "paid" : "updated",
        recordType: "invoice",
        recordLabel: invoice.id,
        summary: `${invoice.id} customer credit invoice ${willBePaid ? "marked paid" : "updated by the sales representative"}`
      });
      return state;
    }

    case "MARK_INVOICE_PAID": {
      const invoice = state.invoices.find((item) => item.id === action.invoiceId);
      const order = state.orders.find((item) => item.id === invoice?.orderId);
      const isCreditInvoice = String(invoice?.paymentType || order?.paymentType || "").toLowerCase().includes("credit");
      if (invoice && currentUserRole(state) === "ceo" && isCreditInvoice) {
        const creditLimit = state.creditLimits.find((item) => normalized(item.partyName) === normalized(invoice.customerName));
        invoice.status = "paid";
        invoice.paidAt = todayISO();
        if (order) {
          order.paymentStatus = "paid";
          order.updatedAt = todayISO();
        }
        if (creditLimit && String(invoice.paymentType || order?.paymentType || "").toLowerCase().includes("credit")) {
          creditLimit.balance = Math.max(0, Number(creditLimit.balance || 0) - Number(invoice.amount || 0));
        }
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: "paid",
          recordType: "invoice",
          recordLabel: invoice.id,
          summary: `${invoice.id} marked paid`
        });
      }
      return state;
    }

    default:
      return state;
  }
}

export function createStore() {
  // Operational data is loaded only after the authenticated tenant is known.
  let state = ensureStateShape(seedData);
  const listeners = new Set();

  function notify(action) {
    saveStoredState(getPersistableState(state));
    listeners.forEach((listener) => listener(state, action));
  }

  return {
    getState() {
      return state;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispatch(action) {
      const deletedClientId = action?.type === "DELETE_CLIENT_ACCOUNT" ? state.client?.id : "";
      state = reducer(state, action);
      if (deletedClientId) clearStoredState(deletedClientId);
      notify(action);
    },

    reset() {
      const clientId = state.client?.id;
      state = ensureStateShape(seedData);
      clearStoredState(clientId);
      notify({
        type: "RESET_DATA",
        message: "Workspace data cleared"
      });
    }
  };
}
