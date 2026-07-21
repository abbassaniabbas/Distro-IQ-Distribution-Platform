import { DEFAULT_ROUTE, NAV_ITEMS } from "./config/navigation.js";
import { createStore } from "./state/store.js";
import { getAuthContext, onAuthStateChange, signOut } from "./services/auth.js";
import { loadWorkspace, loadWorkspaceFeatureModules, saveSharedProductImage, tryLoadPlatformOverview } from "./services/backend.js";
import { isClientRouteEnabled, scopeStateForEnabledModules } from "./services/features.js";
import { setCurrencySettings } from "./services/formatters.js";
import { canAccessRoute, currentUserPermissions, currentUserRole, roleLabel, scopeStateForCurrentRole } from "./services/rbac.js";
import { isBackendConfigured } from "./services/supabase-client.js";
import { restoreProductImages } from "./services/product-images.js";
import { createOperationalSync } from "./services/operational-sync.js";
import { buildGlobalSearchIndex, findGlobalSearchSuggestions } from "./services/global-search.js";
import { createInactivitySession } from "./services/inactivity-session.js";
import { hasOrdersRequiringAutomaticDelay } from "./services/calculations.js";
import { applySearchFilter, escapeHtml, qs, qsa } from "./ui/dom.js";
import { bindRequiredFieldValidation, captureInMemoryFormDrafts, clearAllFormDrafts } from "./ui/form-validation.js";
import { icon, replaceIconPlaceholders } from "./ui/icons.js";
import {
  bindTopbarCommunications,
  getTopbarNotificationItems,
  getUnreadNotificationCount,
  getUnreadMessageCount
} from "./ui/topbar-communications.js";
import { showToast } from "./ui/toast.js";
import { renderActivityLog, bindActivityLog } from "./views/activity-log.js";
import { renderAdminOperations, bindAdminOperations } from "./views/admin-operations.js";
import { renderAuth, bindAuth, renderForgotPassword, bindForgotPassword } from "./views/auth.js";
import { renderBackendSetup, bindBackendSetup } from "./views/backend-setup.js";
import { renderDashboard, bindDashboard } from "./views/dashboard.js";
import { renderFinance, bindFinance } from "./views/finance.js";
import { renderInventory, bindInventory } from "./views/inventory.js";
import { renderInvoices, bindInvoices } from "./views/invoices.js";
import { renderLoading, bindLoading } from "./views/loading.js";
import { renderMessages, bindMessages } from "./views/messages.js";
import {
  renderOnboarding,
  bindOnboarding,
  renderOnboardingConfirmation,
  bindOnboardingConfirmation
} from "./views/onboarding.js";
import { renderOrders, bindOrders } from "./views/orders.js";
import { renderPasswordReset, bindPasswordReset } from "./views/password-reset.js?v=20260715";
import { renderPlatformConsole, bindPlatformConsole } from "./views/platform.js";
import { renderPurchaseOrders, bindPurchaseOrders } from "./views/purchase-orders.js";
import { renderRetailers, bindRetailers } from "./views/retailers.js";
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
    title: "No Connection",
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
  "forgot-password": {
    title: "Forgot Password",
    render: renderForgotPassword,
    bind: bindForgotPassword,
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
  messages: {
    title: "Messages",
    render: renderMessages,
    bind: bindMessages
  },
  orders: {
    title: "Sales Orders",
    render: renderOrders,
    bind: bindOrders
  },
  "purchase-orders": {
    title: "Purchase Orders",
    render: renderPurchaseOrders,
    bind: bindPurchaseOrders
  },
  "admin-operations": {
    title: "Admin Operations",
    render: renderAdminOperations,
    bind: bindAdminOperations
  },
  inventory: {
    title: "Stock",
    render: renderInventory,
    bind: bindInventory
  },
  retailers: {
    title: "Customers",
    render: renderRetailers,
    bind: bindRetailers
  },
  team: {
    title: "Staff",
    render: renderTeam,
    bind: bindTeam
  },
  finance: {
    title: "Finance",
    render: renderFinance,
    bind: bindFinance
  },
  invoices: {
    title: "Invoices",
    render: renderInvoices,
    bind: bindInvoices
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

const BACKEND_RETRY_DELAY_MS = 700;

async function withBackendRetry(operation) {
  try {
    return await operation();
  } catch {
    await new Promise((resolve) => window.setTimeout(resolve, BACKEND_RETRY_DELAY_MS));
    return operation();
  }
}

const store = createStore();
const operationalSync = createOperationalSync({ store });
const inactivitySession = createInactivitySession({
  getState: () => store.getState(),
  getRole: currentUserRole,
  onTimeout: async () => {
    try {
      await signOut();
    } catch {
      // The local session is still cleared when the network cannot complete sign-out.
    } finally {
      clearAllFormDrafts();
      store.dispatch({
        type: "CLEAR_AUTH_CONTEXT",
        message: "Signed out after 30 minutes of inactivity"
      });
      window.location.hash = "#/login?reason=inactivity";
    }
  }
});
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
const searchSuggestions = document.createElement("div");
const AUTH_ROUTES = ["login", "signup", "forgot-password", "reset-password", "platform-admin"];
const PLATFORM_NAV_ITEMS = [
  {
    id: "platform-console",
    label: "Platform Console",
    icon: "dashboard"
  }
];
let activeAuthFormFlows = 0;
let activeViewAbortController = null;
let featureModuleRefreshPending = false;
let selectedSearchSuggestion = "";
let preserveScrollOnNextHashChange = false;
const FEATURE_MODULE_REFRESH_MS = 5000;
const DELAY_STATUS_REFRESH_MS = 15 * 60 * 1000;

searchSuggestions.className = "search-suggestions";
searchSuggestions.hidden = true;
globalSearch.parentElement?.appendChild(searchSuggestions);

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
  return currentUserPermissions(state).nav.find((routeId) => isClientRouteEnabled(state, routeId)) || DEFAULT_ROUTE;
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

  if (!state.session && !["login", "signup", "forgot-password", "platform-admin"].includes(routeId)) {
    return "login";
  }

  if (state.session && ["login", "signup", "forgot-password"].includes(routeId)) {
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

  if (!state.session || !state.client?.id) {
    navRoot.innerHTML = "";
    return;
  }

  const permissions = currentUserPermissions(state);
  const role = currentUserRole(state);
  const visibleItems = state.session && state.client?.id
    ? NAV_ITEMS.filter((item) => permissions.nav.includes(item.id) && isClientRouteEnabled(state, item.id))
    : NAV_ITEMS;

  navRoot.innerHTML = visibleItems.map((item) => {
    const isActive = item.id === activeRouteId;
    const label = role === "sales_rep" && item.id === "dashboard"
      ? "My Day"
      : role === "store_keeper" && item.id === "admin-operations"
        ? "Supplier Receipts"
      : role === "sales_rep" && item.id === "activity-log"
        ? "Recent Activity"
        : item.label;

    return `
      <a class="nav-link ${isActive ? "is-active" : ""}" href="#/${item.id}" aria-current="${isActive ? "page" : "false"}">
        ${icon(item.icon)}
        <span>${escapeHtml(label)}</span>
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

  const today = new Date().toISOString().slice(0, 10);
  const activeDispatches = (state.stockTransactions || []).filter((transaction) => (
    transaction.date === today &&
    String(transaction.movementDirection || "").toLowerCase() === "out" &&
    String(transaction.type || "").toLowerCase() !== "write off"
  )).length;
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
    notificationsButton?.classList.remove("has-alert");
    messagesButton?.classList.remove("has-alert");
    return;
  }

  const account = accountForCurrentUser(state);
  const userMeta = state.user?.user_metadata || {};
  const avatarUrl = account?.staffImageUrl || userMeta.avatar_url || userMeta.picture || "";
  const profileName = account?.name || userMeta.full_name || state.user?.email || "DistroIQ user";
  const profileRole = state.platformAdmin ? "Super Admin" : account?.role ? roleLabel(account.role) : "Team member";

  topbarAvatar.title = `${profileName} - ${profileRole}`;
  const unreadMessages = getUnreadMessageCount(state);
  const notificationCount = getTopbarNotificationItems(state).length;
  const unreadNotifications = getUnreadNotificationCount(state);

  notificationsButton?.classList.toggle("has-alert", unreadNotifications > 0);
  messagesButton?.classList.toggle("has-alert", unreadMessages > 0);
  notificationsButton?.setAttribute(
    "aria-label",
    unreadNotifications ? `Notifications, ${unreadNotifications} new` : notificationCount ? `Notifications, ${notificationCount} available` : "Notifications"
  );
  messagesButton?.setAttribute(
    "aria-label",
    unreadMessages ? `Messages, ${unreadMessages} unread` : "Messages"
  );

  if (avatarUrl) {
    topbarAvatar.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="">`;
    return;
  }

  topbarAvatar.textContent = initialsForProfile(account, state.user).toUpperCase();
}

function updateSearchSuggestions() {
  const query = String(globalSearch.value || "").trim();

  if (
    globalSearch.disabled ||
    query.length < 2 ||
    (selectedSearchSuggestion && query.toLowerCase() === selectedSearchSuggestion.toLowerCase())
  ) {
    searchSuggestions.hidden = true;
    searchSuggestions.innerHTML = "";
    return;
  }

  const state = store.getState();
  const permissions = currentUserPermissions(state);
  const allowedRouteIds = permissions.nav.filter((routeId) => isClientRouteEnabled(state, routeId));
  const searchState = scopeStateForCurrentRole(scopeStateForEnabledModules(state));
  const searchIndex = buildGlobalSearchIndex({
    state: searchState,
    navigationItems: NAV_ITEMS,
    allowedRouteIds
  });
  const matches = findGlobalSearchSuggestions(searchIndex, query);

  if (!matches.length) {
    searchSuggestions.hidden = true;
    searchSuggestions.innerHTML = "";
    return;
  }

  searchSuggestions.innerHTML = matches.map((match) => `
    <button
      type="button"
      data-search-suggestion="${escapeHtml(match.label)}"
      data-search-href="${escapeHtml(match.href)}"
      data-search-query-on-navigate="${match.queryOnNavigate ? "true" : "false"}"
    >
      <span class="search-suggestion-label">${escapeHtml(match.label)}</span>
      <small>${escapeHtml(match.context)}</small>
    </button>
  `).join("");
  searchSuggestions.hidden = false;
}

function render() {
  const state = store.getState();
  const routeId = getCurrentRouteId(state);
  const view = routes[routeId];
  const isAuthRoute = AUTH_ROUTES.includes(routeId);
  const viewState = scopeStateForCurrentRole(scopeStateForEnabledModules(state));
  const formScope = `${state.client?.id || "no-client"}:${state.user?.id || "anonymous"}`;

  captureInMemoryFormDrafts(viewRoot, { scope: formScope });

  document.body.dataset.appView = isAuthRoute || routeId === "backend-setup" ? "auth" : "workspace";
  setCurrencySettings(state.client);
  renderNav(routeId, state);
  updateSidebar(state);
  updateTopbarUtilities(state, view);
  viewTitle.textContent = currentUserRole(state) === "sales_rep" && routeId === "dashboard"
    ? "My Day"
    : currentUserRole(state) === "sales_rep" && routeId === "activity-log"
      ? "Recent Activity"
      : view.title;
  globalSearch.disabled = Boolean(view.isSetup);
  signOutButton.hidden = !state.session;
  if (view.isSetup) {
    globalSearch.value = "";
  }

  activeViewAbortController?.abort();
  activeViewAbortController = new AbortController();
  viewRoot.innerHTML = view.render({ state: viewState, store, routeId });
  view.bind?.({
    root: viewRoot,
    store,
    routeId,
    beginAuthFormFlow,
    signal: activeViewAbortController.signal
  });
  bindRequiredFieldValidation(viewRoot, {
    scope: formScope
  });
  applySearchFilter(viewRoot, globalSearch.value);
  updateSearchSuggestions();
}

globalSearch.addEventListener("input", (event) => {
  if (event.isTrusted) selectedSearchSuggestion = "";
  applySearchFilter(viewRoot, globalSearch.value);
  updateSearchSuggestions();
});

globalSearch.addEventListener("blur", () => {
  window.setTimeout(() => {
    searchSuggestions.hidden = true;
  }, 120);
});

globalSearch.addEventListener("focus", updateSearchSuggestions);

searchSuggestions.addEventListener("mousedown", (event) => {
  event.preventDefault();
});

searchSuggestions.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-search-suggestion]");
  if (!button) return;

  selectedSearchSuggestion = button.dataset.searchSuggestion || "";
  const shouldKeepQuery = button.dataset.searchQueryOnNavigate === "true";
  globalSearch.value = shouldKeepQuery ? selectedSearchSuggestion : "";
  searchSuggestions.hidden = true;
  searchSuggestions.innerHTML = "";
  const destination = button.dataset.searchHref || "";
  if (destination && destination !== window.location.hash) {
    window.location.hash = destination;
    return;
  }
  applySearchFilter(viewRoot, globalSearch.value);
});

