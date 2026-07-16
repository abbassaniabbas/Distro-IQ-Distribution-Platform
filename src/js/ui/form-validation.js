const DRAFT_PREFIX = "distroiq-form-draft";
const SENSITIVE_FORM_PATTERN = /(auth|login|signup|password|delete|reset)/i;
const SENSITIVE_CONTROL_PATTERN = /(password|temporaryPassword|token|secret)/i;
export const REQUIRED_FORM_ALERT_MESSAGE = "Please complete the required fields";

function requiredControls(form) {
  return [...form.querySelectorAll("[required]")].filter((control) => (
    !control.disabled
    && control.type !== "hidden"
    && !control.closest("[hidden]")
  ));
}

function fieldContainer(control) {
  return control.closest(".field, .auth-field") || control.parentElement;
}

function clearControlError(control) {
  control.classList.remove("is-required-invalid");
  control.removeAttribute("aria-invalid");
  fieldContainer(control)?.classList.remove("has-required-error");
}

function markControlError(control) {
  control.classList.add("is-required-invalid");
  control.setAttribute("aria-invalid", "true");
  fieldContainer(control)?.classList.add("has-required-error");
}

function formAlert(form) {
  let alert = form.querySelector(":scope > [data-required-form-alert]");
  if (!alert) {
    alert = document.createElement("div");
    alert.className = "required-form-alert span-full";
    alert.dataset.requiredFormAlert = "true";
    alert.setAttribute("role", "alert");
    form.prepend(alert);
  }
  return alert;
}

function draftStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function canPersistForm(form) {
  return Boolean(form.id) && !SENSITIVE_FORM_PATTERN.test(form.id) && form.dataset.preserveDraft !== "false";
}

function draftKey(form, scope) {
  const route = String(window.location.hash || "#/dashboard").split("?")[0];
  return `${DRAFT_PREFIX}:${scope || "workspace"}:${route}:${form.id}`;
}

function draftControls(form) {
  return [...form.elements].filter((control) => (
    control.name
    && !control.disabled
    && !["file", "hidden", "password", "submit", "button"].includes(control.type)
    && !SENSITIVE_CONTROL_PATTERN.test(control.name)
  ));
}

function saveDraft(form, scope) {
  const storage = draftStorage();
  if (!storage || !canPersistForm(form)) return;

  const values = {};
  draftControls(form).forEach((control) => {
    if (control.type === "radio") {
      if (control.checked) values[control.name] = control.value;
      return;
    }
    values[control.name] = control.type === "checkbox" ? control.checked : control.value;
  });
  storage.setItem(draftKey(form, scope), JSON.stringify(values));
}

function clearDraft(form, scope) {
  draftStorage()?.removeItem(draftKey(form, scope));
}

function restoreDraft(form, scope) {
  const storage = draftStorage();
  if (!storage || !canPersistForm(form)) return;

  let values;
  try {
    values = JSON.parse(storage.getItem(draftKey(form, scope)) || "null");
  } catch {
    values = null;
  }
  if (!values || typeof values !== "object") return;

  draftControls(form).forEach((control) => {
    if (!Object.prototype.hasOwnProperty.call(values, control.name)) return;
    if (control.type === "radio") control.checked = control.value === values[control.name];
    else if (control.type === "checkbox") control.checked = Boolean(values[control.name]);
    else control.value = String(values[control.name] ?? "");
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

export function bindRequiredFieldValidation(root, { scope = "workspace" } = {}) {
  root.querySelectorAll("form").forEach((form) => {
    form.noValidate = true;
    restoreDraft(form, scope);

    form.addEventListener("submit", (event) => {
      const controls = requiredControls(form);
      const invalidControls = controls.filter((control) => !control.checkValidity());

      controls.forEach((control) => {
        if (invalidControls.includes(control)) markControlError(control);
        else clearControlError(control);
      });

      const alert = formAlert(form);
      if (!invalidControls.length) {
        alert.remove();
        clearDraft(form, scope);
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      form.classList.add("is-validation-attempted");
      alert.textContent = REQUIRED_FORM_ALERT_MESSAGE;
      invalidControls[0].focus({ preventScroll: true });
      invalidControls[0].scrollIntoView({ behavior: "smooth", block: "center" });
    }, true);

    requiredControls(form).forEach((control) => {
      const clearWhenValid = () => {
        if (control.checkValidity()) clearControlError(control);
        saveDraft(form, scope);
        if (requiredControls(form).every((item) => item.checkValidity())) {
          form.querySelector(":scope > [data-required-form-alert]")?.remove();
          form.classList.remove("is-validation-attempted");
        }
      };
      control.addEventListener("input", clearWhenValid);
      control.addEventListener("change", clearWhenValid);
    });

    draftControls(form).forEach((control) => {
      if (control.required) return;
      control.addEventListener("input", () => saveDraft(form, scope));
      control.addEventListener("change", () => saveDraft(form, scope));
    });

    form.addEventListener("reset", () => clearDraft(form, scope));
  });
}
