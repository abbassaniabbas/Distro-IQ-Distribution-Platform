import seedData from "../data/seed-data.js";
import { createActivityLog, getCurrentActor } from "../services/activity.js";
import { clearStoredState, loadStoredState, saveStoredState } from "../services/storage.js";
import { createAccountInvite, createClientProfile } from "../services/tenant.js";

function clone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function mergeSeedRecords(existing, defaults) {
  const existingRecords = Array.isArray(existing) ? clone(existing) : [];
  const existingIds = new Set(existingRecords.map((item) => item.id));
  const missingDefaults = clone(defaults || []).filter((item) => !existingIds.has(item.id));

  return [...existingRecords, ...missingDefaults];
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function ensureStateShape(value) {
  const state = clone(value || seedData);

  return {
    ...clone(seedData),
    ...state,
    client: state.client || null,
    accounts: Array.isArray(state.accounts) ? state.accounts : [],
    invites: Array.isArray(state.invites) ? state.invites : [],
    activityLogs: Array.isArray(state.activityLogs) ? state.activityLogs : [],
    products: mergeSeedRecords(state.products, seedData.products),
    stockCategories: mergeSeedRecords(state.stockCategories, seedData.stockCategories),
    stockAssignments: mergeSeedRecords(state.stockAssignments, seedData.stockAssignments),
    stockTransactions: mergeSeedRecords(state.stockTransactions, seedData.stockTransactions),
    creditLimits: mergeSeedRecords(state.creditLimits, seedData.creditLimits),
    backend: {
      ...clone(seedData.backend),
      ...(state.backend || {})
    },
    session: null,
    user: null
  };
}

function getPersistableState(state) {
  return {
    ...state,
    backend: clone(seedData.backend),
    session: null,
    user: null
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
        }
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

    case "CLEAR_AUTH_CONTEXT": {
      return {
        ...state,
        session: null,
        user: null,
        client: null,
        accounts: [],
        invites: [],
        activityLogs: [],
        backend: {
          ...state.backend,
          status: "anonymous",
          error: ""
        }
      };
    }

    case "CREATE_CLIENT": {
      const client = createClientProfile(action.payload);
      state.client = client;
      appendActivityLog(state, {
        clientId: client.id,
        actionType: "created",
        recordType: "company",
        recordLabel: client.companyName,
        summary: "Created factory workspace"
      });

      return {
        ...state,
        client
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

    case "RESTOCK_PRODUCT": {
      const product = state.products.find((item) => item.id === action.productId);
      if (product) {
        const targetStock = Math.max(product.reorderPoint * 2, product.stock + product.reorderPoint);
        product.stock = targetStock;
        product.updatedAt = todayISO();
        appendActivityLog(state, {
          clientId: state.client?.id,
          actionType: "restocked",
          recordType: "inventory",
          recordLabel: product.id,
          summary: `${product.name} stock replenished`
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
          summary: `${route.name} rep run moved to ${textLabel(route.status)}`
        });
      }
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
        message: "Demo data reset"
      });
    }
  };
}