bindTopbarCommunications({ store, notificationsButton, messagesButton });

document.addEventListener("click", (event) => {
  const link = event.target.closest?.("a[data-preserve-scroll]");
  if (!link || link.getAttribute("href") === window.location.hash) return;
  preserveScrollOnNextHashChange = true;
});

signOutButton.addEventListener("click", async () => {
  inactivitySession.clear();
  try {
    await signOut();
  } catch (error) {
    showToast(error.message);
  } finally {
    clearAllFormDrafts();
    store.dispatch({
      type: "CLEAR_AUTH_CONTEXT",
      message: "Signed out"
    });
    window.location.hash = "#/login";
  }
});

store.subscribe((state, action) => {
  inactivitySession.handleStateChange(state);
  render();
  showToast(action?.message);
  operationalSync.handleStateChange(state, action);
});

window.addEventListener("hashchange", () => {
  const preserveScroll = preserveScrollOnNextHashChange;
  const previousScrollY = window.scrollY;
  preserveScrollOnNextHashChange = false;
  if (!preserveScroll) window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  render();
  if (preserveScroll) {
    window.requestAnimationFrame(() => window.scrollTo({ top: previousScrollY, left: 0, behavior: "auto" }));
  }
});

window.addEventListener("offline", render);
window.addEventListener("online", () => {
  if ((store.getState().offlineSalesQueue || []).length) {
    store.dispatch({ type: "SYNC_OFFLINE_SALES", message: "Offline sales synced" });
    return;
  }
  render();
});

