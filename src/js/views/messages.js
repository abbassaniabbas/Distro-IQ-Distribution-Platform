import {
  canSendToAllStaff,
  getUnreadMessageCount,
  initials,
  messageRecipients,
  normalized,
  receivedMessages,
  relativeTime,
  sentMessages
} from "../services/messages.js";
import {
  clearWorkspaceConversation,
  deleteWorkspaceMessages,
  loadWorkspace,
  markWorkspaceConversationRead,
  sendWorkspaceMessage
} from "../services/backend.js?v=20260729a";
import { isBackendConfigured } from "../services/supabase-client.js";
import { roleLabel } from "../services/rbac.js?v=20260801d";
import { confirmActionDialog } from "../ui/action-dialog.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { icon } from "../ui/icons.js?v=20260729a";

function messageRouteParams() {
  if (typeof window === "undefined") return new URLSearchParams();

  const query = window.location.hash.split("?")[1] || "";
  return new URLSearchParams(query);
}

function conversationHref(conversationId) {
  return `#/messages?with=${encodeURIComponent(conversationId)}`;
}

function combinedMessages(state) {
  return [
    ...receivedMessages(state).map((message) => ({ ...message, direction: "received" })),
    ...sentMessages(state).map((message) => ({ ...message, direction: "sent" }))
  ].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}

function messageMatchesAccount(message, account, direction) {
  const accountId = direction === "sent" ? message.toAccountId : message.fromAccountId;
  const userId = direction === "sent" ? message.toUserId : message.fromUserId;
  const email = direction === "sent" ? message.toEmail : message.fromEmail;

  return (
    (account?.id && accountId === account.id) ||
    (account?.userId && userId === account.userId) ||
    (account?.email && normalized(email) === normalized(account.email))
  );
}

function directMessagesForAccount(history, account) {
  return history.filter((message) => (
    (message.direction !== "sent" || message.audience !== "all_staff") &&
    messageMatchesAccount(message, account, message.direction)
  ));
}

function latestMessage(messages) {
  return messages[messages.length - 1] || null;
}

