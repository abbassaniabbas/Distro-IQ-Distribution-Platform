import { escapeHtml } from "./dom.js";
import { icon } from "./icons.js";

export function showToast(message) {
  const region = document.getElementById("toast-region");
  if (!region || !message) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `${icon("check")}<span>${escapeHtml(message)}</span>`;
  region.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3200);
}
