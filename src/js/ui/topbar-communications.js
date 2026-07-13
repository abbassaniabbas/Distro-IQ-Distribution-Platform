import { actionTypeLabel, getScopedActivityLogs } from "../services/activity.js";
import {
  accountForCurrentUser,
  initials,
  normalized,
  relativeTime
} from "../services/messages.js";
import { escapeHtml } from "./dom.js";

let activeNotificationPopover = null;

export { getUnreadMessageCount } from "../services/messages.js";

export function getTopbarNotificationItems(state) {
  if (!state.client?.id) return [];

  const account = accountForCurrentUser(state);
  const readAt = new Date(state.notificationReadAt || 0).getTime();
  const clearedAt = new Date(state.notificationClearedAt || 0).getTime();
  const dismissedIds = new Set((state.dismissedNotificationIds || []).map(String));
  const activityItems = getScopedActivityLogs(state)
    .filter((entry) => entry.clientId === state.client.id)
    .filter((entry) => entry.actorUserId !== state.user?.id)
    .filter((entry) => normalized(entry.actorEmail) !== normalized(account?.email))
    .filter((entry) => new Date(entry.createdAt || 0).getTime() > clearedAt)
    .map((entry) => ({
      id: `activity-${entry.id}`,
      kind: "activity",
      title: `${entry.actorName || "Team member"} ${actionTypeLabel(entry.actionType).toLowerCase()}`,
      meta: relativeTime(entry.createdAt),
      body: entry.summary || "Workspace activity updated",
      avatar: initials(entry.actorName),
      createdAt: entry.createdAt,
      unread: new Date(entry.createdAt || 0).getTime() > readAt
    }))
    .filter((item) => !dismissedIds.has(item.id));

  return activityItems
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 5);
}

export function getUnreadNotificationCount(state) {
  return getTopbarNotificationItems(state).filter((item) => item.unread).length;
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
  const width = Math.min(340, window.innerWidth - 24);
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 12);

  popover.style.width = `${width}px`;
  popover.style.left = `${left}px`;
  popover.style.top = `${rect.bottom + 14}px`;
}

function notificationRow(item) {
  return `
    <article class="topbar-notification-row ${item.unread ? "is-unread" : ""}" data-notification-id="${escapeHtml(item.id)}">
      <div class="communication-avatar">${escapeHtml(item.avatar)}</div>
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.meta)}</span>
        ${item.body ? `<p>${escapeHtml(item.body)}</p>` : ""}
      </div>
      <button class="topbar-dismiss-notification" type="button" title="Clear this notification" aria-label="Clear this notification">X</button>
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
      <div>
        <strong>Notifications</strong>
      </div>
      ${items.length ? '<button class="topbar-clear-notifications" type="button" title="Clear all notifications" aria-label="Clear all notifications">X</button>' : ""}
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
  store.dispatch({ type: "MARK_NOTIFICATIONS_READ" });

  popover.querySelector(".topbar-clear-notifications")?.addEventListener("click", () => {
    store.dispatch({ type: "DISMISS_ALL_NOTIFICATIONS" });
    const list = popover.querySelector(".topbar-notification-list");
    if (list) list.innerHTML = '<div class="topbar-empty-state">No notifications yet</div>';
    popover.querySelector(".topbar-clear-notifications")?.remove();
  });

  popover.querySelectorAll(".topbar-dismiss-notification").forEach((button) => {
    button.addEventListener("click", () => {
      const row = button.closest("[data-notification-id]");
      if (!row) return;
      store.dispatch({ type: "DISMISS_NOTIFICATIONS", notificationIds: [row.dataset.notificationId] });
      row.remove();
      if (!popover.querySelector("[data-notification-id]")) {
        popover.querySelector(".topbar-notification-list").innerHTML = '<div class="topbar-empty-state">No notifications yet</div>';
        popover.querySelector(".topbar-clear-notifications")?.remove();
      }
    });
  });
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