function latestTimestamp(message) {
  const timestamp = new Date(message?.createdAt || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function broadcastDisplayKey(message) {
  const timestamp = latestTimestamp(message);
  const createdSecond = timestamp ? Math.floor(timestamp / 1000) : String(message.id || "");
  return [
    message.fromAccountId || message.fromUserId || message.fromEmail || "sender",
    message.body || "",
    createdSecond
  ].join("|");
}

function consolidateSentBroadcasts(messages) {
  const broadcasts = new Map();

  messages.forEach((message) => {
    const key = broadcastDisplayKey(message);
    const existing = broadcasts.get(key);
    if (existing) {
      existing.recipientCount += 1;
      existing.messageIds.push(message.id);
      return;
    }

    broadcasts.set(key, {
      ...message,
      messageIds: [message.id],
      toName: "All staff",
      toEmail: "",
      toRole: "",
      recipientCount: 1
    });
  });

  return [...broadcasts.values()];
}

function buildConversations(state) {
  const history = combinedMessages(state);
  const direct = messageRecipients(state)
    .map((account) => {
      const messages = directMessagesForAccount(history, account);

      return {
        id: account.id,
        kind: "direct",
        account,
        messages,
        latest: latestMessage(messages),
        unread: messages.filter((message) => message.direction === "received" && !message.readAt).length
      };
    })
    .sort((a, b) => (
      latestTimestamp(b.latest) - latestTimestamp(a.latest) ||
      String(a.account.name || a.account.email).localeCompare(String(b.account.name || b.account.email))
    ));

  const allStaffMessages = consolidateSentBroadcasts(
    sentMessages(state)
      .filter((message) => message.audience === "all_staff")
      .map((message) => ({ ...message, direction: "sent" }))
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
  );
  const allStaff = canSendToAllStaff(state) && direct.length
    ? {
        id: "__all_staff__",
        kind: "all_staff",
        account: null,
        messages: allStaffMessages,
        latest: latestMessage(allStaffMessages),
        unread: 0
      }
    : null;

  return { direct, allStaff };
}

function activeConversation(conversations) {
  const requestedId = messageRouteParams().get("with") || "";

  if (requestedId === "__all_staff__" && conversations.allStaff) {
    return conversations.allStaff;
  }

  return conversations.direct.find((conversation) => conversation.id === requestedId) ||
    conversations.direct[0] ||
    conversations.allStaff ||
    null;
}

function conversationName(conversation) {
  return conversation?.kind === "all_staff"
    ? "All staff"
    : conversation?.account?.name || conversation?.account?.email || "Team member";
}

function conversationRole(conversation) {
  return conversation?.kind === "all_staff"
    ? "Company announcement"
    : roleLabel(conversation?.account?.role);
}

function conversationPreview(conversation) {
  const latest = conversation.latest;

  if (!latest) return "No messages yet";

  const prefix = latest.direction === "sent" ? "You: " : "";
  return `${prefix}${latest.body || ""}`;
}

function conversationSearchIndex(conversation) {
  return [
    conversationName(conversation),
    conversationRole(conversation),
    conversationPreview(conversation)
  ].join(" ").toLowerCase();
}

function renderConversationLink(conversation, activeId) {
  const isActive = conversation.id === activeId;
  const avatar = conversation.kind === "all_staff"
    ? "ALL"
    : initials(conversationName(conversation));

  return `
    <a
      class="message-contact${isActive ? " is-active" : ""}${conversation.kind === "all_staff" ? " is-all-staff" : ""}"
      href="${conversationHref(conversation.id)}"
      data-message-contact
      data-search-index="${escapeHtml(conversationSearchIndex(conversation))}"
      aria-current="${isActive ? "page" : "false"}"
    >
      <span class="communication-avatar">${escapeHtml(avatar)}</span>
      <span class="message-contact-content">
        <strong>${escapeHtml(conversationName(conversation))}</strong>
        <span>${escapeHtml(conversationRole(conversation))}</span>
        <small>${escapeHtml(conversationPreview(conversation))}</small>
      </span>
      <span class="message-contact-meta">
        ${conversation.latest ? `<time>${escapeHtml(relativeTime(conversation.latest.createdAt))}</time>` : ""}
        ${conversation.unread ? `<i aria-label="${conversation.unread} unread message${conversation.unread === 1 ? "" : "s"}">${conversation.unread}</i>` : ""}
      </span>
    </a>
  `;
}

function messageBubble(message) {
  const isSent = message.direction === "sent";
  const messageIds = Array.isArray(message.messageIds) ? message.messageIds : [message.id];

  return `
    <article
      class="message-thread-bubble ${isSent ? "is-sent" : "is-received"}${!isSent && !message.readAt ? " is-unread" : ""}"
      data-message-row
      data-message-ids="${escapeHtml(messageIds.filter(Boolean).join(","))}"
      data-message-body="${escapeHtml(message.body || "")}"
      data-search-index="${escapeHtml(`${message.body} ${message.fromName} ${message.toName}`.toLowerCase())}"
    >
      <div class="message-bubble-layout">
        <div class="message-bubble-body">
          ${isSent && message.audience === "all_staff" ? '<span class="message-broadcast-label">To: All staff</span>' : ""}
          <p>${escapeHtml(message.body)}</p>
          <time>${escapeHtml(relativeTime(message.createdAt))}</time>
        </div>
        <div class="message-actions">
          <button
            class="icon-button message-actions-trigger"
            type="button"
            data-message-actions-trigger
            title="Message actions"
            aria-label="Message actions"
            aria-haspopup="menu"
            aria-expanded="false"
          >${icon("moreHorizontal")}</button>
          <div class="message-actions-menu" role="menu" data-message-actions-menu hidden>
            <button type="button" role="menuitem" data-forward-message>${icon("share")}<span>Forward</span></button>
            <button type="button" role="menuitem" data-delete-message>${icon("trash")}<span>Delete</span></button>
            ${isSent ? `<button type="button" role="menuitem" data-unsend-message>${icon("arrowLeft")}<span>Unsend</span></button>` : ""}
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderForwardMessageModal(state) {
  const recipients = messageRecipients(state);
  const allStaffOption = canSendToAllStaff(state) && recipients.length
    ? '<option value="__all_staff__">All staff</option>'
    : "";

  return `
    <div class="stock-modal-backdrop message-forward-modal-backdrop" data-forward-message-modal hidden>
      <section class="stock-modal message-forward-modal" role="dialog" aria-modal="true" aria-labelledby="forward-message-title">
        <header class="stock-modal-header">
          <div>
            <span class="eyebrow">Messages</span>
            <h2 id="forward-message-title">Forward message</h2>
          </div>
          <button class="icon-button" type="button" data-close-forward-message title="Close" aria-label="Close">${icon("x")}</button>
        </header>
        <form class="form-grid" data-forward-message-form>
          <label class="field">
            <span>Forward to</span>
            <select name="recipientAccountId" required>
              <option value="">Choose a staff member</option>
              ${allStaffOption}
              ${recipients.map((account) => `
                <option value="${escapeHtml(account.id)}">${escapeHtml(account.name || account.email)} — ${escapeHtml(roleLabel(account.role))}</option>
              `).join("")}
            </select>
          </label>
          <div class="message-forward-preview" data-forward-message-preview></div>
          <span class="field-error" data-forward-message-status role="status" aria-live="polite"></span>
          <div class="modal-actions">
            <button class="button subtle" type="button" data-close-forward-message><span>Cancel</span></button>
            <button class="button primary" type="submit">${icon("share")}<span>Forward</span></button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderChat(active) {
  if (!active) {
    return `
      <section class="message-chat message-chat-empty">
        <div class="empty-state">No other staff accounts are available for messaging yet.</div>
      </section>
    `;
  }

  const name = conversationName(active);
  const role = conversationRole(active);
  const avatar = active.kind === "all_staff" ? "ALL" : initials(name);
  const recipientId = active.kind === "all_staff" ? "__all_staff__" : active.account.id;
  const placeholder = active.kind === "all_staff"
    ? "Write an update for the whole team"
    : `Message ${name}`;

  return `
    <section class="message-chat" data-message-conversation-id="${escapeHtml(recipientId)}">
      <header class="message-chat-header">
        <span class="communication-avatar">${escapeHtml(avatar)}</span>
        <div class="message-chat-identity">
          <strong>${escapeHtml(name)}</strong>
          <span>${escapeHtml(role)}</span>
        </div>
        <button
          class="button subtle message-clear-conversation"
          type="button"
          data-clear-message-conversation
          data-all-staff="${active.kind === "all_staff" ? "true" : "false"}"
          title="Clear messages"
          aria-label="Clear messages in this conversation"
          ${active.messages.length ? "" : "disabled"}
        >${icon("trash")}<span>Clear messages</span></button>
      </header>

      <div class="message-thread" data-message-thread aria-label="Conversation with ${escapeHtml(name)}">
        ${active.messages.length
          ? active.messages.map(messageBubble).join("")
          : `<div class="empty-state">Start a conversation with ${escapeHtml(name)}.</div>`}
      </div>

      <form id="message-page-form" class="message-composer" data-recipient-account-id="${escapeHtml(recipientId)}" novalidate>
        <label class="message-composer-field">
          <span class="sr-only">Message</span>
          <textarea name="body" rows="1" maxlength="800" placeholder="${escapeHtml(placeholder)}" required></textarea>
        </label>
        <span id="message-page-status" class="field-error" role="status" aria-live="polite"></span>
        <button class="button primary" type="submit">
          <span>Send</span>
        </button>
      </form>
    </section>
  `;
}

function messagesSignature(messages) {
  return (messages || [])
    .map((message) => `${message.id}:${message.readAt || ""}:${message.createdAt || ""}`)
    .sort()
    .join("|");
}

function syncMessagesInBackground({ store, signal }) {
  const initialState = store.getState();

  if (!isBackendConfigured() || !initialState.client?.id) return;

  let syncing = false;
  const refresh = async () => {
    if (syncing || document.hidden) return;

    syncing = true;
    try {
      const workspace = await loadWorkspace();
      const currentState = store.getState();

      if (messagesSignature(workspace.messages) !== messagesSignature(currentState.messages)) {
        store.dispatch({ type: "SET_WORKSPACE", ...workspace, backgroundRefresh: true });
      }
    } catch (error) {
      console.warn("Messages could not be refreshed:", error.message);
    } finally {
      syncing = false;
    }
  };

  const intervalId = window.setInterval(refresh, 6000);
  signal?.addEventListener("abort", () => window.clearInterval(intervalId), { once: true });
}

export function renderMessages({ state }) {
  const conversations = buildConversations(state);
  const active = activeConversation(conversations);
  const unread = getUnreadMessageCount(state);
  const contacts = [
    ...(conversations.allStaff ? [conversations.allStaff] : []),
    ...conversations.direct
  ];

  return `
    <section class="view messages-view">
      <section class="message-workspace" aria-label="Company messages">
        <aside class="message-sidebar">
          <header class="message-sidebar-header">
            <div>
              <span class="eyebrow">Messages</span>
              <h2>Staff</h2>
            </div>
            ${unread ? `<span class="message-unread-total">${unread}</span>` : ""}
          </header>
          <nav class="message-contact-list" aria-label="Staff conversations">
            ${contacts.length
              ? contacts.map((conversation) => renderConversationLink(conversation, active?.id || "")).join("")
              : '<div class="empty-state">Add a staff account to begin messaging.</div>'}
          </nav>
        </aside>
        ${renderChat(active)}
      </section>
      ${renderForwardMessageModal(state)}
    </section>
  `;
}

export function bindMessages({ root, store, signal }) {
  const activeConversationId = root.querySelector("[data-message-conversation-id]")?.dataset.messageConversationId || "";
  const state = store.getState();

  if (activeConversationId && activeConversationId !== "__all_staff__") {
    const activeAccount = (state.accounts || []).find((account) => account.id === activeConversationId);
    const hasUnreadMessages = receivedMessages(state).some((message) => (
      !message.readAt && messageMatchesAccount(message, activeAccount, "received")
    ));

    if (activeAccount && hasUnreadMessages) {
      store.dispatch({ type: "MARK_CONVERSATION_READ", peerAccountId: activeAccount.id });

      if (isBackendConfigured()) {
        void markWorkspaceConversationRead({
          clientId: state.client?.id,
          peerAccountId: activeAccount.id
        }).catch((error) => console.warn("Conversation could not be marked as read:", error.message));
      }

      return;
    }
  }

  const form = qs("#message-page-form", root);
  const status = qs("#message-page-status", root);
  const thread = qs("[data-message-thread]", root);
  const composer = qs('textarea[name="body"]', root);
  const forwardModal = qs("[data-forward-message-modal]", root);
  const forwardForm = qs("[data-forward-message-form]", root);
  const forwardPreview = qs("[data-forward-message-preview]", root);
  const forwardStatus = qs("[data-forward-message-status]", root);

  if (thread) thread.scrollTop = thread.scrollHeight;
  syncMessagesInBackground({ store, signal });

  const sendMessage = async ({ recipientAccountId, body, successMessage = "Message sent" }) => {
    const sendToAllStaff = recipientAccountId === "__all_staff__";

    if (isBackendConfigured()) {
      const workspace = await sendWorkspaceMessage({
        clientId: store.getState().client?.id,
        recipientAccountId,
        sendToAllStaff,
        body
      });
      store.dispatch({
        type: "SET_WORKSPACE",
        ...workspace,
        message: sendToAllStaff ? "Message sent to all staff" : successMessage
      });
      return;
    }

    store.dispatch({
      type: "SEND_MESSAGE",
      recipientAccountId,
      sendToAllStaff,
      body,
      message: sendToAllStaff ? "Message sent to all staff" : successMessage
    });
  };

  const closeMessageMenus = (except = null) => {
    qsa("[data-message-actions-menu]", root).forEach((menu) => {
      if (menu === except) return;
      menu.hidden = true;
      const trigger = menu.parentElement?.querySelector("[data-message-actions-trigger]");
      trigger?.setAttribute("aria-expanded", "false");
    });
  };

  qsa("[data-message-actions-trigger]", root).forEach((trigger) => {
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      const menu = trigger.parentElement?.querySelector("[data-message-actions-menu]");
      if (!menu) return;
      const shouldOpen = menu.hidden;
      closeMessageMenus(menu);
      menu.hidden = !shouldOpen;
      trigger.setAttribute("aria-expanded", String(shouldOpen));
      if (shouldOpen) {
        menu.classList.remove("opens-up");
        const menuBounds = menu.getBoundingClientRect();
        const threadBottom = thread?.getBoundingClientRect().bottom || window.innerHeight;
        if (menuBounds.bottom > Math.min(window.innerHeight, threadBottom) - 8) {
          menu.classList.add("opens-up");
        }
        menu.querySelector("button")?.focus();
      }
    }, { signal });
  });

  document.addEventListener("click", () => closeMessageMenus(), { signal });

  const messageRowForAction = (target) => target.closest("[data-message-row]");
  const messageIdsForRow = (row) => String(row?.dataset.messageIds || "").split(",").filter(Boolean);
  let forwardReturnFocus = null;

  const closeForwardModal = () => {
    if (!forwardModal) return;
    forwardModal.hidden = true;
    forwardForm?.reset();
    if (forwardPreview) forwardPreview.textContent = "";
    if (forwardStatus) forwardStatus.textContent = "";
    delete forwardForm?.dataset.messageBody;
    if (forwardReturnFocus?.isConnected) forwardReturnFocus.focus({ preventScroll: true });
    forwardReturnFocus = null;
  };

  qsa("[data-forward-message]", root).forEach((button) => {
    button.addEventListener("click", () => {
      const row = messageRowForAction(button);
      const body = String(row?.dataset.messageBody || "");
      closeMessageMenus();
      if (!forwardModal || !forwardForm || !body) return;
      forwardReturnFocus = button;
      forwardForm.dataset.messageBody = body;
      if (forwardPreview) forwardPreview.textContent = body;
      forwardModal.hidden = false;
      qs('select[name="recipientAccountId"]', forwardForm)?.focus();
    }, { signal });
  });

  qsa("[data-close-forward-message]", root).forEach((button) => {
    button.addEventListener("click", closeForwardModal, { signal });
  });
  forwardModal?.addEventListener("click", (event) => {
    if (event.target === forwardModal) closeForwardModal();
  }, { signal });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeMessageMenus();
    if (forwardModal && !forwardModal.hidden) closeForwardModal();
  }, { signal });

  forwardForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const recipientAccountId = String(new FormData(forwardForm).get("recipientAccountId") || "");
    const body = String(forwardForm.dataset.messageBody || "").trim();
    const submitButton = qs('button[type="submit"]', forwardForm);

    if (forwardStatus) forwardStatus.textContent = "";
    if (!recipientAccountId || !body) {
      if (forwardStatus) forwardStatus.textContent = "Choose who should receive this message.";
      return;
    }

    submitButton.disabled = true;
    try {
      await sendMessage({ recipientAccountId, body, successMessage: "Message forwarded" });
      closeForwardModal();
    } catch (error) {
      if (forwardStatus) forwardStatus.textContent = error.message;
      submitButton.disabled = false;
    }
  });

  qsa("[data-delete-message]", root).forEach((button) => {
    button.addEventListener("click", async () => {
      const row = messageRowForAction(button);
      const messageIds = messageIdsForRow(row);
      closeMessageMenus();
      if (!messageIds.length || !await confirmActionDialog({
        title: "Delete this message?",
        message: "This removes the message from your conversation only. Other recipients will still see it.",
        confirmLabel: "Delete",
        tone: "danger"
      })) return;

      try {
        if (isBackendConfigured()) {
          const workspace = await deleteWorkspaceMessages({
            clientId: store.getState().client?.id,
            messageIds
          });
          store.dispatch({ type: "SET_WORKSPACE", ...workspace, message: "Message deleted" });
        } else {
          store.dispatch({ type: "DELETE_MESSAGES_FOR_ME", messageIds, message: "Message deleted" });
        }
      } catch (error) {
        if (status) status.textContent = error.message;
      }
    }, { signal });
  });

  qsa("[data-unsend-message]", root).forEach((button) => {
    button.addEventListener("click", async () => {
      const row = messageRowForAction(button);
      const messageIds = messageIdsForRow(row);
      closeMessageMenus();
      if (!messageIds.length || !await confirmActionDialog({
        title: "Unsend this message?",
        message: "This permanently removes the message for you and every recipient.",
        confirmLabel: "Unsend",
        tone: "danger"
      })) return;

      try {
        if (isBackendConfigured()) {
          const workspace = await deleteWorkspaceMessages({
            clientId: store.getState().client?.id,
            messageIds,
            unsend: true
          });
          store.dispatch({ type: "SET_WORKSPACE", ...workspace, message: "Message unsent" });
        } else {
          store.dispatch({ type: "UNSEND_MESSAGES", messageIds, message: "Message unsent" });
        }
      } catch (error) {
        if (status) status.textContent = error.message;
      }
    }, { signal });
  });

  qs("[data-clear-message-conversation]", root)?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const allStaff = button.dataset.allStaff === "true";
    if (!activeConversationId || !await confirmActionDialog({
      title: "Clear this conversation?",
      message: "This removes every message in this conversation from your view only. It does not clear anyone else’s messages.",
      confirmLabel: "Clear messages",
      tone: "danger"
    })) return;

    button.disabled = true;
    try {
      if (isBackendConfigured()) {
        const workspace = await clearWorkspaceConversation({
          clientId: store.getState().client?.id,
          peerAccountId: allStaff ? "" : activeConversationId,
          allStaff
        });
        store.dispatch({ type: "SET_WORKSPACE", ...workspace, message: "Conversation cleared" });
      } else {
        store.dispatch({
          type: "CLEAR_MESSAGE_CONVERSATION",
          peerAccountId: allStaff ? "" : activeConversationId,
          allStaff,
          message: "Conversation cleared"
        });
      }
    } catch (error) {
      if (status) status.textContent = error.message;
      button.disabled = false;
    }
  }, { signal });

  composer?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form?.requestSubmit();
    }
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const recipientAccountId = String(form.dataset.recipientAccountId || "");
    const body = String(new FormData(form).get("body") || "").trim();
    const submitButton = qs('button[type="submit"]', form);

    if (status) status.textContent = "";

    if (!recipientAccountId || !body) {
      if (status) status.textContent = "Type a message before sending.";
      return;
    }

    submitButton.disabled = true;

    try {
      await sendMessage({ recipientAccountId, body });
    } catch (error) {
      if (status) status.textContent = error.message;
      submitButton.disabled = false;
    }
  });
}
