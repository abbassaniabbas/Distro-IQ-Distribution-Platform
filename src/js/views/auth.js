import { signInWithPassword, signUpWithPassword } from "../services/auth.js";
import { loadWorkspace } from "../services/backend.js";
import { escapeHtml, qs } from "../ui/dom.js";
import { textButton } from "../ui/components.js";
import { icon } from "../ui/icons.js";

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

function renderAuthTab({ href, label, active }) {
  return `
    <a class="auth-tab ${active ? "is-active" : ""}" href="${escapeHtml(href)}" aria-current="${active ? "page" : "false"}">
      ${escapeHtml(label)}
    </a>
  `;
}

function renderAuthFeature({ iconName, title, body }) {
  return `
    <div class="auth-feature">
      <span class="auth-feature-icon">${icon(iconName)}</span>
      <span>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(body)}</small>
      </span>
    </div>
  `;
}

function friendlyAuthError(error, mode) {
  const message = String(error?.message || "").toLowerCase();

  if (message.includes("invalid login") || message.includes("invalid credentials")) {
    return "The email or password does not match. Please check both and try again.";
  }

  if (message.includes("already registered") || message.includes("already exists")) {
    return "An account already exists for this email. Please sign in instead.";
  }

  if (message.includes("email") && message.includes("confirm")) {
    return "Please confirm this email address, then sign in again.";
  }

  if (message.includes("rate") || message.includes("too many")) {
    return "Too many attempts. Please wait a moment, then try again.";
  }

  if (message.includes("configured") || message.includes("supabase") || message.includes("network")) {
    return "We could not reach your company workspace right now. Please try again shortly.";
  }

  return mode === "signup"
    ? "We could not create this account. Please check the details and try again."
    : "We could not sign you in. Please check the details and try again.";
}

export function renderAuth({ routeId }) {
  const mode = isSignupRoute(routeId) ? "signup" : "login";
  const isSignup = mode === "signup";
  const title = isSignup ? "Create your DistroIQ account" : "Welcome back";
  const subtitle = isSignup
    ? "Start with your user account, then create the factory workspace."
    : "Sign in to continue managing sales, stock, dispatch, and balances.";
  const footerCopy = isSignup
    ? "You will set up company details after your account is ready."
    : "Team accounts open with the permissions assigned by your company.";

  return `
    <section class="view auth-view">
      <div class="auth-shell">
        <section class="auth-brand-panel" aria-label="DistroIQ overview">
          <div class="auth-logo-lockup">
            <span class="auth-logo-mark">
              <img src="./src/assets/distro-iq-mark.svg" alt="">
            </span>
            <span>
              <strong>DistroIQ</strong>
              <small>Sales, Stock & Distribution</small>
            </span>
          </div>

          <div class="auth-hero-copy">
            <span class="eyebrow">Snack factory workspace</span>
            <h1>Run sales, stock, dispatch, returns, and customer balances from one place.</h1>
            <p>Built for confectionery teams moving chips and snack products from store to field to customer.</p>
          </div>

          <div class="auth-feature-list">
            ${renderAuthFeature({
              iconName: "package",
              title: "Rep stock",
              body: "See what each sales rep carries and what needs replenishing."
            })}
            ${renderAuthFeature({
              iconName: "orders",
              title: "Sales and returns",
              body: "Capture field sales, returned goods, and outlet activity."
            })}
            ${renderAuthFeature({
              iconName: "wallet",
              title: "Credit balances",
              body: "Track supermarket balances, payments, and revenue in naira."
            })}
          </div>

          <div class="auth-role-strip" aria-label="Supported account roles">
            <span>Sales Rep</span>
            <span>Manager</span>
            <span>Store Keeper</span>
            <span>Accountant</span>
            <span>CEO</span>
            <span>Super Admin</span>
          </div>
        </section>

        <section class="auth-card" aria-labelledby="auth-title">
          <nav class="auth-tabs" aria-label="Account access">
            ${renderAuthTab({ href: "#/login", label: "Sign in", active: !isSignup })}
            ${renderAuthTab({ href: "#/signup", label: "Create account", active: isSignup })}
          </nav>

          <div class="auth-form-heading">
            <span class="eyebrow">Company access</span>
            <h2 id="auth-title">${escapeHtml(title)}</h2>
            <p>${escapeHtml(subtitle)}</p>
          </div>

          <form id="auth-form" class="form-grid auth-form" novalidate data-mode="${mode}">
            ${
              isSignup
                ? `
                  <label class="field span-full auth-field">
                    <span>Full name</span>
                    <input name="name" autocomplete="name" placeholder="Ada Okonkwo" aria-label="Full name">
                    ${renderFieldError("name")}
                  </label>
                `
                : ""
            }
            <label class="field span-full auth-field">
              <span>Email address</span>
              <input name="email" type="email" autocomplete="email" placeholder="you@company.com" aria-label="Email address">
              ${renderFieldError("email")}
            </label>
            <label class="field span-full auth-field">
              <span>Password</span>
              <span class="auth-password-control">
                <input name="password" type="password" autocomplete="${isSignup ? "new-password" : "current-password"}" aria-label="Password">
                <button class="icon-button auth-password-toggle" type="button" title="Show password" aria-label="Show password" data-password-toggle>
                  ${icon("eye")}
                </button>
              </span>
              ${renderFieldError("password")}
              ${isSignup ? '<small class="auth-field-hint">Use at least 8 characters.</small>' : ""}
            </label>
            <span id="auth-message" class="auth-message span-full" role="status" aria-live="polite"></span>
            <div class="span-full auth-submit-row">
              <span class="auth-form-note">${escapeHtml(footerCopy)}</span>
              ${textButton({
                iconName: isSignup ? "userCheck" : "arrowRight",
                label: isSignup ? "Create account" : "Sign in",
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
  const passwordInput = qs('input[name="password"]', root);
  const passwordToggle = qs("[data-password-toggle]", root);
  if (!form) return;

  passwordToggle?.addEventListener("click", () => {
    const isVisible = passwordInput.type === "text";

    passwordInput.type = isVisible ? "password" : "text";
    passwordToggle.title = isVisible ? "Show password" : "Hide password";
    passwordToggle.setAttribute("aria-label", passwordToggle.title);
    passwordToggle.innerHTML = icon(isVisible ? "eye" : "eyeOff");
    passwordInput.focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const mode = form.dataset.mode;
    const submitButton = qs('button[type="submit"]', form);
    const submitText = qs("span", submitButton);
    const idleText = mode === "signup" ? "Create account" : "Sign in";
    const values = readAuthForm(form);
    const errors = validate(values, mode);

    writeErrors(form, errors);
    message.textContent = "";
    message.className = "auth-message span-full";

    if (Object.keys(errors).length) return;

    submitButton.disabled = true;
    submitText.textContent = mode === "signup" ? "Creating..." : "Signing in...";

    try {
      const authData =
        mode === "signup"
          ? await signUpWithPassword(values)
          : await signInWithPassword(values);

      if (!authData.session) {
        message.className = "auth-message span-full is-success";
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
      message.className = "auth-message span-full is-error";
      message.textContent = friendlyAuthError(error, mode);
    } finally {
      submitButton.disabled = false;
      submitText.textContent = idleText;
    }
  });
}
