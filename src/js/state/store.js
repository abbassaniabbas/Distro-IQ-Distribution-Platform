import seedData from "../data/seed-data.js";
import { createActivityLog, getCurrentActor } from "../services/activity.js";
import { assignmentOutstanding, getCreditGuardForOrder } from "../services/calculations.js";
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

function todayISO() {
  return new Date().toISOString().slice(0, 10);
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

function quickSaleOrderId(transaction) {
  return transaction.orderId || `ORD-${String(transaction.id || "SALE").replace(/[^a-z0-9]+/gi, "-")}`.toUpperCase();
}

function orderFromSaleTransaction(transaction, state) {
  const customer = (state.retailers || []).find((item) => item.id === transaction.customerId);
  const paymentType = transaction.paymentType || "cash";
  const paymentLabel = String(paymentType).toLowerCase();
  const date = String(transaction.date || transaction.createdAt || todayISO()).slice(0, 10);

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
        quantity: Number(transaction.quantity || 0)
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

function ensureStateShape(value) {
  const state = clone(value || seedData);

  return ensureQuickSaleOrders({
    ...clone(seedData),
    ...state,
    client: state.client || null,
    accounts: Array.isArray(state.accounts) ? state.accounts : [],
    invites: Array.isArray(state.invites) ? state.invites : [],
    activityLogs: Array.isArray(state.activityLogs) ? state.activityLogs : [],
    salesReports: mergeSeedRecords(state.salesReports, seedData.salesReports),
    creditLimitHistory: mergeSeedRecords(state.creditLimitHistory, seedData.creditLimitHistory),
    retailers: mergeSeedRecords(state.retailers, seedData.retailers),
    orders: mergeSeedRecords(state.orders, seedData.orders),
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
    processing: "packed",
    packed: "in_transit",
    in_transit: "delivered",
    delayed: "processing",
    delivered: "delivered"
  };

  return flow[status] || "processing";
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

function changedFieldLabels(previousProduct, nextProduct) {
  if (!previousProduct) return [];

  const trackedFields = [
    ["stock", "stock"],
    ["reorderPoint", "reorder point"],
    ["unitCost", "cost price"],
    ["unitPrice", "selling price"],
    ["status", "status"],
    ["category", "category"],
    ["unit", "unit"]
  ];

  return trackedFields
    .filter(([key]) => String(previousProduct[key] ?? "") !== String(nextProduct[key] ?? ""))
    .map(([, label]) => label);
}

function productActivitySummary(previousProduct, nextProduct) {
  if (!previousProduct) {
    return `Added stock ${nextProduct.name} with ${nextProduct.stock} ${nextProduct.unit}`;
  }

  const changedLabels = changedFieldLabels(previousProduct, nextProduct);
  const changeText = changedLabels.length ? `: ${changedLabels.join(", ")}` : "";

  return `Updated stock ${nextProduct.name}${changeText}`;
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
      paymentStatus: paymentLabel.includes("credit") ? "open" : "paid",
      dueAt: today,
      createdAt: today,
      updatedAt: today,
      repName,
      repUserId: state.user?.id || "",
      items: [
        {
          productId: product.id,
          quantity
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
        activityLogs: Array.isArray(action.activityLogs) ? action.activityLogs : state.activityLogs
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
        activityLogs: Array.isArray(action.activityLogs) ? action.activityLogs : state.activityLogs,
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
        activityLogs: [],
        platformAdmin: Boolean(action.session),
        platformOverview: Array.isArray(action.platformOverview) ? action.platformOverview : [],
        backend: {
          ...state.backend,
          configured: true,
          status: action.session ? "platform_authenticated" : "anonymous",
          error: ""
        }
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

    case "ADVANCE_ORDER": {
      const order = state.orders.find((item) => item.id === action.orderId);
      if (order) {
        const creditGuard = getCreditGuardForOrder(order, state);

        if (creditGuard.status === "credit_hold" && order.status !== "delivered") {
          appendActivityLog(state, {
            clientId: state.client?.id,
            actionType: "blocked",
            recordType: "order",
            recordLabel: order.id,
            summary: `${order.id} held because projected credit exceeds the limit`
          });
          return state;
        }

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
      const assignment = state.stockAssignments.find((item) => item.id === action.assignmentId);
      const product = state.products.find((item) => item.id === assignment?.productId);
      const customer = state.retailers.find((item) => item.id === action.customerId);
      const quantity = Math.max(0, Number(action.quantity || 0));
      const transactionType = action.transactionType === "return" ? "return" : "sale";
      const amount = quantity * Number(product?.unitPrice || 0);
      const paymentType = action.paymentType || (transactionType === "return" ? "credit adjustment" : "cash");
      const returnDisposition = transactionType === "return"
        ? (action.returnDisposition === "to_store" ? "to_store" : "held_by_rep")
        : "";
      const isCreditImpact = String(paymentType).toLowerCase().includes("credit");
      const creditImpact = isCreditImpact ? amount * (transactionType === "return" ? -1 : 1) : 0;
      const repName = action.repName || assignment?.repName || currentActorName(state);
      const customerName = customer?.name || action.customerName || "Walk-in customer";
      const customerType = customer?.channel || customer?.type || action.customerType || "Customer";

      if (!assignment || !product || !quantity) return state;
      if (transactionType === "sale" && quantity > assignmentOutstanding(assignment)) return state;
      if (transactionType === "return" && quantity > Number(assignment.sold || 0)) return state;

      if (transactionType === "sale") {
        assignment.sold = Number(assignment.sold || 0) + quantity;
      } else {
        assignment.sold = Math.max(0, Number(assignment.sold || 0) - quantity);

        if (returnDisposition === "to_store") {
          assignment.returned = Number(assignment.returned || 0) + quantity;
          product.stock = Number(product.stock || 0) + quantity;
          product.updatedAt = todayISO();
        } else {
          assignment.heldReturns = Number(assignment.heldReturns || 0) + quantity;
        }
      }

      assignment.updatedAt = todayISO();
      refreshAssignmentCompletion(state, assignment);
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
          productId: assignment.productId,
          quantity,
          amount,
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
          orderId
        },
        ...(state.stockTransactions || [])
      ];

      updateCreditBalance(state, repName, creditImpact);
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
      const stockCategory = action.stockCategory || existingProduct?.stockCategory || "finished_products";
      const status = ["active", "inactive"].includes(String(action.status || "")) ? action.status : existingProduct?.status || "active";
      const product = {
        id: productId || createId(stockCategory === "equipment" ? "EQP" : "SKU"),
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
      } else {
        state.products = [product, ...state.products];
      }

      appendActivityLog(state, {
        clientId: state.client?.id,
        actionType: existingProduct ? "updated" : "created",
        recordType: "inventory",
        recordLabel: product.id,
        summary: productActivitySummary(previousProduct, product)
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
      const destination = String(action.destination || recipientType).trim();
      const routeId = String(action.routeId || "").trim();
      const staffName = String(action.staffName || currentActorName(state)).trim();
      const dispatchDate = action.dispatchDate || todayISO();

      if (!product || !quantity || Number(product.stock || 0) < quantity) {
        return state;
      }

      if (recipientType.toLowerCase().includes("representative") && !isSalesRepresentativeName(state, recipientName)) {
        return state;
      }

      product.stock = Math.max(0, Number(product.stock || 0) - quantity);
      product.updatedAt = dispatchDate;

      if (recipientType.toLowerCase().includes("representative")) {
        state.stockAssignments = [
          {
            id: createId("ASN"),
            routeId: routeId || destination || "Factory dispatch",
            repName: recipientName,
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

      state.stockTransactions = [
        {
          id: createId("TXN"),
          type: recipientType.toLowerCase().includes("internal") ? "internal movement" : "supply",
          productId: product.id,
          quantity,
          amount: quantity * Number(product.unitPrice || 0),
          paymentType: "none",
          partyType: recipientType,
          partyName: recipientName,
          recipientName,
          dispatchDestination: destination,
          staffResponsible: staffName,
          date: dispatchDate,
          recordedBy: staffName,
          movementDirection: "out",
          creditImpact: 0
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

      return state;
    }

    case "FLAG_ASSIGNMENT_VARIANCE": {
      const assignment = state.stockAssignments.find((item) => item.id === action.assignmentId);
      if (assignment) {
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
        const outstanding = assignmentOutstanding(assignment);
        if (outstanding > 0 && !assignment.varianceFlagged) return state;

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
            quantity,
            amount: 0,
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
            quantity,
            amount: 0,
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