function featureModuleSignature(featureModules) {
  return (featureModules || [])
    .map((module) => `${module.id || module.moduleKey}:${module.enabled}:${module.updatedAt || ""}`)
    .sort()
    .join("|");
}

async function refreshWorkspaceFeatureModules() {
  const state = store.getState();

  if (
    featureModuleRefreshPending ||
    !state.session ||
    !state.client?.id ||
    state.platformAdmin ||
    !isBackendConfigured()
  ) {
    return;
  }

  featureModuleRefreshPending = true;
  try {
    const featureModules = await loadWorkspaceFeatureModules(state.client.id);

    if (featureModuleSignature(featureModules) !== featureModuleSignature(store.getState().featureModules)) {
      store.dispatch({ type: "SET_FEATURE_MODULES", featureModules });
    }
  } catch {
    // Keep the last known module configuration if a background check cannot complete.
  } finally {
    featureModuleRefreshPending = false;
  }
}

window.setInterval(refreshWorkspaceFeatureModules, FEATURE_MODULE_REFRESH_MS);

function refreshDelayedOrderStatuses() {
  const state = store.getState();
  if (
    !state.session ||
    !state.client?.id ||
    state.platformAdmin ||
    document.documentElement.dataset.filePickerActive === "true" ||
    qsa('input[type="password"]', viewRoot).some((input) => input.value)
  ) return;

  const today = new Date().toISOString().slice(0, 10);
  const hasNewDelay = hasOrdersRequiringAutomaticDelay(state.orders, today);

  // Returning to the browser tab must not rebuild the active page unless an
  // order genuinely crossed its expected delivery date.
  if (!hasNewDelay) return;
  store.dispatch({ type: "AUTO_UPDATE_DELAYED_ORDERS" });
}

