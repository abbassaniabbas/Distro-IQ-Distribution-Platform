import { panelHeader } from "../ui/components.js";

export function renderLoading({ state }) {
  return `
    <section class="view">
      <section class="panel setup-card">
        ${panelHeader("Loading workspace", "Getting your company tools ready")}
        <p>${state.backend?.error ? "We could not open your workspace. Please try again or ask an administrator for help." : "One moment."}</p>
      </section>
    </section>
  `;
}

export function bindLoading() {}
