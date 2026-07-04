import { signInWithPassword, signUpWithPassword } from "../services/auth.js";
import { loadWorkspace } from "../services/backend.js";
import { escapeHtml, qs } from "../ui/dom.js";
import { panelHeader, textButton } from "../ui/components.js";

function isSignupRoute(routeId) {
  return routeId === "signup";
}

function readAuthForm(form) {
  const formData = new FormData(form);

  return {
    name: formData.get("name") || "",
    email: formData.get("email") || "",
    password: formData.get("password") || ""
  };
}

function validate(values, mode) {
  const errors = {};

  if (mode === "signup" && !values.name.trim()) {
    errors.name = "Name is required.";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(values.email).trim())) {
    errors.email = "A valid email is required.";
  }

  if (String(values.password).length < 8) {
    errors.password = "Password must be at least 8 characters.";
  }

  return errors;
}

function writeErrors(form, errors) {
  form.querySelectorAll("[data-error-for]").forEach((target) => {
    target.textContent = errors[target.dataset.errorFor] || "";
  });
}

function renderFieldError(name) {
  return `<span class="field-error" data-error-for="${escapeHtml(name)}"></span>`;
}

export function renderAuth({ routeId }) {
  const mode = isSignupRoute(routeId) ? "signup" : "login";
  const title = mode === "signup" ? "Create account" : "Sign in";
  const subtitle = mode === "signup" ? "Create your user account, then set up your factory" : "Use your work account";

  return `
    <section class="view">
      <div class="onboarding-layout">
        <section class="panel setup-card">
          ${panelHeader("DistroIQ", "Sales, stock, and distribution control for your snack factory")}
          <div class="client-id-box">
            <span class="eyebrow">Factory access</span>
            <strong>Track reps, stock, sales, returns, and balances owed</strong>
            <span class="muted">Managers, store keepers, and sales reps see the tools their role allows.</span>
          </div>
          <div class="toolbar-group">
            <a class="button ${mode === "login" ? "primary" : ""}" href="#/login">Sign in</a>
            <a class="button ${mode === "signup" ? "primary" : ""}" href="#/signup">Create account</a>
          </div>
        </section>

        <section class="panel">
          ${panelHeader(title, subtitle)}
          <form id="auth-form" class="form-grid" novalidate data-mode="${mode}">
            ${
              mode === "signup"
                ? `
                  <label class="field span-full">
                    <span>Full name</span>
                    <input name="name" autocomplete="name" placeholder="Ada Okonkwo">
                    ${renderFieldError("name")}
                  </label>
                `
                : ""
            }
            <label class="field span-full">
              <span>Email</span>
              <input name="email" type="email" autocomplete="email" placeholder="you@company.com">
              ${renderFieldError("email")}
            </label>
            <label class="field span-full">
              <span>Password</span>
              <input name="password" type="password" autocomplete="${mode === "signup" ? "new-password" : "current-password"}">
              ${renderFieldError("password")}
            </label>
            <span id="auth-message" class="field-error span-full"></span>
            <div class="span-full split">
              <span class="muted">${mode === "signup" ? "You will set up your factory next." : "Your sales and stock workspace loads after sign in."}</span>
              ${textButton({
                iconName: mode === "signup" ? "userCheck" : "arrowRight",
                label: title,
                className: "primary",
                type: "submit"
              })}
            </div>
          </form>
        </section>
      </div>
    </section>
  `;
}

export function bindAuth({ root, store }) {
  const form = qs("#auth-form", root);
  const message = qs("#auth-message", root);
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const mode = form.dataset.mode;
    const submitButton = qs('button[type="submit"]', form);
    const values = readAuthForm(form);
    const errors = validate(values, mode);

    writeErrors(form, errors);
    message.textContent = "";

    if (Object.keys(errors).length) return;

    submitButton.disabled = true;

    try {
      const authData =
        mode === "signup"
          ? await signUpWithPassword(values)
          : await signInWithPassword(values);

      if (!authData.session) {
        message.textContent = "Check your email to confirm this account, then sign in.";
        return;
      }

      store.dispatch({
        type: "SET_AUTH_CONTEXT",
        session: authData.session,
        user: authData.user,
        message: mode === "signup" ? "Account created" : "Signed in"
      });

      const workspace = await loadWorkspace();
      store.dispatch({
        type: "SET_WORKSPACE",
        ...workspace
      });

      window.location.hash = workspace.client ? "#/dashboard" : "#/onboarding";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });
}
