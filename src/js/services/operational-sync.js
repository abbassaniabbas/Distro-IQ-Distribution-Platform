import { loadOperationalWorkspace, syncOperationalWorkspace } from "./backend.js";
import { currentUserRole } from "./rbac.js";

export const OPERATIONAL_COLLECTIONS = [
  "products",
  "stockCategories",
  "stockAssignments",
  "stockTransactions",
  "productionBatches",
  "retailers",
  "orders",
  "invoices",
  "salesReports",
  "correctionRequests",
  "stockRequests",
  "purchaseOrders",
  "procurementOrders",
  "routes",
  "creditLimits",
  "creditLimitHistory",
  "activityLogs"
];

const IGNORED_ACTIONS = new Set([
  "SET_BACKEND_STATUS",
  "SET_AUTH_CONTEXT",
  "SET_AUTHENTICATED_WORKSPACE",
  "SET_PLATFORM_CONTEXT",
  "CLEAR_AUTH_CONTEXT",
  "SET_OPERATIONAL_RECORDS",
  "HYDRATE_PRODUCT_IMAGES",
  "MARK_MESSAGES_READ",
  "MARK_CONVERSATION_READ",
  "MARK_NOTIFICATIONS_READ",
  "DISMISS_NOTIFICATIONS",
  "DISMISS_ALL_NOTIFICATIONS"
]);

const ROLE_COLLECTIONS = {
  ceo: new Set(OPERATIONAL_COLLECTIONS),
  admin: new Set([
    "products", "stockAssignments", "stockTransactions", "retailers", "orders",
    "invoices", "salesReports", "correctionRequests", "stockRequests",
    "purchaseOrders", "procurementOrders", "routes", "creditLimits",
    "creditLimitHistory", "activityLogs"
  ]),
  store_keeper: new Set([
    "products", "stockCategories", "stockAssignments", "stockTransactions",
    "productionBatches", "orders", "invoices", "correctionRequests",
    "stockRequests", "purchaseOrders", "procurementOrders", "routes", "activityLogs"
  ]),
  sales_rep: new Set([
    "stockAssignments", "stockTransactions", "retailers", "orders", "invoices",
    "salesReports", "correctionRequests", "stockRequests", "routes",
    "creditLimits", "activityLogs"
  ])
};

const RETRY_DELAY_MS = 5000;

function queueStorageKey(clientId, userId) {
  return `distro-iq-operational-sync:${String(clientId || "")}:${String(userId || "")}`;
}

function operationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function safeRecordData(collection, record) {
  const data = { ...(record || {}) };
  if (collection === "products" && String(data.imageUrl || "").startsWith("data:image/")) {
    data.imageUrl = "";
  }
  delete data.temporaryPassword;
  return data;
}

function recordId(record, index) {
  return String(record?.id || record?.sku || `record-${index}`);
}

export function operationalSnapshot(state, allowedCollections = OPERATIONAL_COLLECTIONS) {
  const snapshot = new Map();
  allowedCollections.forEach((collection) => {
    const records = Array.isArray(state?.[collection]) ? state[collection] : [];
    const byId = new Map();
    records.forEach((record, index) => {
      const id = recordId(record, index);
      const data = safeRecordData(collection, record);
      byId.set(id, { id, data, signature: JSON.stringify(data) });
    });
    snapshot.set(collection, byId);
  });
  return snapshot;
}

export function operationalChanges(previousSnapshot, nextSnapshot) {
  const records = [];
  const deleted = [];
  const touchedCollections = [];

  nextSnapshot.forEach((nextRecords, collection) => {
    const previousRecords = previousSnapshot.get(collection) || new Map();
    let touched = false;

    nextRecords.forEach((nextRecord, id) => {
      if (previousRecords.get(id)?.signature === nextRecord.signature) return;
      records.push({ collection, id, data: nextRecord.data });
      touched = true;
    });

    previousRecords.forEach((_previousRecord, id) => {
      if (nextRecords.has(id)) return;
      deleted.push({ collection, id });
      touched = true;
    });

    if (touched) touchedCollections.push(collection);
  });

  return { records, deleted, touchedCollections };
}

function collectionsFromRemote(workspace) {
  const initialized = new Set(workspace.initializedCollections || []);
  const collections = {};
  initialized.forEach((collection) => {
    if (OPERATIONAL_COLLECTIONS.includes(collection)) collections[collection] = [];
  });
  (workspace.records || []).forEach((record) => {
    if (!OPERATIONAL_COLLECTIONS.includes(record.collection)) return;
    if (!collections[record.collection]) collections[record.collection] = [];
    collections[record.collection].push(record.data);
  });
  return collections;
}

