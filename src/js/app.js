import { DEFAULT_ROUTE, NAV_ITEMS } from "./config/navigation.js";
import { createStore } from "./state/store.js";
import { getAuthContext, onAuthStateChange, signOut } from "./services/auth.js";
import { loadWorkspace } from "./services/backend.js";
import { setCurrencySettings } from "./services/formatters.js";
import { isBackendConfigured } from "./services/supabase-client.js";
import { applySearchFilter, qs } from "./ui/dom.js";
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
    title: "Rep Runs",
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
  }
};

const store = createStore();
const navRoot = qs("#primary-nav");
const viewRoot = qs("#view-root");
const viewTitle = qs("#view-title");
const globalSearch = qs("#global-search");
const resetButton = qs("#reset-demo-data");
const signOutButton = qs("#sign-out");
const sidebarDispatchCount = qs("#sidebar-dispatch-count");
const AUTH_ROUTES = ["login", "signup", "reset-password"];

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

  if (!state.session && !["login", "signup"].includes(routeId)) {
    return "login";
  }

  if (state.session && ["login", "signup"].includes(routeId)) {
    return state.client?.id ? DEFAULT_ROUTE : "onboarding";
  }

  if (state.session && !state.client?.id && !["onboarding", "onboarding-confirmation"].includes(routeId)) {
    return "onboarding";
  }

  if (state.session && state.client?.id && routeId === "onboarding") {
    return "onboarding-confirmation";
  }

  return routeId;
}

function renderNav(activeRouteId) {
  navRoot.innerHTML = NAV_ITEMS.map((item) => {
    const isActive = item.id === activeRouteId;

    return `
      <a class="nav-link ${isActive ? "is-active" : ""}" href="#/${item.id}" aria-current="${isActive ? "page" : "false"}">
        ${icon(item.icon)}
        <span>${item.label}</span>
      </a>
    `;
  }).join("");
}

function updateSidebar(state) {
  const activeDispatches = state.routes.filter((route) => ["scheduled", "in_transit"].includes(route.status)).length;
  sidebarDispatchCount.textContent = `${activeDispatches} dispatch${activeDispatches === 1 ? "" : "es"}`;
}

function render() {
  const state = store.getState();
  const routeId = getCurrentRouteId(state);
  const view = routes[routeId];
  const isAuthRoute = AUTH_ROUTES.includes(routeId);

  document.body.dataset.appView = isAuthRoute ? "auth" : "workspace";
  setCurrencySettings(state.client);
  renderNav(routeId);
  updateSidebar(state);
  viewTitle.textContent = view.title;
  globalSearch.disabled = Boolean(view.isSetup);
  resetButton.hidden = Boolean(state.backend.configured) || Boolean(view.isSetup);
  signOutButton.hidden = !state.session;
  if (view.isSetup) {
    globalSearch.value = "";
  }
  viewRoot.innerHTML = view.render({ state, store, routeId });
  view.bind?.({ root: viewRoot, store, routeId });
  applySearchFilter(viewRoot, globalSearch.value);
}

globalSearch.addEventListener("input", () => {
  applySearchFilter(viewRoot, globalSearch.value);
});

resetButton.addEventListener("click", () => {
  store.reset();
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
    store.dispatch({
      type: "SET_AUTH_CONTEXT",
      session: authContext.session,
      user: authContext.user
    });

    if (authContext.session) {
      const workspace = await loadWorkspace();
      store.dispatch({
        type: "SET_WORKSPACE",
        ...workspace
      });
    }

    await onAuthStateChange(async ({ session, user }) => {
      store.dispatch({
        type: "SET_AUTH_CONTEXT",
        session,
        user
      });

      if (session) {
        const workspace = await loadWorkspace();
        store.dispatch({
          type: "SET_WORKSPACE",
          ...workspace
        });
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
