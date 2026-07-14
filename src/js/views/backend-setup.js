import { textButton, panelHeader } from "../ui/components.js";

export function renderBackendSetup({ state }) {
  const error = state.backend?.error;

  return `
    <section class="view">
      <section class="panel setup-card">
        ${panelHeader("Setup required", "Your company sign-in is not ready yet")}
        ${error ? '<div class="field-error">We could not open the workspace connection. Please ask an administrator to check setup.</div>' : ""}
        <div class="client-id-box">
          <span class="eyebrow">What to do next</span>
          <strong>Finish workspace connection</strong>
        </div>
        <div class="stack">
          <p>An administrator needs to complete the secure sign-in setup before users can continue.</p>
          <p>Setup instructions are available in the project README.</p>
          ${error ? textButton({ iconName: "refresh", label: "Try again", className: "primary", data: { "retry-workspace": "true" } }) : ""}
        </div>
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
