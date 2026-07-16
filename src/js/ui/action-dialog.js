import { escapeHtml } from "./dom.js";
import { icon } from "./icons.js";

let closeActiveDialog = null;

function dialogControl({ inputType, label, placeholder, initialValue, min, step, maxLength }) {
  if (!inputType) return "";
  const common = `name="actionValue" placeholder="${escapeHtml(placeholder || "")}" required`;

  if (inputType === "textarea") {
    return `
      <label class="field action-dialog-field">
        <span>${escapeHtml(label || "Reason")}</span>
        <textarea ${common} rows="4" maxlength="${escapeHtml(maxLength || 500)}">${escapeHtml(initialValue || "")}</textarea>
      </label>
    `;
  }

  return `
    <label class="field action-dialog-field">
      <span>${escapeHtml(label || "Value")}</span>
      <input ${common} type="${escapeHtml(inputType)}" value="${escapeHtml(initialValue || "")}" ${min !== undefined ? `min="${escapeHtml(min)}"` : ""} ${step !== undefined ? `step="${escapeHtml(step)}"` : ""}>
    </label>
  `;
}

function openActionDialog({
  title,
  message,
  label,
  placeholder,
  initialValue = "",
  inputType = "",
  min,
  step,
  maxLength = 500,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  validationMessage = "Please complete the required field"
}) {
  closeActiveDialog?.(null, false);

  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const backdrop = document.createElement("div");
    const titleId = `action-dialog-title-${Date.now()}`;
    const messageId = `action-dialog-message-${Date.now()}`;
    const confirmClass = tone === "danger" ? "warning" : "primary";
    backdrop.className = "stock-modal-backdrop action-dialog-backdrop";
    backdrop.innerHTML = `
      <section class="stock-modal action-dialog action-dialog-${escapeHtml(tone)}" role="alertdialog" aria-modal="true" aria-labelledby="${titleId}" aria-describedby="${messageId}">
        <header class="stock-modal-header action-dialog-header">
          <div class="action-dialog-heading">
            <span class="action-dialog-icon">${icon(tone === "danger" ? "alert" : "check")}</span>
            <div>
              <span class="eyebrow">Confirmation required</span>
              <h2 id="${titleId}">${escapeHtml(title || "Confirm action")}</h2>
            </div>
          </div>
          <button class="icon-button action-dialog-close" type="button" title="Close" aria-label="Close">${icon("x")}</button>
        </header>
        <p class="action-dialog-message" id="${messageId}">${escapeHtml(message || "Please confirm that you want to continue.")}</p>
        <form class="action-dialog-form" novalidate>
          ${dialogControl({ inputType, label, placeholder, initialValue, min, step, maxLength })}
          <span class="field-error action-dialog-error" role="alert" aria-live="polite"></span>
          <div class="action-dialog-actions">
            <button class="button subtle action-dialog-cancel" type="button"><span>${escapeHtml(cancelLabel)}</span></button>
            <button class="button ${confirmClass}" type="submit"><span>${escapeHtml(confirmLabel)}</span></button>
          </div>
        </form>
      </section>
    `;

    let settled = false;
    const finish = (value, restoreFocus = true) => {
      if (settled) return;
      settled = true;
      backdrop.remove();
      document.removeEventListener("keydown", handleKeydown, true);
      if (closeActiveDialog === finish) closeActiveDialog = null;
      if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      resolve(value);
    };

    function handleKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...backdrop.querySelectorAll("button:not([disabled]), textarea:not([disabled]), input:not([disabled])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    closeActiveDialog = finish;
    document.body.appendChild(backdrop);
    document.addEventListener("keydown", handleKeydown, true);

    const form = backdrop.querySelector(".action-dialog-form");
    const control = form.elements.actionValue;
    const error = backdrop.querySelector(".action-dialog-error");
    const cancel = backdrop.querySelector(".action-dialog-cancel");

    const clearError = () => {
      error.textContent = "";
      control?.classList.remove("is-required-invalid");
      control?.removeAttribute("aria-invalid");
    };
    control?.addEventListener("input", clearError);
    cancel.addEventListener("click", () => finish(null));
    backdrop.querySelector(".action-dialog-close").addEventListener("click", () => finish(null));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) finish(null);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!control) {
        finish(true);
        return;
      }

      const value = String(control.value || "").trim();
      if (!value || !control.checkValidity()) {
        error.textContent = validationMessage;
        control.classList.add("is-required-invalid");
        control.setAttribute("aria-invalid", "true");
        control.focus();
        return;
      }
      finish(value);
    });

    window.requestAnimationFrame(() => (control || cancel).focus());
  });
}

export function requestTextDialog(options) {
  return openActionDialog({
    inputType: "textarea",
    label: "Reason",
    placeholder: "Enter a clear reason",
    confirmLabel: "Submit reason",
    tone: "danger",
    ...options
  });
}

export async function confirmActionDialog(options) {
  return (await openActionDialog(options)) === true;
}

export function requestNumberDialog(options) {
  return openActionDialog({
    inputType: "number",
    label: "Quantity",
    min: "0.01",
    step: "0.01",
    confirmLabel: "Continue",
    validationMessage: "Enter a valid quantity greater than zero",
    ...options
  });
}
