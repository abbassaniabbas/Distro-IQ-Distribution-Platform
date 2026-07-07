import { DEFAULT_ROUTE, NAV_ITEMS } from "./config/navigation.js";
import { createStore } from "./state/store.js";
import { getAuthContext, onAuthStateChange, signOut } from "./services/auth.js";
import { loadWorkspace, tryLoadPlatformOverview } from "./services/backend.js";
import { setCurrencySettings } from "./services/formatters.js";
import { canAccessRoute, currentUserPermissions, currentUserRole, roleLabel, scopeStateForCurrentRole } from "./services/rbac.js";
import { isBackendConfigured } from "./services/supabase-client.js";
import { applySearchFilter, escapeHtml, qs } from "./ui/dom.js";
import { icon, replaceIconPlaceholders } from "./ui/icons.js";
import { showToast } from "./ui/toast.js";
import { renderActivityLog, bindActivityLog } from "./views/activity-log.js";
import { renderAuth, bindAuth } from "./views/auth.js";
import { renderBackendSetup, bindBackendSetup } from "./views/backend-setup.js";
import { renderDashboard, bindDashboard } from "./views/dashboard.js";
import { renderFinance, bindFinance } from "./views/finance.js";
import { renderInventory, bindInventory } from "./views/inventory.js";
import { renderLoading, bindLoading } from "./views/loading.js";
import {
  renderOnboarding,
  bindOnboarding,
  renderOnboardingConfirmation,
  bindOnboardingConfirmation
} from "./views/onboarding.js";
import { renderOrders, bindOrders } from "./views/orders.js";
import { renderPasswordReset, bindPasswordReset } from "./views/password-reset.js";
import { renderPlatformConsole, bindPlatformConsole } from "./views/platform.js";
import { renderRetailers, bindRetailers } from "./views/retailers.js";
import { renderRoutes, bindRoutes } from "./views/routes.js";
import { renderSettings, bindSettings } from "./views/settings.js";
import { renderTeam, bindTeam } from "./views/team.js";

const routes = {
  loading: {
    title: "Loading",
    render: renderLoading,
    bind: bindLoading,
    isSetup: true
  },
  "backend-setup": {
    title: "Setup Required",
    render: renderBackendSetup,
    bind: bindBackendSetup,
    isSetup: true
  },
  login: {
    title: "Sign In",
    render: renderAuth,
    bind: bindAuth,
    isSetup: true
  },
  signup: {
    title: "Create Account",
    render: renderAuth,
    bind: bindAuth,
    isSetup: true
  },
  onboarding: {
    title: "Onboarding",
    render: renderOnboarding,
    bind: bindOnboarding,
    isSetup: true
  },
  "onboarding-confirmation": {
    title: "Company Created",
    render: renderOnboardingConfirmation,
    bind: bindOnboardingConfirmation,
    isSetup: true
  },
  dashboard: {
    title: "Dashboard",
    render: renderDashboard,
    bind: bindDashboard
  },
  orders: {
    title: "Sales Orders",
    render: renderOrders,
    bind: bindOrders
  },
  inventory: {
    title: "Stock",
    render: renderInventory,
    bind: bindInventory
  },
  routes: {
    title: "Representative Runs",
    render: renderRoutes,
    bind: bindRoutes
  },
  retailers: {
    title: "Customers",
    render: renderRetailers,
    bind: bindRetailers
  },
  team: {
    title: "Team",
    render: renderTeam,
    bind: bindTeam
  },
  finance: {
    title: "Finance",
    render: renderFinance,
    bind: bindFinance
  },
  "activity-log": {
    title: "Activity Log",
    render: renderActivityLog,
    bind: bindActivityLog
  },
  settings: {
    title: "Settings",
    render: renderSettings,
    bind: bindSettings
  },
  "reset-password": {
    title: "Password Reset",
    render: renderPasswordReset,
    bind: bindPasswordReset,
    isSetup: true
  },
  "platform-admin": {
    title: "Super Admin",
    render: renderAuth,
    bind: bindAuth,
    isSetup: true,
    isPlatformAuth: true
  },
  "platform-console": {
    title: "Platform Console",
    render: renderPlatformConsole,
    bind: bindPlatformConsole,
    isPlatform: true
  }
};

const store = createStore();
const navRoot = qs("#primary-nav");
const viewRoot = qs("#view-root");
const viewTitle = qs("#view-title");
const globalSearch = qs("#global-search");
const signOutButton = qs("#sign-out");
const dashboardDispatchCount = qs("#dashboard-dispatch-count");
const sidebarRoleLabel = qs("#sidebar-role-label");
const sidebarRoleContext = qs("#sidebar-role-context");
const topbarUtilities = qs("#topbar-utility-actions");
const topbarAvatar = qs("#topbar-avatar");
const notificationsButton = qs("#topbar-notifications");
const messagesButton = qs("#topbar-messages");
const AUTH_ROUTES = ["login", "signup", "reset-password", "platform-admin"];
const PLATFORM_NAV_ITEMS = [
  {
    id: "platform-console",
    label: "Platform Console",
    icon: "dashboard"
  }
];
let activeAuthFormFlows = 0;

