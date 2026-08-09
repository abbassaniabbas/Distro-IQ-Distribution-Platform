import { loadOperationalWorkspace, syncOperationalWorkspace } from "./backend.js";
import { currentUserRole } from "./rbac.js?v=20260805g";

export const OPERATIONAL_COLLECTIONS = [
  "products",
  "stockCategories",
  "stockAssignments",
  "stockTransactions",
  "productionBatches",
  "productionPlans",
  "productionIssues",
  "retailers",
  "orders",
  "invoices",
  "salesReports",
  "correctionRequests",
  "stockRequests",
  "stockAdditionRequests",
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
  "RESET_WORKSPACE_DATA_SCOPE",
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
    "stockAdditionRequests", "purchaseOrders", "procurementOrders", "routes", "creditLimits",
    "creditLimitHistory", "activityLogs"
  ]),
  store_keeper: new Set([
    "products", "stockCategories", "stockAssignments", "stockTransactions",
    "productionBatches", "retailers", "orders", "invoices", "correctionRequests",
    "stockRequests", "stockAdditionRequests", "purchaseOrders", "procurementOrders", "routes", "activityLogs"
  ]),
  sales_rep: new Set([
    "stockAssignments", "stockTransactions", "retailers", "orders", "invoices",
    "salesReports", "correctionRequests", "stockRequests", "routes",
    "creditLimits", "activityLogs"
  ]),
  production_manager: new Set([
    "products", "stockTransactions", "productionBatches", "productionPlans", "retailers",
    "productionIssues", "activityLogs"
  ]),
  production_supervisor: new Set([
    "products", "productionBatches", "productionPlans", "productionIssues", "activityLogs"
  ])
};

export function operationalCollectionsForRole(role) {
  return [...(ROLE_COLLECTIONS[String(role || "")] || new Set())];
}

const RETRY_DELAY_MS = 5000;
const SUPERVISOR_SYNC_ACTIONS = new Set([
  "START_ASSIGNED_PRODUCTION_PLAN",
  "SUBMIT_SUPERVISOR_BATCH_REPORT",
  "REPORT_PRODUCTION_ISSUE"
]);
const SUPERVISOR_WRITE_COLLECTIONS = new Set([
  "productionPlans",
  "productionBatches",
  "productionIssues",
  "activityLogs"
]);
const MANAGER_SYNC_ACTIONS = new Set([
  "CREATE_PRODUCTION_PLAN",
  "RECORD_MANAGED_PRODUCTION_BATCH",
  "RECORD_PRODUCTION_QC",
  "APPROVE_PRODUCTION_BATCH",
  "TRANSFER_PRODUCTION_BATCH",
  "REPORT_PRODUCTION_ISSUE",
  "RESOLVE_PRODUCTION_ISSUE",
  "CREATE_ASSIGNED_PRODUCTION_PLAN",
  "APPROVE_SUPERVISOR_BATCH_REPORT",
  "FLAG_SUPERVISOR_BATCH_REPORT",
  "REJECT_SUPERVISOR_BATCH_REPORT",
  "CLOSE_PRODUCTION_PLAN"
]);
const MANAGER_WRITE_COLLECTIONS = new Set([
  "products",
  "stockTransactions",
  "productionBatches",
  "productionPlans",
  "productionIssues",
  "activityLogs"
]);

