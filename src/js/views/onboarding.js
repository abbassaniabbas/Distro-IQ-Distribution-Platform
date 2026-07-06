import {
  CURRENCY_OPTIONS,
  TIMEZONE_OPTIONS,
  validateClientForm
} from "../services/tenant.js";
import {
  DEFAULT_BRAND_COLOR,
  LOGO_ACCEPT,
  LOGO_HELP_TEXT,
  getBrandColor,
  normalizeBrandColor,
  readLogoFile,
  validateLogoFile
} from "../services/branding.js";
import { createWorkspace } from "../services/backend.js";
import { isBackendConfigured } from "../services/supabase-client.js";
import { escapeHtml, qs } from "../ui/dom.js";
import { bindBrandColorInputs } from "../ui/brand-controls.js";
import { renderDeliveryNotePreview } from "../ui/brand-preview.js";
import { icon } from "../ui/icons.js";
import { panelHeader, textButton } from "../ui/components.js";

function companyInitials(companyName) {
  return (companyName || "DI")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function renderLogo(client) {
  if (client?.logoDataUrl) {
    return `<img src="${client.logoDataUrl}" alt="${escapeHtml(client.companyName)} logo">`;
  }

  return escapeHtml(companyInitials(client?.companyName));
}

function renderFieldError(name, errors = {}) {
  return `<span class="field-error" data-error-for="${escapeHtml(name)}">${escapeHtml(errors[name] || "")}</span>`;
}

function renderSelectOptions(options, selectedValue) {
  return options
    .map((option) => {
      const value = typeof option === "string" ? option : option.value;
      const label = typeof option === "string" ? option : option.label;

      return `<option value="${escapeHtml(value)}" ${value === selectedValue ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function collectClientForm(form, logoDataUrl) {
  const formData = new FormData(form);

  return {
    companyName: formData.get("companyName") || "",
    timezone: formData.get("timezone") || "",
    currency: formData.get("currency") || "",
    brandColor: normalizeBrandColor(formData.get("brandColor") || DEFAULT_BRAND_COLOR),
    logoDataUrl
  };
}

function writeErrors(form, errors) {
  form.querySelectorAll("[data-error-for]").forEach((target) => {
    target.textContent = errors[target.dataset.errorFor] || "";
  });
}

export function renderOnboarding({ state }) {
  if (state.client?.id) {
    return renderOnboardingConfirmation({ state });
  }

  return `
    <section class="view onboarding-view">
      <div class="onboarding-layout">
        <section class="panel setup-card">
          ${panelHeader("Create factory workspace", "Set the details your team will see in DistroIQ")}
          <div class="logo-preview" id="logo-preview" aria-label="Factory logo preview">${renderLogo(null)}</div>
          <p>
            Add your factory details once, then invite managers, store keepers, and sales representatives into one connected system.
          </p>
          <div class="client-id-box">
            <span class="eyebrow">Factory workspace</span>
            <strong>You start as CEO</strong>
            <span class="muted">After setup, invite Managers, Sales Representatives, Store Keepers, and Accountants.</span>
          </div>
        </section>

        <section class="panel">
          ${panelHeader("Onboarding", "Factory name, logo, timezone, and currency")}
          <form id="onboarding-form" class="form-grid" novalidate>
            <label class="field span-full">
              <span>Factory name</span>
              <input name="companyName" autocomplete="organization" placeholder="Example Snacks Factory Ltd">
              ${renderFieldError("companyName")}
            </label>

            <label class="field">
              <span>Timezone</span>
              <select name="timezone">
                ${renderSelectOptions(TIMEZONE_OPTIONS, "Africa/Lagos")}
              </select>
              ${renderFieldError("timezone")}
            </label>

            <label class="field">
              <span>Currency</span>
              <select name="currency">
                ${renderSelectOptions(CURRENCY_OPTIONS, "NGN")}
              </select>
              ${renderFieldError("currency")}
            </label>

            <label class="field span-full">
              <span>Brand colour</span>
              <div class="color-field">
                <input class="color-swatch-input" name="brandColorPicker" type="color" value="${escapeHtml(DEFAULT_BRAND_COLOR)}" data-brand-color-picker>
                <input name="brandColor" value="${escapeHtml(DEFAULT_BRAND_COLOR)}" maxlength="7" placeholder="#0B1F3A" data-brand-color-input>
              </div>
              ${renderFieldError("brandColor")}
            </label>

            <div class="field span-full file-field" id="logo-upload-field">
              <span>Factory logo</span>
              <div class="file-upload-row">
                <input class="file-input sr-only" id="company-logo-input" name="logo" type="file" accept="${LOGO_ACCEPT}">
                <label class="file-dropzone" for="company-logo-input">
                  <span class="file-upload-icon">${icon("upload")}</span>
                  <span class="file-upload-copy">
                    <strong id="logo-upload-title">Choose logo file</strong>
                    <small id="logo-file-name">${escapeHtml(LOGO_HELP_TEXT)}</small>
                  </span>
                  <span class="file-upload-action">Browse</span>
                </label>
                <button class="icon-button clear-file-button" id="clear-logo-file" type="button" title="Clear selected logo" aria-label="Clear selected logo" hidden>
                  ${icon("x")}
                </button>
              </div>
              ${renderFieldError("logo")}
            </div>

            <div class="span-full split">
              <span class="muted">These settings can be changed later from Settings.</span>
              ${textButton({
                iconName: "building",
                label: "Create factory",
                className: "primary",
                type: "submit"
              })}
            </div>
            <span id="onboarding-message" class="field-error span-full"></span>
          </form>
        </section>
      </div>
    </section>
  `;
}

export function bindOnboarding({ root, store }) {
  const form = qs("#onboarding-form", root);
  if (!form) return;

  const logoInput = qs('input[name="logo"]', form);
  const logoPreview = qs("#logo-preview", root);
  const logoUploadField = qs("#logo-upload-field", form);
  const logoUploadTitle = qs("#logo-upload-title", form);
  const logoFileName = qs("#logo-file-name", form);
  const clearLogoButton = qs("#clear-logo-file", form);
  let logoDataUrl = "";

  bindBrandColorInputs(form);

  function setLogoUploadState({ fileName = "", error = "" } = {}) {
    logoUploadField.classList.toggle("has-file", Boolean(fileName));
    logoUploadField.classList.toggle("has-error", Boolean(error));
    logoUploadTitle.textContent = fileName ? "Logo selected" : "Choose logo file";
    logoFileName.textContent = fileName || LOGO_HELP_TEXT;
    clearLogoButton.hidden = !fileName;
  }

  function clearLogoSelection() {
    logoInput.value = "";
    logoDataUrl = "";
    logoPreview.textContent = "DI";
    setLogoUploadState();
  }

  logoInput.addEventListener("change", async () => {
    const file = logoInput.files?.[0];
    writeErrors(form, {});
    logoUploadField.classList.remove("has-error");

    if (!file) {
      clearLogoSelection();
      return;
    }

    const fileError = validateLogoFile(file);

    if (fileError) {
      clearLogoSelection();
      writeErrors(form, {
        logo: fileError
      });
      setLogoUploadState({
        error: fileError
      });
      return;
    }

    try {
      logoDataUrl = await readLogoFile(file);
      logoPreview.innerHTML = `<img src="${logoDataUrl}" alt="">`;
      setLogoUploadState({
        fileName: file.name
      });
    } catch (error) {
      clearLogoSelection();
      writeErrors(form, {
        logo: error.message
      });
      setLogoUploadState({
        error: error.message
      });
    }
  });

  clearLogoButton.addEventListener("click", () => {
    writeErrors(form, {});
    clearLogoSelection();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = collectClientForm(form, logoDataUrl);
    const errors = validateClientForm(values);
    const submitButton = qs('button[type="submit"]', form);
    const message = qs("#onboarding-message", form);

    writeErrors(form, errors);
    message.textContent = "";

    if (Object.keys(errors).length) return;

    submitButton.disabled = true;

    try {
      if (isBackendConfigured()) {
        const workspace = await createWorkspace(values);
        store.dispatch({
          type: "SET_WORKSPACE",
          ...workspace,
          message: "Factory workspace created"
        });
      } else {
        store.dispatch({
          type: "CREATE_CLIENT",
          payload: values,
          message: "Factory workspace created"
        });
      }

      window.location.hash = "#/onboarding-confirmation";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });
}

export function renderOnboardingConfirmation({ state }) {
  const client = state.client;
  const previewClient = {
    ...client,
    brandColor: getBrandColor(client)
  };

  if (!client?.id) {
    return renderOnboarding({ state });
  }

  return `
    <section class="view onboarding-confirmation-view">
      <div class="onboarding-layout">
        <section class="panel setup-card">
          ${panelHeader("Factory created", "Your workspace is ready")}
          <div class="logo-preview" aria-label="Factory logo">${renderLogo(client)}</div>
          <div>
            <h2>${escapeHtml(client.companyName)}</h2>
            <p>${escapeHtml(client.timezone)} · ${escapeHtml(client.currencySymbol)} ${escapeHtml(client.currency)}</p>
          </div>
          <div class="client-id-box">
            <span class="eyebrow">Next step</span>
            <strong>Invite your team</strong>
            <span class="muted">As CEO, add Managers, Sales Representatives, Store Keepers, and Accountants when you are ready.</span>
          </div>
        </section>

        <section class="panel setup-card">
          ${icon("check", "metric-icon")}
          <div>
            <h2>Setup confirmed</h2>
            <p>
              Representative stock, sales orders, returns, and owed balances will be organized under ${escapeHtml(client.companyName)}.
            </p>
          </div>
          <div class="toolbar-group">
            <a class="button primary" href="#/team">${icon("team")}<span>Add team accounts</span></a>
            <a class="button" href="#/dashboard">${icon("dashboard")}<span>Open dashboard</span></a>
          </div>
        </section>

        <section class="panel setup-card">
          ${panelHeader("Saved delivery note preview", "Branding applied to a sample document")}
          ${renderDeliveryNotePreview(previewClient)}
        </section>
      </div>
    </section>
  `;
}

export function bindOnboardingConfirmation() {}
