import { escapeHtml } from "./dom.js";

export function staffInitials(name) {
  return String(name || "Staff")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "ST";
}

export function renderStaffAvatar(account, className = "team-member-avatar") {
  const staffImageUrl = String(account?.staffImageUrl || "").trim();
  const name = String(account?.name || "Staff member");

  return `<span class="${escapeHtml(className)}">${staffImageUrl
    ? `<img src="${escapeHtml(staffImageUrl)}" alt="${escapeHtml(name)}">`
    : escapeHtml(staffInitials(name))}</span>`;
}
