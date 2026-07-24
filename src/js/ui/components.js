import { escapeHtml } from "./dom.js";
import { icon } from "./icons.js";
import { formatPercent, statusClass, statusText } from "../services/formatters.js";

export function metricCard({ label, value, meta, iconName }) {
  return `
    <article class="metric-card">
      <header>
        <span class="eyebrow">${escapeHtml(label)}</span>
        <span class="metric-icon">${icon(iconName)}</span>
      </header>
      <div>
        <div class="metric-value">${escapeHtml(value)}</div>
        <div class="metric-meta">${escapeHtml(meta)}</div>
      </div>
    </article>
  `;
}

export function panelHeader(title, subtitle, action = "") {
  return `
    <div class="panel-header">
      <div class="panel-title">
        <h2>${escapeHtml(title)}</h2>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
      </div>
      ${action}
    </div>
  `;
}

export function statusPill(status) {
  return `<span class="status-pill ${statusClass(status)}">${escapeHtml(statusText(status))}</span>`;
}

export function progressBar(percent, tone = "good") {
  const safePercent = Math.max(0, Math.min(100, Number(percent || 0)));
  const toneClass = tone === "danger" || tone === "warning" ? tone : "";

  return `
    <div class="progress-track" aria-label="${formatPercent(safePercent)}">
      <div class="progress-fill ${toneClass}" style="width: ${safePercent}%"></div>
    </div>
  `;
}

export function iconButton({ iconName, label, className = "", disabled = false, data = {} }) {
  const dataAttributes = Object.entries(data)
    .map(([key, value]) => `data-${key}="${escapeHtml(value)}"`)
    .join(" ");

  return `
    <button class="icon-button ${className}" type="button" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" ${disabled ? "disabled" : ""} ${dataAttributes}>
      ${icon(iconName)}
    </button>
  `;
}

export function textButton({ iconName, label, className = "", disabled = false, type = "button", data = {} }) {
  const dataAttributes = Object.entries(data)
    .map(([key, value]) => `data-${key}="${escapeHtml(value)}"`)
    .join(" ");

  return `
    <button class="button ${className}" type="${escapeHtml(type)}" ${disabled ? "disabled" : ""} ${dataAttributes}>
      ${icon(iconName)}
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

export function table(headers, rows, emptyText = "No records found", { selectionScope = "" } = {}) {
  if (!rows.length) {
    return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  }

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            ${selectionScope ? `
              <th class="record-select-cell" data-export-ignore>
                <input type="checkbox" data-ceo-select-all="${escapeHtml(selectionScope)}" aria-label="Select or deselect every row">
              </th>
            ` : ""}
            ${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>
  `;
}
