import { textButton } from "../ui/components.js";
import { icon } from "../ui/icons.js";

export function renderBackendSetup() {
  return `
    <section class="view connection-view">
      <section class="panel connection-card" role="alert" aria-labelledby="connection-status-title">
        <span class="connection-status-icon" aria-hidden="true">${icon("alert")}</span>
        <div>
          <h1 id="connection-status-title">No connection</h1>
          <p>Check your connection and try again.</p>
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
