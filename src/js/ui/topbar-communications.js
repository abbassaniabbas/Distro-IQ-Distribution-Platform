import { actionTypeLabel, getScopedActivityLogs } from "../services/activity.js";
import { roleLabel } from "../services/rbac.js";
import { escapeHtml, qs } from "./dom.js";
import { icon } from "./icons.js";

let activeNotificationPopover = null;
let activeMessageModal = null;

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function accountForCurrentUser(state) {
  const userEmail = normalized(state.user?.email);

  return (state.accounts || []).find((account) => (
    account.clientId === state.client?.id &&
    (
      (account.userId && account.userId === state.user?.id) ||
      (userEmail && normalized(account.email) === userEmail)
    )
  )) || null;
}

function isMessageForAccount(message, account, user) {
  const accountEmail = normalized(account?.email);
  const userEmail = normalized(user?.email);

  return (
    (account?.id && message.toAccountId === account.id) ||
    (user?.id && message.toUserId === user.id) ||
    (accountEmail && normalized(message.toEmail) === accountEmail) ||
    (userEmail && normalized(message.toEmail) === userEmail)
  );
}

function isMessageFromAccount(message, account, user) {
  const accountEmail = normalized(account?.email);
  const userEmail = normalized(user?.email);

  return (
    (account?.id && message.fromAccountId === account.id) ||
    (user?.id && message.fromUserId === user.id) ||
    (accountEmail && normalized(message.fromEmail) === accountEmail) ||
    (userEmail && normalized(message.fromEmail) === userEmail)
  );
}

function companyMessages(state) {
  if (!state.client?.id) return [];

  return (state.messages || [])
    .filter((message) => message.clientId === state.client.id)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function receivedMessages(state) {
  const account = accountForCurrentUser(state);

  return companyMessages(state).filter((message) => isMessageForAccount(message, account, state.user));
}

function sentMessages(state) {
  const account = accountForCurrentUser(state);

  return companyMessages(state).filter((message) => isMessageFromAccount(message, account, state.user));
}

export function getUnreadMessageCount(state) {
  return receivedMessages(state).filter((message) => !message.readAt).length;
}

function relativeTime(value) {
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

function initials(value) {
  const words = String(value || "Team member").trim().split(/[\s@.]+/).filter(Boolean);
  return `${words[0]?.[0] || "T"}${words[1]?.[0] || ""}`.toUpperCase();
}

function senderRole(message) {
  return message.fromRole ? roleLabel(message.fromRole) : "Team member";
}

export function getTopbarNotificationItems(state) {
  if (!state.client?.id) return [];

  const account = accountForCurrentUser(state);
  const messageItems = receivedMessages(state).map((message) => ({
    id: `message-${message.id}`,
    kind: "message",
    title: `${message.fromName || "Team member"} messaged you`,
    meta: relativeTime(message.createdAt),
    body: message.body,
    avatar: initials(message.fromName || message.fromEmail),
    createdAt: message.createdAt,
    unread: !message.readAt
  }));
  const activityItems = getScopedActivityLogs(state)
    .filter((entry) => entry.clientId === state.client.id)
    .filter((entry) => entry.actorUserId !== state.user?.id)
    .filter((entry) => normalized(entry.actorEmail) !== normalized(account?.email))
    .map((entry) => ({
      id: `activity-${entry.id}`,
      kind: "activity",
      title: `${entry.actorName || "Team member"} ${actionTypeLabel(entry.actionType).toLowerCase()}`,
      meta: relativeTime(entry.createdAt),
      body: entry.summary || "Workspace activity updated",
      avatar: initials(entry.actorName),
      createdAt: entry.createdAt,
      unread: false
    }));

  return [...messageItems, ...activityItems]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 5);
}

function closeNotificationPopover() {
  activeNotificationPopover?.remove();
  activeNotificationPopover = null;
}

function closeMessageModal() {
  activeMessageModal?.remove();
  activeMessageModal = null;
}

function closeOverlays() {
  closeNotificationPopover();
  closeMessageModal();
}

function positionPopover(popover, trigger) {
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(420, window.innerWidth - 24);
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 12);

  popover.style.width = `${width}px`;
  popover.style.left = `${left}px`;
  popover.style.top = `${rect.bottom + 14}px`;
}

function notificationRow(item) {
  return `
    <article class="topbar-notification-row ${item.unread ? "is-unread" : ""}">
      <div class="communication-avatar">${escapeHtml(item.avatar)}</div>
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.meta)}</span>
        ${item.body ? `<p>${escapeHtml(item.body)}</p>` : ""}
      </div>
    </article>
  `;
}

function openNotificationPopover({ store, trigger }) {
  closeMessageModal();

  if (activeNotificationPopover) {
    closeNotificationPopover();
    return;
  }

  const items = getTopbarNotificationItems(store.getState());
  const popover = document.createElement("section");
  popover.className = "topbar-notification-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "Notifications");
  popover.innerHTML = `
    <div class="topbar-popover-arrow"></div>
    <header>
      <strong>Notifications</strong>
      <span>${items.length ? `${items.length} latest` : "All clear"}</span>
    </header>
    <div class="topbar-notification-list">
      ${items.length
        ? items.map(notificationRow).join("")
        : '<div class="topbar-empty-state">No notifications yet</div>'}
    </div>
  `;

  document.body.appendChild(popover);
  activeNotificationPopover = popover;
  positionPopover(popover, trigger);
}