function readQueue(clientId, userId) {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(queueStorageKey(clientId, userId)) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function writeQueue(clientId, userId, queue) {
  try {
    globalThis.localStorage?.setItem(queueStorageKey(clientId, userId), JSON.stringify(queue));
  } catch {
    // The main local workspace still retains the unsynchronized records.
  }
}

export function createOperationalSync({ store }) {
  let clientId = "";
  let userId = "";
  let connected = false;
  let connecting = false;
  let baseline = new Map();
  let queue = [];
  let draining = false;
  let retryTimer = null;
  let refreshTimer = null;

  function allowedCollections(state) {
    return [...(ROLE_COLLECTIONS[currentUserRole(state)] || new Set())];
  }

  function persistQueue() {
    if (clientId && userId) writeQueue(clientId, userId, queue);
  }

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = globalThis.setTimeout(() => {
      retryTimer = null;
      void drain();
    }, RETRY_DELAY_MS);
  }

  async function drain() {
    if (draining || !connected || !clientId || !queue.length) return;
    draining = true;
    try {
      while (queue.length && connected) {
        await syncOperationalWorkspace({ clientId, ...queue[0] });
        queue.shift();
        persistQueue();
      }
    } catch (error) {
      console.warn(error.message);
      scheduleRetry();
    } finally {
      draining = false;
    }
  }

  function enqueue(actionType, changes) {
    if (!changes.touchedCollections.length) return;
    queue.push({
      operationId: operationId(),
      actionType: String(actionType || "WORKSPACE_UPDATE"),
      records: changes.records,
      deleted: changes.deleted,
      touchedCollections: changes.touchedCollections
    });
    persistQueue();
    void drain();
  }

  async function refresh() {
    if (!connected || !clientId || queue.length) return;
    try {
      const workspace = await loadOperationalWorkspace(clientId);
      if (!(workspace.initializedCollections || []).length) return;
      const remoteCollections = collectionsFromRemote(workspace);
      const currentState = store.getState();
      const initialized = Object.keys(remoteCollections);
      const currentSnapshot = operationalSnapshot(currentState, initialized);
      const remoteSnapshot = operationalSnapshot({ ...currentState, ...remoteCollections }, initialized);
      if (!operationalChanges(currentSnapshot, remoteSnapshot).touchedCollections.length) return;
      store.dispatch({
        type: "SET_OPERATIONAL_RECORDS",
        collections: remoteCollections
      });
      baseline = operationalSnapshot(store.getState(), allowedCollections(store.getState()));
    } catch (error) {
      console.warn(error.message);
    }
  }

  async function connect() {
    if (connecting) return;
    const state = store.getState();
    const nextClientId = String(state.client?.id || "");
    const nextUserId = String(state.user?.id || "");
    if (!nextClientId || !nextUserId || !state.session) return;

    connecting = true;
    clientId = nextClientId;
    userId = nextUserId;
    connected = false;
    queue = readQueue(clientId, userId);

    const allowed = allowedCollections(state);
    if (!allowed.length) {
      connecting = false;
      return;
    }

    try {
      if (queue.length) {
        connected = true;
        await drain();
        connected = false;
      }

      const workspace = await loadOperationalWorkspace(clientId);
      if ((workspace.initializedCollections || []).length) {
        store.dispatch({
          type: "SET_OPERATIONAL_RECORDS",
          collections: collectionsFromRemote(workspace)
        });
      } else if (currentUserRole(store.getState()) === "ceo") {
        const emptySnapshot = operationalSnapshot({}, allowed);
        const currentSnapshot = operationalSnapshot(store.getState(), allowed);
        const migration = operationalChanges(emptySnapshot, currentSnapshot);
        migration.touchedCollections = [...allowed];
        queue.push({
          operationId: operationId(),
          actionType: "LOCAL_DATA_MIGRATION",
          records: migration.records,
          deleted: [],
          touchedCollections: migration.touchedCollections
        });
        persistQueue();
      }

      baseline = operationalSnapshot(store.getState(), allowedCollections(store.getState()));
      connected = true;
      await drain();
      globalThis.clearInterval(refreshTimer);
      refreshTimer = globalThis.setInterval(() => void refresh(), 15000);
    } catch (error) {
      connected = true;
      console.warn(error.message);
      scheduleRetry();
    } finally {
      connecting = false;
    }
  }

  function disconnect() {
    connected = false;
    connecting = false;
    clientId = "";
    userId = "";
    baseline = new Map();
    queue = [];
    globalThis.clearTimeout(retryTimer);
    globalThis.clearInterval(refreshTimer);
    retryTimer = null;
    refreshTimer = null;
  }

  function handleStateChange(state, action = {}) {
    if (!state.session || !state.client?.id) {
      disconnect();
      return;
    }
    if (!clientId || String(state.client.id) !== clientId || String(state.user?.id || "") !== userId) {
      void connect();
      return;
    }
    if (!connected || IGNORED_ACTIONS.has(action.type)) return;

    const allowed = allowedCollections(state);
    const nextSnapshot = operationalSnapshot(state, allowed);
    const changes = operationalChanges(baseline, nextSnapshot);
    baseline = nextSnapshot;
    enqueue(action.type, changes);
  }

  globalThis.addEventListener?.("online", () => void drain());
  globalThis.addEventListener?.("focus", () => {
    void drain();
    void refresh();
  });

  return { connect, disconnect, handleStateChange, refresh };
}
