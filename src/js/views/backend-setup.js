import { textButton } from "../ui/components.js";
import { escapeHtml } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { classifyAppFailure } from "../services/error-classification.js";

export function renderBackendSetup({ state } = {}) {
  const failure = classifyAppFailure({
    error: state?.backend?.error || "",
    configured: state?.backend?.configured !== false
  });

  return `
    <section class="view connection-view">
      <section class="panel connection-card is-${escapeHtml(failure.category)}" role="alert" aria-labelledby="connection-status-title">
        <span class="connection-status-icon" aria-hidden="true">${icon("alert")}</span>
        <div>
          <span class="connection-error-label">${escapeHtml(failure.label)}</span>
          <h1 id="connection-status-title">${escapeHtml(failure.title)}</h1>
          <p>${escapeHtml(failure.message)}</p>
          ${failure.detail ? `
            <details class="connection-error-details">
              <summary>Error details</summary>
              <code>${escapeHtml(failure.detail)}</code>
            </details>
          ` : ""}
        </div>
        ${textButton({ iconName: "refresh", label: "Try again", className: "primary", data: { "retry-workspace": "true" } })}
      </section>
    </section>
  `;
}

export function bindBackendSetup({ root }) {
  root.querySelector("[data-retry-workspace]")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.querySelector("span").textContent = "Connecting…";
    window.location.reload();
  });
}
