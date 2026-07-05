import {
  createMfaChallenge,
  enrollTotpFactor,
  getAuthContext,
  getAuthenticatorAssuranceLevel,
  listAuthenticatorFactors,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  verifyMfaChallenge
} from "../services/auth.js";
import { loadPlatformOverview, loadWorkspace } from "../services/backend.js";
import { ROLE_OPTIONS, normalizeRole, roleLabel } from "../services/rbac.js";
import { escapeHtml, qs } from "../ui/dom.js";
import { textButton } from "../ui/components.js";
import { icon } from "../ui/icons.js";

function isSignupRoute(routeId) {
  return routeId === "signup";
}

function isPlatformAdminRoute(routeId) {
  return routeId === "platform-admin";
}

function readAuthForm(form) {
  const formData = new FormData(form);

  return {
    name: formData.get("name") || "",
    email: formData.get("email") || "",
    password: formData.get("password") || "",
    role: formData.get("role") || ""
  };
}

function validate(values, mode) {
  const errors = {};

  if (mode === "login" && !ROLE_OPTIONS.some((role) => role.value === values.role)) {
    errors.role = "Choose your role first.";
    return errors;
  }

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

function renderLoginRoleSelector() {
  return `
    <label class="field span-full auth-field">
      <span>Role</span>
      <select name="role" aria-label="Role">
        <option value="">Select your role</option>
        ${ROLE_OPTIONS.map((role) => `
          <option value="${escapeHtml(role.value)}">${escapeHtml(role.label)}</option>
        `).join("")}
      </select>
      ${renderFieldError("role")}
    </label>
  `;
}

function renderPlatformMfaPanel() {
  return `
    <section id="platform-mfa-panel" class="auth-mfa-panel span-full" hidden>
      <div class="auth-form-heading">
        <span class="eyebrow">Two-factor authentication</span>
        <h3>Verify Super Admin access</h3>
        <p>Use an authenticator app to complete the Bex Lab Super Admin sign-in.</p>
      </div>

      <div class="auth-mfa-enrollment" data-mfa-enrollment hidden>
        <div class="auth-mfa-qr">
          <img alt="Authenticator QR code" data-mfa-qr>
        </div>
        <div class="client-id-box">
          <span class="eyebrow">Manual setup key</span>
          <code data-mfa-secret></code>
        </div>
      </div>

      <label class="field span-full auth-field">
        <span>Authenticator code</span>
        <input name="mfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="123456" data-mfa-code>
      </label>
      <span id="platform-mfa-message" class="auth-message span-full" role="status" aria-live="polite"></span>
      <div class="span-full auth-submit-row">
        <button class="button" type="button" data-mfa-cancel>
          ${icon("arrowRight")}
          <span>Back to sign in</span>
        </button>
        <button class="button primary" type="button" data-mfa-verify>
          ${icon("check")}
          <span>Verify and open console</span>
        </button>
      </div>
    </section>
  `;
}

function getWorkspaceAccountForUser(workspace, user) {
  const userEmail = String(user?.email || "").trim().toLowerCase();
  return (workspace.accounts || []).find((item) => (
    item.userId === user?.id ||
    (userEmail && String(item.email || "").trim().toLowerCase() === userEmail)
  )) || null;
}

function getWorkspaceRoleForUser(workspace, user) {
  const account = getWorkspaceAccountForUser(workspace, user);
  return account?.role || user?.user_metadata?.role || "";
}

function roleMismatchError(selectedRole, actualRole) {
  const error = new Error("Role selection does not match this account.");
  error.code = "role_mismatch";
  error.selectedRole = selectedRole;
  error.actualRole = actualRole;
  return error;
}

function mfaRequiredError() {
  const error = new Error("Two-factor authentication is required for Super Admin access.");
  error.code = "mfa_required";
  return error;
}

function friendlyAuthError(error, mode) {
  const message = String(error?.message || "").toLowerCase();

  if (error?.code === "role_mismatch") {
    return `This account is set up as ${roleLabel(error.actualRole)}. Please choose ${roleLabel(error.actualRole)} to sign in.`;
  }

  if (error?.code === "platform_admin_setup_required") {
    return "Platform console setup is not installed yet. Run the updated Supabase schema first.";
  }

  if (error?.code === "mfa_required") {
    return "Two-factor authentication is required for Bex Lab Super Admin access. Complete MFA before opening the console.";
  }

  if (error?.code === "platform_admin_required" || message.includes("platform admin")) {
    return "This sign-in is reserved for the platform owner. Use the company sign-in page for factory accounts.";
  }

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
  const isPlatformAdmin = isPlatformAdminRoute(routeId);
  const mode = isPlatformAdmin ? "platform" : isSignupRoute(routeId) ? "signup" : "login";
  const isSignup = mode === "signup";
  const title = isPlatformAdmin ? "Super Admin" : isSignup ? "Create account" : "Sign in";
  const subtitle = isPlatformAdmin
    ? "Bex Lab Innovations access"
    : isSignup
    ? "Create your DistroIQ account"
    : "Access your company workspace";

  return `
    <section class="view auth-view">
      <div class="auth-shell">
        <section class="auth-card auth-card-centered" aria-labelledby="auth-title">
          <div class="auth-logo-lockup">
            <span class="auth-logo-mark">
              <img src="./src/assets/distro-iq-mark.svg" alt="">
            </span>
            <span>
              <strong>DistroIQ</strong>
              <small>Sales, Stock & Distribution</small>
            </span>
          </div>
          ${
            isPlatformAdmin
              ? ""
              : `
                <nav class="auth-tabs" aria-label="Account access">
                  ${renderAuthTab({ href: "#/login", label: "Sign in", active: !isSignup })}
                  ${renderAuthTab({ href: "#/signup", label: "Create account", active: isSignup })}
                </nav>
              `
          }

          <div class="auth-form-heading">
            <h2 id="auth-title">${escapeHtml(title)}</h2>
            <p>${escapeHtml(subtitle)}</p>
          </div>

          <form id="auth-form" class="form-grid auth-form" novalidate data-mode="${mode}">
            ${mode === "login" ? renderLoginRoleSelector() : ""}
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
            </label>
            <span id="auth-message" class="auth-message span-full" role="status" aria-live="polite"></span>
            ${isPlatformAdmin ? renderPlatformMfaPanel() : ""}
            <div class="span-full auth-submit-row">
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

export function bindAuth({ root, store, beginAuthFormFlow }) {
  const form = qs("#auth-form", root);
  const message = qs("#auth-message", root);
  const passwordInput = qs('input[name="password"]', root);
  const passwordToggle = qs("[data-password-toggle]", root);
  const roleControls = [...root.querySelectorAll('[name="role"]')];
  const mfaPanel = qs("#platform-mfa-panel", root);
  const mfaEnrollment = qs("[data-mfa-enrollment]", root);
  const mfaQr = qs("[data-mfa-qr]", root);
  const mfaSecret = qs("[data-mfa-secret]", root);
  const mfaCode = qs("[data-mfa-code]", root);
  const mfaMessage = qs("#platform-mfa-message", root);
  const mfaVerifyButton = qs("[data-mfa-verify]", root);
  const mfaCancelButton = qs("[data-mfa-cancel]", root);
  let pendingMfa = null;
  if (!form) return;

  function setMfaMessage(text, type = "") {
    if (!mfaMessage) return;

    mfaMessage.textContent = text;
    mfaMessage.className = `auth-message span-full${type ? ` is-${type}` : ""}`;
  }

  function showMfaPanel() {
    form.classList.add("is-verifying-mfa");
    if (mfaPanel) {
      mfaPanel.hidden = false;
    }
    mfaCode?.focus();
  }

  function hideMfaPanel() {
    form.classList.remove("is-verifying-mfa");
    if (mfaPanel) {
      mfaPanel.hidden = true;
    }
    if (mfaEnrollment) {
      mfaEnrollment.hidden = true;
    }
    if (mfaQr) {
      mfaQr.removeAttribute("src");
    }
    if (mfaSecret) {
      mfaSecret.textContent = "";
    }
    if (mfaCode) {
      mfaCode.value = "";
    }
    setMfaMessage("");
    pendingMfa = null;
  }

  async function openPlatformConsole(authData) {
    const platformOverview = await loadPlatformOverview();
    const authContext = await getAuthContext();

    store.dispatch({
      type: "SET_PLATFORM_CONTEXT",
      session: authContext.session || authData.session,
      user: authContext.user || authData.user,
      platformOverview,
      message: "Platform console opened"
    });

    window.location.hash = "#/platform-console";
  }

  async function preparePlatformMfa(authData) {
    showMfaPanel();
    setMfaMessage("Preparing two-factor verification...");

    const factors = await listAuthenticatorFactors();
    const existingFactor = factors.totp.find((factor) => factor.status === "verified") || factors.totp[0];
    let factorId = existingFactor?.id;

    if (!factorId) {
      const enrollment = await enrollTotpFactor();
      factorId = enrollment.factorId;

      if (mfaEnrollment) {
        mfaEnrollment.hidden = false;
      }
      if (mfaQr && enrollment.qrCode) {
        mfaQr.src = enrollment.qrCode;
      }
      if (mfaSecret) {
        mfaSecret.textContent = enrollment.secret || enrollment.uri || "Scan the QR code with your authenticator app.";
      }

      setMfaMessage("Scan the QR code, then enter the six-digit code from your authenticator app.");
    } else {
      if (mfaEnrollment) {
        mfaEnrollment.hidden = true;
      }
      setMfaMessage(
        existingFactor.status === "verified"
          ? "Enter the six-digit code from your authenticator app."
          : "Enter the code from the authenticator app you started setting up for this account."
      );
    }

    const challenge = await createMfaChallenge(factorId);
    pendingMfa = {
      authData,
      factorId,
      challengeId: challenge.challengeId
    };

    mfaCode?.focus();
  }

  roleControls.forEach((control) => {
    control.addEventListener("change", () => {
      writeErrors(form, { role: "" });
      message.textContent = "";
      message.className = "auth-message span-full";
    });
  });

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

    const finishAuthFormFlow = beginAuthFormFlow?.() || (() => {});

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

      if (mode === "platform") {
        const assurance = await getAuthenticatorAssuranceLevel();

        if (assurance.currentLevel !== "aal2") {
          await preparePlatformMfa(authData);
          return;
        }

        await openPlatformConsole(authData);
        return;
      }

      const workspace = await loadWorkspace();
      if (mode === "login") {
        const actualRole = getWorkspaceRoleForUser(workspace, authData.user);

        if (actualRole && normalizeRole(actualRole) !== normalizeRole(values.role)) {
          try {
            await signOut();
          } catch {
            // The visible error should still tell the user which role to choose.
          }
          throw roleMismatchError(values.role, actualRole);
        }
      }

      store.dispatch({
        type: "SET_AUTHENTICATED_WORKSPACE",
        session: authData.session,
        user: authData.user,
        ...workspace,
        message: mode === "signup" ? "Account created" : "Signed in"
      });

      const account = getWorkspaceAccountForUser(workspace, authData.user);
      window.location.hash = account?.passwordResetRequired
        ? "#/reset-password"
        : workspace.client ? "#/dashboard" : "#/onboarding";
    } catch (error) {
      const errorMessage = friendlyAuthError(error, mode);

      if (error?.code === "role_mismatch") {
        writeErrors(form, {
          role: "That role does not match this account."
        });
      }

      message.className = "auth-message span-full is-error";
      message.textContent = errorMessage;
      if (error?.code === "role_mismatch") {
        window.location.hash = "#/login";
      }
    } finally {
      finishAuthFormFlow();
      submitButton.disabled = false;
      submitText.textContent = idleText;
    }
  });

  mfaVerifyButton?.addEventListener("click", async () => {
    if (!pendingMfa) {
      setMfaMessage("Sign in again to start two-factor verification.", "error");
      return;
    }

    const code = String(mfaCode?.value || "").trim();
    if (!/^\d{6,8}$/.test(code)) {
      setMfaMessage("Enter the code from your authenticator app.", "error");
      mfaCode?.focus();
      return;
    }

    const label = qs("span", mfaVerifyButton);
    const idleText = label?.textContent || "Verify and open console";
    mfaVerifyButton.disabled = true;
    if (label) label.textContent = "Verifying...";
    setMfaMessage("");

    try {
      await verifyMfaChallenge({
        factorId: pendingMfa.factorId,
        challengeId: pendingMfa.challengeId,
        code
      });

      const assurance = await getAuthenticatorAssuranceLevel();
      if (assurance.currentLevel !== "aal2") {
        throw mfaRequiredError();
      }

      await openPlatformConsole(pendingMfa.authData);
    } catch (error) {
      setMfaMessage(friendlyAuthError(error, "platform"), "error");
    } finally {
      mfaVerifyButton.disabled = false;
      if (label) label.textContent = idleText;
    }
  });

  mfaCode?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      mfaVerifyButton?.click();
    }
  });

  mfaCancelButton?.addEventListener("click", async () => {
    try {
      await signOut();
    } catch {
      // Returning to the password step should not depend on a perfect sign-out response.
    }
    hideMfaPanel();
  });
}