function queueStorageKey(clientId, userId) {
  // v2 deliberately leaves behind legacy supervisor queues created before
  // production actions waited for backend confirmation. Their stale Start and
  // Submit operations can otherwise replay ahead of the user's current report.
  return `distro-iq-operational-sync:v2:${String(clientId || "")}:${String(userId || "")}`;
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

export function collectionsFromRemote(workspace, allowedCollections = OPERATIONAL_COLLECTIONS) {
  const allowed = new Set(allowedCollections);
  const initialized = new Set(workspace.initializedCollections || []);
  const collections = {};
  initialized.forEach((collection) => {
    if (allowed.has(collection)) collections[collection] = [];
  });
  (workspace.records || []).forEach((record) => {
    if (!allowed.has(record.collection)) return;
    if (!collections[record.collection]) collections[record.collection] = [];
    collections[record.collection].push(record.data);
  });
  Object.values(collections).forEach((records) => records.sort((a, b) => (
    recordRecency(b) - recordRecency(a)
  )));
  return collections;
}

const RECENCY_FIELDS = [
  "createdAt", "submittedAt", "reportedAt", "updatedAt", "changedAt", "reviewedAt",
  "assignedAt", "startedAt", "completedAt", "date", "reportDate", "productionDate",
  "batchDate", "requestedAt", "orderedAt", "issuedAt", "neededBy"
];

export function recordRecency(record = {}) {
  let latest = 0;
  for (const field of RECENCY_FIELDS) {
    const value = record?.[field];
    if (!value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) latest = Math.max(latest, parsed);
  }
  return latest;
}

export function recoverLocalSupervisorProduction(localState, remoteCollections) {
  if (currentUserRole(localState) !== "production_supervisor") {
    return { collections: remoteCollections, actionType: "" };
  }

  const userId = String(localState.user?.id || "");
  const localPlans = (localState.productionPlans || []).filter((plan) => (
    String(plan.assignedSupervisorUserId || "") === userId &&
    ["in_progress", "submitted", "flagged"].includes(plan.status)
  ));
  const remotePlanMap = new Map((remoteCollections.productionPlans || []).map((plan) => [String(plan.id || ""), plan]));
  let recoverablePlans = localPlans.filter((plan) => {
    const remotePlan = remotePlanMap.get(String(plan.id || ""));
    return remotePlan && recordRecency(plan) > recordRecency(remotePlan) && plan.status !== remotePlan.status;
  });
  const assignedPlanIds = new Set(localPlans.map((plan) => String(plan.id || "")));
  const remoteBatchMap = new Map((remoteCollections.productionBatches || []).map((batch) => [String(batch.id || ""), batch]));
  const newestLocalBatchByPlan = new Map();
  [...(localState.productionBatches || [])]
    .sort((a, b) => recordRecency(b) - recordRecency(a))
    .forEach((batch) => {
      const planId = String(batch.planId || "");
      if (planId && !newestLocalBatchByPlan.has(planId)) newestLocalBatchByPlan.set(planId, batch);
    });
  const recoveredBatches = [...newestLocalBatchByPlan.values()].filter((batch) => {
    if (!assignedPlanIds.has(String(batch.planId || "")) || !batch.supervisorWorkflow) return false;
    const plan = localPlans.find((item) => String(item.id || "") === String(batch.planId || ""));
    const targetQuantity = Number(plan?.targetQuantity || plan?.lines?.[0]?.quantity || 0);
    const goodQuantity = Number(batch.quantityProduced || 0);
    if (!["submitted", "flagged"].includes(String(batch.status || "")) || targetQuantity <= 0 || goodQuantity > targetQuantity) return false;
    const remoteBatch = remoteBatchMap.get(String(batch.id || ""));
    return !remoteBatch || recordRecency(batch) > recordRecency(remoteBatch);
  });
  const recoverableBatchPlanIds = new Set(recoveredBatches.map((batch) => String(batch.planId || "")));
  recoverablePlans = recoverablePlans.filter((plan) => (
    !["submitted", "flagged"].includes(String(plan.status || "")) || recoverableBatchPlanIds.has(String(plan.id || ""))
  ));
  const remoteIssueMap = new Map((remoteCollections.productionIssues || []).map((issue) => [String(issue.id || ""), issue]));
  const recoveredIssues = (localState.productionIssues || []).filter((issue) => {
    if (String(issue.reportedByUserId || "") !== userId) return false;
    const remoteIssue = remoteIssueMap.get(String(issue.id || ""));
    return !remoteIssue || recordRecency(issue) > recordRecency(remoteIssue);
  });
  if (!recoverablePlans.length && !recoveredBatches.length && !recoveredIssues.length) {
    return { collections: remoteCollections, actionType: "" };
  }

  const recoveredPlanIds = new Set([
    ...recoverablePlans.map((plan) => String(plan.id || "")),
    ...recoveredBatches.map((batch) => String(batch.planId || "")),
    ...recoveredIssues.map((issue) => String(issue.planId || ""))
  ]);
  const merged = { ...remoteCollections };
  merged.productionPlans = (remoteCollections.productionPlans || []).map((plan) => (
    recoverablePlans.some((localPlan) => String(localPlan.id || "") === String(plan.id || ""))
      ? recoverablePlans.find((localPlan) => String(localPlan.id || "") === String(plan.id || ""))
      : plan
  ));

  const recoveredBatchIds = new Set(recoveredBatches.map((batch) => String(batch.id || "")));
  merged.productionBatches = [
    ...recoveredBatches,
    ...(remoteCollections.productionBatches || []).filter((batch) => !recoveredBatchIds.has(String(batch.id || "")))
  ];
  const recoveredIssueIds = new Set(recoveredIssues.map((issue) => String(issue.id || "")));
  merged.productionIssues = [
    ...recoveredIssues,
    ...(remoteCollections.productionIssues || []).filter((issue) => !recoveredIssueIds.has(String(issue.id || "")))
  ];

  const recoveredActivity = (localState.activityLogs || []).filter((entry) => (
    recoveredPlanIds.has(String(entry.planId || "")) &&
    ["production_plan", "production_batch", "production_issue"].includes(entry.recordType) &&
    ["started", "submitted", "reported"].includes(entry.actionType) &&
    String(entry.actorUserId || "") === userId
  ));
  const recoveredActivityIds = new Set(recoveredActivity.map((entry) => String(entry.id || "")));
  merged.activityLogs = [
    ...recoveredActivity,
    ...(remoteCollections.activityLogs || []).filter((entry) => !recoveredActivityIds.has(String(entry.id || "")))
  ];

  return {
    collections: merged,
    actionType: recoveredBatches.some((batch) => ["submitted", "flagged"].includes(batch.status)) || recoverablePlans.some((plan) => ["submitted", "flagged"].includes(plan.status))
      ? "SUBMIT_SUPERVISOR_BATCH_REPORT"
      : recoveredIssues.length
        ? "REPORT_PRODUCTION_ISSUE"
      : "START_ASSIGNED_PRODUCTION_PLAN"
  };
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

export function sanitizePersistedOperationalQueue(savedQueue, role, userId) {
  if (!Array.isArray(savedQueue)) return [];
  const normalizedRole = String(role || "");
  if (normalizedRole === "production_manager") {
    return savedQueue.filter((operation) => {
      const actionType = String(operation?.actionType || "").trim().toUpperCase();
      const records = Array.isArray(operation?.records) ? operation.records : [];
      const deleted = Array.isArray(operation?.deleted) ? operation.deleted : [];
      const touchedCollections = Array.isArray(operation?.touchedCollections) ? operation.touchedCollections : [];
      return (
        MANAGER_SYNC_ACTIONS.has(actionType) &&
        !deleted.length &&
        touchedCollections.length > 0 &&
        touchedCollections.every((collection) => MANAGER_WRITE_COLLECTIONS.has(String(collection))) &&
        records.every((record) => MANAGER_WRITE_COLLECTIONS.has(String(record?.collection || "")))
      );
    });
  }
  if (normalizedRole !== "production_supervisor") return savedQueue;

  const actorUserId = String(userId || "");
  return savedQueue.filter((operation) => {
    const actionType = String(operation?.actionType || "").trim().toUpperCase();
    const records = Array.isArray(operation?.records) ? operation.records : [];
    const deleted = Array.isArray(operation?.deleted) ? operation.deleted : [];
    const touchedCollections = Array.isArray(operation?.touchedCollections) ? operation.touchedCollections : [];
    if (!SUPERVISOR_SYNC_ACTIONS.has(actionType) || deleted.length) return false;
    if (!touchedCollections.length || touchedCollections.some((collection) => !SUPERVISOR_WRITE_COLLECTIONS.has(String(collection)))) return false;

    return records.every((record) => {
      const collection = String(record?.collection || "");
      const data = record?.data || {};
      if (!SUPERVISOR_WRITE_COLLECTIONS.has(collection)) return false;
      if (collection === "productionPlans") return String(data.assignedSupervisorUserId || "") === actorUserId;
      if (collection === "productionBatches") return String(data.recordedByUserId || "") === actorUserId;
      if (collection === "productionIssues") return String(data.reportedByUserId || "") === actorUserId;
      return String(data.actorUserId || "") === actorUserId;
    });
  });
}

export function createOperationalSync({ store }) {
  let clientId = "";
  let userId = "";
  let connected = false;
  let connecting = false;
  let baseline = new Map();
  let queue = [];
  let draining = false;
  let lastSyncError = null;
  let retryTimer = null;
  let refreshTimer = null;

  function allowedCollections(state) {
    return operationalCollectionsForRole(currentUserRole(state));
  }

  function persistQueue() {
    if (clientId && userId) writeQueue(clientId, userId, queue);
  }

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = globalThis.setTimeout(() => {
      retryTimer = null;
      if (connected) void drain();
      else void connect();
    }, RETRY_DELAY_MS);
  }

  async function drain() {
    if (draining || !connected || !clientId) return;
    const sanitizedQueue = sanitizePersistedOperationalQueue(queue, currentUserRole(store.getState()), userId);
    if (sanitizedQueue.length !== queue.length) {
      queue = sanitizedQueue;
      persistQueue();
    }
    if (!queue.length) return;
    draining = true;
    try {
      while (queue.length && connected) {
        await syncOperationalWorkspace({ clientId, ...queue[0] });
        queue.shift();
        persistQueue();
        lastSyncError = null;
      }
    } catch (error) {
      lastSyncError = error;
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

  function waitFor(predicate, timeoutMs = 15000) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        if (predicate()) {
          resolve();
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error("Backend save timed out. Check the connection and try again."));
          return;
        }
        globalThis.setTimeout(check, 40);
      };
      check();
    });
  }

  async function flush(actionType = "WORKSPACE_UPDATE") {
    if (connecting) await waitFor(() => !connecting);
    if (!connected) await connect();
    if (connecting) await waitFor(() => !connecting);
    if (!connected) {
      throw lastSyncError || new Error("Could not connect to the backend. Check the connection and try again.");
    }

    // A state change can happen before the initial connection has finished. In
    // that case handleStateChange cannot enqueue it, so detect and queue the
    // change here before reporting that the backend save is complete.
    if (connected && clientId) {
      const state = store.getState();
      const allowed = allowedCollections(state);
      const nextSnapshot = operationalSnapshot(state, allowed);
      const changes = operationalChanges(baseline, nextSnapshot);
      baseline = nextSnapshot;
      enqueue(actionType, changes);
    }

    if (draining) await waitFor(() => !draining);
    if (queue.length) await drain();
    if (draining) await waitFor(() => !draining);
    if (queue.length) {
      throw lastSyncError || new Error("Production changes are still waiting for the backend. Try again.");
    }
    return true;
  }

  async function refresh() {
    if (!connected || !clientId || queue.length) return;
    try {
      const workspace = await loadOperationalWorkspace(clientId);
      // A local action may have been queued while the request was in flight.
      // Never let the older response overwrite that newer local state.
      if (queue.length || !connected) return;
      if (!(workspace.initializedCollections || []).length) return;
      const currentState = store.getState();
      const allowed = allowedCollections(currentState);
      const remoteCollections = collectionsFromRemote(workspace, allowed);
      const recovery = recoverLocalSupervisorProduction(currentState, remoteCollections);
      if (recovery.actionType) {
        const remoteSnapshot = operationalSnapshot({ ...currentState, ...remoteCollections }, allowed);
        const recoveredSnapshot = operationalSnapshot({ ...currentState, ...recovery.collections }, allowed);
        enqueue(recovery.actionType, operationalChanges(remoteSnapshot, recoveredSnapshot));
        await drain();
        return;
      }
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
    queue = sanitizePersistedOperationalQueue(readQueue(clientId, userId), currentUserRole(state), userId);
    persistQueue();
    baseline = operationalSnapshot(state, allowedCollections(state));

    const allowed = allowedCollections(state);
    try {
      if (queue.length) {
        connected = true;
        await drain();
        if (queue.length) throw lastSyncError || new Error("Queued production changes could not be saved.");
        connected = false;
      }

      let workspace = await loadOperationalWorkspace(clientId);
      while (queue.length) {
        connected = true;
        await drain();
        if (queue.length) throw lastSyncError || new Error("Queued production changes could not be saved.");
        connected = false;
        workspace = await loadOperationalWorkspace(clientId);
      }
      if ((workspace.initializedCollections || []).length) {
        const remoteCollections = collectionsFromRemote(workspace, allowed);
        const recovery = recoverLocalSupervisorProduction(store.getState(), remoteCollections);
        if (recovery.actionType) {
          const remoteSnapshot = operationalSnapshot({ ...store.getState(), ...remoteCollections }, allowed);
          const recoveredSnapshot = operationalSnapshot({ ...store.getState(), ...recovery.collections }, allowed);
          enqueue(recovery.actionType, operationalChanges(remoteSnapshot, recoveredSnapshot));
        }
        store.dispatch({
          type: "SET_OPERATIONAL_RECORDS",
          collections: recovery.collections
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
      connected = false;
      lastSyncError = error;
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
    lastSyncError = null;
  }

  function discardQueuedChanges() {
    queue = [];
    lastSyncError = null;
    globalThis.clearTimeout(retryTimer);
    retryTimer = null;
    try {
      if (clientId && userId) {
        globalThis.localStorage?.removeItem(queueStorageKey(clientId, userId));
        globalThis.localStorage?.removeItem(`distro-iq-operational-sync:${clientId}:${userId}`);
      }
    } catch {
      // The confirmed backend reset remains authoritative if browser storage is unavailable.
    }
    baseline = operationalSnapshot(store.getState(), allowedCollections(store.getState()));
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
    if (IGNORED_ACTIONS.has(action.type)) return;
    if (!connected && !connecting) return;

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

  return { connect, disconnect, discardQueuedChanges, flush, handleStateChange, refresh };
}
