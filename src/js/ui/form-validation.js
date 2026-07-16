const DRAFT_PREFIX = "distroiq-form-draft";
const DRAFT_TTL_MS = 30 * 60 * 1000;
const SENSITIVE_FORM_PATTERN = /(auth|login|signup|password|delete|reset)/i;
const SENSITIVE_CONTROL_PATTERN = /(password|temporaryPassword|token|secret)/i;
const inMemorySensitiveDrafts = new Map();
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

function submitActionGroup(form) {
  const submitter = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
  if (!submitter) return null;
  return submitter.closest(".manager-form-actions, .form-actions, [data-form-actions]") || submitter.parentElement;
}

function formAlert(form) {
  let alert = form.querySelector("[data-required-form-alert]");
  if (!alert) {
    alert = document.createElement("div");
    alert.className = "required-form-alert";
    alert.dataset.requiredFormAlert = "true";
    alert.setAttribute("role", "alert");
    const actionGroup = submitActionGroup(form);
    if (actionGroup) {
      alert.classList.add("required-form-alert-inline");
      actionGroup.append(alert);
    } else {
      alert.classList.add("span-full");
      form.append(alert);
    }
  }
  return alert;
}

function draftStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function purgeExpiredDrafts(storage) {
  if (!storage) return;
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key) => String(key || "").startsWith(`${DRAFT_PREFIX}:`));

  keys.forEach((key) => {
    try {
      const draft = JSON.parse(storage.getItem(key) || "null");
      if (!draft?.expiresAt || Number(draft.expiresAt) <= Date.now()) storage.removeItem(key);
    } catch {
      storage.removeItem(key);
    }
  });
}

export function clearAllFormDrafts() {
  const storage = draftStorage();
  if (storage) {
    Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key) => String(key || "").startsWith(`${DRAFT_PREFIX}:`))
      .forEach((key) => storage.removeItem(key));
  }
  inMemorySensitiveDrafts.clear();
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
  storage.setItem(draftKey(form, scope), JSON.stringify({
    savedAt: Date.now(),
    expiresAt: Date.now() + DRAFT_TTL_MS,
    values
  }));
}

function clearDraft(form, scope) {
  draftStorage()?.removeItem(draftKey(form, scope));
}

function restoreDraft(form, scope) {
  const storage = draftStorage();
  if (!storage || !canPersistForm(form)) return;

  let draft;
  try {
    draft = JSON.parse(storage.getItem(draftKey(form, scope)) || "null");
  } catch {
    draft = null;
  }
  const values = draft?.values;
  if (!draft || Number(draft.expiresAt || 0) <= Date.now()) {
    clearDraft(form, scope);
    return;
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

function sensitiveDraftKey(form, scope) {
  return `${draftKey(form, scope)}:memory`;
}

function sensitiveDraftControls(form) {
  return [...form.elements].filter((control) => (
    control.name &&
    !control.disabled &&
    !["file", "hidden", "submit", "button"].includes(control.type)
  ));
}

function isSensitiveForm(form) {
  return Boolean(
    form.id &&
    (SENSITIVE_FORM_PATTERN.test(form.id) || form.querySelector('input[type="password"]'))
  );
}

export function captureInMemoryFormDrafts(root, { scope = "workspace" } = {}) {
  root.querySelectorAll("form").forEach((form) => {
    if (!isSensitiveForm(form)) return;
    const values = {};
    sensitiveDraftControls(form).forEach((control) => {
      if (control.type === "radio") {
        if (control.checked) values[control.name] = control.value;
        return;
      }
      values[control.name] = control.type === "checkbox" ? control.checked : control.value;
    });
    inMemorySensitiveDrafts.set(sensitiveDraftKey(form, scope), {
      expiresAt: Date.now() + DRAFT_TTL_MS,
      values
    });
  });
}

function restoreInMemoryDraft(form, scope) {
  if (!isSensitiveForm(form)) return;
  const key = sensitiveDraftKey(form, scope);
  const draft = inMemorySensitiveDrafts.get(key);
  if (!draft) return;
  if (Number(draft.expiresAt || 0) <= Date.now()) {
    inMemorySensitiveDrafts.delete(key);
    return;
  }

  sensitiveDraftControls(form).forEach((control) => {
    if (!Object.prototype.hasOwnProperty.call(draft.values, control.name)) return;
    if (control.type === "radio") control.checked = control.value === draft.values[control.name];
    else if (control.type === "checkbox") control.checked = Boolean(draft.values[control.name]);
    else control.value = String(draft.values[control.name] ?? "");
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

export function bindRequiredFieldValidation(root, { scope = "workspace" } = {}) {
  purgeExpiredDrafts(draftStorage());
  root.querySelectorAll("form").forEach((form) => {
    form.noValidate = true;
    restoreDraft(form, scope);
    restoreInMemoryDraft(form, scope);

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
          form.querySelector("[data-required-form-alert]")?.remove();
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
