import { updateCurrentUserPassword, updateCurrentUserProfile } from "../services/auth.js";
import {
  deleteWorkspace,
  loadWorkspace,
  recordActivity,
  updateMyMembershipProfile,
  updateWorkspaceSettings
} from "../services/backend.js";
import {
  DEFAULT_BRAND_COLOR,
  LOGO_ACCEPT,
  LOGO_HELP_TEXT,
  readLogoFile,
  validateLogoFile
} from "../services/branding.js";
import { setCurrencySettings } from "../services/formatters.js";
import {
  CURRENCY_OPTIONS,
  TIMEZONE_OPTIONS,
  getScopedAccounts,
  validateClientForm
} from "../services/tenant.js";
import { currentUserPermissions, currentUserRole, roleDescription, roleLabel } from "../services/rbac.js";
import { isModuleEnabled } from "../services/features.js";
import { isBackendConfigured } from "../services/supabase-client.js";
import { escapeHtml, qs } from "../ui/dom.js";
import { renderDeliveryNotePreview } from "../ui/brand-preview.js";
import { icon } from "../ui/icons.js";
import { panelHeader, statusPill, textButton } from "../ui/components.js";

function getCurrentAccount(state) {
  return getScopedAccounts(state).find((account) => account.userId === state.user?.id);
}

function canEditCompanySettings(state) {
  return currentUserPermissions(state).canConfigureFactory;
}

function canDeleteFactoryAccount(state) {
  return currentUserRole(state) === "ceo";
}

function renderFieldError(name) {
  return `<span class="field-error" data-error-for="${escapeHtml(name)}"></span>`;
}

