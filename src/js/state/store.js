import seedData from "../data/seed-data.js";
import { createActivityLog, getCurrentActor } from "../services/activity.js";
import {
  assignmentOutstanding,
  getReturnableCustomerChoices,
  isRepresentativeReturnEligible,
  stockCategoryIdForProduct
} from "../services/calculations.js";
import { salesRepresentativeNames } from "../services/rbac.js";
import { clearStoredState, loadStoredState, saveStoredState } from "../services/storage.js";
import { createAccountInvite, createClientProfile, createId } from "../services/tenant.js";

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

function boundedPercent(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
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
    transactionId: transaction.id,
    retailerId: customer?.id || transaction.customerId || "",
    customerName: customer?.name || transaction.partyName || "Walk-in customer",
    customerType: customer?.channel || transaction.partyType || "Customer",
    region: customer?.stateName || customer?.region || "Direct sales",
    priority: "Normal",
    status: "delivered",
    paymentType,
    paymentStatus: paymentLabel.includes("credit") ? "open" : "paid",
    dueAt: date,
    createdAt: date,
    updatedAt: date,
    repName: transaction.recordedBy || "Sales Representative",
    repUserId: transaction.repUserId || "",
    items: [
      {
        productId: transaction.productId,
        productName: transaction.productName || product?.name || transaction.productId,
        quantity,
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
    status: normalizedOrderStatus(order.status)
  }));
}

