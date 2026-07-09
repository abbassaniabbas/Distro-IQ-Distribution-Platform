import { actionTypeLabel, getScopedActivityLogs } from "../services/activity.js";
import {
  accountForCurrentUser,
  initials,
  normalized,
  receivedMessages,
  relativeTime
} from "../services/messages.js";
import { escapeHtml } from "./dom.js";

let activeNotificationPopover = null;

export { getUnreadMessageCount } from "../services/messages.js";

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

function closeOverlays() {
  closeNotificationPopover();
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

export function bindTopbarCommunications({ store, notificationsButton, messagesButton }) {
  notificationsButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    openNotificationPopover({ store, trigger: notificationsButton });
  });

  messagesButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    closeOverlays();
    window.location.hash = "#/messages";
  });

  document.addEventListener("click", (event) => {
    if (
      event.target.closest?.(".topbar-notification-popover") ||
      event.target.closest?.("#topbar-notifications")
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
