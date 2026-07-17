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
  loadWorkspace,
  markWorkspaceConversationRead,
  sendWorkspaceMessage
} from "../services/backend.js";
import { isBackendConfigured } from "../services/supabase-client.js";
import { roleLabel } from "../services/rbac.js";
import { escapeHtml, qs } from "../ui/dom.js";

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
      return;
    }

    broadcasts.set(key, {
      ...message,
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

  return `
    <article
      class="message-thread-bubble ${isSent ? "is-sent" : "is-received"}${!isSent && !message.readAt ? " is-unread" : ""}"
      data-message-row
      data-search-index="${escapeHtml(`${message.body} ${message.fromName} ${message.toName}`.toLowerCase())}"
    >
      <div class="message-bubble-body">
        ${isSent && message.audience === "all_staff" ? '<span class="message-broadcast-label">To: All staff</span>' : ""}
        <p>${escapeHtml(message.body)}</p>
        <time>${escapeHtml(relativeTime(message.createdAt))}</time>
      </div>
    </article>
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
        <div>
          <strong>${escapeHtml(name)}</strong>
          <span>${escapeHtml(role)}</span>
        </div>
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
        store.dispatch({ type: "SET_WORKSPACE", ...workspace });
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

  if (thread) thread.scrollTop = thread.scrollHeight;
  syncMessagesInBackground({ store, signal });

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
          message: sendToAllStaff ? "Message sent to all staff" : "Message sent"
        });
      } else {
        store.dispatch({
          type: "SEND_MESSAGE",
          recipientAccountId,
          sendToAllStaff,
          body,
          message: sendToAllStaff ? "Message sent to all staff" : "Message sent"
        });
      }
    } catch (error) {
      if (status) status.textContent = error.message;
      submitButton.disabled = false;
    }
  });
}
