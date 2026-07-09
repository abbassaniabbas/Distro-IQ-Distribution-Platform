import {
  canSendToAllStaff,
  getUnreadMessageCount,
  initials,
  messageRecipients,
  receivedMessages,
  recipientLabel,
  relativeTime,
  sentMessages
} from "../services/messages.js";
import { roleLabel } from "../services/rbac.js";
import { escapeHtml, qs } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { panelHeader } from "../ui/components.js";

function recipientOptions(state) {
  const recipients = messageRecipients(state);
  const allStaffOption = canSendToAllStaff(state) && recipients.length
    ? '<option value="__all_staff__">All staff</option>'
    : "";
  const staffOptions = recipients.map((account) => `
    <option value="${escapeHtml(account.id)}">${escapeHtml(recipientLabel(account))}</option>
  `).join("");

  return `${allStaffOption}${staffOptions}`;
}

function combinedMessages(state) {
  return [
    ...receivedMessages(state).map((message) => ({ ...message, direction: "received" })),
    ...sentMessages(state).map((message) => ({ ...message, direction: "sent" }))
  ].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}

function messageSearchIndex(message) {
  return [
    message.direction,
    message.fromName,
    message.fromEmail,
    message.toName,
    message.toEmail,
    roleLabel(message.fromRole),
    roleLabel(message.toRole),
    message.body
  ].join(" ").toLowerCase();
}

function messageBubble(message) {
  const isSent = message.direction === "sent";
  const name = isSent ? message.toName : message.fromName;
  const email = isSent ? message.toEmail : message.fromEmail;
  const role = isSent ? message.toRole : message.fromRole;
  const label = isSent ? "To" : "From";
  const unreadClass = !isSent && !message.readAt ? " is-unread" : "";

  return `
    <article
      class="message-thread-bubble ${isSent ? "is-sent" : "is-received"}${unreadClass}"
      data-message-row
      data-direction="${escapeHtml(message.direction)}"
      data-search-index="${escapeHtml(messageSearchIndex(message))}"
    >
      ${isSent ? "" : `<div class="communication-avatar">${escapeHtml(initials(name || email))}</div>`}
      <div class="message-bubble-body">
        <header>
          <div>
            <strong>${escapeHtml(isSent ? "You" : (name || "Team member"))}</strong>
            <span>${escapeHtml(label)} ${escapeHtml(roleLabel(role))}</span>
          </div>
          <time>${escapeHtml(relativeTime(message.createdAt))}</time>
        </header>
        <p>${escapeHtml(message.body)}</p>
      </div>
    </article>
  `;
}

export function renderMessages({ state }) {
  const received = receivedMessages(state);
  const sent = sentMessages(state);
  const history = combinedMessages(state);
  const unread = received.filter((message) => !message.readAt).length;
  const recipients = recipientOptions(state);

  return `
    <section class="view messages-view">
      <section class="panel message-compose-panel">
        ${panelHeader("Messages", `${unread} unread - ${received.length} received - ${sent.length} sent`)}
        <form id="message-page-form" class="message-page-compose" novalidate>
          <label class="field">
            <span>Send to</span>
            <select name="recipientAccountId" required ${recipients ? "" : "disabled"}>
              <option value="">Choose staff member</option>
              ${recipients}
            </select>
          </label>
          <label class="field message-page-body-field">
            <span>Message</span>
            <textarea name="body" rows="3" maxlength="800" placeholder="Type your message" required ${recipients ? "" : "disabled"}></textarea>
          </label>
          <div class="message-page-actions">
            <span id="message-page-status" class="field-error"></span>
            <button class="button primary" type="submit" ${recipients ? "" : "disabled"}>
              ${icon("message")}
              <span>Send</span>
            </button>
          </div>
        </form>
      </section>

      <section class="panel message-conversation-panel">
        ${panelHeader("Conversation history", "Sent and received messages in one place")}
        <div class="message-thread" data-message-thread>
          ${history.length
            ? history.map(messageBubble).join("")
            : '<div class="empty-state">No messages yet</div>'}
        </div>
      </section>
    </section>
  `;
}

export function bindMessages({ root, store }) {
  if (getUnreadMessageCount(store.getState())) {
    store.dispatch({ type: "MARK_MESSAGES_READ" });
    return;
  }

  const form = qs("#message-page-form", root);
  const status = qs("#message-page-status", root);
  const thread = qs("[data-message-thread]", root);

  if (thread) {
    thread.scrollTop = thread.scrollHeight;
  }

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const recipientAccountId = String(formData.get("recipientAccountId") || "");
    const body = String(formData.get("body") || "").trim();

    if (status) status.textContent = "";

    if (!recipientAccountId || !body) {
      if (status) status.textContent = "Choose who should receive it and type a message.";
      return;
    }

    store.dispatch({
      type: "SEND_MESSAGE",
      recipientAccountId,
      sendToAllStaff: recipientAccountId === "__all_staff__",
      body,
      message: recipientAccountId === "__all_staff__" ? "Message sent to all staff" : "Message sent"
    });
  });
}
