import { createId } from "./tenant.js";
import { currentUserRole } from "./rbac.js";
import { formatCurrency, formatNumber } from "./formatters.js";

export const ACTION_LABELS = {
  created: "Created",
  updated: "Updated",
  invited: "Invited",
  completed: "Completed",
  delayed: "Delayed",
  restocked: "Restocked",
  reduced: "Reduced",
  contacted: "Contacted",
  paid: "Paid",
  sold: "Sold",
  returned: "Returned",
  submitted: "Submitted",
  blocked: "Blocked",
  assigned: "Assigned",
  dispatched: "Dispatched",
  reconciled: "Reconciled",
  flagged: "Flagged",
  deactivated: "Deactivated"
};

export const RECORD_LABELS = {
  company: "Company",
  account: "Account",
  order: "Sales Order",
  inventory: "Stock",
  stock_movement: "Stock Movement",
  route: "Dispatch",
  retailer: "Customer",
  invoice: "Invoice",
  credit_limit: "Credit Limit",
  sale: "Sale",
  report: "Sales Report"
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
  summary,
  details = []
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
    details,
    createdAt: new Date().toISOString()
  };
}

function transactionActionType(transaction) {
  const type = String(transaction.type || "").toLowerCase();
  const direction = String(transaction.movementDirection || "").toLowerCase();

  if (type === "write off") return "reduced";
  if (type === "sale") return "sold";
  if (type === "return") return "returned";
  if (direction === "in") return "restocked";
  if (direction === "out") return "dispatched";
  return "updated";
}

function transactionSummary(transaction, productName) {
  const quantity = Number(transaction.quantity || 0);
  const actionType = transactionActionType(transaction);

  if (actionType === "reduced") {
    const reason = [transaction.reason, transaction.reasonDetails].filter(Boolean).join(" - ");
    return `${productName} reduced by ${quantity}${reason ? `: ${reason}` : ""}`;
  }

  if (actionType === "restocked") {
    return `${productName} restocked by ${quantity}`;
  }

  if (actionType === "sold") {
    return `${quantity} ${productName} sold to ${transaction.partyName || "customer"}`;
  }

  if (actionType === "returned") {
    return `${quantity} ${productName} returned by ${transaction.partyName || "customer"}`;
  }

  return `Dispatched ${quantity} ${productName} to ${transaction.recipientName || transaction.partyName || "recipient"}`;
}

function transactionCreatedAt(transaction) {
  if (transaction.createdAt) return transaction.createdAt;
  if (transaction.date) return `${transaction.date}T12:00:00.000Z`;
  return new Date().toISOString();
}

function activityKey(entry) {
  return [
    entry.actionType,
    entry.recordType,
    entry.recordLabel,
    entry.summary,
    String(entry.createdAt || "").slice(0, 10)
  ].join("|");
}

function stockMovementActivityLogs(state, existingLogs) {
  if (!state.client?.id) return [];

  const existingKeys = new Set(existingLogs.map(activityKey));
  const productMap = new Map((state.products || []).map((product) => [product.id, product]));

  return (state.stockTransactions || [])
    .map((transaction) => {
      const product = productMap.get(transaction.productId);
      const productName = transaction.productName || product?.name || transaction.productId || "Stock item";
      const actionType = transactionActionType(transaction);
      const entry = {
        id: `TXN-ACT-${transaction.id}`,
        clientId: state.client.id,
        actionType,
        recordType: "stock_movement",
        recordLabel: transaction.productId || transaction.id,
        actorUserId: "",
        actorName: transaction.staffResponsible || transaction.recordedBy || "Store Keeper",
        actorEmail: "",
        summary: transactionSummary(transaction, productName),
        createdAt: transactionCreatedAt(transaction)
      };

      return existingKeys.has(activityKey(entry)) ? null : entry;
    })
    .filter(Boolean);
}

function financialTransactionActivityLogs(state) {
  if (!state.client?.id) return [];

  const productMap = new Map((state.products || []).map((product) => [product.id, product]));

  return (state.stockTransactions || [])
    .filter((transaction) => {
      const type = String(transaction.type || "").toLowerCase();
      return type === "sale" || type === "return" || type === "write off";
    })
    .map((transaction) => {
      const product = productMap.get(transaction.productId);
      const productName = transaction.productName || product?.name || transaction.productId || "Stock item";
      const type = String(transaction.type || "").toLowerCase();
      const isSale = type === "sale";
      const isReturn = type === "return";
      const quantity = Number(transaction.quantity || 0);
      const amount = isSale || isReturn
        ? Number(transaction.amount || 0)
        : quantity * Number(transaction.unitCost ?? transaction.unitCostAtSale ?? product?.unitCost ?? product?.unitPrice ?? 0);
      const actionType = isSale ? "sold" : isReturn ? "returned" : "reduced";
      const recordType = isSale || isReturn ? "sale" : "stock_movement";
      const actorName = transaction.recordedBy || transaction.staffResponsible || "Team member";
      const summary = isSale
        ? `${actorName} sold ${formatNumber(quantity)} ${productName} to ${transaction.partyName || "customer"} for ${formatCurrency(amount)} (${transaction.paymentType || "cash"})`
        : isReturn
          ? `${actorName} logged a ${formatCurrency(amount)} return from ${transaction.partyName || "customer"} for ${formatNumber(quantity)} ${productName}`
          : `${actorName} wrote off ${formatNumber(quantity)} ${productName}; estimated loss ${formatCurrency(amount)}`;

      return {
        id: `FIN-ACT-${transaction.id}`,
        clientId: state.client.id,
        actionType,
        recordType,
        recordLabel: isSale || isReturn ? productName : transaction.productId || transaction.id,
        actorUserId: transaction.repUserId || "",
        actorName,
        actorEmail: "",
        summary,
        createdAt: transactionCreatedAt(transaction)
      };
    });
}

export function getScopedActivityLogs(state) {
  if (!state.client?.id) return [];

  const savedLogs = (state.activityLogs || [])
    .filter((entry) => entry.clientId === state.client.id);
  const logs = [
    ...savedLogs,
    ...stockMovementActivityLogs(state, savedLogs)
  ];
  const role = currentUserRole(state);

  if (role === "store_keeper") {
    return logs
      .filter((entry) => ["inventory", "stock_movement", "route"].includes(entry.recordType))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  if (role === "accountant") {
    const accountantSavedLogs = savedLogs.filter((entry) => (
      !(entry.recordType === "sale" && ["sold", "returned"].includes(entry.actionType))
    ));

    return [
      ...accountantSavedLogs,
      ...financialTransactionActivityLogs(state)
    ]
      .filter((entry) => (
        ["sale", "invoice", "credit_limit", "report", "order"].includes(entry.recordType) ||
        (entry.recordType === "stock_movement" && entry.actionType === "reduced")
      ))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  return logs
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