function ensureStateShape(value) {
  const state = clone(value || seedData);

  return ensureQuickSaleOrders({
    ...clone(seedData),
    ...state,
    client: state.client || null,
    accounts: Array.isArray(state.accounts) ? state.accounts : [],
    invites: Array.isArray(state.invites) ? state.invites : [],
    featureModules: Array.isArray(state.featureModules) ? state.featureModules : [],
    messages: Array.isArray(state.messages) ? state.messages : [],
    notificationReadAt: String(state.notificationReadAt || ""),
    activityLogs: Array.isArray(state.activityLogs) ? state.activityLogs : [],
    salesReports: mergeSeedRecords(state.salesReports, seedData.salesReports),
    creditLimitHistory: mergeSeedRecords(state.creditLimitHistory, seedData.creditLimitHistory),
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
    backend: clone(seedData.backend),
    session: null,
    user: null,
    platformAdmin: false,
    platformOverview: []
  };
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
  return getCurrentActor(state).name || "Manager";
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

  return `Updated stock ${nextProduct.name}`;
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
}

function appendActivityLog(state, activity) {
  if (!activity?.clientId) return;

  state.activityLogs = [
    createActivityLog({
      ...activity,
      actor: getCurrentActor(state)
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
  paymentType,
  repName
}) {
  const paymentLabel = String(paymentType || "cash").toLowerCase();
  const today = todayISO();
  const orderId = createId("ORD");
  const isCreditSale = paymentLabel.includes("credit");
  const customerLimit = (state.creditLimits || []).find((limit) => (
    normalized(limit.partyName) === normalized(customer?.name || customerName)
  ));
  const dueDate = new Date(`${today}T12:00:00`);
  dueDate.setDate(dueDate.getDate() + Number(customerLimit?.paymentPeriodDays ?? 14));
  const dueAt = dueDate.toISOString().slice(0, 10);
  const amount = quantity * Number(product.unitPrice || 0);

  state.orders = [
    {
      id: orderId,
      clientId: state.client?.id || "",
      source: "quick_sale",
      transactionId,
      retailerId: customer?.id || "",
      customerName: customer?.name || customerName || "Walk-in customer",
      customerType: customer?.channel || customerType || "Customer",
      region: customer?.stateName || customer?.region || "Direct sales",
      priority: "Normal",
      status: "delivered",
      paymentType,
      paymentStatus: isCreditSale ? "open" : "paid",
      dueAt: isCreditSale ? dueAt : today,
      createdAt: today,
      updatedAt: today,
      repName,
      repUserId: state.user?.id || "",
      items: [
        {
          productId: product.id,
          productName: product.name,
          quantity,
          unitPrice: Number(product.unitPrice || 0),
          unitCost: Number(product.unitCost || 0)
        }
      ]
    },
    ...(state.orders || [])
  ];

  if (isCreditSale) {
    state.invoices = [
      {
        id: createId("INV"),
        clientId: state.client?.id || "",
        orderId,
        transactionId,
        retailerId: customer?.id || "",
        customerName: customer?.name || customerName || "Customer",
        issuedAt: today,
        dueAt,
        amount,
        status: "open",
        repName
      },
      ...(state.invoices || [])
    ];
  }

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
  transactionId,
  product,
  quantity,
  recipientName,
  recipientType,
  destination,
  dispatchDate,
  staffName,
  repUserId = ""
}) {
  const customer = findRetailerByName(state, recipientName);
  const dispatchesToRepresentative = String(recipientType || "").toLowerCase().includes("representative");
  const orderId = createId("ORD");

  state.orders = [
    {
      id: orderId,
      clientId: state.client?.id || "",
      source: "factory_dispatch",
      transactionId,
      retailerId: customer?.id || "",
      customerName: customer?.name || recipientName || "Customer",
      customerType: customer?.channel || recipientType || "Customer",
      region: customer?.stateName || customer?.region || destination || "Direct dispatch",
      priority: "Normal",
      status: "in_transit",
      paymentType: "pending",
      paymentStatus: "pending",
      dueAt: dispatchDate,
      createdAt: dispatchDate,
      updatedAt: dispatchDate,
      repName: dispatchesToRepresentative ? recipientName : staffName,
      repUserId: dispatchesToRepresentative ? repUserId : state.user?.id || "",
      items: [
        {
          productId: product.id,
          productName: product.name,
          quantity,
          unitPrice: Number(product.unitPrice || 0),
          unitCost: Number(product.unitCost || 0)
        }
      ]
    },
    ...(state.orders || [])
  ];

  return orderId;
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
      return {
        ...state,
        client: action.client || null,
        accounts: Array.isArray(action.accounts) ? action.accounts : [],
        invites: Array.isArray(action.invites) ? action.invites : [],
        featureModules: Array.isArray(action.featureModules) ? action.featureModules : state.featureModules,
        messages: Array.isArray(action.messages) ? action.messages : state.messages,
        notificationReadAt: action.notificationReadAt || state.notificationReadAt,
        activityLogs: Array.isArray(action.activityLogs) ? action.activityLogs : state.activityLogs,
        creditLimits: Array.isArray(action.creditLimits) ? mergeCreditLimitRecords(state.creditLimits, action.creditLimits) : state.creditLimits,
        creditLimitHistory: Array.isArray(action.creditLimitHistory)
          ? mergeCreditHistoryRecords(state.creditLimitHistory, action.creditLimitHistory)
          : state.creditLimitHistory
      };
    }

    case "SET_AUTHENTICATED_WORKSPACE": {
      return {
        ...state,
        session: action.session || null,
        user: action.user || null,
        client: action.client || null,
        accounts: Array.isArray(action.accounts) ? action.accounts : [],
        invites: Array.isArray(action.invites) ? action.invites : [],
        featureModules: Array.isArray(action.featureModules) ? action.featureModules : state.featureModules,
        messages: Array.isArray(action.messages) ? action.messages : state.messages,
        notificationReadAt: action.notificationReadAt || state.notificationReadAt,
        activityLogs: Array.isArray(action.activityLogs) ? action.activityLogs : state.activityLogs,
        creditLimits: Array.isArray(action.creditLimits) ? mergeCreditLimitRecords(state.creditLimits, action.creditLimits) : state.creditLimits,
        creditLimitHistory: Array.isArray(action.creditLimitHistory)
          ? mergeCreditHistoryRecords(state.creditLimitHistory, action.creditLimitHistory)
          : state.creditLimitHistory,
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

    case "SET_PLATFORM_CONTEXT": {
      return {
        ...state,
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

    case "CLEAR_AUTH_CONTEXT": {
      return {
        ...state,
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

    case "DELETE_CLIENT_ACCOUNT": {
      return {
        ...state,
        client: null,
        accounts: [],
        invites: [],
        messages: [],
        notificationReadAt: "",
        activityLogs: [],
        salesReports: [],
        creditLimitHistory: [],
        retailers: [],
        orders: [],
        routes: [],
        products: [],
        stockCategories: [],
        stockAssignments: [],
        stockTransactions: [],
        creditLimits: [],
        invoices: []
      };
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
                full_name: action.name
              }
            }
          : state.user,
        accounts: state.accounts.map((account) =>
          account.userId === state.user?.id
            ? {
                ...account,
                name: action.name
              }
            : account
        )
      };
    }

    case "CREATE_ACCOUNT": {
      if (!state.client?.id) return state;
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
      const canSendToAllStaff = ["manager", "ceo"].includes(String(sender?.role || "").toLowerCase());
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

    case "ADVANCE_ORDER": {
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
      const order = state.orders.find((item) => item.id === action.orderId);
      const nextStatus = normalizedOrderStatus(action.status);

      if (order && order.status !== nextStatus) {
        order.status = nextStatus;
        order.updatedAt = todayISO();
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
      const order = state.orders.find((item) => item.id === action.orderId);
      if (order && order.status !== "delivered") {
        order.status = "delayed";
        order.updatedAt = todayISO();
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

    case "LOG_REP_TRANSACTION": {
      const customer = state.retailers.find((item) => item.id === action.customerId);
      const quantity = Math.max(0, Number(action.quantity || 0));
      const transactionType = action.transactionType === "return" ? "return" : "sale";
      const paymentType = action.paymentType || (transactionType === "return" ? "credit adjustment" : "cash");
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
      const amount = quantity * Number(product?.unitPrice || 0);
      const isCreditImpact = String(paymentType).toLowerCase().includes("credit");
      const creditImpact = isCreditImpact ? amount * (transactionType === "return" ? -1 : 1) : 0;
      const customerName = customer?.name || action.customerName || "Walk-in customer";
      const customerType = customer?.channel || customer?.type || action.customerType || "Customer";
      const isWalkInSale = transactionType === "sale" && !customer && normalized(customerName) === "walk-in customer";
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

      if (!product || !quantity || !eligibleAssignments.length || quantity > availableQuantity) return state;
      if (isWalkInSale && normalized(paymentType) !== "cash") return state;
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
            paymentType,
            repName
          })
        : "";

      state.stockTransactions = [
        {
          id: transactionId,
          type: transactionType,
          productId,
          productName: product.name,
          quantity,
          amount,
          unitPrice: Number(product.unitPrice || 0),
          unitCost: Number(product.unitCost || 0),
          paymentType,
          partyType: customerType,
          partyName: customerName,
          customerId: customer?.id || action.customerId || "",
          date: todayISO(),
          createdAt: new Date().toISOString(),
          recordedBy: repName,
          creditImpact,
          repUserId: state.user?.id || "",
          returnDisposition: transactionType === "return" ? returnDisposition : "",
          returnDestination: transactionType === "return"
            ? (returnDisposition === "to_store" ? "Store stock" : "Held by sales representative")
            : "",
          movementDirection: transactionType === "return" && returnDisposition === "to_store" ? "in" : "",
          orderId,
          assignmentId: assignmentAllocations[0]?.assignmentId || "",
          assignmentIds: assignmentAllocations.map((allocation) => allocation.assignmentId),
          assignmentAllocations
        },
        ...(state.stockTransactions || [])
      ];

      // Representative credit is recalculated daily from today's transactions.
      updateCreditBalance(state, customerName, creditImpact);

      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: transactionType === "sale" ? "sold" : "returned",
        recordType: "sale",
        recordLabel: product.name,
        summary: transactionType === "sale"
          ? `${repName} sold ${quantity} ${product.name} to ${customerName} for ${amount} (${paymentType})`
          : `${repName} recorded ${quantity} ${product.name} returned by ${customerName} - ${returnDisposition === "to_store" ? "to store stock" : "held for resale"}`
      });

      if (orderId) {
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: "created",
          recordType: "order",
          recordLabel: orderId,
          summary: `${orderId} created from ${repName}'s sale to ${customerName}`
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

    case "SUBMIT_REP_REPORT": {
      const report = {
        id: action.reportId || createId("RPT"),
        clientId: state.client?.id || "",
        repName: action.repName || currentActorName(state),
        reportDate: action.reportDate || todayISO(),
        tripLabel: action.tripLabel || "Today",
        salesAmount: Number(action.salesAmount || 0),
        cashAmount: Number(action.cashAmount || 0),
        creditAmount: Number(action.creditAmount || 0),
        returnAmount: Number(action.returnAmount || 0),
        unitsSold: Number(action.unitsSold || 0),
        unitsReturned: Number(action.unitsReturned || 0),
        transactionIds: Array.isArray(action.transactionIds) ? action.transactionIds : [],
        reportLines: Array.isArray(action.reportLines) ? action.reportLines.map((line) => ({
          transactionId: String(line.transactionId || ""),
          type: String(line.type || "Sale"),
          productId: String(line.productId || ""),
          productName: String(line.productName || "Unknown snack"),
          customerName: String(line.customerName || "Customer"),
          quantity: Number(line.quantity || 0),
          amount: Number(line.amount || 0),
          paymentType: String(line.paymentType || "cash"),
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
      const productId = String(action.productId || "").trim();
      const existingProduct = state.products.find((item) => item.id === productId);
      const previousProduct = existingProduct ? { ...existingProduct } : null;
      const requestedStockCategory = action.stockCategory || existingProduct?.stockCategory || "finished_products";
      const nextProductId = String(action.sku || productId || "").trim() || createId(requestedStockCategory === "equipment" ? "EQP" : "SKU");
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
      const product = {
        id: nextProductId,
        name: String(action.name || existingProduct?.name || "New product").trim(),
        category: categoryNameForStockCategory(stockCategory),
        stockCategory,
        unit: String(action.unit || existingProduct?.unit || "unit").trim(),
        warehouse: String(action.warehouse || existingProduct?.warehouse || "Finished Goods Store").trim(),
        region: "Factory",
        stock: Math.max(0, Number(action.stock ?? existingProduct?.stock ?? 0)),
        reorderPoint: Math.max(0, Number(action.reorderPoint ?? existingProduct?.reorderPoint ?? 0)),
        dailyVelocity: Math.max(0, Number(action.dailyVelocity ?? existingProduct?.dailyVelocity ?? 0)),
        unitCost: Math.max(0, Number(action.unitCost ?? existingProduct?.unitCost ?? 0)),
        unitPrice: Math.max(0, Number(action.unitPrice ?? existingProduct?.unitPrice ?? 0)),
        imageUrl: String(action.imageUrl ?? existingProduct?.imageUrl ?? "").trim(),
        status,
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

    case "RECORD_STOCK_DISPATCH": {
      const product = state.products.find((item) => item.id === action.productId);
      const quantity = Math.max(0, Number(action.quantity || 0));
      const recipientType = String(action.recipientType || "Recipient").trim();
      const recipientName = String(action.recipientName || "Recipient").trim();
      const normalizedRecipientType = recipientType.toLowerCase();
      const isInternalDispatch = normalizedRecipientType.includes("internal");
      const isRepresentativeDispatch = normalizedRecipientType.includes("representative");
      const destination = String(action.destination || recipientType).trim();
      const routeId = String(action.routeId || "").trim();
      const staffName = String(action.staffName || currentActorName(state)).trim();
      const dispatchDate = action.dispatchDate || todayISO();
      const transactionId = createId("TXN");
      const representativeAccount = isRepresentativeDispatch
        ? (state.accounts || []).find((account) => (
            normalized(account.name) === normalized(recipientName) &&
            ["sales_rep", "sales representative"].includes(normalized(account.role).replaceAll("-", "_"))
          ))
        : null;
      let orderId = "";

      if (
        !product ||
        product.status === "inactive" ||
        !quantity ||
        Number(product.stock || 0) < quantity ||
        (isRepresentativeDispatch && stockCategoryIdForProduct(product) !== "finished_products")
      ) {
        return state;
      }

      if (isRepresentativeDispatch && !isSalesRepresentativeName(state, recipientName)) {
        return state;
      }

      product.stock = Math.max(0, Number(product.stock || 0) - quantity);
      product.updatedAt = dispatchDate;

      if (isRepresentativeDispatch) {
        state.stockAssignments = [
          {
            id: createId("ASN"),
            routeId: routeId || destination || "Factory dispatch",
            repName: recipientName,
            repUserId: representativeAccount?.userId || "",
            repMembershipId: representativeAccount?.id || "",
            productId: product.id,
            assignedAt: dispatchDate,
            assigned: quantity,
            sold: 0,
            returned: 0,
            status: "open",
            varianceFlagged: false,
            varianceNote: ""
          },
          ...state.stockAssignments
        ];
      }

      if (!isInternalDispatch) {
        orderId = createDispatchSalesOrder(state, {
          transactionId,
          product,
          quantity,
          recipientName,
          recipientType,
          destination,
          dispatchDate,
          staffName,
          repUserId: representativeAccount?.userId || ""
        });
      }

      state.stockTransactions = [
        {
          id: transactionId,
          type: isInternalDispatch ? "internal movement" : "supply",
          productId: product.id,
          productName: product.name,
          quantity,
          amount: quantity * Number(product.unitPrice || 0),
          unitPrice: Number(product.unitPrice || 0),
          unitCost: Number(product.unitCost || 0),
          paymentType: "none",
          partyType: recipientType,
          partyName: recipientName,
          recipientName,
          dispatchDestination: destination,
          staffResponsible: staffName,
          date: dispatchDate,
          recordedBy: staffName,
          movementDirection: "out",
          creditImpact: 0,
          orderId
        },
        ...(state.stockTransactions || [])
      ];

      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: "dispatched",
        recordType: "stock_movement",
        recordLabel: product.id,
        summary: `Dispatched ${quantity} ${product.name} to ${recipientName}`
      });

      if (orderId) {
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: "created",
          recordType: "order",
          recordLabel: orderId,
          summary: `${orderId} created from factory dispatch to ${recipientName}`
        });
      }

      return state;
    }

    case "FLAG_ASSIGNMENT_VARIANCE": {
      const assignment = state.stockAssignments.find((item) => item.id === action.assignmentId);
      if (assignment && Math.abs(stockAssignmentVariance(assignment)) > 0.0001) {
        assignment.status = "variance";
        assignment.varianceFlagged = true;
        assignment.varianceNote = String(action.note || "Manager requested explanation").trim();
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
          reason: String(action.reason || "Manager adjustment").trim(),
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
      const report = state.salesReports.find((item) => item.id === action.reportId);
      if (report) {
        report.status = "reviewed";
        report.reviewedAt = new Date().toISOString();
        report.reviewNote = String(action.note || "Reviewed by manager").trim();
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
      const report = state.salesReports.find((item) => item.id === action.reportId);
      if (report) {
        report.status = "flagged";
        report.reviewNote = String(action.note || "Needs correction").trim();
        report.flaggedAt = new Date().toISOString();
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: "flagged",
          recordType: "report",
          recordLabel: report.id,
          summary: `${report.repName} report flagged for correction`
        });
      }
      return state;
    }

    case "RESTOCK_PRODUCT": {
      const product = state.products.find((item) => item.id === action.productId);
      const quantity = Math.max(0, Number(action.quantity || 0));
      if (product && quantity > 0) {
        product.stock = Number(product.stock || 0) + quantity;
        product.updatedAt = todayISO();
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

    case "REDUCE_PRODUCT_STOCK": {
      const product = state.products.find((item) => item.id === action.productId);
      const quantity = Math.max(0, Number(action.quantity || 0));
      const reason = String(action.reason || "").trim();
      const reasonDetails = String(action.reasonDetails || "").trim();
      const reasonSummary = reasonDetails ? `${reason} - ${reasonDetails}` : reason;

      if (product && quantity > 0 && quantity <= Number(product.stock || 0) && reason) {
        product.stock = Math.max(0, Number(product.stock || 0) - quantity);
        product.updatedAt = todayISO();
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
      const previousName = existingRetailer?.name;
      const nextName = String(action.name || existingRetailer?.name || "New customer").trim();
      const stateName = String(action.stateName ?? action.region ?? existingRetailer?.stateName ?? existingRetailer?.region ?? "").trim();
      const retailer = {
        id: retailerId || createId("RTL"),
        name: nextName,
        city: String(action.city ?? existingRetailer?.city ?? "").trim(),
        region: stateName,
        stateName,
        address: String(action.address ?? existingRetailer?.address ?? "").trim(),
        channel: String(action.channel ?? existingRetailer?.channel ?? "Supermarket").trim(),
        contact: String(action.contact ?? existingRetailer?.contact ?? "").trim(),
        contactPhone: String(action.contactPhone ?? existingRetailer?.contactPhone ?? "").trim(),
        assignedRepUserId: String(action.assignedRepUserId ?? existingRetailer?.assignedRepUserId ?? "").trim(),
        assignedRepName: String(action.assignedRepName ?? existingRetailer?.assignedRepName ?? "").trim(),
        fillRate: Math.max(0, Math.min(100, Number(action.fillRate ?? existingRetailer?.fillRate ?? 0))),
        outstanding: Math.max(0, Number(action.outstanding ?? existingRetailer?.outstanding ?? 0)),
        lastOrder: existingRetailer?.lastOrder || todayISO(),
        lastContact: existingRetailer?.lastContact || todayISO(),
        status: String(action.status || existingRetailer?.status || "active"),
        updatedAt: todayISO()
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
      const changedBy = currentActorLabel(state);
      const changedAt = new Date().toISOString();
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
        summary: `${existingRetailer ? "Updated" : "Added"} customer profile`
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

    case "MARK_INVOICE_PAID": {
      const invoice = state.invoices.find((item) => item.id === action.invoiceId);
      if (invoice) {
        invoice.status = "paid";
        invoice.paidAt = todayISO();
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
  let state = ensureStateShape(loadStoredState() || seedData);
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
      state = reducer(state, action);
      notify(action);
    },

    reset() {
      state = ensureStateShape(seedData);
      clearStoredState();
      notify({
        type: "RESET_DATA",
        message: "Workspace data cleared"
      });
    }
  };
}