function recipientOptions(state) {
  const currentAccount = accountForCurrentUser(state);
  const canSendToAllStaff = ["manager", "ceo"].includes(normalized(currentAccount?.role));
  const recipients = (state.accounts || [])
    .filter((account) => account.clientId === state.client?.id)
    .filter((account) => account.id !== currentAccount?.id)
    .filter((account) => account.status !== "deactivated")
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const allStaffOption = canSendToAllStaff && recipients.length
    ? '<option value="__all_staff__">All staff</option>'
    : "";
  const staffOptions = recipients.map((account) => `
      <option value="${escapeHtml(account.id)}">
        ${escapeHtml(account.name || account.email)} - ${escapeHtml(roleLabel(account.role))}
      </option>
    `)
    .join("");

  return `${allStaffOption}${staffOptions}`;
}

function renderMessageList(messages, emptyText, direction) {
  if (!messages.length) {
    return `<div class="topbar-empty-state">${escapeHtml(emptyText)}</div>`;
  }

  return messages.map((message) => {
    const name = direction === "sent" ? message.toName : message.fromName;
    const metaRole = direction === "sent" ? roleLabel(message.toRole) : senderRole(message);
    const metaPrefix = direction === "sent" ? "To" : "From";

    return `
      <article class="message-thread-row ${!message.readAt && direction === "received" ? "is-unread" : ""}">
        <div class="communication-avatar">${escapeHtml(initials(name || message.fromEmail || message.toEmail))}</div>
        <div>
          <div class="message-thread-heading">
            <strong>${escapeHtml(name || "Team member")}</strong>
            <span>${escapeHtml(relativeTime(message.createdAt))}</span>
          </div>
          <small>${escapeHtml(metaPrefix)} ${escapeHtml(metaRole)}</small>
          <p>${escapeHtml(message.body)}</p>
        </div>
      </article>
    `;
  }).join("");
}

function openMessageModal({ store }) {
  closeNotificationPopover();

  if (activeMessageModal) {
    closeMessageModal();
    return;
  }

  const modal = document.createElement("div");
  modal.className = "message-modal-backdrop";
  modal.innerHTML = '<section class="message-modal" role="dialog" aria-modal="true" aria-labelledby="message-modal-title"></section>';
  document.body.appendChild(modal);
  activeMessageModal = modal;
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeMessageModal();
  });

  store.dispatch({ type: "MARK_MESSAGES_READ" });
  renderMessageModal({ store });
}

function renderMessageModal({ store }) {
  if (!activeMessageModal) return;

  const state = store.getState();
  const received = receivedMessages(state);
  const sent = sentMessages(state);
  const options = recipientOptions(state);
  const content = qs(".message-modal", activeMessageModal);

  content.innerHTML = `
    <header class="message-modal-header">
      <div>
        <span class="eyebrow">Company messages</span>
        <h2 id="message-modal-title">Quick message</h2>
      </div>
      <button class="icon-button js-close-message-modal" type="button" aria-label="Close messages">
        ${icon("x")}
      </button>
    </header>

    <form id="quick-message-form" class="message-compose-form" novalidate>
      <label class="field">
        <span>Send to</span>
        <select name="recipientAccountId" required ${options ? "" : "disabled"}>
          <option value="">Choose team member</option>
          ${options}
        </select>
      </label>
      <label class="field">
        <span>Message</span>
        <textarea name="body" rows="3" maxlength="600" placeholder="Write a short update" required ${options ? "" : "disabled"}></textarea>
      </label>
      <div class="message-compose-actions">
        <span id="quick-message-status" class="field-error"></span>
        <button class="button primary" type="submit" ${options ? "" : "disabled"}>
          ${icon("message")}
          <span>Send message</span>
        </button>
      </div>
    </form>

    <div class="message-modal-grid">
      <section>
        <header class="message-section-header">
          <strong>Received</strong>
          <span>${received.length}</span>
        </header>
        <div class="message-thread-list">
          ${renderMessageList(received, "No received messages yet", "received")}
        </div>
      </section>
      <section>
        <header class="message-section-header">
          <strong>Sent</strong>
          <span>${sent.length}</span>
        </header>
        <div class="message-thread-list">
          ${renderMessageList(sent, "No sent messages yet", "sent")}
        </div>
      </section>
    </div>
  `;

  qs(".js-close-message-modal", activeMessageModal)?.addEventListener("click", closeMessageModal);
  qs("#quick-message-form", activeMessageModal)?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const status = qs("#quick-message-status", activeMessageModal);
    const recipientAccountId = String(formData.get("recipientAccountId") || "");
    const body = String(formData.get("body") || "").trim();

    if (status) status.textContent = "";

    if (!recipientAccountId || !body) {
      if (status) status.textContent = "Choose a team member and write a message.";
      return;
    }

    store.dispatch({
      type: "SEND_MESSAGE",
      recipientAccountId,
      sendToAllStaff: recipientAccountId === "__all_staff__",
      body,
      message: recipientAccountId === "__all_staff__" ? "Message sent to all staff" : "Message sent"
    });
    renderMessageModal({ store });
  });
}

export function bindTopbarCommunications({ store, notificationsButton, messagesButton }) {
  notificationsButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    openNotificationPopover({ store, trigger: notificationsButton });
  });

  messagesButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    openMessageModal({ store });
  });

  document.addEventListener("click", (event) => {
    if (
      event.target.closest?.(".topbar-notification-popover") ||
      event.target.closest?.("#topbar-notifications") ||
      event.target.closest?.(".message-modal")
    ) {
      return;
    }

    closeNotificationPopover();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeOverlays();
  });

  window.addEventListener("resize", closeNotificationPopover);
}
