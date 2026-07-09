import { roleLabel } from "./rbac.js";

export function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

export function accountForCurrentUser(state) {
  const userEmail = normalized(state.user?.email);

  return (state.accounts || []).find((account) => (
    account.clientId === state.client?.id &&
    (
      (account.userId && account.userId === state.user?.id) ||
      (userEmail && normalized(account.email) === userEmail)
    )
  )) || null;
}

export function isMessageForAccount(message, account, user) {
  const accountEmail = normalized(account?.email);
  const userEmail = normalized(user?.email);

  return (
    (account?.id && message.toAccountId === account.id) ||
    (user?.id && message.toUserId === user.id) ||
    (accountEmail && normalized(message.toEmail) === accountEmail) ||
    (userEmail && normalized(message.toEmail) === userEmail)
  );
}

export function isMessageFromAccount(message, account, user) {
  const accountEmail = normalized(account?.email);
  const userEmail = normalized(user?.email);

  return (
    (account?.id && message.fromAccountId === account.id) ||
    (user?.id && message.fromUserId === user.id) ||
    (accountEmail && normalized(message.fromEmail) === accountEmail) ||
    (userEmail && normalized(message.fromEmail) === userEmail)
  );
}

export function companyMessages(state) {
  if (!state.client?.id) return [];

  return (state.messages || [])
    .filter((message) => message.clientId === state.client.id)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

export function receivedMessages(state) {
  const account = accountForCurrentUser(state);

  return companyMessages(state).filter((message) => isMessageForAccount(message, account, state.user));
}

export function sentMessages(state) {
  const account = accountForCurrentUser(state);

  return companyMessages(state).filter((message) => isMessageFromAccount(message, account, state.user));
}

export function getUnreadMessageCount(state) {
  return receivedMessages(state).filter((message) => !message.readAt).length;
}

export function canSendToAllStaff(state) {
  const account = accountForCurrentUser(state);

  return ["manager", "ceo"].includes(normalized(account?.role));
}

export function messageRecipients(state) {
  const currentAccount = accountForCurrentUser(state);

  return (state.accounts || [])
    .filter((account) => account.clientId === state.client?.id)
    .filter((account) => account.id !== currentAccount?.id)
    .filter((account) => !["deactivated", "disabled"].includes(normalized(account.status)))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export function recipientLabel(account) {
  return `${account.name || account.email} - ${roleLabel(account.role)}`;
}

export function relativeTime(value) {
  const timestamp = new Date(value || Date.now()).getTime();
  const diffMs = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (!Number.isFinite(timestamp)) return "Just now";
  if (diffMs < minute) return "Just now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} mins ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} hrs ago`;
  if (diffMs < 2 * day) return "Yesterday";
  return `${Math.floor(diffMs / day)} days ago`;
}

export function initials(value) {
  const words = String(value || "Team member").trim().split(/[\s@.]+/).filter(Boolean);

  return `${words[0]?.[0] || "T"}${words[1]?.[0] || ""}`.toUpperCase();
}
