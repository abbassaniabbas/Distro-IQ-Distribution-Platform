import { createId } from "./tenant.js";

export const ACTION_LABELS = {
  created: "Created",
  updated: "Updated",
  invited: "Invited",
  completed: "Completed",
  delayed: "Delayed",
  restocked: "Restocked",
  contacted: "Contacted",
  paid: "Paid"
};

export const RECORD_LABELS = {
  company: "Company",
  account: "Account",
  order: "Order",
  inventory: "Inventory",
  route: "Route",
  retailer: "Retailer",
  invoice: "Invoice"
};

export function actionTypeLabel(actionType) {
  return ACTION_LABELS[actionType] || actionType || "Updated";
}

export function recordTypeLabel(recordType) {
  return RECORD_LABELS[recordType] || recordType || "Record";
}

export function getCurrentActor(state) {
  const userId = state.user?.id;
  const account = state.accounts.find((item) => item.userId && item.userId === userId);
  const name = account?.name || state.user?.user_metadata?.full_name || state.user?.email || "Local admin";
  const email = account?.email || state.user?.email || "";

  return {
    userId: userId || "",
    name,
    email
  };
}

export function createActivityLog({
  clientId,
  actionType,
  recordType,
  recordLabel = "",
  actor,
  summary
}) {
  return {
    id: createId("LOG"),
    clientId,
    actionType,
    recordType,
    recordLabel,
    actorUserId: actor?.userId || "",
    actorName: actor?.name || "Team member",
    actorEmail: actor?.email || "",
    summary,
    createdAt: new Date().toISOString()
  };
}

export function getScopedActivityLogs(state) {
  if (!state.client?.id) return [];

  return (state.activityLogs || [])
    .filter((entry) => entry.clientId === state.client.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