window.setInterval(refreshDelayedOrderStatuses, DELAY_STATUS_REFRESH_MS);
window.addEventListener("focus", refreshDelayedOrderStatuses);

replaceIconPlaceholders(document);

async function hydrateWorkspaceProductImages() {
  const state = store.getState();
  if (!state.client?.id || !(state.products || []).length) return;

  try {
    const images = await restoreProductImages(state.client.id, state.products);
    if (!images.length) return;
    store.dispatch({ type: "HYDRATE_PRODUCT_IMAGES", images });

    if (!isBackendConfigured() || !["ceo", "store_keeper"].includes(currentUserRole(store.getState()))) return;

    const currentProducts = new Map((store.getState().products || []).map((product) => [String(product.id || ""), product]));
    const syncedImages = [];
    for (const image of images) {
      const product = currentProducts.get(String(image.productId || ""));
      if (!product || product.imageRemoteSynced || !String(image.imageUrl || "").startsWith("data:image/")) continue;

      try {
        const savedImage = await saveSharedProductImage({
          clientId: state.client.id,
          sku: product.id,
          name: product.name,
          unit: product.unit,
          status: product.status,
          imageUrl: image.imageUrl
        });
        syncedImages.push({
          ...savedImage,
          imageStorageKey: image.imageStorageKey,
          remoteSynced: true
        });
      } catch (error) {
        // Keep the durable browser copy available and retry on the next sign-in.
        console.warn(`Stock picture for ${product.id} could not be backed up:`, error.message);
      }
    }

    if (syncedImages.length) {
      store.dispatch({ type: "HYDRATE_PRODUCT_IMAGES", images: syncedImages });
    }
  } catch (error) {
    console.warn("Stock pictures could not be restored:", error.message);
  }
}

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
    await hydrateWorkspaceProductImages();
    return;
  }

  try {
    const authContext = await withBackendRetry(getAuthContext);

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
        const workspace = await withBackendRetry(loadWorkspace);
        store.dispatch({
          type: "SET_AUTHENTICATED_WORKSPACE",
          session: authContext.session,
          user: authContext.user,
          ...workspace
        });
        await hydrateWorkspaceProductImages();
      }
    } else {
      store.dispatch({
        type: "SET_AUTH_CONTEXT",
        session: null,
        user: null
      });
    }

    await onAuthStateChange(async ({ event, session, user }) => {
      if (isAuthFormFlowActive()) {
        return;
      }

      const currentState = store.getState();
      const currentUserId = String(currentState.user?.id || "");
      const incomingUserId = String(user?.id || "");
      const sameAuthenticatedUser = Boolean(
        currentState.session &&
        currentUserId &&
        incomingUserId &&
        currentUserId === incomingUserId
      );

      // Supabase can repeat these session events when a background tab becomes
      // active. The token remains managed by Supabase, so avoid reloading the
      // workspace and destroying open modals or unfinished fields.
      if (
        session &&
        sameAuthenticatedUser &&
        ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED"].includes(event)
      ) {
        return;
      }

      try {
        if (session) {
          if (event === "PASSWORD_RECOVERY" && getHashRouteId() !== "reset-password") {
            window.location.hash = "#/reset-password?recovery=1";
          }
          const platformOverview = await tryLoadPlatformOverview();

          if (platformOverview) {
            store.dispatch({
              type: "SET_PLATFORM_CONTEXT",
              session,
              user,
              platformOverview
            });
          } else {
            const workspace = await withBackendRetry(loadWorkspace);
            store.dispatch({
              type: "SET_AUTHENTICATED_WORKSPACE",
              session,
              user,
              ...workspace
            });
            await hydrateWorkspaceProductImages();
          }
        } else {
          store.dispatch({
            type: "CLEAR_AUTH_CONTEXT"
          });
        }
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