function writeErrors(form, errors) {
  form.querySelectorAll("[data-error-for]").forEach((target) => {
    target.textContent = errors[target.dataset.errorFor] || "";
  });
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

function collectCompanySettings(form, logoDataUrl) {
  const formData = new FormData(form);

  return {
    companyName: formData.get("companyName") || "",
    timezone: formData.get("timezone") || "",
    currency: formData.get("currency") || "",
    brandColor: DEFAULT_BRAND_COLOR,
    creditLimitEmailEnabled: formData.get("creditLimitEmailEnabled") === "on",
    creditLimitSmsEnabled: formData.get("creditLimitSmsEnabled") === "on",
    logoDataUrl
  };
}

function readProfileForm(form) {
  const formData = new FormData(form);

  return {
    name: String(formData.get("name") || "").trim()
  };
}

function renderCompanySettings(state, account) {
  const client = state.client;
  const canEdit = canEditCompanySettings(state);
  return `
    <section class="panel">
      ${panelHeader("Factory settings", "Shared settings your team sees across the app")}
      <form id="company-settings-form" class="form-grid" novalidate>
        <div class="span-full split settings-logo-row">
          <div class="logo-preview" id="settings-logo-preview" aria-label="Factory logo preview">${renderLogo(client)}</div>
          <div class="client-id-box">
            <span class="eyebrow">Active factory</span>
            <strong>${escapeHtml(client.companyName)}</strong>
            <span class="muted">Logo, timezone, and currency apply for the whole team.</span>
          </div>
        </div>

        <label class="field span-full">
          <span>Factory name</span>
          <input name="companyName" value="${escapeHtml(client.companyName)}" ${canEdit ? "" : "disabled"}>
          ${renderFieldError("companyName")}
        </label>

        <label class="field">
          <span>Timezone</span>
          <select name="timezone" ${canEdit ? "" : "disabled"}>
            ${renderSelectOptions(TIMEZONE_OPTIONS, client.timezone)}
          </select>
          ${renderFieldError("timezone")}
        </label>

        <label class="field">
          <span>Currency</span>
          <select name="currency" ${canEdit ? "" : "disabled"}>
            ${renderSelectOptions(CURRENCY_OPTIONS, client.currency)}
          </select>
          ${renderFieldError("currency")}
        </label>

        <div class="field span-full file-field" id="settings-logo-upload-field">
          <span>Factory logo</span>
          <div class="file-upload-row">
            <input class="file-input sr-only" id="settings-logo-input" name="logo" type="file" accept="${LOGO_ACCEPT}" ${canEdit ? "" : "disabled"}>
            <label class="file-dropzone" for="settings-logo-input">
              <span class="file-upload-icon">${icon("upload")}</span>
              <span class="file-upload-copy">
                <strong id="settings-logo-upload-title">${client.logoDataUrl ? "Logo is set" : "Choose logo file"}</strong>
                <small id="settings-logo-file-name">${escapeHtml(LOGO_HELP_TEXT)}</small>
              </span>
              <span class="file-upload-action">Browse</span>
            </label>
            <button class="icon-button clear-file-button" id="settings-clear-logo-file" type="button" title="Clear selected logo" aria-label="Clear selected logo" ${canEdit && client.logoDataUrl ? "" : "hidden"}>
              ${icon("x")}
            </button>
          </div>
          ${renderFieldError("logo")}
        </div>

        <fieldset class="field span-full settings-notification-controls">
          <legend>Credit-limit notifications</legend>
          <label class="settings-switch">
            <span><strong>Email</strong><small>Send the representative an email when their limit changes</small></span>
            <input name="creditLimitEmailEnabled" type="checkbox" ${client.creditLimitEmailEnabled ? "checked" : ""} ${canEdit ? "" : "disabled"}>
          </label>
          <label class="settings-switch">
            <span><strong>SMS</strong><small>Send the representative a text message when their limit changes</small></span>
            <input name="creditLimitSmsEnabled" type="checkbox" ${client.creditLimitSmsEnabled ? "checked" : ""} ${canEdit ? "" : "disabled"}>
          </label>
        </fieldset>

        <span id="company-settings-message" class="field-error span-full"></span>
        <div class="span-full split">
          <span class="muted">${canEdit ? "Saved changes apply for everyone in this factory." : "Only CEOs and Managers can change factory-wide settings."}</span>
          ${textButton({
            iconName: "settings",
            label: "Save factory",
            className: "primary",
            type: "submit",
            disabled: !canEdit
          })}
        </div>
      </form>
      ${isModuleEnabled(state, "delivery_notes") ? `
        <div class="saved-preview-block">
          ${panelHeader("Saved delivery note preview", "Branding applied to a sample document")}
          ${renderDeliveryNotePreview({ ...client, brandColor: DEFAULT_BRAND_COLOR })}
        </div>
      ` : ""}
    </section>
  `;
}

function renderFactoryDeletion(state) {
  if (!canDeleteFactoryAccount(state)) return "";

  return `
    <section class="panel danger-panel">
      ${panelHeader("Delete factory account", "CEO-only action")}
      <form id="delete-factory-form" class="form-grid" novalidate>
        <div class="span-full client-id-box danger-box">
          <span class="eyebrow">Permanent deletion</span>
          <strong>${escapeHtml(state.client.companyName)}</strong>
          <span class="muted">This removes the factory workspace and its local records from this app.</span>
        </div>
        <label class="field span-full">
          <span>Type the factory name to confirm</span>
          <input name="confirmCompanyName" autocomplete="off" placeholder="${escapeHtml(state.client.companyName)}">
          ${renderFieldError("confirmCompanyName")}
        </label>
        <span id="delete-factory-message" class="field-error span-full"></span>
        <div class="span-full split">
          <span class="muted">Only the CEO can perform this action.</span>
          ${textButton({
            iconName: "x",
            label: "Delete factory",
            className: "warning",
            type: "submit"
          })}
        </div>
      </form>
    </section>
  `;
}

function renderProfileSettings(state, account) {
  const name = account?.name || state.user?.user_metadata?.full_name || "";
  const email = account?.email || state.user?.email || "";

  return `
    <section class="panel">
      ${panelHeader("My profile", "Personal details for your signed-in account")}
      <form id="profile-settings-form" class="form-grid" novalidate>
        <label class="field">
          <span>Full name</span>
          <input name="name" autocomplete="name" value="${escapeHtml(name)}">
          ${renderFieldError("name")}
        </label>
        <label class="field">
          <span>Email</span>
          <input value="${escapeHtml(email)}" disabled>
          <span class="muted">Contact an administrator if this email needs to change.</span>
        </label>
        <div class="span-full client-id-box">
          <span class="eyebrow">Role</span>
          <strong>${escapeHtml(roleLabel(account?.role))}</strong>
          ${statusPill(account?.status || "active")}
          <span class="muted">${escapeHtml(roleDescription(account?.role))}</span>
        </div>
        <span id="profile-settings-message" class="field-error span-full"></span>
        <div class="span-full split">
          <span class="muted">Your name appears across this factory workspace.</span>
          ${textButton({
            iconName: "userCheck",
            label: "Save profile",
            className: "primary",
            type: "submit"
          })}
        </div>
      </form>
    </section>
  `;
}

function renderPasswordSettings() {
  return `
    <section class="panel">
      ${panelHeader("Password", "Update the password for your signed-in account")}
      <form id="password-settings-form" class="form-grid" novalidate>
        <label class="field">
          <span>New password</span>
          <input name="newPassword" type="password" autocomplete="new-password">
          ${renderFieldError("newPassword")}
        </label>
        <label class="field">
          <span>Confirm password</span>
          <input name="confirmPassword" type="password" autocomplete="new-password">
          ${renderFieldError("confirmPassword")}
        </label>
        <span id="password-settings-message" class="field-error span-full"></span>
        <div class="span-full split">
          <span class="muted">Use at least 8 characters.</span>
          ${textButton({
            iconName: "shield",
            label: "Update password",
            className: "primary",
            type: "submit"
          })}
        </div>
      </form>
    </section>
  `;
}

export function renderSettings({ state }) {
  if (!state.client?.id) {
    return `
      <section class="view">
        <section class="panel setup-card">
          ${panelHeader("Factory setup required", "Create or join a factory before changing settings")}
          <a class="button primary" href="#/onboarding">Start onboarding</a>
        </section>
      </section>
    `;
  }

  const account = getCurrentAccount(state);
  const showFactorySettings = canEditCompanySettings(state);

  return `
    <section class="view settings-view">
      <div class="settings-layout ${showFactorySettings ? "" : "personal-settings-layout"}">
        ${showFactorySettings ? renderCompanySettings(state, account) : ""}
        <div class="settings-side">
          ${renderProfileSettings(state, account)}
          ${renderPasswordSettings()}
          ${renderFactoryDeletion(state)}
        </div>
      </div>
    </section>
  `;
}

function bindCompanyLogoUpload({ root, form, state }) {
  const logoInput = qs("#settings-logo-input", form);
  const logoPreview = qs("#settings-logo-preview", root);
  const logoUploadField = qs("#settings-logo-upload-field", form);
  const logoUploadTitle = qs("#settings-logo-upload-title", form);
  const logoFileName = qs("#settings-logo-file-name", form);
  const clearLogoButton = qs("#settings-clear-logo-file", form);
  let logoDataUrl = state.client?.logoDataUrl || "";

  function setLogoUploadState({ fileName = "", error = "" } = {}) {
    logoUploadField.classList.toggle("has-file", Boolean(fileName || logoDataUrl));
    logoUploadField.classList.toggle("has-error", Boolean(error));
    logoUploadTitle.textContent = fileName ? "Logo selected" : logoDataUrl ? "Logo is set" : "Choose logo file";
    logoFileName.textContent = fileName || LOGO_HELP_TEXT;
    clearLogoButton.hidden = !logoDataUrl && !fileName;
  }

  function clearLogoSelection() {
    logoInput.value = "";
    logoDataUrl = "";
    logoPreview.textContent = companyInitials(state.client?.companyName);
    setLogoUploadState();
  }

  logoInput.addEventListener("change", async () => {
    const file = logoInput.files?.[0];
    writeErrors(form, {});
    logoUploadField.classList.remove("has-error");

    if (!file) {
      setLogoUploadState();
      return;
    }

    const fileError = validateLogoFile(file);

    if (fileError) {
      logoInput.value = "";
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
      logoInput.value = "";
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

  setLogoUploadState();

  return {
    getLogoDataUrl() {
      return logoDataUrl;
    }
  };
}

export function bindSettings({ root, store }) {
  const state = store.getState();
  const companyForm = qs("#company-settings-form", root);
  const profileForm = qs("#profile-settings-form", root);
  const passwordForm = qs("#password-settings-form", root);
  const deleteFactoryForm = qs("#delete-factory-form", root);
  const logoUpload = companyForm ? bindCompanyLogoUpload({ root, form: companyForm, state }) : null;

  companyForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const currentState = store.getState();
    const values = collectCompanySettings(companyForm, logoUpload.getLogoDataUrl());
    const errors = validateClientForm(values);
    const message = qs("#company-settings-message", companyForm);
    const submitButton = qs('button[type="submit"]', companyForm);

    writeErrors(companyForm, errors);
    message.textContent = "";

    if (Object.keys(errors).length) return;

    submitButton.disabled = true;

    try {
      if (isBackendConfigured()) {
        const workspace = await updateWorkspaceSettings({
          client: currentState.client,
          payload: values
        });
        store.dispatch({
          type: "SET_WORKSPACE",
          ...workspace,
          message: "Company settings updated"
        });
      } else {
        const currency = CURRENCY_OPTIONS.find((item) => item.value === values.currency) || CURRENCY_OPTIONS[0];
        store.dispatch({
          type: "UPDATE_CLIENT_SETTINGS",
          payload: {
            companyName: values.companyName.trim(),
            logoDataUrl: values.logoDataUrl,
            timezone: values.timezone,
            currency: currency.value,
            currencySymbol: currency.symbol,
            brandColor: values.brandColor,
            creditLimitEmailEnabled: values.creditLimitEmailEnabled,
            creditLimitSmsEnabled: values.creditLimitSmsEnabled
          },
          message: "Company settings updated"
        });
      }

      setCurrencySettings(store.getState().client);
    } catch (error) {
      message.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });

  profileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const currentState = store.getState();
    const values = readProfileForm(profileForm);
    const message = qs("#profile-settings-message", profileForm);
    const submitButton = qs('button[type="submit"]', profileForm);

    writeErrors(profileForm, {});
    message.textContent = "";

    if (!values.name) {
      writeErrors(profileForm, {
        name: "Full name is required."
      });
      return;
    }

    submitButton.disabled = true;

    try {
      if (isBackendConfigured()) {
        await updateCurrentUserProfile({
          name: values.name
        });
        const workspace = await updateMyMembershipProfile({
          clientId: currentState.client.id,
          name: values.name
        });
        store.dispatch({
          type: "SET_WORKSPACE",
          ...workspace,
          message: "Profile updated"
        });
      } else {
        store.dispatch({
          type: "UPDATE_MY_PROFILE",
          name: values.name,
          message: "Profile updated"
        });
      }
    } catch (error) {
      message.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });

  passwordForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(passwordForm);
    const newPassword = String(formData.get("newPassword") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");
    const message = qs("#password-settings-message", passwordForm);
    const submitButton = qs('button[type="submit"]', passwordForm);

    writeErrors(passwordForm, {});
    message.textContent = "";

    if (newPassword.length < 8) {
      writeErrors(passwordForm, {
        newPassword: "Password must be at least 8 characters."
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      writeErrors(passwordForm, {
        confirmPassword: "Passwords do not match."
      });
      return;
    }

    submitButton.disabled = true;

    try {
      await updateCurrentUserPassword(newPassword);
      if (isBackendConfigured() && store.getState().client?.id) {
        await recordActivity({
          clientId: store.getState().client.id,
          actionType: "updated",
          recordType: "account",
          recordLabel: "Password",
          summary: "Updated password"
        });
        const workspace = await loadWorkspace();
        store.dispatch({
          type: "SET_WORKSPACE",
          ...workspace,
          message: "Password updated"
        });
      }
      passwordForm.reset();
      message.className = "muted span-full";
      message.textContent = "Password updated.";
    } catch (error) {
      message.className = "field-error span-full";
      message.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });

  deleteFactoryForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const currentState = store.getState();
    const formData = new FormData(deleteFactoryForm);
    const typedName = String(formData.get("confirmCompanyName") || "").trim();
    const factoryName = currentState.client?.companyName || "";
    const message = qs("#delete-factory-message", deleteFactoryForm);
    const submitButton = qs('button[type="submit"]', deleteFactoryForm);

    writeErrors(deleteFactoryForm, {});
    message.textContent = "";

    if (!canDeleteFactoryAccount(currentState)) {
      message.textContent = "Only the CEO can delete the factory account.";
      return;
    }

    if (typedName !== factoryName) {
      writeErrors(deleteFactoryForm, {
        confirmCompanyName: "Enter the factory name exactly."
      });
      return;
    }

    submitButton.disabled = true;

    try {
      if (isBackendConfigured()) {
        await deleteWorkspace({
          clientId: currentState.client.id
        });
      }

      store.dispatch({
        type: "DELETE_CLIENT_ACCOUNT",
        message: "Factory account deleted"
      });

      window.location.hash = "#/onboarding";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });
}