function beginAuthFormFlow() {
  activeAuthFormFlows += 1;

  return () => {
    activeAuthFormFlows = Math.max(0, activeAuthFormFlows - 1);
  };
}

function isAuthFormFlowActive() {
  return activeAuthFormFlows > 0;
}

function defaultRouteForState(state) {
  return currentUserPermissions(state).nav[0] || DEFAULT_ROUTE;
}

function getHashRouteId() {
  const routeId = window.location.hash.replace(/^#\/?/, "") || DEFAULT_ROUTE;
  return routeId.split("?")[0];
}

function getCurrentRouteId(state) {
  const requestedRouteId = getHashRouteId();
  const routeId = routes[requestedRouteId] ? requestedRouteId : DEFAULT_ROUTE;

  if (state.backend.status === "checking") {
    return "loading";
  }

  if (!state.backend.configured) {
    return "backend-setup";
  }

  if (state.backend.status === "error") {
    return "backend-setup";
  }

  if (routeId === "reset-password") {
    return routeId;
  }

  if (state.platformAdmin) {
    return routeId === "platform-console" ? routeId : "platform-console";
  }

  if (routeId === "platform-console") {
    return "platform-admin";
  }

  if (state.session && routeId === "platform-admin") {
    return state.client?.id ? defaultRouteForState(state) : "platform-admin";
  }

  if (!state.session && !["login", "signup", "platform-admin"].includes(routeId)) {
    return "login";
  }

  if (state.session && ["login", "signup"].includes(routeId)) {
    return state.client?.id ? DEFAULT_ROUTE : "onboarding";
  }

  if (state.session && !state.client?.id && !["onboarding", "onboarding-confirmation"].includes(routeId)) {
    return "onboarding";
  }

  if (
    state.session &&
    state.client?.id &&
    routeId !== "reset-password" &&
    accountForCurrentUser(state)?.passwordResetRequired
  ) {
    return "reset-password";
  }

  if (state.session && state.client?.id && routeId === "onboarding") {
    return "onboarding-confirmation";
  }

  if (!canAccessRoute(state, routeId)) {
    return defaultRouteForState(state);
  }

  return routeId;
}

function renderNav(activeRouteId, state) {
  if (state.platformAdmin) {
    navRoot.innerHTML = PLATFORM_NAV_ITEMS.map((item) => {
      const isActive = item.id === activeRouteId;

      return `
        <a class="nav-link ${isActive ? "is-active" : ""}" href="#/${item.id}" aria-current="${isActive ? "page" : "false"}">
          ${icon(item.icon)}
          <span>${item.label}</span>
        </a>
      `;
    }).join("");
    return;
  }

  const permissions = currentUserPermissions(state);
  const role = currentUserRole(state);
  const visibleItems = state.session && state.client?.id
    ? NAV_ITEMS.filter((item) => permissions.nav.includes(item.id))
    : NAV_ITEMS;

  navRoot.innerHTML = visibleItems.map((item) => {
    const isActive = item.id === activeRouteId;

    return `
      <a class="nav-link ${isActive ? "is-active" : ""}" href="#/${item.id}" aria-current="${isActive ? "page" : "false"}">
        ${icon(item.icon)}
        <span>${escapeHtml(role === "sales_rep" && item.id === "dashboard" ? "My Day" : item.label)}</span>
      </a>
    `;
  }).join("");
}

function updateSidebar(state) {
  const account = accountForCurrentUser(state);
  const roleName = state.platformAdmin ? "Super Admin" : account?.role ? roleLabel(account.role) : "Team member";

  if (sidebarRoleLabel) {
    sidebarRoleLabel.textContent = state.session || state.platformAdmin ? roleName : "Team member";
  }

  if (sidebarRoleContext) {
    sidebarRoleContext.textContent = state.platformAdmin ? "Bex Lab console" : state.session ? "Factory workspace" : "Not signed in";
  }

  if (state.platformAdmin) {
    if (dashboardDispatchCount) dashboardDispatchCount.textContent = "Platform monitor";
    return;
  }

  if (currentUserRole(state) === "sales_rep") {
    const outstanding = (state.stockAssignments || []).reduce((total, assignment) => {
      const assigned = Number(assignment.assigned || 0);
      const sold = Number(assignment.sold || 0);
      const returned = Number(assignment.returned || 0);
      return total + Math.max(0, assigned - sold - returned);
    }, 0);
    if (dashboardDispatchCount) dashboardDispatchCount.textContent = `${outstanding} units in hand`;
    return;
  }

  const activeDispatches = state.routes.filter((route) => ["scheduled", "in_transit"].includes(route.status)).length;
  if (dashboardDispatchCount) dashboardDispatchCount.textContent = `${activeDispatches} dispatch${activeDispatches === 1 ? "" : "es"}`;
}

function accountForCurrentUser(state) {
  const userEmail = String(state.user?.email || "").trim().toLowerCase();

  return (state.accounts || []).find((account) => (
    account.userId === state.user?.id ||
    (userEmail && String(account.email || "").trim().toLowerCase() === userEmail)
  )) || null;
}

function initialsForProfile(account, user) {
  const displayName = account?.name || user?.user_metadata?.full_name || user?.email || "DistroIQ";
  const words = String(displayName)
    .trim()
    .split(/[\s@.]+/)
    .filter(Boolean);

  return (words[0]?.[0] || "D") + (words[1]?.[0] || "I");
}

function updateTopbarUtilities(state, view) {
  if (!topbarUtilities || !topbarAvatar) return;

  const shouldShow = Boolean(state.session && !view.isSetup);
  topbarUtilities.hidden = !shouldShow;

  if (!shouldShow) {
    return;
  }

  const account = accountForCurrentUser(state);
  const userMeta = state.user?.user_metadata || {};
  const avatarUrl = userMeta.avatar_url || userMeta.picture || "";
  const profileName = account?.name || userMeta.full_name || state.user?.email || "DistroIQ user";
  const profileRole = state.platformAdmin ? "Super Admin" : account?.role ? roleLabel(account.role) : "Team member";

  topbarAvatar.title = `${profileName} - ${profileRole}`;

  if (avatarUrl) {
    topbarAvatar.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="">`;
    return;
  }

  topbarAvatar.textContent = initialsForProfile(account, state.user).toUpperCase();
}

function render() {
  const state = store.getState();
  const routeId = getCurrentRouteId(state);
  const view = routes[routeId];
  const isAuthRoute = AUTH_ROUTES.includes(routeId);
  const viewState = scopeStateForCurrentRole(state);

  document.body.dataset.appView = isAuthRoute ? "auth" : "workspace";
  setCurrencySettings(state.client);
  renderNav(routeId, state);
  updateSidebar(state);
  updateTopbarUtilities(state, view);
  viewTitle.textContent = currentUserRole(state) === "sales_rep" && routeId === "dashboard" ? "My Day" : view.title;
  globalSearch.disabled = Boolean(view.isSetup);
  signOutButton.hidden = !state.session;
  if (view.isSetup) {
    globalSearch.value = "";
  }
  viewRoot.innerHTML = view.render({ state: viewState, store, routeId });
  view.bind?.({ root: viewRoot, store, routeId, beginAuthFormFlow });
  applySearchFilter(viewRoot, globalSearch.value);
}

globalSearch.addEventListener("input", () => {
  applySearchFilter(viewRoot, globalSearch.value);
});

notificationsButton?.addEventListener("click", () => {
  showToast("No new notifications right now");
});

messagesButton?.addEventListener("click", () => {
  showToast("No unread messages right now");
});

signOutButton.addEventListener("click", async () => {
  try {
    await signOut();
  } catch (error) {
    showToast(error.message);
  } finally {
    store.dispatch({
      type: "CLEAR_AUTH_CONTEXT",
      message: "Signed out"
    });
    window.location.hash = "#/login";
  }
});

store.subscribe((state, action) => {
  render();
  showToast(action?.message);
});

window.addEventListener("hashchange", render);

replaceIconPlaceholders(document);

async function bootstrap() {
  store.dispatch({
    type: "SET_BACKEND_STATUS",
    payload: {
      configured: isBackendConfigured(),
      status: isBackendConfigured() ? "checking" : "unconfigured",
      error: ""
    }
  });

  if (!isBackendConfigured()) {
    return;
  }

  try {
    const authContext = await getAuthContext();

    if (authContext.session) {
      const platformOverview = await tryLoadPlatformOverview();

      if (platformOverview) {
        store.dispatch({
          type: "SET_PLATFORM_CONTEXT",
          session: authContext.session,
          user: authContext.user,
          platformOverview
        });
      } else {
        const workspace = await loadWorkspace();
        store.dispatch({
          type: "SET_AUTHENTICATED_WORKSPACE",
          session: authContext.session,
          user: authContext.user,
          ...workspace
        });
      }
    } else {
      store.dispatch({
        type: "SET_AUTH_CONTEXT",
        session: null,
        user: null
      });
    }

    await onAuthStateChange(async ({ session, user }) => {
      if (isAuthFormFlowActive()) {
        return;
      }

      if (session) {
        const platformOverview = await tryLoadPlatformOverview();

        if (platformOverview) {
          store.dispatch({
            type: "SET_PLATFORM_CONTEXT",
            session,
            user,
            platformOverview
          });
        } else {
          const workspace = await loadWorkspace();
          store.dispatch({
            type: "SET_AUTHENTICATED_WORKSPACE",
            session,
            user,
            ...workspace
          });
        }
      } else {
        store.dispatch({
          type: "CLEAR_AUTH_CONTEXT"
        });
      }
    });
  } catch (error) {
    store.dispatch({
      type: "SET_BACKEND_STATUS",
      payload: {
        configured: true,
        status: "error",
        error: error.message
      }
    });
  }
}

render();
bootstrap();
