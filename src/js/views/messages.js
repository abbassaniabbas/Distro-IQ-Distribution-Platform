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
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { metricCard, panelHeader } from "../ui/components.js";

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

function messageSearchIndex(message, direction) {
  return [
    direction,
    message.fromName,
    message.fromEmail,
    message.toName,
    message.toEmail,
    roleLabel(message.fromRole),
    roleLabel(message.toRole),
    message.body
  ].join(" ").toLowerCase();
}

function messageCard(message, direction) {
  const isSent = direction === "sent";
  const name = isSent ? message.toName : message.fromName;
  const email = isSent ? message.toEmail : message.fromEmail;
  const role = isSent ? message.toRole : message.fromRole;
  const label = isSent ? "Sent to" : "From";
  const unreadClass = !isSent && !message.readAt ? " is-unread" : "";

  return `
    <article
      class="message-history-card${unreadClass}"
      data-message-row
      data-direction="${escapeHtml(direction)}"
      data-search-index="${escapeHtml(messageSearchIndex(message, direction))}"
    >
      <div class="communication-avatar">${escapeHtml(initials(name || email))}</div>
      <div class="message-history-body">
        <header>
          <div>
            <strong>${escapeHtml(name || "Team member")}</strong>
            <span>${escapeHtml(label)} ${escapeHtml(roleLabel(role))}</span>
          </div>
          <time>${escapeHtml(relativeTime(message.createdAt))}</time>
        </header>
        <p>${escapeHtml(message.body)}</p>
      </div>
    </article>
  `;
}

function renderMessageColumn(title, messages, direction) {
  return `
    <section class="panel message-history-panel">
      ${panelHeader(title, "")}
      <div class="message-history-list">
        ${messages.length
          ? messages.map((message) => messageCard(message, direction)).join("")
          : `<div class="empty-state">No ${escapeHtml(direction)} messages yet</div>`}
      </div>
    </section>
  `;
}

export function renderMessages({ state }) {
  const received = receivedMessages(state);
  const sent = sentMessages(state);
  const unread = received.filter((message) => !message.readAt).length;
  const recipients = recipientOptions(state);

  return `
    <section class="view messages-view">
      <div class="metric-grid">
        ${metricCard({
          label: "Unread",
          value: String(unread),
          meta: "New messages",
          iconName: "message"
        })}
        ${metricCard({
          label: "Inbox",
          value: String(received.length),
          meta: "Received messages",
          iconName: "mail"
        })}
        ${metricCard({
          label: "Sent",
          value: String(sent.length),
          meta: "Outgoing messages",
          iconName: "arrowRight"
        })}
      </div>

      <section class="panel message-compose-panel">
        ${panelHeader("Quick message", "Send a short internal update to staff in this company")}
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

      <div class="toolbar message-history-toolbar">
        <div class="toolbar-group" role="group" aria-label="Message filters">
          <button class="button subtle is-active" type="button" data-message-filter="all">All</button>
          <button class="button subtle" type="button" data-message-filter="received">Received</button>
          <button class="button subtle" type="button" data-message-filter="sent">Sent</button>
        </div>
      </div>

      <div class="messages-layout">
        ${renderMessageColumn("Received", received, "received")}
        ${renderMessageColumn("Sent", sent, "sent")}
      </div>
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
  const filterButtons = qsa("[data-message-filter]", root);
  const messageRows = qsa("[data-message-row]", root);
  const globalSearch = qs("#global-search", document);
  let activeFilter = "all";

  function applyFilter() {
    const query = String(globalSearch?.value || "").trim().toLowerCase();

    messageRows.forEach((row) => {
      const filterMatches = activeFilter === "all" || row.dataset.direction === activeFilter;
      const searchMatches = !query || String(row.dataset.searchIndex || "").includes(query);

      row.hidden = !filterMatches || !searchMatches;
    });
    filterButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.messageFilter === activeFilter);
    });
  }

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.messageFilter || "all";
      applyFilter();
    });
  });
  globalSearch?.addEventListener("input", applyFilter);

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
