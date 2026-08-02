import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { calculateMetrics, effectiveOrderStatus, getCustomerOrderCompletion, getFinancialSalesLines, getOrdersWithTotals, getReturnableCustomerChoices, hasOrdersRequiringAutomaticDelay, summarizeSalesLines } from "../src/js/services/calculations.js";
import { getNigeriaLgas, NIGERIA_STATES_AND_LGAS, NIGERIA_STATE_NAMES, normalizeNigeriaStateName } from "../src/js/data/nigeria-locations.js";
import { buildInvoiceDocument, buildInvoicePreviewContent, buildInvoiceQuickViewMarkup, getFinancialInvoiceRecords, getInvoiceRecords } from "../src/js/services/invoices.js";
import { effectivePiecePrice, packagingLineAmount, packagingQuantityLabel, packagingUnitPrice, quantityInPieces } from "../src/js/services/packaging.js";
import { scopeStateForEnabledModules } from "../src/js/services/features.js";
import { currentUserPermissions, currentUserRole, scopeStateForCurrentRole } from "../src/js/services/rbac.js";
import { nextFormattedId } from "../src/js/services/tenant.js";
import { classifyAppFailure } from "../src/js/services/error-classification.js";
import { friendlyEdgeFunctionMessage } from "../src/js/services/backend.js";
import { getScopedActivityLogs } from "../src/js/services/activity.js";
import { OPERATIONAL_COLLECTIONS, collectionsFromRemote, operationalChanges, operationalCollectionsForRole, operationalSnapshot } from "../src/js/services/operational-sync.js";
import { dateIsWithinRange, normalizeDateRange } from "../src/js/services/filtering.js";
import { buildGlobalSearchIndex, findGlobalSearchSuggestions } from "../src/js/services/global-search.js";
import { INACTIVITY_TIMEOUT_MS, remainingInactivityMs, requiresInactivityLogout } from "../src/js/services/inactivity-session.js";
import { createStore } from "../src/js/state/store.js";
import { getTopbarNotificationItems } from "../src/js/ui/topbar-communications.js";
import { REQUIRED_FORM_ALERT_MESSAGE } from "../src/js/ui/form-validation.js";
import { MODAL_SAFE_BACKGROUND_ACTIONS, hasOpenWorkspaceModal, shouldDeferRenderForModal } from "../src/js/ui/modal-render-guard.js";
import { renderAuth, renderForgotPassword } from "../src/js/views/auth.js";
import { renderBackendSetup } from "../src/js/views/backend-setup.js";
import { renderActivityLog } from "../src/js/views/activity-log.js";
import { renderAdjustments } from "../src/js/views/adjustments.js";
import { ceoActualSalesRevenue, renderDashboard } from "../src/js/views/dashboard.js";
import { renderFinance } from "../src/js/views/finance.js";
import { renderInventory, renderRecordCorrectionModal } from "../src/js/views/inventory.js";
import { renderInvoices } from "../src/js/views/invoices.js";
import { renderMessages } from "../src/js/views/messages.js";
import { renderOrders } from "../src/js/views/orders.js";
import { renderPasswordReset } from "../src/js/views/password-reset.js";
import { renderProduction } from "../src/js/views/production.js";
import { renderCustomerDetails, renderRetailers } from "../src/js/views/retailers.js";
import { renderSettings } from "../src/js/views/settings.js";
import { buildLoginDetailsEmail } from "../src/js/views/team.js";
import { renderTeam } from "../src/js/views/team.js";

globalThis.window = { location: { hash: "#/dashboard" } };
const responsiveLayoutCss = readFileSync(new URL("../src/css/layout.css", import.meta.url), "utf8");
const responsiveComponentCss = readFileSync(new URL("../src/css/components.css", import.meta.url), "utf8");
const responsiveViewCss = readFileSync(new URL("../src/css/views.css", import.meta.url), "utf8");
const workspaceDataResetSource = readFileSync(new URL("../src/js/ui/workspace-data-reset.js", import.meta.url), "utf8");
const actionDialogSource = readFileSync(new URL("../src/js/ui/action-dialog.js", import.meta.url), "utf8");
const ceoPasswordVerificationSource = readFileSync(new URL("../src/js/ui/ceo-password-verification.js", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/js/app.js", import.meta.url), "utf8");
const backendSource = readFileSync(new URL("../src/js/services/backend.js", import.meta.url), "utf8");
const messageManagementSql = readFileSync(new URL("../supabase/message-management.sql", import.meta.url), "utf8");
assert.match(responsiveLayoutCss, /@media \(max-width: 640px\)[\s\S]*\.view-root,[\s\S]*padding: 14px 12px 24px/, "phone layouts must use compact page padding");
assert.match(responsiveComponentCss, /@media \(max-width: 720px\)[\s\S]*\.icon-button[\s\S]*width: 44px;[\s\S]*height: 44px/, "phone and tablet controls must retain touch-friendly targets");
assert.match(responsiveComponentCss, /\.table-wrap[\s\S]*-webkit-overflow-scrolling: touch/, "wide tables must scroll safely on touch devices");
assert.match(responsiveComponentCss, /:has\(input\[required\][\s\S]*content: " \*";/, "required textboxes must display a visible asterisk beside their labels");
assert.match(responsiveViewCss, /@media \(max-width: 640px\)[\s\S]*max-height: calc\(100dvh - 20px\)/, "mobile modals must remain inside the visible viewport");
assert.match(responsiveViewCss, /\.stock-health-grid\s*\{[\s\S]*grid-template-columns: repeat\(auto-fill, minmax\(230px, 280px\)\);[\s\S]*justify-content: start;/, "Stock Health grid cards must keep a normal width and fill from the left");
assert.match(responsiveViewCss, /\.product-catalogue-size-modal \.ceo-size-picture-grid\s*\{[\s\S]*grid-template-columns: repeat\(auto-fill, minmax\(230px, 280px\)\);[\s\S]*justify-content: start;/, "all portal product catalogues must share the normal CEO image-card width");
assert.doesNotMatch(responsiveViewCss, /\.rep-product-size-modal \.ceo-size-picture\s*\{[\s\S]*min-height:/, "sales representative catalogue images must not override the shared CEO image proportions");
assert.match(responsiveViewCss, /\.profile-settings-form\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/, "profile settings fields must stay aligned in one responsive column");
assert.match(responsiveViewCss, /\.profile-settings-form \.field-error:empty\s*\{[\s\S]*display: none;/, "empty profile validation rows must not offset the profile fields");
assert.match(responsiveViewCss, /\.settings-layout\s*\{[\s\S]*grid-template-columns: minmax\(0, 3fr\) minmax\(320px, 2fr\);/, "CEO settings must use the requested 60/40 Factory Settings and My Profile width split");
assert.match(responsiveViewCss, /\.settings-top-panel > \.panel\s*\{[\s\S]*height: 100%;/, "Factory Settings and My Profile panels must have equal top-to-bottom length");
assert.match(responsiveViewCss, /\.rep-request-quantity-fields:focus-within[\s\S]*box-shadow:[^;]+;/, "representative stock-request quantity controls must have a clear polished focus state");
assert.match(responsiveViewCss, /\.rep-stock-quantity-row\s*\{[\s\S]*display: flex;[\s\S]*justify-content: flex-start;[\s\S]*gap: 8px;/, "assigned package stock must sit immediately beside the remaining piece count");
assert.match(backendSource, /export async function loadWorkspacePackagingState[\s\S]*packaging_change_requests/, "background configuration refresh must load packaging approval requests");
assert.match(backendSource, /role === "production_manager"[\s\S]*choose a valid role[\s\S]*deploy the latest invite-user function/, "a stale invitation function must report the required backend update instead of rejecting the selected role as invalid");
assert.match(appSource, /loadWorkspacePackagingState\([\s\S]*SET_PACKAGING_WORKSPACE_STATE/, "active portals must receive packaging requests and approved settings without a new sign-in");
assert.match(messageManagementSql, /workspace_message_deletions[\s\S]*membership_id/, "message deletion must be stored per staff member");
assert.match(messageManagementSql, /delete_my_workspace_messages[\s\S]*p_unsend[\s\S]*messages\.from_membership_id = v_current_membership_id/, "only a message sender may unsend it for everyone");
assert.match(messageManagementSql, /clear_my_workspace_conversation[\s\S]*p_peer_membership_id[\s\S]*on conflict \(message_id, membership_id\) do nothing/, "conversation clearing must remain scoped to the current staff member and selected conversation");
assert.match(messageManagementSql, /get_my_workspace_messages[\s\S]*not exists[\s\S]*workspace_message_deletions/, "messages privately deleted by the current staff member must stay out of backend refreshes");
const currentTestDate = new Date().toISOString().slice(0, 10);
const browserStorage = new Map();
globalThis.localStorage = {
  getItem(key) { return browserStorage.get(key) || null; },
  setItem(key, value) { browserStorage.set(key, String(value)); },
  removeItem(key) { browserStorage.delete(key); }
};

assert.deepEqual(normalizeDateRange("2026-07-20", "2026-07-10"), { from: "2026-07-10", to: "2026-07-20" });
assert.equal(dateIsWithinRange("2026-07-10", "2026-07-10", "2026-07-20"), true, "date filters must include the first day");
assert.equal(dateIsWithinRange("2026-07-20", "2026-07-10", "2026-07-20"), true, "date filters must include the last day");
assert.equal(requiresInactivityLogout("ceo"), true);
assert.equal(requiresInactivityLogout("admin"), true);
assert.equal(requiresInactivityLogout("store_keeper"), true);
assert.equal(requiresInactivityLogout("production_manager"), true);
assert.equal(requiresInactivityLogout("sales_rep"), false, "sales representatives must keep their offline field sessions");
assert.equal(remainingInactivityMs(1_000, 1_000), INACTIVITY_TIMEOUT_MS);

const globalSearchFixture = buildGlobalSearchIndex({
  state: {
    products: [{ id: "SKU-0044", name: "Plantain Chips", productType: "Original" }],
    retailers: [{ id: "CUS-1", name: "Abbas Stores", address: "Kaduna" }],
    accounts: [{ id: "STAFF-1", name: "Steph Musa", role: "admin" }]
  },
  navigationItems: [
    { id: "inventory", label: "Stock" },
    { id: "retailers", label: "Customers" },
    { id: "team", label: "Staff" }
  ],
  allowedRouteIds: ["inventory", "retailers", "team"]
});
assert.equal(findGlobalSearchSuggestions(globalSearchFixture, "Plantain")[0]?.context, "Stock");
assert.equal(findGlobalSearchSuggestions(globalSearchFixture, "Abbas")[0]?.href, "#/retailers");
assert.equal(findGlobalSearchSuggestions(globalSearchFixture, "Steph")[0]?.context, "Staff");

const client = { id: "client-test", companyName: "Test Factory", currencySymbol: "₦", packagingTypes: ["piece", "carton", "pack"], packagingDefaults: { piece: 1, carton: 10, pack: 5 } };
const accounts = [
  { id: "membership-rep", clientId: client.id, userId: "user-rep", name: "Amina Rep", email: "amina@example.com", role: "sales_rep", status: "active" },
  { id: "membership-manager", clientId: client.id, userId: "user-manager", name: "Musa Manager", email: "musa@example.com", role: "manager", status: "active" },
  { id: "membership-ceo", clientId: client.id, userId: "user-ceo", name: "Chioma CEO", email: "chioma@example.com", role: "ceo", status: "active" },
  { id: "membership-store", clientId: client.id, userId: "user-store", name: "Tola Store", email: "tola@example.com", role: "store_keeper", status: "active" },
  { id: "membership-production", clientId: client.id, userId: "user-production", name: "Bello Production", email: "bello@example.com", role: "production_manager", status: "active" },
  { id: "membership-admin", clientId: client.id, userId: "user-admin", name: "Ada Admin", email: "ada@example.com", role: "admin", status: "active" }
];

const sharedCustomerStore = createStore();
const secondRepresentative = { id: "membership-rep-two", clientId: client.id, userId: "user-rep-two", name: "Binta Rep", email: "binta@example.com", role: "sales_rep", status: "active" };
const sharedCustomerAccounts = [...accounts, secondRepresentative];
function authenticateSharedCustomerUser(account) {
  sharedCustomerStore.dispatch({
    type: "SET_AUTHENTICATED_WORKSPACE",
    session: { user: { id: account.userId } },
    user: { id: account.userId, email: account.email, user_metadata: { full_name: account.name } },
    client,
    accounts: sharedCustomerAccounts,
    invites: [],
    featureModules: [],
    messages: [],
    activityLogs: sharedCustomerStore.getState().activityLogs
  });
}
authenticateSharedCustomerUser(accounts[0]);
sharedCustomerStore.dispatch({
  type: "UPSERT_RETAILER",
  name: "Shared Corner Shop",
  stateName: "Kaduna",
  lga: "Chikun",
  address: "Central Market",
  channel: "Kiosk",
  assignedRepUserId: accounts[0].userId,
  assignedRepName: accounts[0].name
});
const sharedCustomer = sharedCustomerStore.getState().retailers.find((customer) => customer.name === "Shared Corner Shop");
assert.ok(sharedCustomer, "a Sales Representative must be able to save a company customer");
assert.equal(sharedCustomer.createdByUserId, accounts[0].userId);
assert.equal(sharedCustomer.createdByName, "Amina Rep", "the customer record must retain who originally added it");
assert.ok(sharedCustomer.createdAt, "the customer record must retain when it was added");
const sharedCustomerSyncRecord = operationalSnapshot(sharedCustomerStore.getState(), ["retailers"]).get("retailers").get(sharedCustomer.id).data;
assert.equal(sharedCustomerSyncRecord.createdByName, "Amina Rep", "creator attribution must be persisted with the backend customer record");
authenticateSharedCustomerUser(secondRepresentative);
const secondRepCustomerState = scopeStateForCurrentRole(sharedCustomerStore.getState());
assert.ok(secondRepCustomerState.retailers.some((customer) => customer.id === sharedCustomer.id), "customers added by one rep must be visible to every other rep");
const secondRepDashboard = renderDashboard({ state: secondRepCustomerState });
assert.match(secondRepDashboard, new RegExp(`<option value="${sharedCustomer.id}">Shared Corner Shop<\\/option>`), "another rep must be able to select the saved customer for a sale without retyping it");
const sharedCustomerDirectory = renderRetailers({ state: secondRepCustomerState });
assert.match(sharedCustomerDirectory, /Shared Corner Shop[\s\S]*Added by Amina Rep/, "the shared customer directory must show who added the customer");
const sharedCustomerDetails = renderCustomerDetails(sharedCustomer, secondRepCustomerState, currentUserPermissions(secondRepCustomerState));
assert.match(sharedCustomerDetails, /Added by[\s\S]*Amina Rep/, "customer details must identify the original creator");

const store = createStore();

assert.equal(
  currentUserRole({ accounts: [], user: { user_metadata: { role: "ceo" } } }),
  "sales_rep",
  "untrusted user metadata must not grant a privileged role"
);
assert.equal(nextFormattedId("SKU-{0000}", ["SKU-0001", "SKU-0008"], "SKU"), "SKU-0009");
assert.equal(nextFormattedId("INV-{000}", ["INV-001"], "INV"), "INV-002");
assert.equal(quantityInPieces({ packagingConversions: { carton: 24 } }, 2, "carton"), 48);
assert.equal(packagingQuantityLabel(2, "carton"), "2 cartons");
const packagePriceFixture = { unitPrice: 200, packagingConversions: { carton: 10 }, packagingPrices: { carton: 1800 } };
assert.equal(packagingUnitPrice(packagePriceFixture, "carton", client), 1800);
assert.equal(effectivePiecePrice(packagePriceFixture, "carton", client), 180);
assert.equal(packagingLineAmount(packagePriceFixture, 2, "carton", client), 3600);

const representativeCustodySalesFixture = {
  products: [{ id: "SKU-CUSTODY", name: "Custody Chips", unitPrice: 1000, unitCost: 500, stockCategory: "finished_products" }],
  stockAssignments: [{ id: "ASN-CUSTODY", productId: "SKU-CUSTODY", repName: "Amina Rep", assigned: 480, sold: 30, returned: 100, transactionId: "TXN-CUSTODY-ISSUED" }],
  stockTransactions: [
    { id: "TXN-CUSTODY-ISSUED", type: "supply", productId: "SKU-CUSTODY", quantity: 480, packagingType: "carton", packagingQuantity: 20, amount: 48000, partyType: "Sales Representative", partyName: "Amina Rep" },
    { id: "TXN-CUSTODY-SALE", type: "sale", productId: "SKU-CUSTODY", quantity: 30, amount: 30000, partyType: "Customer", partyName: "Retail customer", financialImpact: false, accountingTreatment: "sell_through_only", assignmentId: "ASN-CUSTODY" },
    { id: "TXN-CUSTODY-RETURNED", type: "return to factory", productId: "SKU-CUSTODY", quantity: 100, amount: 0, partyType: "Sales Representative", partyName: "Amina Rep", assignmentId: "ASN-CUSTODY" }
  ],
  orders: [
    { id: "ORD-CUSTODY-DISPATCH", source: "factory_dispatch", customerType: "Sales Representative", customerName: "Amina Rep", transactionId: "TXN-CUSTODY-ISSUED", items: [{ productId: "SKU-CUSTODY", quantity: 480, packagingType: "carton", packagingQuantity: 20, packagingUnitPrice: 2400, unitPrice: 100, lineAmount: 48000 }] },
    { id: "ORD-ACTUAL-SALE", source: "quick_sale", status: "delivered", customerName: "Retail customer", transactionId: "TXN-CUSTODY-SALE", financialImpact: false, accountingTreatment: "sell_through_only", items: [{ productId: "SKU-CUSTODY", quantity: 30, unitPrice: 1000, lineAmount: 30000, transactionId: "TXN-CUSTODY-SALE" }] }
  ],
  invoices: [],
  routes: [],
  retailers: []
};
assert.equal(calculateMetrics(representativeCustodySalesFixture).orderRevenue, 48000, "the finance ledger calculation must remain unchanged for the existing representative dispatch invoice");
assert.equal(getFinancialSalesLines(representativeCustodySalesFixture).reduce((total, line) => total + line.revenue, 0), 48000, "the Finance section must retain its existing representative dispatch accounting record");
assert.equal(ceoActualSalesRevenue(representativeCustodySalesFixture), 30000, "the CEO Sales card must show the actual ₦30,000 customer sale instead of the ₦48,000 representative stock dispatch");

const grossNetFinanceFixture = {
  products: [{ id: "SKU-GROSS-NET", name: "Gross Net Chips", unitPrice: 500, unitCost: 200 }],
  retailers: [],
  routes: [],
  invoices: [],
  stockAssignments: [],
  orders: [{
    id: "ORD-GROSS-NET",
    source: "factory_dispatch",
    customerName: "Gross Net Customer",
    paymentType: "cash",
    createdAt: currentTestDate,
    items: [{
      productId: "SKU-GROSS-NET",
      quantity: 2,
      grossAmount: 1000,
      discountAmount: 100,
      otherDeductions: 50,
      netAmount: 850,
      unitCost: 200
    }]
  }],
  stockTransactions: [{
    id: "TXN-GROSS-NET-RETURN",
    type: "return",
    productId: "SKU-GROSS-NET",
    quantity: 1,
    amount: 200,
    unitCost: 200,
    partyName: "Gross Net Customer",
    recordedBy: "Factory",
    date: currentTestDate
  }]
};
const grossNetFinanceTotals = summarizeSalesLines(getFinancialSalesLines(grossNetFinanceFixture));
assert.deepEqual(grossNetFinanceTotals, {
  grossSales: 1000,
  returns: 200,
  discounts: 100,
  otherDeductions: 50,
  netSales: 650
}, "finance must calculate net sales as gross sales less returns, discounts, and other deductions");
const grossNetFinanceView = renderFinance({
  state: {
    ...createStore().getState(),
    ...grossNetFinanceFixture,
    session: { user: { id: "user-ceo" } },
    user: { id: "user-ceo", email: "chioma@example.com" },
    client,
    accounts
  }
});
assert.match(grossNetFinanceView, /Gross sales[\s\S]*₦1,000/, "Finance overview must show gross sales before deductions");
assert.match(grossNetFinanceView, /Returns[\s\S]*₦200/, "Finance overview must show customer returns separately");
assert.match(grossNetFinanceView, /Discounts[\s\S]*₦100/, "Finance overview must show discounts separately");
assert.match(grossNetFinanceView, /Other deductions[\s\S]*₦50/, "Finance overview must show other deductions separately");
assert.match(grossNetFinanceView, /Net sales[\s\S]*₦650/, "Finance overview must show final net sales");

const loginHtml = renderAuth({ routeId: "login" });
assert.equal((loginHtml.match(/type="radio" name="role"/g) || []).length, 5, "login must show the five supported role cards");
assert.match(loginHtml, /value="admin"/, "Admin must be available as a distinct sign-in role");
assert.match(loginHtml, /value="production_manager"/, "Production Line Manager must be available as a distinct sign-in role");
assert.match(loginHtml, /href="#\/forgot-password"/);
const forgotPasswordHtml = renderForgotPassword();
assert.match(forgotPasswordHtml, /id="forgot-password-form"/);
assert.match(forgotPasswordHtml, /Send reset link/);
assert.match(forgotPasswordHtml, /If this email has an account|secure reset link/);
assert.doesNotMatch(loginHtml, /value="accountant"|>Accountant</, "the removed Accountant role must not appear at login");
const backendErrorHtml = renderBackendSetup({ state: { backend: { error: "Temporary connection error" } } });
assert.match(backendErrorHtml, /data-retry-workspace="true"/);
assert.match(backendErrorHtml, /Try again/);
assert.match(backendErrorHtml, /Network error/);
assert.match(backendErrorHtml, /Connection problem/);
assert.doesNotMatch(backendErrorHtml, /Setup required|company sign-in|workspace connection|What to do next|project README/);
const databaseErrorHtml = renderBackendSetup({ state: { backend: { configured: true, error: "column memberships.staff_image_url does not exist" } } });
assert.match(databaseErrorHtml, /Database error/);
assert.match(databaseErrorHtml, /Database update required/);
assert.match(databaseErrorHtml, /staff_image_url/);
assert.equal(classifyAppFailure({ configured: true, error: "Invalid API key", online: true }).category, "configuration");
assert.equal(classifyAppFailure({ configured: true, error: "Failed to send a request to the Edge Function", online: true }).category, "backend");
assert.equal(
  friendlyEdgeFunctionMessage("Failed to send a request to the Edge Function", "", { serviceLabel: "staff account deletion service", online: true }),
  "Backend error: The staff account deletion service could not be reached. Check its Supabase deployment and try again."
);
assert.equal(
  friendlyEdgeFunctionMessage("Failed to fetch", "", { serviceLabel: "staff account deletion service", online: false }),
  "Network error: Check your internet connection and try again."
);
assert.equal(
  friendlyEdgeFunctionMessage('{"code":"NOT_FOUND","message":"Requested function was not found"}', "", { serviceLabel: "staff account deletion service", online: true }),
  "Backend deployment error: The staff account deletion service is not deployed in Supabase."
);
assert.equal(classifyAppFailure({ configured: true, error: "Auth session expired", online: true }).category, "authentication");
assert.equal(classifyAppFailure({ configured: true, error: "Failed to fetch", online: false }).category, "network");
assert.deepEqual(
  OPERATIONAL_COLLECTIONS,
  [
    "products", "stockCategories", "stockAssignments", "stockTransactions",
    "productionBatches", "productionPlans", "productionIssues", "retailers", "orders", "invoices", "salesReports",
    "correctionRequests", "stockRequests", "stockAdditionRequests", "purchaseOrders", "procurementOrders",
    "routes", "creditLimits", "creditLimitHistory", "activityLogs"
  ],
  "every operational collection must be included in Supabase synchronization"
);
assert.deepEqual(
  collectionsFromRemote({
    initializedCollections: ["products", "productionPlans", "orders", "salesReports"],
    records: [
      { collection: "products", data: { id: "PROD-VISIBLE" } },
      { collection: "productionPlans", data: { id: "PLAN-VISIBLE" } },
      { collection: "orders", data: { id: "ORDER-HIDDEN" } },
      { collection: "salesReports", data: { id: "REPORT-HIDDEN" } }
    ]
  }, ["products", "productionPlans"]),
  { products: [{ id: "PROD-VISIBLE" }], productionPlans: [{ id: "PLAN-VISIBLE" }] },
  "remote workspace hydration must exclude collections that the current role cannot access"
);
const previousOperationalSnapshot = operationalSnapshot({
  products: [{ id: "SYNC-PRODUCT", stock: 10, imageUrl: "data:image/png;base64,LOCAL" }],
  stockTransactions: [{ id: "SYNC-TX-1", type: "restock", quantity: 10 }]
}, ["products", "stockTransactions"]);
const nextOperationalSnapshot = operationalSnapshot({
  products: [{ id: "SYNC-PRODUCT", stock: 7, imageUrl: "data:image/png;base64,LOCAL" }],
  stockTransactions: [
    { id: "SYNC-TX-1", type: "restock", quantity: 10 },
    { id: "SYNC-TX-2", type: "supply", quantity: 3 }
  ]
}, ["products", "stockTransactions"]);
const synchronizedChanges = operationalChanges(previousOperationalSnapshot, nextOperationalSnapshot);
assert.deepEqual(synchronizedChanges.touchedCollections, ["products", "stockTransactions"]);
assert.equal(synchronizedChanges.records.length, 2, "a stock change and its movement must both be synchronized");
assert.equal(synchronizedChanges.records.find((record) => record.collection === "products").data.imageUrl, "", "large stock image data must remain in the dedicated shared-image path");
const operationalMigrationSql = readFileSync(new URL("../supabase/operational-persistence-migration.sql", import.meta.url), "utf8");
assert.match(operationalMigrationSql, /unique \(client_id, operation_id\)/, "operation retries must be idempotent");
assert.match(operationalMigrationSql, /workspace_operation_events/, "every synchronized action must have an append-only event record");
assert.match(operationalMigrationSql, /public\.is_client_member\(client_id\)/, "operational records must remain tenant isolated");
assert.match(operationalMigrationSql, /UPSERT_PRODUCT', 'RESTOCK_PRODUCT'[\s\S]*v_role = 'store_keeper'[\s\S]*require Admin or CEO approval/, "backend sync must reject direct Store Keeper stock additions");
assert.match(operationalMigrationSql, /APPROVE_STOCK_ADDITION_REQUEST', 'REJECT_STOCK_ADDITION_REQUEST'[\s\S]*v_role not in \('ceo', 'admin'\)/, "only Admin or CEO may review stock addition requests in backend sync");
assert.match(operationalMigrationSql, /stockAdditionRequests'[\s\S]*status'[\s\S]*approved/, "backend stock approval must include the approved request record");
for (const role of ["ceo", "admin", "store_keeper", "sales_rep", "production_manager"]) {
  assert.ok(operationalCollectionsForRole(role).includes("retailers"), `${role} must load the shared company customer directory`);
}
assert.match(operationalMigrationSql, /when 'store_keeper' then array\[[\s\S]*?'productionBatches', 'retailers', 'orders'/, "Store Keepers must receive shared customers for dispatch choices");
assert.match(operationalMigrationSql, /when 'production_manager' then array\[[\s\S]*?'productionPlans', 'retailers'/, "the shared customer collection must be available across every company portal");
const workspaceResetSql = readFileSync(new URL("../supabase/workspace-data-reset.sql", import.meta.url), "utf8");
assert.match(workspaceResetSql, /security definer/, "workspace resets must run through a protected server function");
assert.match(workspaceResetSql, /v_role <> 'ceo'/, "only the active CEO may reset workspace data");
assert.match(workspaceResetSql, /where client_id = p_client_id/g, "every reset must remain within the selected factory");
assert.doesNotMatch(workspaceResetSql, /delete from public\.memberships|delete from auth\.users|delete from public\.clients/, "factory reset must preserve the company and staff sign-ins");
const passwordSetupHtml = renderPasswordReset({ state: { session: { user: { id: "password-user" } }, user: { email: "password@example.com" }, client: { companyName: "Test Factory" } } });
assert.match(passwordSetupHtml, /minlength="8"/);
assert.match(passwordSetupHtml, /Use 8\+ characters/);
assert.doesNotMatch(passwordSetupHtml, /12\+ characters/);
globalThis.window.location.hash = "#/reset-password?recovery=1";
const passwordRecoveryHtml = renderPasswordReset({ state: { session: null, user: null, client: null, accounts: [] } });
assert.match(passwordRecoveryHtml, /Reset your password/);
assert.match(passwordRecoveryHtml, /name="newPassword"/);
assert.match(passwordRecoveryHtml, /name="confirmPassword"/);
assert.doesNotMatch(passwordRecoveryHtml, /Sign in first|temporary password from your CEO|name="temporaryPassword"/);
globalThis.window.location.hash = "#/login?password-reset=success";
assert.match(renderAuth({ routeId: "login" }), /Your password has been reset\. Sign in with your new password\./);
globalThis.window.location.hash = "#/dashboard";
assert.doesNotMatch(loginHtml, /value="manager"/, "the removed Manager role must not appear at login");
assert.doesNotMatch(loginHtml, /<select name="role"/, "login role selection must not use a dropdown");
assert.equal(REQUIRED_FORM_ALERT_MESSAGE, "Please complete the required fields");
const openModalRoot = {
  querySelector(selector) {
    return selector.includes(".stock-modal-backdrop:not([hidden])") ? { id: "dashboard-dispatch-modal" } : null;
  }
};
const closedModalRoot = { querySelector() { return null; } };
assert.equal(hasOpenWorkspaceModal(openModalRoot), true, "the shared modal guard must detect an open dispatch or portal modal");
assert.equal(shouldDeferRenderForModal({ type: "SET_OPERATIONAL_RECORDS" }, openModalRoot), true, "backend refreshes must not rebuild a portal while its modal is open");
assert.equal(shouldDeferRenderForModal({ type: "SET_OPERATIONAL_RECORDS" }, closedModalRoot), false, "backend refreshes should render normally when no modal is open");
assert.equal(shouldDeferRenderForModal({ type: "RECORD_STOCK_DISPATCH" }, openModalRoot), false, "a completed modal action must still render its saved result immediately");
assert.deepEqual(
  [...MODAL_SAFE_BACKGROUND_ACTIONS],
  ["SET_WORKSPACE", "SET_OPERATIONAL_RECORDS", "SET_FEATURE_MODULES", "SET_PACKAGING_WORKSPACE_STATE", "HYDRATE_PRODUCT_IMAGES", "AUTO_UPDATE_DELAYED_ORDERS"],
  "all routine workspace refresh actions must preserve open modals"
);
const notificationFixture = {
  client,
  user: { id: "user-manager", email: "musa@example.com" },
  accounts,
  notificationReadAt: "",
  notificationClearedAt: "",
  dismissedNotificationIds: [],
  activityLogs: [{ id: "notice-1", clientId: client.id, actorUserId: "user-rep", actorName: "Amina Rep", actorEmail: "amina@example.com", actionType: "created", summary: "New sale", createdAt: "2026-07-13T09:00:00.000Z" }]
};
assert.equal(getTopbarNotificationItems(notificationFixture).length, 1);
assert.equal(getTopbarNotificationItems({ ...notificationFixture, dismissedNotificationIds: ["activity-notice-1"] }).length, 0);
assert.equal(getTopbarNotificationItems({ ...notificationFixture, notificationClearedAt: "2026-07-13T10:00:00.000Z" }).length, 0);
const productionActivityFixture = {
  client,
  user: { id: "user-production", email: "bello@example.com" },
  accounts,
  notificationReadAt: "",
  notificationClearedAt: "",
  dismissedNotificationIds: [],
  products: [
    { id: "RAW-PROD", name: "Production Oil", stockCategory: "raw_materials" },
    { id: "EQP-PROD", name: "Packaging Machine", stockCategory: "equipment" }
  ],
  activityLogs: [
    { id: "production-batch-notice", clientId: client.id, actorUserId: "user-store", actorName: "Tola Store", actorEmail: "tola@example.com", actionType: "used", recordType: "production_batch", recordLabel: "BATCH-001", summary: "Produced factory stock", createdAt: "2026-07-13T12:00:00.000Z" },
    { id: "raw-stock-notice", clientId: client.id, actorUserId: "user-admin", actorName: "Ada Admin", actorEmail: "ada@example.com", actionType: "updated", recordType: "inventory", recordLabel: "RAW-PROD", summary: "Raw material stock updated", createdAt: "2026-07-13T11:00:00.000Z" },
    { id: "equipment-notice", clientId: client.id, actorUserId: "user-admin", actorName: "Ada Admin", actorEmail: "ada@example.com", actionType: "updated", recordType: "inventory", recordLabel: "EQP-PROD", summary: "Equipment updated", createdAt: "2026-07-13T10:00:00.000Z" },
    { id: "sales-report-notice", clientId: client.id, actorUserId: "user-rep", actorName: "Amina Rep", actorEmail: "amina@example.com", actionType: "submitted", recordType: "report", recordLabel: "REPORT-1", summary: "Sales report submitted", createdAt: "2026-07-13T09:00:00.000Z" }
  ],
  stockTransactions: [
    { id: "TXN-PRODUCTION", type: "production usage", productId: "RAW-PROD", productName: "Production Oil", quantity: 2, movementDirection: "out", batchId: "BATCH-001", recordedBy: "Tola Store", createdAt: "2026-07-13T08:00:00.000Z" },
    { id: "TXN-DISPATCH", type: "supply", productId: "RAW-PROD", productName: "Production Oil", quantity: 1, movementDirection: "out", recordedBy: "Tola Store", createdAt: "2026-07-13T07:00:00.000Z" }
  ]
};
const productionScopedActivity = getScopedActivityLogs(productionActivityFixture);
assert.equal(productionScopedActivity.some((entry) => entry.id === "production-batch-notice"), true, "Production Line Manager activity must include production batches");
assert.equal(productionScopedActivity.some((entry) => entry.id === "raw-stock-notice"), true, "Production Line Manager activity must include relevant raw-material updates");
assert.equal(productionScopedActivity.some((entry) => entry.id === "equipment-notice"), false, "Production Line Manager activity must exclude equipment administration");
assert.equal(productionScopedActivity.some((entry) => entry.id === "sales-report-notice"), false, "Production Line Manager activity must exclude sales reports");
assert.equal(productionScopedActivity.some((entry) => entry.id === "TXN-ACT-TXN-PRODUCTION"), true, "Production Line Manager activity must include raw-material production usage");
assert.equal(productionScopedActivity.some((entry) => entry.id === "TXN-ACT-TXN-DISPATCH"), false, "Production Line Manager activity must exclude dispatch movements");
const productionNotifications = getTopbarNotificationItems(productionActivityFixture);
assert.equal(productionNotifications.some((item) => item.body.includes("Sales report")), false, "Production Line Manager notifications must exclude sales activity");
assert.equal(productionNotifications.some((item) => item.body.includes("Equipment")), false, "Production Line Manager notifications must exclude equipment administration");
assert.equal(productionNotifications.some((item) => item.body.includes("Produced factory stock")), true, "Production Line Manager notifications must include production output");

function authenticate(userId) {
  const account = accounts.find((item) => item.userId === userId);
  store.dispatch({
    type: "SET_AUTHENTICATED_WORKSPACE",
    session: { user: { id: userId } },
    user: { id: userId, email: account.email, user_metadata: { full_name: account.name } },
    client,
    accounts,
    invites: [],
    featureModules: [],
    messages: [],
    activityLogs: store.getState().activityLogs
  });
}

authenticate("user-manager");
assert.equal(currentUserRole(store.getState()), "ceo", "legacy Manager memberships must be absorbed into CEO access");

const salesOrderCleanupStore = createStore();
const salesOrderCleanupClient = { ...client, id: "client-sales-order-cleanup" };
const salesOrderCleanupAccount = { ...accounts.find((item) => item.role === "ceo"), clientId: salesOrderCleanupClient.id };
salesOrderCleanupStore.dispatch({
  type: "SET_AUTHENTICATED_WORKSPACE",
  session: { user: { id: salesOrderCleanupAccount.userId } },
  user: { id: salesOrderCleanupAccount.userId, email: salesOrderCleanupAccount.email },
  client: salesOrderCleanupClient,
  accounts: [salesOrderCleanupAccount],
  invites: [],
  activityLogs: []
});
salesOrderCleanupStore.dispatch({
  type: "SET_OPERATIONAL_RECORDS",
  collections: {
    orders: [
      { id: "ORD-OLD", createdAt: "2026-07-18T09:00:00.000Z", items: [] },
      { id: "ORD-TODAY", createdAt: "2026-07-22T09:00:00.000Z", items: [] }
    ],
    invoices: [
      { id: "INV-OLD", orderId: "ORD-OLD", issuedAt: "2026-07-18" },
      { id: "INV-TODAY", orderId: "ORD-TODAY", issuedAt: "2026-07-22" }
    ],
    routes: [{ id: "ROUTE-CLEANUP", orderIds: ["ORD-OLD", "ORD-TODAY"] }],
    stockTransactions: [
      { id: "TXN-SALES-ORDER", orderId: "ORD-TODAY", type: "sale", date: "2026-07-22" },
      { id: "TXN-SUPPLY-HISTORY", orderId: "ORD-OLD", type: "supply", date: "2026-07-18" }
    ]
  }
});
const salesOrderCleanupBefore = operationalSnapshot(salesOrderCleanupStore.getState());
salesOrderCleanupStore.dispatch({ type: "DELETE_ALL_SALES_ORDERS_DATA" });
const salesOrderCleanupChanges = operationalChanges(salesOrderCleanupBefore, operationalSnapshot(salesOrderCleanupStore.getState()));
assert.deepEqual(salesOrderCleanupStore.getState().orders, [], "Sales Orders Delete must remove every order");
assert.deepEqual(salesOrderCleanupStore.getState().invoices, [], "Sales Orders Delete must remove linked invoices");
assert.deepEqual(salesOrderCleanupStore.getState().routes[0].orderIds, [], "Sales Orders Delete must clear route order references");
assert.equal(salesOrderCleanupStore.getState().stockTransactions.some((transaction) => transaction.id === "TXN-SALES-ORDER"), false, "Sales Orders Delete must remove sale records so orders cannot be regenerated");
assert.equal(salesOrderCleanupStore.getState().stockTransactions.some((transaction) => transaction.id === "TXN-SUPPLY-HISTORY"), true, "Sales Orders Delete must preserve independent supply movements");
assert.equal(salesOrderCleanupChanges.deleted.some((record) => record.collection === "orders" && record.id === "ORD-TODAY"), true, "Sales Orders Delete must queue backend order deletion");
assert.equal(salesOrderCleanupChanges.deleted.some((record) => record.collection === "invoices" && record.id === "INV-TODAY"), true, "Sales Orders Delete must queue backend invoice deletion");
assert.equal(salesOrderCleanupChanges.deleted.some((record) => record.collection === "stockTransactions" && record.id === "TXN-SALES-ORDER"), true, "Sales Orders Delete must queue backend sale deletion");

const productRevenueCleanupStore = createStore();
const productRevenueCleanupClient = { ...client, id: "client-product-revenue-cleanup" };
const productRevenueCleanupAccount = { ...accounts.find((item) => item.role === "ceo"), clientId: productRevenueCleanupClient.id };
productRevenueCleanupStore.dispatch({
  type: "SET_AUTHENTICATED_WORKSPACE",
  session: { user: { id: productRevenueCleanupAccount.userId } },
  user: { id: productRevenueCleanupAccount.userId, email: productRevenueCleanupAccount.email },
  client: productRevenueCleanupClient,
  accounts: [productRevenueCleanupAccount],
  invites: [],
  activityLogs: []
});
productRevenueCleanupStore.dispatch({
  type: "SET_OPERATIONAL_RECORDS",
  collections: {
    orders: [
      { id: "ORD-OLD-REVENUE", createdAt: "2026-07-18", financialImpact: true, items: [] },
      { id: "ORD-OLD-SELL-THROUGH", createdAt: "2026-07-18", financialImpact: false, accountingTreatment: "sell_through_only", items: [] },
      { id: "ORD-TODAY-REVENUE", createdAt: "2026-07-22", financialImpact: true, items: [] }
    ],
    invoices: [
      { id: "INV-OLD-REVENUE", orderId: "ORD-OLD-REVENUE", issuedAt: "2026-07-18", financialImpact: true },
      { id: "INV-OLD-SELL-THROUGH", orderId: "ORD-OLD-SELL-THROUGH", issuedAt: "2026-07-18", financialImpact: false, accountingTreatment: "sell_through_only" },
      { id: "INV-TODAY-REVENUE", orderId: "ORD-TODAY-REVENUE", issuedAt: "2026-07-22", financialImpact: true }
    ],
    stockTransactions: [
      { id: "TXN-OLD-REVENUE", type: "sale", date: "2026-07-18", financialImpact: true },
      { id: "TXN-OLD-SELL-THROUGH", type: "sale", date: "2026-07-18", financialImpact: false, accountingTreatment: "sell_through_only" },
      { id: "TXN-TODAY-REVENUE", type: "sale", date: "2026-07-22", financialImpact: true }
    ]
  }
});
const productRevenueCleanupBefore = operationalSnapshot(productRevenueCleanupStore.getState());
productRevenueCleanupStore.dispatch({ type: "DELETE_ALL_PRODUCT_REVENUE_DATA" });
const productRevenueCleanupChanges = operationalChanges(productRevenueCleanupBefore, operationalSnapshot(productRevenueCleanupStore.getState()));
assert.deepEqual(productRevenueCleanupStore.getState().orders.map((order) => order.id), ["ORD-OLD-SELL-THROUGH"], "Product Revenue Delete must keep only representative sell-through orders");
assert.deepEqual(productRevenueCleanupStore.getState().stockTransactions.map((transaction) => transaction.id), ["TXN-OLD-SELL-THROUGH"], "Product Revenue Delete must keep only representative sell-through transactions");
assert.deepEqual(productRevenueCleanupStore.getState().invoices.map((invoice) => invoice.id), ["INV-OLD-SELL-THROUGH"], "Product Revenue Delete must keep only representative sell-through receipts");
assert.equal(productRevenueCleanupChanges.deleted.some((record) => record.collection === "orders" && record.id === "ORD-TODAY-REVENUE"), true, "Product Revenue Delete must queue backend financial-order deletion");
assert.equal(productRevenueCleanupChanges.deleted.some((record) => record.collection === "invoices" && record.id === "INV-TODAY-REVENUE"), true, "Product Revenue Delete must queue backend invoice deletion");
assert.equal(productRevenueCleanupChanges.deleted.some((record) => record.collection === "stockTransactions" && record.id === "TXN-TODAY-REVENUE"), true, "Product Revenue Delete must queue backend revenue-transaction deletion");

productRevenueCleanupStore.dispatch({
  type: "SET_OPERATIONAL_RECORDS",
  collections: {
    products: [{ id: "SKU-CHIPS", sku: "SKU-CHIPS", name: "Plantain Chips", stockCategory: "finished_products", unitPrice: 500, unitCost: 200 }],
    invoices: [{ id: "INV-KEEP" }, { id: "INV-DELETE" }],
    salesReports: [{ id: "REPORT-KEEP" }, { id: "REPORT-DELETE" }],
    creditLimits: [
      { id: "LIMIT-REP", partyType: "Sales Representative", partyName: "Rep" },
      { id: "LIMIT-CUSTOMER", partyType: "Customer", partyName: "Customer" }
    ],
    creditLimitHistory: [
      { id: "HISTORY-KEEP", partyType: "Customer", partyName: "Customer" },
      { id: "HISTORY-DELETE", partyType: "Sales Representative", partyName: "Rep" }
    ],
    activityLogs: [{ id: "ACTIVITY-KEEP" }, { id: "ACTIVITY-DELETE" }],
    orders: [
      { id: "ORDER-KEEP", transactionId: "TXN-KEEP", items: [] },
      { id: "ORDER-DELETE", transactionId: "TXN-DELETE", items: [] }
    ],
    stockTransactions: [
      { id: "TXN-KEEP", type: "sale", productId: "SKU-CHIPS", quantity: 1, amount: 500 },
      { id: "TXN-DELETE", type: "sale", productId: "SKU-CHIPS", quantity: 1, amount: 500 }
    ]
  }
});
productRevenueCleanupStore.dispatch({ type: "DELETE_CEO_DATA_RECORDS", scope: "invoices", ids: ["INV-DELETE"] });
productRevenueCleanupStore.dispatch({ type: "DELETE_CEO_DATA_RECORDS", scope: "sales_reports", ids: ["REPORT-DELETE"] });
productRevenueCleanupStore.dispatch({ type: "DELETE_CEO_DATA_RECORDS", scope: "representative_credit_limits", ids: ["LIMIT-REP"] });
productRevenueCleanupStore.dispatch({ type: "DELETE_CEO_DATA_RECORDS", scope: "representative_credit_history", ids: ["HISTORY-DELETE"] });
productRevenueCleanupStore.dispatch({ type: "DELETE_CEO_DATA_RECORDS", scope: "activity", ids: ["ACTIVITY-DELETE"] });
assert.equal(getFinancialSalesLines(productRevenueCleanupStore.getState()).some((line) => line.id === "TXN-KEEP"), true);
const ordersBeforeScopedRevenueDeletion = structuredClone(productRevenueCleanupStore.getState().orders);
productRevenueCleanupStore.dispatch({ type: "DELETE_CEO_DATA_RECORDS", scope: "product_revenue", ids: ["TXN-KEEP"] });
assert.deepEqual(productRevenueCleanupStore.getState().orders, ordersBeforeScopedRevenueDeletion, "product-revenue deletion must not change sales orders");
assert.equal(productRevenueCleanupStore.getState().stockTransactions.some((record) => record.id === "TXN-KEEP"), true, "product-revenue deletion must preserve the underlying sales activity");
assert.equal(getFinancialSalesLines(productRevenueCleanupStore.getState()).some((line) => line.id === "TXN-KEEP"), false, "deleted revenue records must not regenerate in finance");
productRevenueCleanupStore.dispatch({ type: "DELETE_CEO_DATA_RECORDS", scope: "orders", ids: ["ORDER-DELETE"] });
assert.deepEqual(productRevenueCleanupStore.getState().invoices.map((record) => record.id), ["INV-KEEP"], "invoice deletion must not clear adjacent finance data");
assert.deepEqual(productRevenueCleanupStore.getState().salesReports.map((record) => record.id), ["REPORT-KEEP"], "sales-report deletion must preserve other reports");
assert.deepEqual(productRevenueCleanupStore.getState().creditLimits.map((record) => record.id), ["LIMIT-CUSTOMER"], "representative credit deletion must preserve customer credit reports");
assert.deepEqual(productRevenueCleanupStore.getState().creditLimitHistory.map((record) => record.id), ["HISTORY-KEEP"], "credit-history deletion must stay record scoped");
assert.deepEqual(productRevenueCleanupStore.getState().activityLogs.map((record) => record.id), ["ACTIVITY-KEEP"], "activity deletion must preserve unselected activity");
assert.deepEqual(productRevenueCleanupStore.getState().orders.map((record) => record.id), ["ORDER-KEEP"], "sales-order deletion must preserve unselected orders");
assert.deepEqual(productRevenueCleanupStore.getState().stockTransactions.map((record) => record.id), ["TXN-KEEP"], "sales-order deletion must remove only its linked sale record");

globalThis.window.location.hash = "#/messages?with=__all_staff__";
const broadcastBody = "Company-wide stock review at 4 PM";
const broadcastMessagesHtml = renderMessages({
  state: {
    ...store.getState(),
    messages: ["membership-rep", "membership-store"].map((toAccountId, index) => ({
      id: `broadcast-copy-${index}`,
      clientId: client.id,
      fromAccountId: "membership-manager",
      fromUserId: "user-manager",
      fromName: "Musa Manager",
      fromEmail: "musa@example.com",
      toAccountId,
      toName: index ? "Tola Store" : "Amina Rep",
      body: broadcastBody,
      audience: "all_staff",
      createdAt: "2026-07-17T09:00:00.000Z"
    }))
  }
});
assert.equal((broadcastMessagesHtml.match(new RegExp(`<p>${broadcastBody}<\\/p>`, "g")) || []).length, 1, "sender must see one bubble for an all-staff broadcast");
assert.match(broadcastMessagesHtml, /message-broadcast-label">To: All staff</);
assert.equal((broadcastMessagesHtml.match(/data-message-actions-trigger/g) || []).length, 1, "a consolidated all-staff message must have one three-dot action menu");
assert.match(broadcastMessagesHtml, /data-unsend-message/, "a sent all-staff message must support unsend");
assert.match(broadcastMessagesHtml, /data-clear-message-conversation/, "every active conversation must provide Clear messages");

const messageActionFixture = [
  {
    id: "MSG-SENT-REP",
    clientId: client.id,
    fromAccountId: "membership-manager",
    fromUserId: "user-manager",
    fromName: "Musa Manager",
    fromEmail: "musa@example.com",
    toAccountId: "membership-rep",
    toUserId: "user-rep",
    toName: "Amina Rep",
    toEmail: "amina@example.com",
    body: "Sent to Amina",
    audience: "direct",
    createdAt: "2026-07-17T09:01:00.000Z"
  },
  {
    id: "MSG-RECEIVED-REP",
    clientId: client.id,
    fromAccountId: "membership-rep",
    fromUserId: "user-rep",
    fromName: "Amina Rep",
    fromEmail: "amina@example.com",
    toAccountId: "membership-manager",
    toUserId: "user-manager",
    toName: "Musa Manager",
    toEmail: "musa@example.com",
    body: "Received from Amina",
    audience: "direct",
    createdAt: "2026-07-17T09:02:00.000Z"
  },
  {
    id: "MSG-SENT-STORE",
    clientId: client.id,
    fromAccountId: "membership-manager",
    fromUserId: "user-manager",
    fromName: "Musa Manager",
    fromEmail: "musa@example.com",
    toAccountId: "membership-store",
    toUserId: "user-store",
    toName: "Tola Store",
    toEmail: "tola@example.com",
    body: "Other conversation",
    audience: "direct",
    createdAt: "2026-07-17T09:03:00.000Z"
  }
];
globalThis.window.location.hash = "#/messages?with=membership-rep";
const directMessagesHtml = renderMessages({ state: { ...store.getState(), messages: messageActionFixture } });
assert.equal((directMessagesHtml.match(/data-message-actions-trigger/g) || []).length, 2, "each message in the active conversation must have a three-dot menu");
assert.equal((directMessagesHtml.match(/data-forward-message>/g) || []).length, 2, "both sent and received messages must support forwarding");
assert.equal((directMessagesHtml.match(/data-delete-message>/g) || []).length, 2, "both sent and received messages must support private deletion");
assert.equal((directMessagesHtml.match(/data-unsend-message>/g) || []).length, 1, "only the current user's sent message must show Unsend");
assert.match(directMessagesHtml, /data-forward-message-modal[\s\S]*value="membership-store"/, "forwarding must allow another staff conversation to be selected");
assert.match(directMessagesHtml, /data-clear-message-conversation[\s\S]*Clear messages/, "the active direct conversation must provide a clear action");

function messageActionStore() {
  const actionStore = createStore();
  actionStore.dispatch({
    type: "SET_AUTHENTICATED_WORKSPACE",
    session: { user: { id: "user-manager" } },
    user: { id: "user-manager", email: "musa@example.com" },
    client,
    accounts,
    invites: [],
    messages: structuredClone(messageActionFixture),
    activityLogs: []
  });
  return actionStore;
}

const privateDeleteStore = messageActionStore();
privateDeleteStore.dispatch({ type: "DELETE_MESSAGES_FOR_ME", messageIds: ["MSG-RECEIVED-REP"] });
assert.deepEqual(
  privateDeleteStore.getState().messages.map((message) => message.id),
  ["MSG-SENT-REP", "MSG-SENT-STORE"],
  "Delete must remove only the chosen message from the current user's view"
);

const unsendStore = messageActionStore();
unsendStore.dispatch({ type: "UNSEND_MESSAGES", messageIds: ["MSG-SENT-REP", "MSG-RECEIVED-REP"] });
assert.deepEqual(
  unsendStore.getState().messages.map((message) => message.id),
  ["MSG-RECEIVED-REP", "MSG-SENT-STORE"],
  "Unsend must remove only messages owned by the current sender"
);

const clearConversationStore = messageActionStore();
clearConversationStore.dispatch({ type: "CLEAR_MESSAGE_CONVERSATION", peerAccountId: "membership-rep" });
assert.deepEqual(
  clearConversationStore.getState().messages.map((message) => message.id),
  ["MSG-SENT-STORE"],
  "clearing one conversation must preserve messages in every other conversation"
);

globalThis.window.location.hash = "#/dashboard";
assert.equal(currentUserPermissions(store.getState()).canAssignStock, true);
assert.equal(currentUserPermissions(store.getState()).canReconcileStock, true);
assert.equal(currentUserPermissions(store.getState()).canLogSalesReturns, true);
const managerSettings = renderSettings({ state: store.getState() });
assert.match(managerSettings, /name="skuFormat"/);
assert.match(managerSettings, /name="invoiceFormat"/);
assert.match(managerSettings, /id="packaging-settings-form"/);
assert.match(managerSettings, /id="profile-settings-form" class="form-grid profile-settings-form"/, "CEO profile fields must use the dedicated aligned layout");
assert.ok(managerSettings.indexOf("Factory settings") < managerSettings.indexOf("Sales packaging"), "CEO Sales packaging settings must appear below Factory settings");
assert.match(managerSettings, /class="settings-primary settings-top-panel"[\s\S]*Factory settings/, "Factory Settings must occupy the 60% top panel");
assert.match(managerSettings, /class="settings-side settings-top-panel"[\s\S]*My profile/, "My Profile must occupy the equal-height 40% top panel");
assert.match(managerSettings, /class="settings-primary settings-followup-panel"[\s\S]*Sales packaging/, "CEO Sales Packaging must remain below Factory Settings");
assert.equal((managerSettings.match(/id="packaging-settings-form"/g) || []).length, 1, "CEO Sales Packaging must render once");
assert.match(managerSettings, /name="packagingTypes" value="carton"/);
assert.match(managerSettings, /name="packagingTypes" value="carton" checked/, "CEO packaging settings must retain multiple selected package types");
assert.match(managerSettings, /name="packagingTypes" value="pack" checked/, "CEO packaging settings must allow more than one package type at once");
assert.ok((managerSettings.match(/data-packaging-toggle aria-pressed="true"/g) || []).length >= 3, "CEO packaging settings must show every selected package type as active");
assert.match(managerSettings, /data-packaging-option-state>Selected</, "CEO packaging choices must have an explicit selected state");
assert.match(managerSettings, /data-packaging-selection-summary>Pieces · Cartons · Packs</, "CEO packaging settings must clearly summarize all selected package types");
assert.doesNotMatch(managerSettings, /name="packagingDefault-|Default pieces per/);
assert.match(managerSettings, /Set the quantity inside each stock item/);
assert.match(managerSettings, /data-reset-workspace-scope="factory"/, "CEO settings must include the factory data reset control");
assert.match(managerSettings, /CEO password required/, "CEO settings must state that the password is required for a factory reset");
assert.match(actionDialogSource, /export function requestPasswordDialog[\s\S]*inputType: "password"[\s\S]*autoComplete: "current-password"/, "destructive re-authentication must use a protected password input");
assert.match(workspaceDataResetSource, /scope === "factory" && !await verifyFactoryResetPassword\(store\.getState\(\)\)/, "factory reset must stop unless the signed-in CEO password is verified");
assert.match(ceoPasswordVerificationSource, /await signInWithPassword\(\{[\s\S]*email:[\s\S]*password[\s\S]*\}\);/, "CEO destructive actions must re-authenticate with the signed-in account");
assert.match(workspaceDataResetSource, /verifyFactoryResetPassword\(store\.getState\(\)\)[\s\S]*await resetWorkspaceData/, "CEO password verification must finish before the backend factory reset starts");
assert.doesNotMatch(workspaceDataResetSource, /Type RESET to confirm|placeholder: "RESET"/, "Factory Data Reset must not require typing RESET when CEO password verification is enabled");
assert.doesNotMatch(managerSettings, /Delete records before today|delete-history-before-today/, "Settings must not include the section-data Delete control");
const managerAccountsBeforePackagingSync = store.getState().accounts.length;
store.dispatch({
  type: "SYNC_CLIENT_SETTINGS",
  payload: {
    packagingTypes: ["piece", "carton", "pack", "tray"],
    packagingDefaults: { piece: 1, carton: 24, pack: 6, tray: 12 }
  },
  message: "Packaging settings saved successfully"
});
assert.deepEqual(store.getState().client.packagingTypes, ["piece", "carton", "pack", "tray"], "confirmed CEO packaging settings must update immediately");
assert.equal(store.getState().accounts.length, managerAccountsBeforePackagingSync, "packaging confirmation must not clear unrelated workspace data");
const settingsViewSource = readFileSync(new URL("../src/js/views/settings.js", import.meta.url), "utf8");
assert.match(settingsViewSource, /deleteFactoryForm\?\.addEventListener\("submit"[\s\S]*await verifyCeoPassword\([\s\S]*await deleteWorkspace\(/, "Delete Factory must verify the CEO password before calling the backend deletion service");
assert.match(settingsViewSource, /message: "Packaging settings saved successfully"/, "CEO packaging save must emit a success confirmation banner");
assert.doesNotMatch(settingsViewSource, /const packagingDefaults =/, "packaging submit must not shadow the packagingDefaults helper before saving");
assert.doesNotMatch(managerSettings, /name="timezone"/);
assert.doesNotMatch(managerSettings, /Saved delivery note preview/);
assert.match(managerSettings, /data-open-password-modal/);
assert.match(managerSettings, /name="oldPassword"/);
assert.match(managerSettings, /data-open-delete-factory/);
assert.match(managerSettings, /permanently deletes the factory records and linked staff sign-ins/);
assert.match(managerSettings, /CEO password verification is required/, "Delete Factory must clearly state its CEO password requirement");
assert.doesNotMatch(managerSettings, /confirmCompanyName|Enter [^<]+ to confirm/, "Delete Factory must not require retyping the company name when CEO password verification is enabled");
assert.match(managerSettings, /id="profile-staff-image"[^>]+type="file"/, "profile settings must accept an optional staff image");
assert.match(managerSettings, /staff-image-preview staff-image-picker[^>]+aria-label="Choose profile picture"/, "profile picture selection must use the circular avatar surface");
assert.match(managerSettings, /js-remove-profile-image[^>]+disabled/, "profile settings must provide a compact remove-photo control");
assert.doesNotMatch(managerSettings, /Staff image \(optional\)|Remove image/, "profile settings must not show file-upload instructions or removal text");
const managerTeam = renderTeam({ state: store.getState() });
assert.doesNotMatch(managerTeam, /<option value="ceo">/, "CEO must not be assignable as a staff role");
assert.doesNotMatch(managerTeam, /<option value="manager">/);
assert.match(managerTeam, /<option value="admin">Admin<\/option>/);
assert.match(managerTeam, /team-member-list/);
assert.match(managerTeam, /data-team-account-id="membership-rep"/);
assert.match(managerTeam, /team-account-modal/);
assert.match(managerTeam, /data-team-activity-account-id="membership-rep"/, "CEO staff rows must include a compact activity button");
assert.doesNotMatch(managerTeam, /data-team-activity-account-id="membership-ceo"/, "the CEO staff entry must not show an activity-log button");
assert.match(managerTeam, /id="staff-activity-modal"/, "CEO must have the staff activity modal");
const teamViewSource = readFileSync(new URL("../src/js/views/team.js", import.meta.url), "utf8");
assert.match(teamViewSource, /STAFF_ACTIVITY_PAGE_SIZE = 10/, "staff activity must paginate at ten records per page");
assert.match(managerTeam, /Add Staff/);
assert.match(managerTeam, /Create staff/);
assert.match(managerTeam, /id="new-staff-image"[^>]+type="file"/, "staff creation must accept an optional staff image");
assert.match(managerTeam, /staff-image-preview staff-image-picker[^>]+aria-label="Choose staff profile picture"/, "staff creation must use the circular avatar surface as its picker");
assert.match(managerTeam, /js-remove-new-staff-image[^>]+disabled/, "staff creation must include a compact remove-photo icon that starts hidden until a picture is selected");
assert.doesNotMatch(managerTeam, /Staff image \(optional\)|Remove image/, "staff creation must not show file-upload instructions or removal text");
assert.match(managerTeam, /staff-create-compact[\s\S]*staff-create-photo[\s\S]*staff-create-fields/, "Add Staff must place the profile picture on the left and compact fields on the right");
assert.doesNotMatch(managerTeam, /Team access/);
const staffImageFixture = "data:image/jpeg;base64,STAFF_IMAGE_FIXTURE";
store.dispatch({
  type: "UPDATE_MY_PROFILE",
  name: "Musa Manager",
  phoneNumber: "08000000001",
  staffImageUrl: staffImageFixture
});
assert.equal(store.getState().accounts.find((account) => account.userId === "user-manager").staffImageUrl, staffImageFixture, "profile images must persist on the membership");
assert.match(renderSettings({ state: store.getState() }), /staff-image-preview[\s\S]*STAFF_IMAGE_FIXTURE/, "saved profile images must render in profile settings");
assert.doesNotMatch(renderSettings({ state: store.getState() }), /js-remove-profile-image[^>]+disabled/, "remove-photo control must be available when a profile picture exists");
store.dispatch({
  type: "UPDATE_MY_PROFILE",
  name: "Musa Manager",
  phoneNumber: "08000000001",
  staffImageUrl: ""
});
assert.equal(store.getState().accounts.find((account) => account.userId === "user-manager").staffImageUrl, "", "profile pictures must be removable");
store.dispatch({
  type: "UPDATE_MY_PROFILE",
  name: "Musa Manager",
  phoneNumber: "08000000001",
  staffImageUrl: staffImageFixture
});
assert.match(renderTeam({ state: store.getState() }), /team-member-avatar[\s\S]*STAFF_IMAGE_FIXTURE/, "saved staff images must render in the staff list");
store.dispatch({ type: "SET_ACCOUNT_STATUS", accountId: "membership-rep", active: false });
assert.equal(store.getState().accounts.find((account) => account.id === "membership-rep").status, "disabled");
store.dispatch({ type: "SET_ACCOUNT_STATUS", accountId: "membership-rep", active: true });
assert.equal(store.getState().accounts.find((account) => account.id === "membership-rep").status, "active");
store.dispatch({ type: "SET_ACCOUNT_ROLE", accountId: "membership-rep", role: "admin" });
assert.equal(store.getState().accounts.find((account) => account.id === "membership-rep").role, "admin", "CEO must be able to convert existing staff to Admin");
store.dispatch({ type: "SET_ACCOUNT_ROLE", accountId: "membership-rep", role: "sales_rep" });
assert.equal(store.getState().accounts.find((account) => account.id === "membership-rep").role, "sales_rep");
store.dispatch({
  type: "UPSERT_PRODUCT",
  productId: "SKU-CHIPS",
  sku: "SKU-CHIPS",
  name: "Plantain Chips",
  stockCategory: "finished_products",
  unit: "pack",
  stock: 100,
  reorderPoint: 10,
  unitCost: 200,
  unitPrice: 500,
  packagingConversions: { carton: 10, pack: 5 },
  status: "active"
});
store.dispatch({
  type: "UPSERT_PRODUCT",
  productId: "SKU-NAME-SEPARATION",
  sku: "SKU-NAME-SEPARATION",
  name: "Plantain Chips Original 55g",
  productFamily: "Plantain Chips",
  productType: "Original",
  size: "55g",
  sizeValue: "55",
  sizeUnit: "g",
  stockCategory: "finished_products",
  unit: "g",
  stock: 20,
  reorderPoint: 2,
  unitCost: 100,
  unitPrice: 150,
  status: "active"
});
const separatedNameProduct = store.getState().products.find((product) => product.id === "SKU-NAME-SEPARATION");
assert.equal(separatedNameProduct.name, "Plantain Chips", "saving stock must not append its type and size to the product name");
assert.equal(separatedNameProduct.productType, "Original");
assert.equal(separatedNameProduct.size, "55g");
const inventoryViewSource = readFileSync(new URL("../src/js/views/inventory.js", import.meta.url), "utf8");
assert.match(inventoryViewSource, /productForm\.elements\.name\.value = stockProductBaseName\(product\)/, "editing stock must restore only the base product name");
store.dispatch({ type: "DELETE_PRODUCTS", productIds: ["SKU-NAME-SEPARATION"] });
store.dispatch({
  type: "UPSERT_PRODUCT",
  productId: "RAW-OIL",
  sku: "RAW-OIL",
  name: "Cooking Oil",
  stockCategory: "raw_materials",
  unit: "litre",
  stock: 50,
  reorderPoint: 10,
  unitCost: 1000,
  unitPrice: 0,
  status: "active"
});

const persistentImageData = "data:image/png;base64,RELOAD_SAFE_STOCK_IMAGE";
store.dispatch({
  type: "UPSERT_PRODUCT",
  productId: "SKU-IMAGE-PERSIST",
  sku: "SKU-IMAGE-PERSIST",
  name: "Image Persistence Test",
  stockCategory: "finished_products",
  unit: "pack",
  stock: 1,
  reorderPoint: 1,
  unitCost: 1,
  unitPrice: 1,
  status: "active",
  imageUrl: persistentImageData,
  imageStorageKey: `${client.id}:SKU-IMAGE-PERSIST`
});
assert.equal(store.getState().products.find((product) => product.id === "SKU-IMAGE-PERSIST").imageUrl, persistentImageData, "stock image must remain available in memory after saving");
assert.ok(
  [...browserStorage.values()].every((value) => !String(value).includes(persistentImageData)),
  "large stock image data must be kept outside the main browser state document"
);
store.dispatch({
  type: "HYDRATE_PRODUCT_IMAGES",
  images: [{ productId: "SKU-IMAGE-PERSIST", imageUrl: persistentImageData, imageStorageKey: `${client.id}:SKU-IMAGE-PERSIST` }]
});
assert.equal(store.getState().products.find((product) => product.id === "SKU-IMAGE-PERSIST").imageUrl, persistentImageData, "saved stock images must restore after workspace hydration");
store.dispatch({
  type: "HYDRATE_PRODUCT_IMAGES",
  images: [{ productId: "SKU-IMAGE-PERSIST", imageUrl: "data:image/png;base64,SHARED_PORTAL_IMAGE", remoteSynced: true }],
  authoritative: true
});
assert.equal(store.getState().products.find((product) => product.id === "SKU-IMAGE-PERSIST").imageUrl, "data:image/png;base64,SHARED_PORTAL_IMAGE", "shared Supabase stock pictures must replace a portal's local image");
assert.equal(store.getState().products.find((product) => product.id === "SKU-IMAGE-PERSIST").imageRemoteSynced, true, "shared stock pictures must be marked as backend synchronized");
const stateBeforeMissingRemoteImage = store.getState();
store.dispatch({
  type: "SET_WORKSPACE",
  client,
  accounts,
  invites: stateBeforeMissingRemoteImage.invites,
  featureModules: stateBeforeMissingRemoteImage.featureModules,
  messages: stateBeforeMissingRemoteImage.messages,
  activityLogs: stateBeforeMissingRemoteImage.activityLogs,
  productImages: []
});
assert.equal(store.getState().products.find((product) => product.id === "SKU-IMAGE-PERSIST").imageUrl, "data:image/png;base64,SHARED_PORTAL_IMAGE", "a missing Supabase image row must not erase the surviving browser image");
assert.equal(store.getState().products.find((product) => product.id === "SKU-IMAGE-PERSIST").imageRemoteSynced, false, "a missing Supabase image row must be eligible for automatic backfill");
const synchronizedProductRecords = store.getState().products.map((product) => (
  product.id === "SKU-IMAGE-PERSIST" ? { ...product, stock: 25, imageUrl: "" } : product
));
store.dispatch({
  type: "SET_OPERATIONAL_RECORDS",
  collections: { products: synchronizedProductRecords }
});
assert.equal(store.getState().products.find((product) => product.id === "SKU-IMAGE-PERSIST").stock, 25, "Supabase operational refresh must apply the shared stock quantity");
assert.equal(store.getState().products.find((product) => product.id === "SKU-IMAGE-PERSIST").imageUrl, "data:image/png;base64,SHARED_PORTAL_IMAGE", "operational refresh must preserve the dedicated stock picture");
assert.match(appSource, /saveSharedProductImage\([\s\S]*imageUrl: image\.imageUrl/, "surviving browser stock images must be backed up to Supabase after sign-in");
assert.match(backendSource, /select\("sku, image_url"\)[\s\S]*single\(\)/, "remote stock picture saves must be read back and confirmed");
assert.match(backendSource, /purgeSharedProductImages[\s\S]*update\(\{ image_url: ""[\s\S]*\.delete\(\)/, "stock deletion must erase shared picture data before removing its compatibility row");
assert.match(backendSource, /operationalActivityInitialized[\s\S]*activityLogs:[\s\S]*operationalActivityRows/, "initialized synchronized activity must remain authoritative over legacy activity rows");
const inventorySource = readFileSync(new URL("../src/js/views/inventory.js", import.meta.url), "utf8");
assert.match(inventorySource, /!existingProduct\?\.imageRemoteSynced/, "saving a stock item must retry any picture that has not reached Supabase");
assert.match(inventorySource, /sharedImageChanged = !existingProductId \|\| shouldStoreImage/, "a newly created stock item must explicitly replace any past image saved under the same SKU");
assert.match(inventorySource, /await purgeSharedProductImages\([\s\S]*await Promise\.all\(deletedProducts/, "deleting stock must clear its Supabase and browser picture traces before removing the row");

store.dispatch({
  type: "UPSERT_PRODUCT",
  productId: "SKU-STALE-IMAGE",
  sku: "SKU-STALE-IMAGE",
  name: "Fresh stock without picture",
  stockCategory: "finished_products",
  stock: 10,
  status: "active"
});
store.dispatch({
  type: "HYDRATE_PRODUCT_IMAGES",
  images: [{ productId: "SKU-STALE-IMAGE", imageUrl: "data:image/png;base64,PAST_STOCK_IMAGE", remoteSynced: true }],
  authoritative: true
});
const operationalProductsWithoutStaleImage = store.getState().products.map((product) => (
  product.id === "SKU-STALE-IMAGE"
    ? { ...product, imageUrl: "", imageStorageKey: "", imageRemoteSynced: false }
    : product
));
store.dispatch({ type: "SET_OPERATIONAL_RECORDS", collections: { products: operationalProductsWithoutStaleImage } });
assert.equal(store.getState().products.find((product) => product.id === "SKU-STALE-IMAGE").imageUrl, "", "an unsynchronized new stock record must not inherit a past image merely because its SKU matches");
assert.equal(store.getState().products.find((product) => product.id === "SKU-STALE-IMAGE").imageRemoteSynced, false, "operational image ownership must override a stale browser hydration flag");
store.dispatch({ type: "DELETE_PRODUCTS", productIds: ["SKU-STALE-IMAGE"] });
store.dispatch({ type: "DELETE_PRODUCTS", productIds: ["SKU-IMAGE-PERSIST"] });

store.dispatch({
  type: "RECORD_STOCK_DISPATCH",
  productId: "RAW-OIL",
  quantity: 5,
  recipientType: "Sales Representative",
  recipientName: "Amina Rep",
  destination: "Route A",
  dispatchDate: currentTestDate,
  expectedDeliveryAt: "2099-07-11",
  staffName: "Musa Manager"
});
assert.equal(store.getState().stockAssignments.length, 0, "raw materials must not be assigned to a representative");
assert.equal(store.getState().products.find((item) => item.id === "RAW-OIL").stock, 50);

store.dispatch({
  type: "RECORD_PRODUCTION_USAGE",
  batchDate: "2026-07-10",
  batchReference: "BATCH-REJECTED",
  finishedProductId: "SKU-CHIPS",
  quantityProduced: 10,
  purpose: "Factory stock",
  materials: [{ productId: "RAW-OIL", quantity: 51 }]
});
assert.equal(store.getState().products.find((item) => item.id === "RAW-OIL").stock, 50, "batch usage above stock on hand must be rejected");
assert.equal(store.getState().productionBatches.length, 0);

store.dispatch({
  type: "RECORD_PRODUCTION_USAGE",
  batchDate: "2026-07-10",
  batchReference: "BATCH-1001",
  finishedProductId: "SKU-CHIPS",
  quantityProduced: 10,
  purpose: "Customer orders",
  notes: "Morning production run",
  materials: [{ productId: "RAW-OIL", quantity: 5 }]
});
assert.equal(store.getState().products.find((item) => item.id === "RAW-OIL").stock, 45);
assert.equal(store.getState().products.find((item) => item.id === "SKU-CHIPS").stock, 110, "production output must increase finished stock");
assert.equal(store.getState().productionBatches[0].materials[0].productId, "RAW-OIL");
assert.equal(store.getState().productionBatches[0].finishedProductId, "SKU-CHIPS");
assert.equal(store.getState().stockTransactions[0].type, "production usage");
assert.equal(store.getState().stockTransactions[1].type, "production output");
globalThis.window.location.hash = "#/inventory?tab=stock-health";
const productionUsage = renderInventory({ state: store.getState() });
assert.doesNotMatch(productionUsage, />Production usage</);
assert.doesNotMatch(productionUsage, /Production purpose/);
assert.match(productionUsage, /stock-health-table/);
assert.match(productionUsage, /stock-health-row/);
assert.doesNotMatch(productionUsage, /production-stock-update/);
assert.match(productionUsage, /Sell raw material/);
assert.match(productionUsage, /js-sell-raw-material/);
assert.match(productionUsage, /js-select-all-stock/);
assert.match(productionUsage, /js-select-stock/);
assert.match(productionUsage, /js-delete-product/);
assert.match(productionUsage, /js-delete-selected-stock/);
assert.match(productionUsage, /id="stock-delete-confirmation-modal"/);
assert.match(productionUsage, /js-confirm-stock-delete/);
assert.match(productionUsage, /Factory quantities and representative allocations/);

store.dispatch({
  type: "RECORD_RAW_MATERIAL_SALE",
  productId: "RAW-OIL",
  quantity: 2,
  customerName: "Bakery Direct",
  paymentType: "cash",
  unitPrice: 1200,
  saleDate: "2026-07-10",
  notes: "Factory-gate sale"
});
assert.equal(store.getState().products.find((item) => item.id === "RAW-OIL").stock, 43, "raw-material sale must reduce raw stock");
const rawMaterialSale = store.getState().stockTransactions.find((item) => item.productId === "RAW-OIL" && item.type === "sale");
assert.ok(rawMaterialSale, "raw-material sale must create a stock movement");
assert.ok(store.getState().orders.some((order) => order.transactionId === rawMaterialSale.id), "raw-material sale must create an order");
assert.ok(store.getState().invoices.some((invoice) => invoice.transactionId === rawMaterialSale.id), "raw-material sale must create an invoice");

store.getState().featureModules = [{ clientId: client.id, moduleKey: "raw_materials", enabled: false }];
globalThis.window.location.hash = "#/inventory?tab=stock-health";
const rawMaterialsDisabled = renderInventory({ state: scopeStateForEnabledModules(scopeStateForCurrentRole(store.getState())) });
assert.doesNotMatch(rawMaterialsDisabled, /Production usage/);
assert.doesNotMatch(rawMaterialsDisabled, /Cooking Oil/);
store.getState().featureModules = [];

store.dispatch({
  type: "RECORD_STOCK_DISPATCH",
  productId: "SKU-CHIPS",
  quantity: 20,
  recipientType: "Sales Representative",
  recipientName: "Amina Rep",
  destination: "Route A",
  dispatchDate: currentTestDate,
  expectedDeliveryAt: "2099-07-11",
  staffName: "Musa Manager"
});

let state = store.getState();
const assignment = state.stockAssignments[0];
assert.equal(state.products.find((item) => item.id === "SKU-CHIPS").stock, 90, "dispatch must immediately reduce factory stock");
assert.equal(assignment.assigned, 20);
assert.equal(assignment.repUserId, "user-rep", "assignment must be scoped to the selected representative account");
const financialRevenueBeforeRepSale = getFinancialSalesLines(state).reduce((total, line) => total + Number(line.revenue || 0), 0);
const financialInvoicesBeforeRepSale = getFinancialInvoiceRecords(state).length;
const financialOrdersBeforeRepSale = getOrdersWithTotals(state).length;
const receivablesBeforeRepSale = calculateMetrics(state).receivables;

authenticate("user-rep");
store.dispatch({
  type: "LOG_REP_TRANSACTION",
  assignmentIds: [assignment.id],
  productId: "SKU-CHIPS",
  customerId: "",
  customerName: "Walk-in customer",
  customerType: "Walk-in",
  quantity: 2,
  transactionType: "sale",
  paymentType: "cash",
  repName: "Amina Rep",
  offline: true
});

state = store.getState();
const sale = state.stockTransactions.find((item) => item.type === "sale" && item.productId === "SKU-CHIPS");
assert.equal(sale.syncStatus, "pending", "offline sale must be saved as pending");
assert.equal(state.offlineSalesQueue.length, 1, "offline sale must enter the sync queue");
store.dispatch({ type: "SYNC_OFFLINE_SALES" });
assert.equal(store.getState().offlineSalesQueue.length, 0, "online sync must clear the offline queue");
assert.equal(store.getState().stockTransactions.find((item) => item.id === sale.id).syncStatus, "synced");
assert.ok(sale, "walk-in sell-through must be saved");
assert.equal(sale.partyName, "Walk-in customer");
assert.equal(sale.paymentType, "not_tracked", "representative customer payment sources must not be recorded");
assert.equal(state.stockAssignments[0].sold, 2);
const cashInvoice = getInvoiceRecords(state).find((invoice) => invoice.transactionId === sale.id);
assert.ok(cashInvoice, "every representative customer sale must create a receipt");
assert.equal(cashInvoice.status, "recorded");
assert.equal(cashInvoice.paymentType, "not_tracked");
assert.equal(cashInvoice.repName, "Amina Rep");
assert.equal(cashInvoice.items[0].productName, "Plantain Chips");
assert.equal(cashInvoice.financialImpact, false, "representative sell-through receipts must not affect factory finances");
assert.equal(cashInvoice.documentType, "sales_receipt");
assert.equal(getFinancialSalesLines(state).reduce((total, line) => total + Number(line.revenue || 0), 0), financialRevenueBeforeRepSale, "representative sell-through must not add factory revenue");
assert.equal(getFinancialInvoiceRecords(state).length, financialInvoicesBeforeRepSale, "representative receipts must not enter the factory invoice ledger");
assert.equal(getOrdersWithTotals(state).length, financialOrdersBeforeRepSale, "representative sell-through must not create another factory sales order");
assert.equal(calculateMetrics(state).receivables, receivablesBeforeRepSale, "representative sell-through must not change factory receivables");
const legacySellThroughState = structuredClone(state);
const legacyTransaction = legacySellThroughState.stockTransactions.find((item) => item.id === sale.id);
const legacyOrder = legacySellThroughState.orders.find((item) => item.id === cashInvoice.orderId);
const legacyInvoice = legacySellThroughState.invoices.find((item) => item.id === cashInvoice.id);
[legacyTransaction, legacyOrder, legacyInvoice].forEach((record) => {
  delete record.financialImpact;
  delete record.accountingTreatment;
  delete record.documentType;
});
assert.equal(getFinancialInvoiceRecords(legacySellThroughState).some((invoice) => invoice.id === cashInvoice.id), false, "historical assignment-linked representative receipts must remain outside factory finance");
assert.equal(getOrdersWithTotals(legacySellThroughState).some((order) => order.id === cashInvoice.orderId), false, "historical representative sell-through orders must remain outside factory order totals");
assert.equal(getFinancialSalesLines(legacySellThroughState).some((line) => line.recordId === cashInvoice.orderId || line.id === sale.id), false, "historical representative sell-through must not be counted as factory revenue");
const invoiceDocument = buildInvoiceDocument(cashInvoice, state);
assert.match(invoiceDocument, /DistroIQ Sales, Stock &amp; Distribution/);
assert.match(invoiceDocument, /Test Factory/);
assert.match(invoiceDocument, /Walk-in customer/);
assert.match(invoiceDocument, /Plantain Chips/);
assert.match(invoiceDocument, /Sold by Amina Rep/);
assert.match(invoiceDocument, /SALES RECEIPT/);
assert.doesNotMatch(invoiceDocument, /Representative sell-through record only|Factory revenue was already recognised/);
assert.doesNotMatch(invoiceDocument, /Payment:/, "representative sales receipts must not expose a customer payment source");
const invoicePreview = buildInvoicePreviewContent(cashInvoice, state);
assert.match(invoicePreview, /invoice-modal-document/);
assert.match(invoicePreview, /Bill to/);
assert.match(invoicePreview, /Plantain Chips/);
assert.match(invoicePreview, /Sales receipt/);
assert.doesNotMatch(invoicePreview, /Representative sell-through record only|factory revenue was already recognised/i);
assert.doesNotMatch(invoicePreview, /iframe/);
const factoryRepresentativeInvoice = {
  ...cashInvoice,
  id: "INV-FACTORY-REP",
  orderId: "ORD-FACTORY-REP",
  dispatchId: "DSP-FACTORY-REP",
  customerName: "Amina Rep",
  documentType: "invoice",
  financialImpact: true
};
const factoryRepresentativeInvoiceState = {
  ...state,
  orders: [
    ...(state.orders || []),
    {
      id: "ORD-FACTORY-REP",
      source: "factory_dispatch",
      dispatchId: "DSP-FACTORY-REP",
      customerType: "Sales Representative",
      customerName: "Amina Rep"
    }
  ]
};
assert.match(
  buildInvoicePreviewContent(factoryRepresentativeInvoice, factoryRepresentativeInvoiceState),
  /Bill to[\s\S]*Amina Rep[\s\S]*invoice-modal-origin-note">From factory</,
  "factory stock invoices to sales representatives must show the origin note below Bill to"
);
assert.match(
  buildInvoiceDocument(factoryRepresentativeInvoice, factoryRepresentativeInvoiceState),
  /<h2>Bill to<\/h2>[\s\S]*Amina Rep[\s\S]*origin-note">From factory</,
  "downloaded and printed representative stock invoices must retain the factory origin note"
);
assert.doesNotMatch(invoicePreview, /invoice-modal-origin-note">From factory</, "customer sales receipts must not show the factory-assignment note");
const packagedInvoicePreview = buildInvoicePreviewContent({
  ...cashInvoice,
  items: [{ ...cashInvoice.items[0], quantity: 48, packagingType: "carton", packagingQuantity: 2 }]
}, state);
assert.match(packagedInvoicePreview, /2 cartons/);
assert.match(packagedInvoicePreview, /48 pieces/);
const representativeInvoices = renderInvoices({ state: scopeStateForCurrentRole(state) });
assert.match(representativeInvoices, /My invoices/);
assert.match(representativeInvoices, /js-download-invoice/);
assert.match(representativeInvoices, /js-print-invoice/);
assert.match(representativeInvoices, /js-print-invoice-list/);
assert.match(representativeInvoices, /aria-label="Print invoice list"/);
const sharedCustomerInvoiceState = {
  ...state,
  accounts: [
    ...accounts,
    { id: "membership-rep-two", clientId: client.id, userId: "user-rep-two", name: "Binta Rep", email: "binta@example.com", role: "sales_rep", status: "active" }
  ],
  invoices: [
    { id: "INV-OWN", retailerId: "RTL-SHARED", repUserId: "user-rep", repName: "Amina Rep" },
    { id: "INV-OTHER", retailerId: "RTL-SHARED", repUserId: "user-rep-two", repName: "Binta Rep" },
    { id: "INV-LEGACY-OWN", retailerId: "RTL-SHARED", repName: "Amina Rep" },
    { id: "INV-LEGACY-OTHER", retailerId: "RTL-SHARED", repName: "Binta Rep" }
  ],
  orders: [
    ...(state.orders || []),
    { id: "ORD-SHARED", retailerId: "RTL-SHARED", repUserId: "user-rep", repName: "Amina Rep", items: [] }
  ]
};
assert.deepEqual(
  scopeStateForCurrentRole(sharedCustomerInvoiceState).invoices.map((invoice) => invoice.id),
  ["INV-OWN", "INV-LEGACY-OWN"],
  "a representative must never see another representative's invoice, even for a shared customer"
);

const returnableCustomers = getReturnableCustomerChoices(state, {
  productId: "SKU-CHIPS",
  repName: "Amina Rep",
  repUserId: "user-rep",
  assignmentIds: [assignment.id]
});
assert.equal(returnableCustomers.length, 1);
assert.equal(returnableCustomers[0].customerName, "Walk-in customer");
assert.equal(returnableCustomers[0].quantity, 2);

store.dispatch({
  type: "LOG_REP_TRANSACTION",
  assignmentIds: [assignment.id],
  productId: "SKU-CHIPS",
  customerId: "",
  customerName: "Different customer",
  customerType: "Retailer",
  quantity: 1,
  transactionType: "return",
  paymentType: "cash refund",
  returnDisposition: "held_by_rep",
  repName: "Amina Rep"
});
assert.equal(store.getState().stockTransactions.filter((item) => item.type === "return").length, 0, "returns must be tied to the original customer");

store.dispatch({
  type: "LOG_REP_TRANSACTION",
  assignmentIds: [assignment.id],
  productId: "SKU-CHIPS",
  customerId: "",
  customerName: "Walk-in customer",
  customerType: "Walk-in",
  quantity: 1,
  transactionType: "return",
  paymentType: "cash refund",
  returnDisposition: "to_store",
  repName: "Amina Rep"
});
assert.equal(store.getState().stockTransactions.filter((item) => item.type === "return").length, 1, "the original customer return must be accepted");

const repDashboard = renderDashboard({ state: scopeStateForCurrentRole(state) });
assert.match(repDashboard, /Walk-in customer/, "walk-in sale must appear in the current daily report");
assert.match(repDashboard, /Plantain Chips/);
assert.match(repDashboard, /Gross sales[\s\S]*₦1,000/, "the representative's existing Sales figure must be labelled Gross sales");
assert.match(repDashboard, /Net sales[\s\S]*₦500/, "representative net sales must subtract the accepted customer return");
assert.match(repDashboard, /rep-factory-return-form/, "representatives must be able to return stock in hand to the factory");
assert.match(repDashboard, /rep-product-family-grid/, "representative catalogue must group products into families");
assert.match(repDashboard, /js-toggle-rep-product-types/, "representatives must be able to open product types");
assert.match(repDashboard, /js-open-rep-product-sizes/, "representatives must be able to open product sizes");
assert.match(repDashboard, /id="rep-product-size-modal"/, "product sizes must open in a catalogue modal");
assert.match(repDashboard, /rep-product-size-modal product-catalogue-size-modal/, "representative product images must use the shared CEO catalogue frame");
assert.match(repDashboard, /js-select-rep-product-size/, "each catalogue size must be selectable");
assert.match(repDashboard, /name="salePackagingType"/, "quick sales must support configured packaging types");
assert.match(repDashboard, /name="returnPackagingType"/, "customer returns must allow the representative to choose packaging");
assert.match(repDashboard, /data-rep-return-package-summary/, "customer returns must show the exact piece equivalent of the selected package quantity");
assert.match(repDashboard, /rep-return-quantity-row[\s\S]*name="returnQuantity"[\s\S]*name="returnPackagingType"/, "customer return quantity and packaging controls must share one aligned compact row");
assert.match(repDashboard, /name="factoryReturnPackagingType"/, "Stock in your hand returns must support configured packaging");
assert.match(repDashboard, /data-rep-factory-return-package-summary/, "Stock in your hand returns must show the exact piece equivalent");
assert.match(repDashboard, /rep-sale-item-product/);
assert.match(repDashboard, /rep-sale-item-quantity/);
assert.match(repDashboard, /rep-sale-item-packaging/);
assert.match(repDashboard, /rep-sale-item-price/);
assert.match(repDashboard, /rep-sale-item-remove[\s\S]*js-remove-rep-sale-item/, "Quick Sale fields and remove control must use the contained item-row layout");
assert.doesNotMatch(repDashboard, /name="salePaymentType"|name="returnPaymentType"/, "representative sales and returns must not ask where customer money came from");

store.dispatch({
  type: "SUBMIT_REP_REPORT",
  repName: "Amina Rep",
  reportDate: "2026-07-10",
  salesAmount: 1000,
  cashAmount: 1000,
  creditAmount: 0,
  unitsSold: 2,
  unitsReturned: 1,
  transactionIds: [sale.id],
  reportLines: [{
    transactionId: sale.id,
    type: "Sale",
    productId: "SKU-CHIPS",
    productName: "Plantain Chips",
    customerName: "Walk-in customer",
    quantity: 2,
    amount: 1000,
    paymentType: "cash"
  }]
});

store.dispatch({ type: "TOGGLE_PRODUCT_STATUS", productId: "SKU-CHIPS" });
state = store.getState();
const repScope = scopeStateForCurrentRole(state);
assert.equal(repScope.stockAssignments.length, 0, "inactive products must be hidden from representative stock flows");
assert.ok(repScope.stockTransactions.some((item) => item.id === sale.id), "past transactions must remain intact");

authenticate("user-store");
globalThis.window.location.hash = "#/inventory?tab=stock-health";
const storeKeeperInventory = renderInventory({ state: store.getState() });
assert.doesNotMatch(storeKeeperInventory, /<h3>Plantain Chips<\/h3>/, "inactive products must be hidden from Store Keeper stock cards");
assert.doesNotMatch(storeKeeperInventory, /<dt>Region<\/dt>/, "stock product details must not show Region");
assert.match(storeKeeperInventory, /name="sku" value="SKU-\d+" readonly/, "new products must receive an automatic SKU");
assert.match(storeKeeperInventory, /field stock-sku-field/, "SKU field must have its own spacing hook");
assert.match(storeKeeperInventory, /name="productType"/);
assert.match(storeKeeperInventory, /name="sizeValue" type="number"/);
assert.match(storeKeeperInventory, /name="sizeUnit" aria-label="Product size unit"/);
assert.match(storeKeeperInventory, /name="sizeUnitOther"[^>]+hidden/);
assert.match(storeKeeperInventory, /name="packagingConversion-carton"/, "products must record pieces per configured bulk package");
assert.doesNotMatch(storeKeeperInventory, /name="packagingConversion-carton"[^>]+value="10"/, "new stock must require its own package quantity instead of inheriting a factory default");
assert.match(storeKeeperInventory, /name="stockEntryMode"/);
assert.match(storeKeeperInventory, /value="package">Package<\/option>/);
assert.match(storeKeeperInventory, /value="piece">Pieces<\/option>/);
assert.match(storeKeeperInventory, /name="stockPackagingType"/);
assert.match(storeKeeperInventory, /data-stock-packaging-type[\s\S]*value="carton">Cartons<[\s\S]*value="pack">Packs</, "Add Stock must offer every package type selected in Settings");
assert.match(storeKeeperInventory, /data-stock-piece-total/);
assert.equal((storeKeeperInventory.match(/data-stock-form-step="/g) || []).length, 3, "Add Stock must use three simple steps");
assert.match(storeKeeperInventory, /data-stock-form-step="1"[\s\S]*Product name[\s\S]*Product type[\s\S]*Product size[\s\S]*SKU[\s\S]*Category/);
assert.match(storeKeeperInventory, /data-stock-form-step="2"[\s\S]*Factory stock[\s\S]*Enter stock as[\s\S]*Package type[\s\S]*Reorder point[\s\S]*Cost price per piece[\s\S]*Selling price per piece[\s\S]*Package contents and selling prices/);
assert.match(storeKeeperInventory, /data-stock-form-step="3"[\s\S]*Catalogue status[\s\S]*Stock picture/);
assert.match(storeKeeperInventory, /data-stock-step-previous hidden/);
assert.match(storeKeeperInventory, /data-stock-step-next/);
assert.match(storeKeeperInventory, /data-stock-step-save hidden/);
assert.doesNotMatch(storeKeeperInventory, /js-clear-product-form/);
assert.equal((storeKeeperInventory.match(/<select name="sizeUnit"[\s\S]*?<\/select>/)?.[0].match(/<option /g) || []).length, 5, "product-size unit dropdown must not exceed five options");
assert.match(storeKeeperInventory, /data-affiliated-product-progress/);
assert.match(storeKeeperInventory, /js-add-affiliated-product/);
assert.match(storeKeeperInventory, /Product added successfully/);
assert.doesNotMatch(storeKeeperInventory, /Production stock update|Recording raw materials used is optional|Complete this section only when the finished stock was produced from factory raw materials/);
assert.doesNotMatch(storeKeeperInventory, /name="productionBatchDate"|name="productionBatchReference"|name="productionQuantity"|name="batchMaterialId"|name="batchMaterialQuantity"/);
assert.doesNotMatch(storeKeeperInventory, /name="variantSku"/);
assert.match(storeKeeperInventory, /<th>Product type<\/th>/);
assert.match(storeKeeperInventory, /<th>Size<\/th>/);
assert.match(storeKeeperInventory, /toolbar stock-health-toolbar/);
assert.match(storeKeeperInventory, /data-stock-view="list"/, "Stock Health must offer a list view");
assert.match(storeKeeperInventory, /data-stock-view="grid"/, "Stock Health must offer a grid view");
assert.match(storeKeeperInventory, /data-stock-view-panel="list"/, "Stock Health must render its list panel");
assert.match(storeKeeperInventory, /data-stock-view-panel="grid"/, "Stock Health must render its grid panel");
assert.match(storeKeeperInventory, /stock-health-grid-card/, "the grid view must show product cards with full images");
assert.match(storeKeeperInventory, /data-open-stock-product/, "stock rows and cards must open product details from their main surface");
assert.match(storeKeeperInventory, /id="stock-product-details-modal"/, "Stock Health must provide a product details modal");
assert.match(storeKeeperInventory, /id="stock-product-details-content"/, "the product details modal must have dynamic product content");
const plainStockNameInventory = renderInventory({
  state: {
    ...store.getState(),
    products: [{
      id: "SKU-PLANTAIN-650G",
      name: "Plantain Chips Plastic Pack 650g",
      productFamily: "Plantain Chips",
      productType: "Plastic Pack",
      size: "650g",
      category: "Finished Products",
      stockCategory: "finished_products",
      stock: 24,
      reorderPoint: 5,
      unitCost: 100,
      unitPrice: 150,
      status: "active"
    }]
  }
});
assert.match(plainStockNameInventory, /stock-health-item[\s\S]*<strong>Plantain Chips<\/strong>[\s\S]*SKU-PLANTAIN-650G/, "Stock item must show only the plain product name");
assert.match(plainStockNameInventory, /<td>Plastic Pack<\/td>[\s\S]*<td>650g<\/td>/, "product type and size must remain in their own Stock Health columns");
assert.doesNotMatch(storeKeeperInventory, /js-open-production-traceability/, "Stock Health must not show the stock-material-usage icon in any portal");
const cartonStockInventory = renderInventory({
  state: {
    ...store.getState(),
    products: [{
      id: "SKU-CARTON-VIEW",
      name: "Carton View Product",
      productType: "Original",
      size: "150g",
      category: "Finished Products",
      stockCategory: "finished_products",
      unit: "piece",
      warehouse: "Finished Products Store",
      region: "Factory",
      stock: 1440,
      reorderPoint: 25,
      dailyVelocity: 0,
      unitCost: 100,
      unitPrice: 200,
      packagingConversions: { carton: 24 },
      packagingPrices: { carton: 4500 },
      status: "active"
    }]
  }
});
assert.match(cartonStockInventory, /data-grid-stock-unit="carton"[\s\S]*60 cartons/, "grid cards must prefer full-carton availability over pieces");
const belowCartonStockInventory = renderInventory({
  state: {
    ...store.getState(),
    products: [{
      id: "SKU-LOOSE-VIEW",
      name: "Loose Piece Product",
      category: "Finished Products",
      stockCategory: "finished_products",
      unit: "piece",
      stock: 23,
      reorderPoint: 10,
      dailyVelocity: 0,
      unitCost: 100,
      unitPrice: 200,
      packagingConversions: { carton: 24 },
      packagingPrices: { carton: 4500 },
      status: "active"
    }]
  }
});
assert.match(belowCartonStockInventory, /data-grid-stock-unit="piece"[\s\S]*23 pieces/, "grid cards must fall back to pieces below one complete carton");
globalThis.window.location.hash = "#/inventory?tab=dispatch";
const defaultDispatchForm = renderInventory({ state: store.getState() });
const defaultDispatchDate = defaultDispatchForm.match(/name="dispatchDate"[^>]+value="([^"]+)"/)?.[1];
const defaultExpectedDeliveryDate = defaultDispatchForm.match(/name="expectedDeliveryAt"[^>]+value="([^"]+)"/)?.[1];
assert.ok(defaultDispatchDate, "factory dispatch must have a default dispatch date");
assert.equal(defaultExpectedDeliveryDate, defaultDispatchDate, "expected delivery must initially match the dispatch date");
assert.match(defaultDispatchForm, /name="dispatchPackagingType"/, "factory dispatch must accept configured packaging types");
assert.match(defaultDispatchForm, /Destination \/ drop-off point \(optional\)/, "factory dispatch must identify the destination as optional");
assert.doesNotMatch(defaultDispatchForm, /name="destination"[^>]*required/, "factory dispatch must not require a destination");
assert.match(storeKeeperInventory, /field stock-health-type-filter/);

assert.equal(effectiveOrderStatus({ status: "in_transit", expectedDeliveryAt: "2026-07-01" }, "2026-07-11"), "delayed");
assert.equal(hasOrdersRequiringAutomaticDelay([{ status: "in_transit", expectedDeliveryAt: "2026-07-01" }], "2026-07-11"), true);
assert.equal(hasOrdersRequiringAutomaticDelay([{ status: "in_transit", expectedDeliveryAt: "2099-07-01" }], "2026-07-11"), false, "tab focus must not rebuild the page when no order newly became delayed");
assert.equal(effectiveOrderStatus({ status: "delivered", expectedDeliveryAt: "2026-07-01" }, "2026-07-11"), "delivered");
assert.equal(
  effectiveOrderStatus({ source: "quick_sale", status: "in_transit", dueAt: "2026-07-01" }, "2026-07-11"),
  "in_transit",
  "payment due dates must not trigger delivery delays"
);

store.getState().orders.unshift({
  id: "ORD-AUTO-DELAY",
  source: "factory_dispatch",
  customerName: "Late Outlet",
  retailerId: "",
  region: "Lagos",
  priority: "Normal",
  status: "in_transit",
  paymentType: "pending",
  paymentStatus: "pending",
  dueAt: "2026-07-01",
  expectedDeliveryAt: "2026-07-01",
  originalExpectedDeliveryAt: "2026-07-01",
  items: [{ productId: "SKU-CHIPS", quantity: 1, unitPrice: 500 }]
});
store.dispatch({ type: "AUTO_UPDATE_DELAYED_ORDERS", referenceDate: "2026-07-11" });
assert.equal(store.getState().orders.find((order) => order.id === "ORD-AUTO-DELAY").status, "delayed");
assert.equal(store.getState().orders.find((order) => order.id === "ORD-AUTO-DELAY").delaySource, "automatic");

authenticate("user-rep");
store.dispatch({ type: "SET_ORDER_STATUS", orderId: "ORD-AUTO-DELAY", status: "delivered" });
assert.equal(store.getState().orders.find((order) => order.id === "ORD-AUTO-DELAY").status, "delayed", "representatives cannot change delayed status");

authenticate("user-manager");
store.dispatch({
  type: "UPDATE_ORDER_DELAY_DETAILS",
  orderId: "ORD-AUTO-DELAY",
  reason: "Vehicle issue",
  revisedExpectedDeliveryAt: "2099-07-15",
  note: "Replacement van assigned"
});
assert.equal(store.getState().orders.find((order) => order.id === "ORD-AUTO-DELAY").delayReason, "Vehicle issue");
assert.equal(store.getState().orders.find((order) => order.id === "ORD-AUTO-DELAY").delayHistory.length, 1);
const delayedOrdersPage = renderOrders({ state: store.getState() });
assert.match(delayedOrdersPage, /order-delay-attention-icon/);
assert.match(delayedOrdersPage, /data-ceo-delete-selected="orders"/, "CEO Sales Orders must retain selected-row deletion");
assert.match(delayedOrdersPage, /data-ceo-select-all="orders"[^>]+aria-label="Select or deselect every row"/, "Sales Orders must use one master checkbox above the row checkboxes");
assert.doesNotMatch(delayedOrdersPage, /data-ceo-clear-section="orders"|Clear sales orders/, "Sales Orders must not show the redundant section-wide clear button");
assert.doesNotMatch(delayedOrdersPage, /Delete selected|>Select all</, "Sales Orders deletion controls must use the simplified Delete label and checkbox-only master selection");
assert.match(delayedOrdersPage, /Delivery attention/);
assert.doesNotMatch(delayedOrdersPage, /Automatically detected/);
assert.doesNotMatch(delayedOrdersPage, /Order status and credit checks for every snack order/);
assert.doesNotMatch(delayedOrdersPage, /<span>Missed expected delivery date<\/span>|<span>Vehicle issue<\/span>/);
assert.match(delayedOrdersPage, /data-search-suggestions="[^"]*Late Outlet/);
assert.match(delayedOrdersPage, /Replacement van assigned|Review delay plan/);

const creditHoldOrderState = {
  ...store.getState(),
  products: [{ id: "SKU-CREDIT-CHECK", name: "Credit Check Product", unitPrice: 1000, unitCost: 500 }],
  retailers: [{ id: "RTL-CREDIT-CHECK", name: "Credit Check Customer", region: "Kaduna" }],
  creditLimits: [{ id: "CRD-CREDIT-CHECK", partyName: "Credit Check Customer", limit: 10000, balance: 1000 }],
  orders: [{
    id: "ORD-CREDIT-CHECK",
    retailerId: "RTL-CREDIT-CHECK",
    customerName: "Credit Check Customer",
    status: "in_transit",
    paymentType: "credit",
    paymentStatus: "open",
    expectedDeliveryAt: "2026-07-30",
    items: [{ productId: "SKU-CREDIT-CHECK", quantity: 1, unitPrice: 1000 }]
  }]
};
const noCreditHoldPage = renderOrders({ state: creditHoldOrderState });
assert.match(noCreditHoldPage, /<span class="eyebrow">Credit holds<\/span>\s*<strong>0<\/strong>/, "unpaid credit within its approved limit must not be counted as a hold");
const actualCreditHoldPage = renderOrders({
  state: {
    ...creditHoldOrderState,
    creditLimits: [{ id: "CRD-CREDIT-CHECK", partyName: "Credit Check Customer", limit: 10000, balance: 9500 }]
  }
});
assert.match(actualCreditHoldPage, /<span class="eyebrow">Credit holds<\/span>\s*<strong>1<\/strong>/, "only a projected limit breach must be counted as a credit hold");

authenticate("user-manager");
globalThis.window.location.hash = "#/inventory?tab=assignments";
const ledger = renderInventory({ state: store.getState() });
assert.match(ledger, /data-assignment-rep-filter/);
assert.match(ledger, /js-export-assignment-pdf/);
assert.match(ledger, /js-open-assignment-details/);
assert.match(ledger, /assignment-details-modal/);
assert.doesNotMatch(ledger, /<th>Variance<\/th>/, "variance must not crowd the representative stock ledger table");
assert.match(ledger, />18<\/strong>[\s\S]*Still with representative/, "the ledger must show unsold stock as stock in hand");
assert.match(ledger, /SKU/);

const managerDashboard = renderDashboard({ state: store.getState() });
assert.doesNotMatch(managerDashboard, /Recent sales orders/);
assert.doesNotMatch(managerDashboard, /Consolidated sales activity/);
assert.doesNotMatch(managerDashboard, /Submitted sales reports/);
assert.doesNotMatch(managerDashboard, /Manager controls/);
assert.match(managerDashboard, /Musa Manager/);
assert.match(managerDashboard, /Test Factory/);

globalThis.window.location.hash = "#/activity-log?tab=recent-orders";
const managerRecentOrders = renderActivityLog({ state: store.getState() });
assert.match(managerRecentOrders, /Activity log pages/);
assert.match(managerRecentOrders, /Recent sales orders/);
assert.match(managerRecentOrders, /js-download-recent-orders/);
assert.match(managerRecentOrders, /js-print-recent-orders/);
assert.match(managerRecentOrders, /<thead>[\s\S]*data-ceo-select-all="orders"[\s\S]*<th>Sales order<\/th>/, "Recent Sales Orders must place the master checkbox in the table-title row");
assert.match(managerRecentOrders, /data-ceo-delete-selected="orders"/);
assert.doesNotMatch(managerRecentOrders, /data-ceo-clear-section|Clear recent sales orders/, "Recent Sales Orders must not duplicate Delete with a Clear button");
assert.doesNotMatch(managerRecentOrders, /data-reset-workspace-scope="activity"/, "Recent sales orders must not use the activity-log clear scope");
globalThis.window.location.hash = "#/activity-log?tab=submitted-reports";
const managerSubmittedReportsWithDeletion = renderActivityLog({ state: store.getState() });
assert.match(managerSubmittedReportsWithDeletion, /<thead>[\s\S]*data-ceo-select-all="sales_reports"[\s\S]*<th>Report<\/th>/);
assert.match(managerSubmittedReportsWithDeletion, /data-ceo-delete-selected="sales_reports"/);
assert.doesNotMatch(managerSubmittedReportsWithDeletion, /data-ceo-clear-section|Clear submitted sales reports/);
globalThis.window.location.hash = "#/activity-log";
const activityWithUserFilter = renderActivityLog({ state: store.getState() });
assert.match(activityWithUserFilter, /data-ceo-delete-selected="activity"/);
assert.match(activityWithUserFilter, /<thead>[\s\S]*data-ceo-select-all="activity"[\s\S]*<th>Timestamp<\/th>[\s\S]*<th>Action<\/th>/, "Activity Log must place the master checkbox immediately left of Timestamp");
assert.doesNotMatch(activityWithUserFilter, /data-ceo-clear-section|Clear activity/);
const userFilterMarkup = activityWithUserFilter.match(/<select id="activity-user-filter">([\s\S]*?)<\/select>/)?.[1] || "";
assert.doesNotMatch(userFilterMarkup, /@/, "activity user filter must show names without email addresses");
const conciseStockActivity = renderActivityLog({
  state: {
    ...store.getState(),
    activityLogs: [{
      id: "LOG-CONCISE-STOCK",
      clientId: store.getState().client.id,
      actionType: "updated",
      recordType: "inventory",
      recordLabel: "KULI-120G",
      actorName: "Musa Manager",
      summary: "Updated Kuli Kuli (Groundnut Cake) stock from 5 to 60 pieces.",
      details: [
        { summary: "product name: Kuli Kuli (Groundnut Cake) Original 120g -> Kuli Kuli (Groundnut Cake)" },
        { summary: "stock: 5 -> 60" },
        { summary: "picture: no picture -> picture set" }
      ],
      createdAt: "2026-07-17T10:00:00.000Z"
    }]
  }
});
assert.match(conciseStockActivity, /Updated Kuli Kuli \(Groundnut Cake\) stock from 5 to 60 pieces\./);
assert.doesNotMatch(conciseStockActivity, /product name:|stock: 5 -&gt; 60|picture: no picture/, "Activity details must show one concise sentence instead of a technical field-by-field story");
globalThis.window.location.hash = "#/activity-log?tab=sales-activity";
assert.doesNotMatch(renderActivityLog({ state: store.getState() }), /Consolidated sales activity/);
globalThis.window.location.hash = "#/activity-log?tab=submitted-reports";
const managerSubmittedReports = renderActivityLog({ state: store.getState() });
assert.match(managerSubmittedReports, /Submitted sales reports/);
assert.match(managerSubmittedReports, /js-view-report-details/);
assert.match(managerSubmittedReports, /js-download-submitted-reports/);
assert.match(managerSubmittedReports, /js-print-submitted-reports/);
assert.match(managerSubmittedReports, /js-download-report-details/);
assert.match(managerSubmittedReports, /js-print-report-details/);

globalThis.window.location.hash = "#/inventory?tab=overview";
const stockJourney = renderInventory({ state: store.getState() });
assert.match(stockJourney, /Total Stock/);
assert.match(stockJourney, /Raw materials/);
assert.match(stockJourney, /Finished products/);
assert.match(stockJourney, /Equipment/);
assert.match(stockJourney, /At factory/);
assert.match(stockJourney, /Running low/);
assert.match(stockJourney, /With sales representatives/);
assert.match(stockJourney, /Stock updates/);
assert.match(stockJourney, /Paid/);
assert.doesNotMatch(stockJourney, /Representative custody|Assignment \/ dispatch|Paid \/ reconciled/);
const packagedStockJourney = renderInventory({
  state: {
    ...store.getState(),
    products: [{
      id: "SKU-JOURNEY-CARTON",
      name: "Journey Carton Product",
      stockCategory: "finished_products",
      category: "Finished Products",
      unit: "piece",
      stock: 1450,
      reorderPoint: 100,
      packagingConversions: { carton: 24 },
      status: "active"
    }],
    stockAssignments: [{ id: "ASN-JOURNEY-CARTON", productId: "SKU-JOURNEY-CARTON", assigned: 240, sold: 0, returned: 0, damaged: 0, status: "issued" }],
    stockTransactions: [],
    orders: []
  }
});
assert.match(packagedStockJourney, /stock-journey-package-quantity[^>]*>60 cartons/, "Stock Journey must show configured cartons before exact factory-stock pieces");
assert.match(packagedStockJourney, /60 cartons<\/strong>\s*<small>1,450 pieces<\/small>/, "Stock Journey package totals must retain the exact factory piece count underneath");
assert.match(packagedStockJourney, /stock-journey-package-quantity[^>]*>10 cartons<\/strong>\s*<small>240 pieces<\/small>/, "Representative stock in Stock Journey must also show cartons and exact pieces");

authenticate("user-ceo");
const ceoDashboard = renderDashboard({ state: store.getState() });
const custodySalesDashboard = renderDashboard({ state: { ...store.getState(), ...representativeCustodySalesFixture } });
assert.match(custodySalesDashboard, /<span class="eyebrow">Sales<\/span>[\s\S]*?<div class="metric-value">₦30,000<\/div>[\s\S]*?Actual customer sales/, "the rendered CEO Sales card must show actual customer sell-through revenue");
store.dispatch({ type: "SET_OPERATIONAL_RECORDS", collections: { stockCategories: [] } });
assert.deepEqual(store.getState().stockCategories.map((category) => category.id), ["raw_materials", "finished_products", "equipment"], "empty remote stock-category data must restore the built-in category choices");
const inventoryWithEmptyCategoryInput = renderInventory({ state: { ...store.getState(), stockCategories: [] } });
assert.match(inventoryWithEmptyCategoryInput, /Stock category[\s\S]*Raw Materials[\s\S]*Finished Products[\s\S]*Equipment/, "Add stock must always show the three stock-category choices");
assert.doesNotMatch(inventoryWithEmptyCategoryInput, /Choose whether this item is a finished product, a production raw material, or equipment/, "Add stock must not show the removed stock-category comment");
assert.match(ceoDashboard, /Last 7 days/);
assert.equal((ceoDashboard.match(/class="ceo-chart-column"/g) || []).length, 7, "CEO sales trend must remain seven days");
assert.doesNotMatch(ceoDashboard, /Submitted sales reports/, "submitted reports must be moved out of the CEO dashboard");
assert.match(ceoDashboard, /Chioma CEO/);
assert.match(ceoDashboard, /js-open-stock-modal/);
assert.match(ceoDashboard, /js-open-dashboard-dispatch/);
assert.match(ceoDashboard, /id="stock-product-modal" class="stock-modal-backdrop" hidden/);
assert.match(ceoDashboard, /id="dashboard-dispatch-modal" class="stock-modal-backdrop" hidden/);
assert.doesNotMatch(ceoDashboard, /Executive overview/);
assert.match(ceoDashboard, /Factory dispatch/);
assert.equal((ceoDashboard.match(/id="manager-product-form"/g) || []).length, 1);
assert.equal((ceoDashboard.match(/id="stock-dispatch-form"/g) || []).length, 1);
assert.doesNotMatch(ceoDashboard, /ceo-freshness/);
assert.doesNotMatch(ceoDashboard, /Factory-to-cash controls/);
assert.doesNotMatch(ceoDashboard, /Business pulse/);
assert.doesNotMatch(ceoDashboard, /Customer ratings/);
assert.doesNotMatch(ceoDashboard, /Leadership drilldown/);
assert.doesNotMatch(ceoDashboard, /data-ceo-drilldown/);
assert.match(ceoDashboard, /dashboard-stock-quantity/, "CEO factory stock figures must include piece and package quantities");
const separatedStockSplit = renderDashboard({
  state: {
    ...store.getState(),
    products: [{ id: "SKU-SPLIT", name: "Split Test Chips", stockCategory: "finished_products", category: "Finished Products", stock: 80, reorderPoint: 10, unitPrice: 100, unitCost: 50, status: "active" }],
    stockAssignments: [{ id: "ASN-SPLIT", dispatchId: "DSP-REP-SPLIT", transactionId: "TXN-REP-SPLIT", productId: "SKU-SPLIT", repName: "Amina Rep", assigned: 20, sold: 0, returned: 0, status: "open" }],
    stockTransactions: [],
    orders: [
      { id: "ORD-REP-SPLIT", source: "factory_dispatch", dispatchId: "DSP-REP-SPLIT", transactionId: "TXN-REP-SPLIT", transactionIds: ["TXN-REP-SPLIT"], customerName: "Amina Rep", customerType: "Sales Representative", repName: "Amina Rep", status: "delivered", createdAt: currentTestDate, items: [{ productId: "SKU-SPLIT", quantity: 20, unitPrice: 100 }] },
      { id: "ORD-SUPERMARKET-SPLIT", source: "factory_dispatch", dispatchId: "DSP-MARKET-SPLIT", customerName: "Central Supermarket", customerType: "Supermarket", status: "delivered", createdAt: currentTestDate, items: [{ productId: "SKU-SPLIT", quantity: 7, unitPrice: 100 }] }
    ],
    invoices: [],
    retailers: [{ id: "RTL-SPLIT", name: "Central Supermarket", channel: "Supermarket" }],
    routes: [],
    salesReports: [],
    creditLimits: []
  }
});
assert.match(separatedStockSplit, /data-stock-split="representatives"[\s\S]*?<span class="strong">20<\/span>/, "representative-held stock must remain in the representative stock split");
assert.match(separatedStockSplit, /Sales rep/, "the stock split must use the shorter sales-rep label");
assert.match(separatedStockSplit, /data-stock-split="supermarkets"[\s\S]*?<span class="strong">7<\/span>/, "representative dispatches must not be added to supermarket stock");
assert.match(separatedStockSplit, /factory stock available/i, "CEO Stock must be labelled as factory-only stock");
assert.match(separatedStockSplit, /(?:metric-value|ceo-metric-secondary)">80 pieces<\/div>/, "CEO Stock must show only the 80 pieces remaining at the factory after dispatch");
assert.match(separatedStockSplit, /ceo-stock-split-total[\s\S]*Total stock produced[\s\S]*progress-track[\s\S]*<span class="strong">107<\/span>/, "total produced stock must use the same line-and-value treatment as the other stock splits");
assert.match(separatedStockSplit, /id="ceo-stock-split-modal"[\s\S]*data-stock-split-family="Split Test Chips"/, "the stock split modal must list product-level splits");
assert.match(separatedStockSplit, /data-stock-split-size-view="Split Test Chips"[\s\S]*Split Test Chips[\s\S]*Standard/, "each product must drill down to size-level stock splits");
globalThis.window.location.hash = "#/activity-log?tab=submitted-reports";
const ceoSubmittedReports = renderActivityLog({ state: store.getState() });
assert.match(ceoSubmittedReports, /Activity log pages/);
assert.match(ceoSubmittedReports, /Submitted sales reports/);
assert.match(ceoSubmittedReports, /js-view-report-details/, "CEO must be able to open the detailed report view");
assert.match(ceoSubmittedReports, /title="Download submitted sales report"/);
assert.match(ceoSubmittedReports, /title="Print submitted sales report"/);
assert.match(ceoSubmittedReports, /js-review-report/, "CEO must inherit report review controls from the former Manager role");

authenticate("user-store");
const storeKeeperDashboard = renderDashboard({ state: store.getState() });
assert.match(storeKeeperDashboard, /Tola Store/);
assert.deepEqual(currentUserPermissions(store.getState()).nav, ["dashboard", "inventory", "activity-log", "settings"]);
assert.equal(currentUserPermissions(store.getState()).canFulfillPurchaseOrders, false);
assert.match(storeKeeperDashboard, /storekeeper-factory-stock-dropdown/);
assert.match(storeKeeperDashboard, /<details>/);
assert.match(storeKeeperDashboard, /Today's factory stock/);
assert.doesNotMatch(storeKeeperDashboard, /<details\s+open/);
assert.doesNotMatch(storeKeeperDashboard, /Forwarded Purchase Orders/);
assert.match(storeKeeperDashboard, /js-open-dashboard-dispatch/);
assert.match(storeKeeperDashboard, /id="dashboard-dispatch-modal" class="stock-modal-backdrop" hidden/);
assert.equal((storeKeeperDashboard.match(/id="stock-dispatch-form"/g) || []).length, 1);
assert.match(storeKeeperDashboard, /name="paymentType"/);
assert.match(storeKeeperDashboard, /value="cash">Cash paid on dispatch/);
assert.match(storeKeeperDashboard, /value="credit">Credit/);
assert.match(storeKeeperDashboard, /option value="Walk-in Customer">Walk-in Customer/, "factory dispatch must support walk-in customers");
assert.match(storeKeeperDashboard, /name="dispatchProductId"/);
assert.match(storeKeeperDashboard, /name="dispatchQuantity"/);
assert.match(storeKeeperDashboard, /data-dispatch-item-template/);
assert.match(storeKeeperDashboard, /js-add-dispatch-item/);
assert.doesNotMatch(storeKeeperDashboard, /href="#\/inventory\?tab=dispatch"/);

store.dispatch({
  type: "UPSERT_PRODUCT",
  productId: "SKU-BYPASS-BLOCKED",
  sku: "SKU-BYPASS-BLOCKED",
  name: "Bypass attempt",
  stockCategory: "finished_products",
  stock: 5,
  status: "active"
});
assert.equal(store.getState().products.some((product) => product.id === "SKU-BYPASS-BLOCKED"), false, "Store Keepers must not add live stock directly");
store.dispatch({
  type: "SUBMIT_STOCK_ADDITION_REQUEST",
  kind: "new_product",
  productId: "SKU-APPROVAL-1",
  quantity: 12,
  product: {
    id: "SKU-APPROVAL-1",
    name: "Approval Chips",
    productFamily: "Approval Chips",
    productType: "Original",
    size: "50g",
    sizeValue: "50",
    sizeUnit: "g",
    category: "Finished Products",
    stockCategory: "finished_products",
    unit: "g",
    warehouse: "Finished Products Store",
    region: "Factory",
    stock: 12,
    reorderPoint: 3,
    dailyVelocity: 0,
    unitCost: 100,
    unitPrice: 150,
    status: "active"
  }
});
const pendingStockAddition = store.getState().stockAdditionRequests.find((request) => request.productId === "SKU-APPROVAL-1");
assert.equal(pendingStockAddition?.status, "pending", "Store Keeper stock additions must become pending requests");
assert.equal(store.getState().products.some((product) => product.id === "SKU-APPROVAL-1"), false, "pending stock must not appear in live inventory");

authenticate("user-production");
const productionManagerDashboard = renderDashboard({ state: store.getState() });
assert.match(productionManagerDashboard, /Production Line Manager portal/);
assert.match(productionManagerDashboard, /Recent production batches/);
assert.match(productionManagerDashboard, /Manage production/);
assert.doesNotMatch(productionManagerDashboard, /js-open-dashboard-dispatch|Add stock|Staff accounts|finance/i, "the Production Line Manager portal must remain limited to production work");
assert.deepEqual(currentUserPermissions(store.getState()).nav, ["dashboard", "production", "inventory", "activity-log", "settings"]);
assert.equal(currentUserPermissions(store.getState()).canPlanProduction, true);
assert.equal(currentUserPermissions(store.getState()).canRecordProduction, true);
assert.equal(currentUserPermissions(store.getState()).canAssignProductionWork, true);
assert.equal(currentUserPermissions(store.getState()).canPerformProductionQC, true);
assert.equal(currentUserPermissions(store.getState()).canApproveProductionBatch, true);
assert.equal(currentUserPermissions(store.getState()).canTransferFinishedGoods, true);
assert.equal(currentUserPermissions(store.getState()).canReportProductionIssues, true);
assert.equal(currentUserPermissions(store.getState()).canViewProductionReports, true);
globalThis.window.location.hash = "#/inventory?tab=movement-history";
const productionManagerInventory = renderInventory({ state: store.getState() });
assert.equal((productionManagerInventory.match(/class="subtab-link/g) || []).length, 1, "Production Line Managers must only receive Stock Health in inventory");
assert.doesNotMatch(productionManagerInventory, /js-open-stock-modal|js-restock-product|Factory dispatch/);

const productionWorkflowStore = createStore();
productionWorkflowStore.dispatch({
  type: "SET_AUTHENTICATED_WORKSPACE",
  session: { user: { id: "user-production" } },
  user: { id: "user-production", email: "bello@example.com", user_metadata: { full_name: "Bello Production" } },
  client,
  accounts,
  invites: [],
  featureModules: [],
  messages: [],
  activityLogs: []
});
productionWorkflowStore.dispatch({
  type: "SET_OPERATIONAL_RECORDS",
  collections: {
    products: [
      { id: "PROD-FIN", name: "Production Chips", stockCategory: "finished_products", category: "Finished Products", stock: 10, reorderPoint: 5, unit: "pieces", unitCost: 50, unitPrice: 100, status: "active" },
      { id: "PROD-RAW", name: "Production Potatoes", stockCategory: "raw_materials", category: "Raw Materials", stock: 100, reorderPoint: 20, unit: "kg", unitCost: 10, unitPrice: 0, status: "active" }
    ],
    productionPlans: [],
    productionBatches: [],
    productionIssues: [],
    stockTransactions: [],
    activityLogs: []
  }
});
globalThis.window.location.hash = "#/production?tab=plans";
const productionPlanPage = renderProduction({ state: productionWorkflowStore.getState() });
assert.match(productionPlanPage, /Create production plan/);
assert.match(productionPlanPage, /Daily[\s\S]*Weekly/);
assert.match(productionPlanPage, /Products and target quantities/);
assert.match(productionPlanPage, /Team[\s\S]*Shift[\s\S]*Machine or production line/);
assert.match(productionPlanPage, /Raw materials issued for this batch/);
assert.match(productionPlanPage, /Raw materials issued for this batch[\s\S]*optional/);
assert.match(productionPlanPage, /name="materialName"[\s\S]*Fresh ginger/);
assert.match(productionPlanPage, /Quality control \(QC\)[\s\S]*appearance, measurement, packaging, and safety standards/);
assert.match(productionPlanPage, /Rejected quantity[\s\S]*Damaged quantity[\s\S]*Wasted quantity/);
assert.match(productionPlanPage, /Confirm batch quality/);
assert.match(productionPlanPage, /Report production issue/);

productionWorkflowStore.dispatch({
  type: "CREATE_PRODUCTION_PLAN",
  name: "Daily chips plan",
  cadence: "daily",
  startDate: "2026-08-01",
  endDate: "2026-08-01",
  lines: [{ productId: "PROD-FIN", quantity: 80 }],
  team: "Team A",
  shift: "Morning",
  machine: "Line 1"
});
const productionPlan = productionWorkflowStore.getState().productionPlans[0];
assert.equal(productionPlan?.lines[0]?.quantity, 80, "production plans must record product targets");
assert.equal(productionPlan?.team, "Team A", "production plans must assign work to teams");
assert.equal(productionPlan?.shift, "Morning", "production plans must assign shifts");
assert.equal(productionPlan?.machine, "Line 1", "production plans must assign machines");

productionWorkflowStore.dispatch({
  type: "RECORD_MANAGED_PRODUCTION_BATCH",
  planId: productionPlan.id,
  finishedProductId: "PROD-FIN",
  batchReference: "BATCH-MANAGED-001",
  batchDate: "2026-08-01",
  expiryDate: "2026-12-01",
  quantityProduced: 75,
  quantityRejected: 2,
  quantityDamaged: 1,
  quantityWasted: 2,
  materials: [{ productId: "PROD-RAW", quantity: 20 }]
});
const managedBatch = productionWorkflowStore.getState().productionBatches[0];
assert.equal(managedBatch?.status, "awaiting_qc", "new production output must wait for quality control");
assert.equal(managedBatch?.expiryDate, "2026-12-01", "production batches must record expiry dates");
assert.equal(managedBatch?.quantityRejected, 2);
assert.equal(managedBatch?.quantityDamaged, 1);
assert.equal(managedBatch?.quantityWasted, 2);
assert.equal(productionWorkflowStore.getState().products.find((product) => product.id === "PROD-RAW")?.stock, 80, "raw materials issued must leave stock immediately");
assert.equal(productionWorkflowStore.getState().products.find((product) => product.id === "PROD-FIN")?.stock, 10, "finished stock must not increase before QC, approval, and transfer");

productionWorkflowStore.dispatch({ type: "RECORD_PRODUCTION_QC", batchId: managedBatch.id, outcome: "passed", checks: { appearance: true, weight: true, packaging: true, safety: true } });
assert.equal(productionWorkflowStore.getState().productionBatches.find((batch) => batch.id === managedBatch.id)?.status, "qc_passed", "a batch with every QC check confirmed can pass quality control");
productionWorkflowStore.dispatch({ type: "APPROVE_PRODUCTION_BATCH", batchId: managedBatch.id });
assert.equal(productionWorkflowStore.getState().productionBatches.find((batch) => batch.id === managedBatch.id)?.status, "approved", "passed batches can be approved by the Production Line Manager");
productionWorkflowStore.dispatch({ type: "TRANSFER_PRODUCTION_BATCH", batchId: managedBatch.id });
assert.equal(productionWorkflowStore.getState().productionBatches.find((batch) => batch.id === managedBatch.id)?.status, "transferred", "approved batches can be transferred to finished goods");
assert.equal(productionWorkflowStore.getState().products.find((product) => product.id === "PROD-FIN")?.stock, 85, "warehouse stock must increase only after transfer");
assert.equal(productionWorkflowStore.getState().productionPlans[0]?.status, "in_progress", "a short production plan must remain in progress until its full target is transferred");
assert.equal(productionWorkflowStore.getState().stockTransactions.some((transaction) => transaction.type === "production output" && transaction.batchId === managedBatch.id), true, "finished-goods transfers must create a stock audit transaction");

productionWorkflowStore.dispatch({ type: "REPORT_PRODUCTION_ISSUE", issueType: "machine_downtime", severity: "high", planId: productionPlan.id, machine: "Line 1", downtimeMinutes: 45, description: "Drive belt replacement" });
const productionIssue = productionWorkflowStore.getState().productionIssues[0];
assert.equal(productionIssue?.downtimeMinutes, 45, "production issues must record machine downtime");
productionWorkflowStore.dispatch({ type: "RESOLVE_PRODUCTION_ISSUE", issueId: productionIssue.id, resolution: "Drive belt replaced" });
assert.equal(productionWorkflowStore.getState().productionIssues.find((issue) => issue.id === productionIssue.id)?.status, "resolved", "production issues must support resolution records");

globalThis.window.location.hash = "#/production?tab=reports";
const productionReportPage = renderProduction({ state: productionWorkflowStore.getState() });
assert.match(productionReportPage, /Production efficiency, wastage, and output/);
assert.match(productionReportPage, /Planned[\s\S]*Actual[\s\S]*Variance[\s\S]*Plan efficiency[\s\S]*Losses[\s\S]*Yield/);
assert.match(productionReportPage, /Daily chips plan[\s\S]*Production Chips[\s\S]*80[\s\S]*75/);
assert.equal(getScopedActivityLogs(productionWorkflowStore.getState()).some((entry) => entry.recordType === "production_transfer"), true, "Production Line Manager activity must include finished-goods transfers");

productionWorkflowStore.dispatch({
  type: "RECORD_MANAGED_PRODUCTION_BATCH",
  planId: productionPlan.id,
  finishedProductId: "PROD-FIN",
  batchReference: "BATCH-NO-MATERIALS",
  batchDate: "2026-08-01",
  expiryDate: "2026-12-01",
  quantityProduced: 1,
  materials: []
});
assert.equal(productionWorkflowStore.getState().productionBatches.find((batch) => batch.reference === "BATCH-NO-MATERIALS")?.materials.length, 0, "raw-material entry must be optional when recording a batch");

productionWorkflowStore.dispatch({
  type: "RECORD_MANAGED_PRODUCTION_BATCH",
  planId: productionPlan.id,
  finishedProductId: "PROD-FIN",
  batchReference: "BATCH-CUSTOM-MATERIAL",
  batchDate: "2026-08-01",
  expiryDate: "2026-12-01",
  quantityProduced: 1,
  materials: [{ name: "Fresh ginger", quantity: 3, unit: "kg" }]
});
const customMaterialBatch = productionWorkflowStore.getState().productionBatches.find((batch) => batch.reference === "BATCH-CUSTOM-MATERIAL");
assert.equal(customMaterialBatch?.materials[0]?.productName, "Fresh ginger", "unsaved raw-material names must be recorded on production batches");
assert.equal(customMaterialBatch?.materials[0]?.inventoryLinked, false, "typed materials must not pretend to be saved inventory records");
assert.equal(productionWorkflowStore.getState().products.find((product) => product.id === "PROD-RAW")?.stock, 80, "typed materials must not alter saved inventory stock");

authenticate("user-admin");
assert.equal(currentUserPermissions(store.getState()).canAddStock, true, "Admin must be allowed to add and restock live stock");
globalThis.window.location.hash = "#/inventory?tab=stock-health";
const adminStockApprovalQueue = renderInventory({ state: store.getState() });
assert.match(adminStockApprovalQueue, /Stock additions awaiting approval/);
assert.match(adminStockApprovalQueue, /SKU-APPROVAL-1[\s\S]*js-approve-stock-addition/);
store.dispatch({ type: "APPROVE_STOCK_ADDITION_REQUEST", requestId: pendingStockAddition.id });
assert.equal(store.getState().products.find((product) => product.id === "SKU-APPROVAL-1")?.stock, 12, "Admin approval must publish the requested stock to live inventory");
assert.equal(store.getState().stockAdditionRequests.find((request) => request.id === pendingStockAddition.id)?.status, "approved");

authenticate("user-manager");
const ceoCustomersPage = renderRetailers({ state: store.getState() });
assert.match(ceoCustomersPage, /Add Customer/);
assert.match(ceoCustomersPage, /data-reset-workspace-scope="customers"/, "CEO customer records must include a delete-all control");
assert.doesNotMatch(ceoCustomersPage, /Customer relationship/);
assert.doesNotMatch(ceoCustomersPage, /Supermarkets, kiosks, wholesalers, contacts, and balances owed/);
assert.equal(NIGERIA_STATE_NAMES.length, 37, "customer state list must contain all 36 states and FCT");
assert.equal(NIGERIA_STATE_NAMES[0], "Kaduna", "Kaduna must appear first in the customer state list");
assert.equal(NIGERIA_STATES_AND_LGAS.reduce((total, entry) => total + entry.lgas.length, 0), 774, "Nigeria location data must contain all 774 LGAs");
assert.deepEqual(getNigeriaLgas("Kaduna").slice(0, 2), ["Birnin Gwari", "Chikun"]);
assert.equal(normalizeNigeriaStateName("FCT"), "Federal Capital Territory (FCT)");
const customerStateSelect = ceoCustomersPage.match(/<select name="stateName" required>([\s\S]*?)<\/select>/)?.[1] || "";
assert.equal((customerStateSelect.match(/<option /g) || []).length, 37, "Add Customer must show all Nigerian states and FCT");
assert.match(customerStateSelect, /^\s*<option value="Kaduna">Kaduna<\/option>/, "Kaduna must be the initially selected state");
assert.match(ceoCustomersPage, /<select name="lga" required>/);
assert.match(ceoCustomersPage, /<option value="Zaria">Zaria<\/option>/);
assert.match(ceoCustomersPage, /<input name="address"[^>]+required>/);
assert.doesNotMatch(ceoCustomersPage, /City or town|name="city"/);
const historyRetailer = { id: "RTL-HISTORY", name: "History Supermarket", channel: "Supermarket", status: "active", outstanding: 2500 };
const historyRetailerState = {
  ...store.getState(),
  retailers: [historyRetailer],
  orders: [{ id: "ORD-HISTORY", retailerId: "RTL-HISTORY", status: "delivered", createdAt: "2026-07-12", items: [{ productId: "SKU-CHIPS", quantity: 4, unitPrice: 500 }] }]
};
const customerHistoryView = renderCustomerDetails(historyRetailer, historyRetailerState, currentUserPermissions(historyRetailerState));
assert.match(customerHistoryView, /Supply history/);
assert.match(customerHistoryView, /Deactivate customer/);
assert.match(customerHistoryView, /Products supplied to this outlet/);
const clearCustomerView = renderCustomerDetails({ ...historyRetailer, outstanding: 0 }, { ...historyRetailerState, creditLimits: [] }, currentUserPermissions(historyRetailerState));
assert.match(clearCustomerView, /Credit clear/);
assert.doesNotMatch(clearCustomerView, /No limit set/);
const repCustomerState = {
  ...historyRetailerState,
  session: { user: { id: "user-rep" } },
  user: { id: "user-rep", email: "amina@example.com" },
  accounts,
  creditLimits: [{ id: "CRD-HISTORY", partyType: "Customer", partyName: historyRetailer.name, limit: 10000, balance: 9000 }]
};
const scopedRepCustomerState = scopeStateForCurrentRole(repCustomerState);
const repCustomerRow = renderRetailers({ state: scopedRepCustomerState });
const repCustomerModal = renderCustomerDetails(historyRetailer, scopedRepCustomerState, currentUserPermissions(scopedRepCustomerState));
assert.match(repCustomerRow, /Credit Watch/);
assert.match(repCustomerModal, /Credit Watch/);
assert.match(repCustomerRow, /High risk/);
assert.match(repCustomerModal, /High Risk/);
store.getState().retailers.push({ ...historyRetailer });
store.dispatch({ type: "TOGGLE_RETAILER_STATUS", retailerId: historyRetailer.id });
assert.equal(store.getState().retailers.find((retailer) => retailer.id === historyRetailer.id).status, "inactive");
store.getState().retailers = store.getState().retailers.filter((retailer) => retailer.id !== historyRetailer.id);
store.getState().creditLimits = Array.from({ length: 12 }, (_, index) => ({
  id: `CRD-${index + 1}`,
  partyType: index === 0 ? "Sales Representative" : "Customer",
  partyName: index === 0 ? "Amina Rep" : index === 1 ? "Sahad Stores" : `Customer ${index + 1}`,
  limit: 100000,
  balance: (12 - index) * 5000,
  previousLimit: 80000,
  changedBy: "Musa Manager",
  changedAt: `2026-07-${String(10 - Math.floor(index / 2)).padStart(2, "0")}T08:00:00Z`,
  paymentPeriodDays: 14
}));
store.getState().creditLimitHistory = Array.from({ length: 24 }, (_, index) => ({
  id: `CLH-${index + 1}`,
  partyType: index < 12 ? "Sales Representative" : "Customer",
  partyName: index < 12 ? `Representative ${index + 1}` : `Customer ${index - 11}`,
  previousLimit: 80000,
  nextLimit: 100000,
  changedBy: "Musa Manager",
  changedAt: `2026-07-${String(10 - Math.floor((index % 12) / 2)).padStart(2, "0")}T08:00:00Z`
}));
globalThis.window.location.hash = "#/inventory?tab=credit";
const stockWithoutCreditLimits = renderInventory({ state: store.getState() });
assert.doesNotMatch(stockWithoutCreditLimits, />Credit limits</);
assert.doesNotMatch(stockWithoutCreditLimits, /Sales representative credit limits|Customer credit limits/);
assert.match(stockWithoutCreditLimits, /Stock health/);

store.getState().orders = [{
  id: "ORD-CREDIT-AGING",
  source: "quick_sale",
  customerName: "Sahad Stores",
  retailerId: "",
  paymentType: "credit",
  paymentStatus: "open",
  createdAt: "2026-06-01",
  dueAt: "2026-06-15",
  items: [{ productId: "SKU-CHIPS", quantity: 3, unitPrice: 500 }]
}];
globalThis.window.location.hash = "#/finance?tab=overview";
const financeOverview = renderFinance({ state: store.getState() });
assert.match(financeOverview, /data-reset-workspace-scope="finance"/, "CEO finance pages must include a clear-all control");
assert.doesNotMatch(financeOverview, /Customer balances/);
assert.match(financeOverview, /Sales reports/);
assert.match(financeOverview, /Invoices/);
assert.match(financeOverview, /Product revenue/);
assert.match(financeOverview, /Credit limits/);
assert.match(financeOverview, /Credit history/);
assert.match(financeOverview, /Cash in/);
assert.match(financeOverview, /Gross sales/);
assert.match(financeOverview, /Net sales/);
assert.match(financeOverview, /Discounts/);
assert.match(financeOverview, /Other deductions/);
assert.match(financeOverview, /Gross profit/);
assert.match(financeOverview, /Stock loss/);
assert.match(financeOverview, /finance-compact-summary/);
assert.equal((financeOverview.match(/finance-compact-summary-card/g) || []).length, 9);
assert.ok(financeOverview.indexOf("Cash in") < financeOverview.indexOf("Credit aging"), "compact finance summary must appear above Credit aging");
assert.doesNotMatch(financeOverview, /Customer returns reducing sales|Written-off stock at cost value/);
assert.match(financeOverview, /Credit aging[\s\S]*₦1,500/, "open credit orders must feed the credit-aging view");

globalThis.window.location.hash = "#/finance?tab=invoices";
const ceoFinanceInvoices = renderFinance({ state: store.getState() });
assert.match(ceoFinanceInvoices, /Download, print, and confirm customer payments/);
assert.match(ceoFinanceInvoices, /js-view-invoice/);
assert.match(ceoFinanceInvoices, /js-download-invoice/);
assert.match(ceoFinanceInvoices, /data-ceo-delete-selected="invoices"/);
assert.match(ceoFinanceInvoices, /<thead>[\s\S]*data-ceo-select-all="invoices"[\s\S]*<th>Invoice<\/th>/);
assert.doesNotMatch(ceoFinanceInvoices, /data-ceo-clear-section|>Clear invoices</);
assert.doesNotMatch(ceoFinanceInvoices, /data-reset-workspace-scope="finance"/, "the broad finance clear control must stay on Overview only");

globalThis.window.location.hash = "#/finance?tab=sales-reports";
const ceoFinanceSalesReports = renderFinance({ state: store.getState() });
assert.match(ceoFinanceSalesReports, /data-ceo-delete-selected="sales_reports"/);
assert.match(ceoFinanceSalesReports, /<thead>[\s\S]*data-ceo-select-all="sales_reports"[\s\S]*<th>Report<\/th>/);
assert.doesNotMatch(ceoFinanceSalesReports, /data-ceo-clear-section|>Clear sales reports</);
assert.doesNotMatch(ceoFinanceSalesReports, /data-reset-workspace-scope="finance"/);

globalThis.window.location.hash = "#/finance?tab=product-revenue";
const ceoProductRevenue = renderFinance({ state: store.getState() });
assert.match(ceoProductRevenue, /Revenue, cost, and profit/);
assert.match(ceoProductRevenue, /data-ceo-delete-selected="product_revenue"/);
assert.match(ceoProductRevenue, /<thead>[\s\S]*data-ceo-select-all="product_revenue"[\s\S]*<th>Date<\/th>/);
assert.doesNotMatch(ceoProductRevenue, /data-ceo-clear-section|Clear revenue data/);
assert.doesNotMatch(ceoProductRevenue, /data-reset-workspace-scope="finance"/);

globalThis.window.location.hash = "#/finance?tab=credit-limits";
const financeLimits = renderFinance({ state: store.getState() });
assert.match(financeLimits, /Sales representative credit reports/);
assert.match(financeLimits, /Customer credit terms/);
assert.match(financeLimits, /id="rep-credit-limit-form"[\s\S]*name="limit" type="number" min="1" step="1"/, "typed representative credit limits must be accepted without using spinner buttons");
assert.doesNotMatch(financeLimits, /name="limit" type="number" min="1" step="1000"/, "credit-limit inputs must not use the invalid min-one thousand-step combination");
const representativeCreditReports = financeLimits.match(/data-credit-report-type="representative"[\s\S]*?<\/section>/)?.[0] || "";
const customerCreditReports = financeLimits.match(/data-credit-report-type="customer"[\s\S]*?<\/section>/)?.[0] || "";
assert.equal((representativeCreditReports.match(/js-open-credit-account/g) || []).length, 1, "sales representative credit reports must be listed separately");
assert.equal((customerCreditReports.match(/js-open-credit-account/g) || []).length, 11, "customer credit reports must be listed separately");
assert.doesNotMatch(financeLimits, /Credit exposure/);
assert.equal((financeLimits.match(/js-open-credit-account/g) || []).length, 12);
assert.match(financeLimits, /id="credit-account-modal"/);
assert.match(financeLimits, /data-credit-account-detail/);
assert.match(financeLimits, /credit-account-list-header[\s\S]*data-ceo-select-all="representative_credit_limits"[\s\S]*Sales representative/);
assert.match(financeLimits, /credit-account-list-header[\s\S]*data-ceo-select-all="customer_credit_limits"[\s\S]*Customer/);
assert.match(financeLimits, /data-ceo-delete-selected="representative_credit_limits"/);
assert.match(financeLimits, /data-ceo-delete-selected="customer_credit_limits"/);
assert.doesNotMatch(financeLimits, /data-ceo-clear-section|Clear representative credit reports|Clear customer credit terms/);
assert.doesNotMatch(financeLimits, /data-reset-workspace-scope="finance"/);

globalThis.window.location.hash = "#/finance?tab=credit-history";
const financeHistory = renderFinance({ state: store.getState() });
assert.match(financeHistory, /Sales representative credit terms history/);
assert.match(financeHistory, /Customer credit terms history/);
assert.match(financeHistory, /credit-history-account/);
assert.match(financeHistory, /Download CSV/);
assert.doesNotMatch(financeHistory, /data-ceo-clear-section="representative_credit_history"/);
assert.doesNotMatch(financeHistory, /data-ceo-clear-section="customer_credit_history"/);
assert.match(financeHistory, /data-ceo-delete-selected="representative_credit_history"/);
assert.match(financeHistory, /data-ceo-delete-selected="customer_credit_history"/);
assert.equal((financeHistory.match(/aria-label="Select or deselect every row"/g) || []).length, 2, "each Credit History list must have one checkbox-only master selector");
assert.match(financeHistory, /<thead>[\s\S]*data-ceo-select-all="representative_credit_history"[\s\S]*<th>Account<\/th>/);
assert.match(financeHistory, /<thead>[\s\S]*data-ceo-select-all="customer_credit_history"[\s\S]*<th>Account<\/th>/);
assert.doesNotMatch(financeHistory, /Delete selected|>Select all<|Clear representative credit history|Clear customer credit history/, "Credit History must use only simplified Delete controls");
assert.equal((financeHistory.match(/data-finance-page-row="credit-history-representative"/g) || []).length, 12);

const retiredAccountantStore = createStore();
retiredAccountantStore.dispatch({
  type: "SET_AUTHENTICATED_WORKSPACE",
  session: { user: { id: "cleanup-ceo" } },
  user: { id: "cleanup-ceo", email: "cleanup@example.com" },
  client,
  accounts: [
    { id: "cleanup-ceo-membership", clientId: client.id, userId: "cleanup-ceo", name: "Cleanup CEO", email: "cleanup@example.com", role: "ceo", status: "active" },
    { id: "retired-accountant", clientId: client.id, userId: "retired-accountant-user", name: "Retired Accountant", email: "retired@example.com", role: "accountant", status: "active" }
  ],
  invites: [{ id: "retired-accountant-invite", role: "accountant", email: "retired@example.com" }],
  featureModules: [],
  messages: [],
  activityLogs: []
});
assert.equal(retiredAccountantStore.getState().accounts.length, 1, "retired Accountant staff must be removed from workspace state");
assert.equal(retiredAccountantStore.getState().invites.length, 0, "retired Accountant invitations must be removed from workspace state");
assert.equal((financeHistory.match(/hidden data-finance-page-row="credit-history-representative"/g) || []).length, 2);
assert.equal((financeHistory.match(/data-finance-page-row="credit-history-customer"/g) || []).length, 12);
assert.equal((financeHistory.match(/hidden data-finance-page-row="credit-history-customer"/g) || []).length, 2);

const movementTemplate = store.getState().stockTransactions[0];
store.getState().stockTransactions = Array.from({ length: 12 }, (_, index) => ({
  ...movementTemplate,
  id: `TXN-PAGE-${index + 1}`,
  date: `2026-07-${String(10 - Math.floor(index / 2)).padStart(2, "0")}`
}));
globalThis.window.location.hash = "#/inventory?tab=movement-history";
const movementPage = renderInventory({ state: store.getState() });
assert.equal((movementPage.match(/data-movement-row/g) || []).length, 12);
assert.equal((movementPage.match(/hidden data-movement-row/g) || []).length, 2, "movement history must initially show no more than 10 rows");
assert.match(movementPage, /data-movement-pagination/);
assert.doesNotMatch(movementPage, /<td>\s*[\d,.]+\s*g\s*<\/td>/i, "movement quantities must not append the product size unit");

store.dispatch({ type: "TOGGLE_PRODUCT_STATUS", productId: "SKU-CHIPS" });
authenticate("user-rep");
assert.equal(scopeStateForCurrentRole(store.getState()).stockAssignments.length, 1, "reactivated products must return to representative stock flows");

store.getState().retailers = [{ id: "RTL-CREDIT", name: "Credit Corner", channel: "Retailer" }];
const financialInvoiceCountBeforeCreditSellThrough = getFinancialInvoiceRecords(store.getState()).length;
store.dispatch({
  type: "LOG_REP_TRANSACTION",
  assignmentIds: [assignment.id],
  productId: "SKU-CHIPS",
  customerId: "RTL-CREDIT",
  customerName: "Credit Corner",
  customerType: "Retailer",
  quantity: 1,
  transactionType: "sale",
  paymentType: "credit",
  repName: "Amina Rep"
});
const creditSaleInvoice = getInvoiceRecords(store.getState()).find((invoice) => invoice.customerName === "Credit Corner");
assert.ok(creditSaleInvoice, "every representative customer sale must create a receipt");
assert.equal(creditSaleInvoice.status, "recorded");
assert.equal(creditSaleInvoice.paymentType, "not_tracked");
assert.equal(creditSaleInvoice.financialImpact, false);
assert.equal(getFinancialInvoiceRecords(store.getState()).length, financialInvoiceCountBeforeCreditSellThrough, "customer credit recorded by a representative must not add a factory receivable");
assert.equal(store.getState().creditLimits.some((limit) => limit.partyName === "Credit Corner"), false, "representative customer credit must not create or change a factory credit balance");

const stockBeforeFactoryReturn = store.getState().products.find((product) => product.id === "SKU-CHIPS").stock;
const outstandingBeforeFactoryReturn = store.getState().stockAssignments.find((item) => item.id === assignment.id).assigned
  - store.getState().stockAssignments.find((item) => item.id === assignment.id).sold
  - store.getState().stockAssignments.find((item) => item.id === assignment.id).returned;
store.dispatch({
  type: "RETURN_REP_STOCK_TO_FACTORY",
  assignmentIds: [assignment.id],
  productId: "SKU-CHIPS",
  quantity: 1,
  reason: "Unsold stock",
  repName: "Amina Rep"
});
const returnedAssignment = store.getState().stockAssignments.find((item) => item.id === assignment.id);
const outstandingAfterFactoryReturn = returnedAssignment.assigned - returnedAssignment.sold - returnedAssignment.returned;
assert.equal(store.getState().products.find((product) => product.id === "SKU-CHIPS").stock, stockBeforeFactoryReturn + 1);
assert.equal(outstandingAfterFactoryReturn, outstandingBeforeFactoryReturn - 1);
assert.equal(store.getState().stockTransactions[0].type, "return to factory");
const reportAfterFactoryReturn = renderDashboard({ state: scopeStateForCurrentRole(store.getState()) });
assert.match(reportAfterFactoryReturn, /Back to factory/);
assert.match(reportAfterFactoryReturn, /Returned to factory/);

const completion = getCustomerOrderCompletion(
  { id: "RTL-METRIC", name: "Metric Mart" },
  {
    orders: [
      { retailerId: "RTL-METRIC", status: "delivered" },
      { retailerId: "RTL-METRIC", status: "delayed", expectedDeliveryAt: "2026-07-01" },
      { retailerId: "RTL-OTHER", status: "delivered" }
    ]
  },
  "2026-07-11"
);
assert.deepEqual(completion, { completedOrders: 1, totalOrders: 2, percent: 50 });

const emailDetails = buildLoginDetailsEmail({
  client: { companyName: "Test Factory" },
  invite: {
    to: "new.staff@example.com",
    temporaryPassword: "Distro-Secure123!",
    role: "store_keeper"
  },
  loginUrl: "https://app.example.com/#/login"
});
assert.match(emailDetails.mailtoHref, /^mailto:new\.staff@example\.com\?/);
assert.match(decodeURIComponent(emailDetails.mailtoHref), /Temporary password: Distro-Secure123!/);
assert.match(emailDetails.whatsappHref, /^https:\/\/wa\.me\/\?text=/);
assert.match(emailDetails.clipboardText, /Sign-in email: new\.staff@example\.com/);
assert.doesNotMatch(emailDetails.clipboardText, /^To:|^Subject:/m);

authenticate("user-manager");
store.dispatch({
  type: "CREATE_ACCOUNT",
  payload: {
    name: "Security Test",
    email: "security-test@example.com",
    phoneNumber: "08000000000",
    role: "sales_rep",
    staffImageUrl: staffImageFixture
  }
});
const temporaryPassword = store.getState().invites.find((invite) => invite.to === "security-test@example.com")?.temporaryPassword;
assert.ok(temporaryPassword, "temporary password must be available once for staff handoff");
assert.ok(
  [...browserStorage.values()].every((value) => !String(value).includes(temporaryPassword)),
  "temporary passwords must never be persisted in browser storage"
);
const securityAccount = store.getState().accounts.find((account) => account.email === "security-test@example.com");
assert.equal(securityAccount.staffImageUrl, staffImageFixture, "new staff accounts must retain their optional image");
store.dispatch({ type: "DELETE_ACCOUNT", accountId: securityAccount.id });
assert.equal(store.getState().accounts.some((account) => account.id === securityAccount.id), false, "CEO must be able to delete a staff account");
store.dispatch({ type: "DELETE_ACCOUNT", accountId: "membership-ceo" });
assert.equal(store.getState().accounts.some((account) => account.id === "membership-ceo"), true, "CEO accounts must be protected from staff deletion");

authenticate("user-manager");
store.dispatch({ type: "RESTOCK_PRODUCT", productId: "SKU-CHIPS", quantity: 10 });
authenticate("user-store");
store.dispatch({
  type: "RECORD_STOCK_DISPATCH",
  productId: "SKU-CHIPS",
  quantity: 4,
  recipientType: "Sales Representative",
  recipientName: "Amina Rep",
  destination: "Correction test route",
  dispatchDate: "2026-07-14",
  expectedDeliveryAt: "2099-07-15",
  staffName: "Tola Store"
});
const correctionDispatch = store.getState().stockTransactions.find((transaction) => transaction.dispatchDestination === "Correction test route");
assert.ok(correctionDispatch, "dispatch correction fixture must be recorded");
const correctionStockBefore = store.getState().products.find((product) => product.id === "SKU-CHIPS").stock;
const correctionAssignmentBefore = store.getState().stockAssignments.find((item) => item.transactionId === correctionDispatch.id)?.assigned;
store.dispatch({
  type: "REQUEST_RECORD_CORRECTION",
  transactionId: correctionDispatch.id,
  requestedQuantity: Number(correctionDispatch.quantity) - 1,
  reason: "One carton was entered twice"
});
const dispatchCorrectionRequest = store.getState().correctionRequests.find((request) => request.transactionId === correctionDispatch.id && request.status === "pending");
assert.ok(dispatchCorrectionRequest, "Store Keeper must be able to request a reasoned dispatch correction");
globalThis.window.location.hash = "#/inventory?tab=dispatch";
assert.match(renderInventory({ state: store.getState() }), /Correction awaiting approval/);
store.dispatch({ type: "APPROVE_RECORD_CORRECTION", requestId: dispatchCorrectionRequest.id });
assert.equal(store.getState().correctionRequests.find((request) => request.id === dispatchCorrectionRequest.id).status, "pending", "Store Keeper must not approve a correction");

authenticate("user-manager");
assert.equal(currentUserPermissions(store.getState()).nav.includes("purchase-orders"), false, "CEO navigation must not show Purchase Orders");
assert.equal(currentUserPermissions(store.getState()).nav.includes("admin-operations"), false, "CEO navigation must not show Admin Operations");
assert.equal(currentUserPermissions(store.getState()).nav.includes("adjustments"), false, "Adjustments must not remain a standalone CEO navigation item");
globalThis.window.location.hash = "#/inventory?tab=adjustments";
const stockAdjustmentsPage = renderInventory({ state: store.getState() });
assert.match(stockAdjustmentsPage, /class="subtab-link is-active"[\s\S]*>\s*Adjustments/);
assert.match(stockAdjustmentsPage, /Adjustment approvals/);
const correctionApprovalDashboard = renderDashboard({ state: store.getState() });
assert.doesNotMatch(correctionApprovalDashboard, /Correction approvals/);
const correctionApprovalPage = renderAdjustments({ state: store.getState() });
assert.match(correctionApprovalPage, /Adjustment approvals/);
assert.match(correctionApprovalPage, /data-reset-workspace-scope="adjustments"/, "CEO correction requests must include a delete-all control");
assert.match(correctionApprovalPage, /One carton was entered twice/);
assert.match(correctionApprovalDashboard, /Added stock/);
assert.match(correctionApprovalDashboard, /Dispatched product/);
assert.match(correctionApprovalDashboard, /<details>/);
assert.doesNotMatch(correctionApprovalDashboard, /<details\s+open/);
assert.match(correctionApprovalDashboard, /js-toggle-product-types/);
assert.match(correctionApprovalDashboard, /data-product-type-dropdown="Plantain Chips"/);
store.dispatch({ type: "APPROVE_RECORD_CORRECTION", requestId: dispatchCorrectionRequest.id });
assert.equal(store.getState().correctionRequests.find((request) => request.id === dispatchCorrectionRequest.id).status, "approved");
assert.equal(store.getState().stockTransactions.find((transaction) => transaction.id === correctionDispatch.id).quantity, Number(correctionDispatch.quantity) - 1);
assert.equal(store.getState().products.find((product) => product.id === "SKU-CHIPS").stock, correctionStockBefore + 1);
assert.equal(
  store.getState().invoices.find((invoice) => invoice.id === correctionDispatch.invoiceId).amount,
  (Number(correctionDispatch.quantity) - 1) * Number(correctionDispatch.unitPrice),
  "approved dispatch corrections must update the linked invoice"
);
if (Number.isFinite(correctionAssignmentBefore)) {
  assert.equal(store.getState().stockAssignments.find((item) => item.transactionId === correctionDispatch.id).assigned, correctionAssignmentBefore - 1);
}
const correctionRequestCountBeforeCeoAdjustment = store.getState().correctionRequests.length;
const ceoAdjustmentModal = renderRecordCorrectionModal("Save adjustment");
assert.match(ceoAdjustmentModal, /Reason for adjustment \(optional\)/);
assert.doesNotMatch(ceoAdjustmentModal, /name="reason"[^>]*required/, "CEO adjustment reasons must be optional");
assert.match(renderRecordCorrectionModal(), /name="reason"[^>]*required/, "controlled staff correction requests must still require a reason");
store.dispatch({
  type: "DIRECT_RECORD_CORRECTION",
  transactionId: correctionDispatch.id,
  requestedQuantity: Number(correctionDispatch.quantity),
  reason: "CEO corrected the dispatch directly"
});
assert.equal(store.getState().correctionRequests.length, correctionRequestCountBeforeCeoAdjustment, "CEO direct adjustments must not create approval requests");
assert.equal(store.getState().stockTransactions.find((transaction) => transaction.id === correctionDispatch.id).quantity, Number(correctionDispatch.quantity));
store.dispatch({
  type: "DIRECT_RECORD_CORRECTION",
  transactionId: correctionDispatch.id,
  requestedQuantity: Number(correctionDispatch.quantity) - 1
});
assert.equal(store.getState().stockTransactions.find((transaction) => transaction.id === correctionDispatch.id).quantity, Number(correctionDispatch.quantity) - 1, "CEO direct adjustments must save without a reason");
assert.equal(store.getState().stockTransactions.find((transaction) => transaction.id === correctionDispatch.id).correctionReason, "CEO adjustment");
store.dispatch({
  type: "DIRECT_RECORD_CORRECTION",
  transactionId: correctionDispatch.id,
  requestedQuantity: Number(correctionDispatch.quantity),
  reason: "Restore correction fixture"
});
const productSizeDashboard = renderDashboard({ state: store.getState() });
assert.ok(productSizeDashboard.indexOf("Sales trend") < productSizeDashboard.indexOf(">Products<"), "CEO Sales trend must appear above Products");
assert.match(productSizeDashboard, /id="ceo-product-size-modal"/);
assert.match(productSizeDashboard, /ceo-product-size-modal product-catalogue-size-modal/, "CEO and Admin product catalogues must use the shared image frame");
assert.match(productSizeDashboard, /js-open-product-size-modal/);
assert.match(productSizeDashboard, /data-size-sku="SKU-CHIPS"/);
assert.match(productSizeDashboard, /Available in factory/);
assert.match(productSizeDashboard, /Dispatched today/);
assert.match(productSizeDashboard, /Stock with sales reps/);
assert.match(productSizeDashboard, /data-size-rep-stock=/);
assert.match(productSizeDashboard, /data-size-available-packages=/);
assert.match(productSizeDashboard, /data-size-detail-available-packages/);
assert.match(productSizeDashboard, /pieces[\s\S]*(?:cartons|packs)/, "configured package equivalents must appear alongside CEO stock pieces");
assert.match(productSizeDashboard, /<div class="metric-value">[^<]*(?:cartons|packs)[^<]*<\/div>\s*<div class="ceo-metric-secondary">[^<]*pieces<\/div>/, "CEO Stock metric must emphasize packages above the piece count");
assert.doesNotMatch(productSizeDashboard, /in full packages/, "CEO stock summaries must not use the phrase in full packages");
assert.doesNotMatch(productSizeDashboard, /This month/);
assert.doesNotMatch(productSizeDashboard, /This year/);

authenticate("user-rep");
const correctionSaleAssignment = store.getState().stockAssignments.find((item) => item.transactionId === correctionDispatch.id);
store.dispatch({
  type: "LOG_REP_TRANSACTION",
  assignmentIds: [correctionSaleAssignment.id],
  productId: "SKU-CHIPS",
  customerId: "",
  customerName: "Walk-in customer",
  customerType: "Walk-in",
  quantity: 1,
  transactionType: "sale",
  paymentType: "cash",
  repName: "Amina Rep"
});
const correctionSale = store.getState().stockTransactions.find((transaction) => (
  transaction.type === "sale" && transaction.assignmentIds?.includes(correctionSaleAssignment.id)
));
assert.ok(correctionSale, "sale correction fixture must be recorded");
store.dispatch({
  type: "REQUEST_RECORD_CORRECTION",
  transactionId: correctionSale.id,
  requestedQuantity: Number(correctionSale.quantity) + 1,
  requestedPackagingType: "piece",
  requestedPackagingQuantity: Number(correctionSale.quantity) + 1,
  reason: "Customer received one additional pack"
});
const saleCorrectionRequest = store.getState().correctionRequests.find((request) => request.transactionId === correctionSale.id && request.status === "pending");
assert.ok(saleCorrectionRequest, "Sales Representative must request approval instead of editing a saved sale");
assert.equal(saleCorrectionRequest.requestedPackagingType, "piece", "correction requests must retain the selected packaging");
assert.equal(saleCorrectionRequest.requestedPackagingQuantity, Number(correctionSale.quantity) + 1, "correction requests must retain the entered package quantity");
const repCorrectionDashboard = renderDashboard({ state: scopeStateForCurrentRole(store.getState()) });
assert.match(repCorrectionDashboard, /Correction awaiting approval/);
assert.match(repCorrectionDashboard, /Send for approval/);
assert.match(repCorrectionDashboard, /name="requestedPackagingType"/, "correction requests must allow packaging selection");
assert.match(repCorrectionDashboard, /data-correction-package-summary/, "correction requests must show the exact piece equivalent");
assert.doesNotMatch(repCorrectionDashboard, /Send (?:to|for) CEO approval/i);
authenticate("user-manager");
store.dispatch({ type: "APPROVE_RECORD_CORRECTION", requestId: saleCorrectionRequest.id });
assert.equal(store.getState().correctionRequests.find((request) => request.id === saleCorrectionRequest.id).status, "approved");
assert.equal(store.getState().stockTransactions.find((transaction) => transaction.id === correctionSale.id).quantity, 2);
assert.equal(store.getState().invoices.find((invoice) => invoice.transactionId === correctionSale.id).items[0].quantity, 2);

store.dispatch({
  type: "UPSERT_PRODUCT",
  productId: "SKU-DELETE-TEST",
  sku: "SKU-DELETE-TEST",
  name: "Delete Test Stock",
  stockCategory: "finished_products",
  unit: "pack",
  stock: 5,
  reorderPoint: 1,
  unitCost: 100,
  unitPrice: 150,
  status: "active"
});
authenticate("user-store");
store.dispatch({ type: "DELETE_PRODUCTS", productIds: ["SKU-DELETE-TEST"] });
assert.ok(store.getState().products.some((product) => product.id === "SKU-DELETE-TEST"), "Store Keeper must not delete stock records");
authenticate("user-ceo");
store.dispatch({ type: "DELETE_PRODUCTS", productIds: ["SKU-DELETE-TEST"] });
assert.ok(!store.getState().products.some((product) => product.id === "SKU-DELETE-TEST"), "CEO must be able to delete selected stock records");
assert.ok(store.getState().activityLogs.some((entry) => entry.summary === "Deleted stock record for Delete Test Stock"));

const secondClient = { id: "client-other", companyName: "Other Factory", currencySymbol: "₦" };
store.dispatch({
  type: "SET_AUTHENTICATED_WORKSPACE",
  session: { user: { id: "other-manager" } },
  user: { id: "other-manager", email: "other@example.com" },
  client: secondClient,
  accounts: [{ id: "other-membership", userId: "other-manager", name: "Other Manager", email: "other@example.com", role: "manager", status: "active" }],
  invites: [],
  featureModules: [],
  messages: [],
  activityLogs: []
});
assert.equal(store.getState().products.length, 0, "a different company must not inherit the previous company's browser records");
authenticate("user-manager");
assert.ok(store.getState().products.some((product) => product.id === "SKU-CHIPS"), "returning to a company restores only that company's records");

const multiDispatchStore = createStore();
const multiDispatchClient = { id: "client-multi-dispatch", companyName: "Multi Dispatch Factory", currencySymbol: "₦", packagingTypes: ["piece", "carton"], packagingDefaults: { piece: 1, carton: 0 } };
const multiDispatchAccounts = [
  { id: "multi-ceo", clientId: multiDispatchClient.id, userId: "multi-ceo-user", name: "Multi CEO", email: "multi-ceo@example.com", role: "ceo", status: "active" },
  { id: "multi-rep", clientId: multiDispatchClient.id, userId: "multi-rep-user", name: "Multi Rep", email: "multi-rep@example.com", role: "sales_rep", status: "active" },
  { id: "multi-admin", clientId: multiDispatchClient.id, userId: "multi-admin-user", name: "Multi Admin", email: "multi-admin@example.com", role: "admin", status: "active" },
  { id: "multi-store", clientId: multiDispatchClient.id, userId: "multi-store-user", name: "Multi Store", email: "multi-store@example.com", role: "store_keeper", status: "active" }
];
multiDispatchStore.dispatch({
  type: "SET_AUTHENTICATED_WORKSPACE",
  session: { user: { id: "multi-ceo-user" } },
  user: { id: "multi-ceo-user", email: "multi-ceo@example.com" },
  client: multiDispatchClient,
  accounts: multiDispatchAccounts,
  invites: [],
  featureModules: [],
  messages: [],
  activityLogs: []
});
[
  { productId: "MULTI-A", name: "Plantain Chips 50g", stock: 20, unitPrice: 500, packagingConversions: { carton: 10 } },
  { productId: "MULTI-B", name: "Kuli Kuli 100g", stock: 15, unitPrice: 800, packagingConversions: { carton: 5 } },
  { productId: "MULTI-RAW", name: "Groundnut", stock: 40, unitPrice: 450, stockCategory: "raw_materials", unit: "kg" }
].forEach((product) => multiDispatchStore.dispatch({
  type: "UPSERT_PRODUCT",
  sku: product.productId,
  stockCategory: product.stockCategory || "finished_products",
  unit: product.unit || "pack",
  reorderPoint: 2,
  unitCost: 200,
  status: "active",
  ...product
}));
multiDispatchStore.dispatch({
  type: "UPSERT_REP_CREDIT_LIMIT",
  repName: "Multi Rep",
  repUserId: "multi-rep-user",
  limit: 100000,
  paymentPeriodDays: 7
});
multiDispatchStore.dispatch({
  type: "RECORD_STOCK_DISPATCH",
  items: [
    { productId: "MULTI-A", quantity: 3 },
    { productId: "MULTI-B", quantity: 2 }
  ],
  recipientType: "Sales Representative",
  recipientName: "Multi Rep",
  paymentType: "credit",
  dispatchDate: "2026-07-15",
  expectedDeliveryAt: "2026-07-16",
  staffName: "Multi CEO"
});
const multiDispatchState = multiDispatchStore.getState();
assert.equal(multiDispatchState.products.find((product) => product.id === "MULTI-A").stock, 17);
assert.equal(multiDispatchState.products.find((product) => product.id === "MULTI-B").stock, 13);
assert.equal(multiDispatchState.stockTransactions.find((transaction) => transaction.dispatchId)?.dispatchDestination, "", "factory dispatches must save successfully without a destination");
assert.equal(multiDispatchState.stockAssignments.length, 2, "each selected product must create a representative assignment");
assert.equal(multiDispatchState.stockTransactions.filter((transaction) => transaction.dispatchId).length, 2, "one dispatch transaction must be recorded per product");
assert.equal(multiDispatchState.orders[0].items.length, 2, "factory dispatch order must contain every selected product");
assert.equal(multiDispatchState.invoices[0].items.length, 2, "factory dispatch invoice must contain every selected product");
assert.equal(multiDispatchState.invoices[0].amount, 3100);
assert.equal(multiDispatchState.invoices[0].paymentType, "credit");
assert.equal(multiDispatchState.invoices[0].status, "open");
assert.equal(multiDispatchState.creditLimits.find((limit) => limit.partyName === "Multi Rep").balance, 3100);
const multiDispatchInvoicePreview = buildInvoicePreviewContent(multiDispatchState.invoices[0], multiDispatchState);
assert.match(multiDispatchInvoicePreview, /Plantain Chips 50g/);
assert.match(multiDispatchInvoicePreview, /Kuli Kuli 100g/);
assert.match(multiDispatchInvoicePreview, /Credit/);
assert.match(multiDispatchInvoicePreview, /Collected by[\s\S]*Multi Rep/, "factory dispatch invoices must identify who collected the stock");
assert.doesNotMatch(multiDispatchInvoicePreview, /Sold by/, "factory dispatch invoices must not label the collector as the seller");
const multiDispatchQuickView = buildInvoiceQuickViewMarkup(multiDispatchState.invoices[0], multiDispatchState);
assert.match(multiDispatchQuickView, /js-download-invoice-preview/);
assert.match(multiDispatchQuickView, /aria-label="Download invoice"/);
assert.match(multiDispatchQuickView, /js-print-invoice-preview/);
assert.match(multiDispatchQuickView, /aria-label="Print invoice"/);
const quickSaleInvoiceView = buildInvoiceQuickViewMarkup(multiDispatchState.invoices[0], multiDispatchState, {
  downloadLabel: "Save invoice",
  downloadIconName: "save"
});
assert.match(quickSaleInvoiceView, /aria-label="Save invoice"/);
assert.match(quickSaleInvoiceView, /js-print-invoice-preview/);
multiDispatchStore.dispatch({ type: "MARK_INVOICE_PAID", invoiceId: multiDispatchState.invoices[0].id });
assert.equal(multiDispatchStore.getState().invoices[0].status, "paid");
assert.equal(multiDispatchStore.getState().creditLimits.find((limit) => limit.partyName === "Multi Rep").balance, 0);
const invoiceCountBeforeRejectedDispatch = multiDispatchStore.getState().invoices.length;
multiDispatchStore.dispatch({
  type: "RECORD_STOCK_DISPATCH",
  items: [{ productId: "MULTI-A", quantity: 1 }, { productId: "MULTI-B", quantity: 999 }],
  recipientType: "Sales Representative",
  recipientName: "Multi Rep",
  destination: "Van 12",
  paymentType: "cash",
  dispatchDate: "2026-07-15",
  expectedDeliveryAt: "2026-07-16",
  staffName: "Multi CEO"
});
assert.equal(multiDispatchStore.getState().products.find((product) => product.id === "MULTI-A").stock, 17, "invalid multi-product dispatch must not partially deduct stock");
assert.equal(multiDispatchStore.getState().invoices.length, invoiceCountBeforeRejectedDispatch, "invalid multi-product dispatch must not create an invoice");
multiDispatchStore.dispatch({
  type: "RECORD_STOCK_DISPATCH",
  items: [{ productId: "MULTI-A", quantity: 1 }, { productId: "MULTI-B", quantity: 1 }],
  recipientType: "Sales Representative",
  recipientName: "Multi Rep",
  destination: "Van 12",
  paymentType: "cash",
  dispatchDate: "2026-07-15",
  expectedDeliveryAt: "2026-07-16",
  staffName: "Multi CEO"
});
assert.equal(multiDispatchStore.getState().invoices[0].paymentType, "cash");
assert.equal(multiDispatchStore.getState().invoices[0].status, "paid");
assert.equal(multiDispatchStore.getState().invoices[0].amount, 1300);
assert.equal(multiDispatchStore.getState().creditLimits.find((limit) => limit.partyName === "Multi Rep").balance, 0, "cash dispatch must not increase representative credit");
const assignmentsBeforeWalkInDispatch = multiDispatchStore.getState().stockAssignments.length;
const revenueBeforeWalkInDispatch = getFinancialSalesLines(multiDispatchStore.getState()).reduce((total, line) => total + Number(line.revenue || 0), 0);
multiDispatchStore.dispatch({
  type: "RECORD_STOCK_DISPATCH",
  items: [{ productId: "MULTI-A", quantity: 2 }],
  recipientType: "Walk-in Customer",
  recipientName: "Walk-in customer",
  destination: "Factory collection",
  paymentType: "credit",
  dispatchDate: "2026-07-15",
  expectedDeliveryAt: "2026-07-15",
  staffName: "Multi CEO"
});
const walkInDispatchState = multiDispatchStore.getState();
assert.equal(walkInDispatchState.stockAssignments.length, assignmentsBeforeWalkInDispatch, "walk-in factory sales must not create representative assignments");
assert.equal(walkInDispatchState.products.find((product) => product.id === "MULTI-A").stock, 14, "walk-in collection must reduce factory stock immediately");
assert.equal(walkInDispatchState.invoices[0].customerName, "Walk-in customer");
assert.equal(walkInDispatchState.invoices[0].paymentType, "cash", "walk-in factory collections must be recorded as factory cash inflow");
assert.equal(getFinancialSalesLines(walkInDispatchState).reduce((total, line) => total + Number(line.revenue || 0), 0), revenueBeforeWalkInDispatch + 1000, "walk-in factory dispatch must add one factory sale");
globalThis.window.location.hash = "#/finance";
const inflowFinanceOverview = renderFinance({ state: walkInDispatchState });
assert.match(inflowFinanceOverview, /Cash in[\s\S]*₦5,400/, "cash inflow must include paid representative dispatches and factory walk-in sales");

const pricedPackagingStore = createStore();
const pricedPackagingClient = {
  id: "client-priced-packaging",
  companyName: "Priced Packaging Factory",
  currencySymbol: "₦",
  packagingTypes: ["piece", "carton"],
  packagingDefaults: { piece: 1, carton: 10 }
};
const pricedPackagingAccounts = [
  { id: "priced-ceo", clientId: pricedPackagingClient.id, userId: "priced-ceo-user", name: "Pricing CEO", email: "pricing-ceo@example.com", role: "ceo", status: "active" },
  { id: "priced-rep", clientId: pricedPackagingClient.id, userId: "priced-rep-user", name: "Pricing Rep", email: "pricing-rep@example.com", role: "sales_rep", status: "active" }
];
function authenticatePricedPackaging(userId) {
  const account = pricedPackagingAccounts.find((item) => item.userId === userId);
  pricedPackagingStore.dispatch({
    type: "SET_AUTHENTICATED_WORKSPACE",
    session: { user: { id: userId } },
    user: { id: userId, email: account.email },
    client: pricedPackagingClient,
    accounts: pricedPackagingAccounts,
    invites: [],
    featureModules: [],
    messages: [],
    activityLogs: pricedPackagingStore.getState().activityLogs
  });
}
authenticatePricedPackaging("priced-ceo-user");
pricedPackagingStore.dispatch({
  type: "UPSERT_PRODUCT",
  sku: "PRICE-CHIPS",
  name: "Discount Carton Chips",
  stockCategory: "finished_products",
  unit: "piece",
  stock: 100,
  reorderPoint: 10,
  unitCost: 120,
  unitPrice: 200,
  packagingConversions: { carton: 10 },
  packagingPrices: { carton: 1800 },
  status: "active"
});
pricedPackagingStore.dispatch({ type: "UPSERT_REP_CREDIT_LIMIT", repName: "Pricing Rep", repUserId: "priced-rep-user", limit: 10000, paymentPeriodDays: 7 });
pricedPackagingStore.dispatch({
  type: "RECORD_STOCK_DISPATCH",
  items: [
    { productId: "PRICE-CHIPS", packagingType: "carton", packagingQuantity: 1 },
    { productId: "PRICE-CHIPS", packagingType: "piece", packagingQuantity: 2 }
  ],
  recipientType: "Sales Representative",
  recipientName: "Pricing Rep",
  destination: "Pricing van",
  paymentType: "credit",
  dispatchDate: "2026-07-16",
  expectedDeliveryAt: "2026-07-16",
  staffName: "Pricing CEO"
});
let pricedState = pricedPackagingStore.getState();
assert.equal(pricedState.products.find((product) => product.id === "PRICE-CHIPS").stock, 88, "one carton of ten plus two pieces must deduct exactly twelve pieces");
assert.equal(pricedState.invoices[0].amount, 2200, "mixed dispatch revenue must use the discounted carton price plus loose-piece price");
assert.equal(pricedState.invoices[0].items.length, 2, "mixed carton and piece dispatch must retain separate invoice lines");
assert.equal(pricedState.invoices[0].items.find((item) => item.packagingType === "carton").packagingUnitPrice, 1800);
assert.equal(pricedState.stockAssignments.reduce((total, assignment) => total + assignment.assigned, 0), 12);
assert.equal(pricedState.creditLimits.find((limit) => limit.partyName === "Pricing Rep").balance, 2200, "credit must use the package-specific mixed dispatch total");
assert.match(buildInvoicePreviewContent(pricedState.invoices[0], pricedState), /₦1,800/);
const pricedFactoryRevenueBeforeSellThrough = getFinancialSalesLines(pricedState).reduce((total, line) => total + Number(line.revenue || 0), 0);
const pricedFactoryInvoiceCountBeforeSellThrough = getFinancialInvoiceRecords(pricedState).length;

authenticatePricedPackaging("priced-rep-user");
const pricedRepDashboard = renderDashboard({
  state: {
    ...pricedPackagingStore.getState(),
    stockAssignments: pricedPackagingStore.getState().stockAssignments.map((assignment) => ({
      ...assignment,
      assignedAt: new Date().toISOString()
    }))
  }
});
assert.match(pricedRepDashboard, /rep-assigned-piece-stock[^>]*>10<\/strong>[\s\S]*rep-assigned-package-stock[^>]*>1 carton<\/strong>/, "assigned stock must show a carton alongside its exact piece count");
assert.match(pricedRepDashboard, /rep-assigned-piece-stock[^>]*>2<\/strong>[\s\S]*rep-assigned-package-stock[^>]*>0 cartons \+ 2 pieces<\/strong>/, "loose assigned stock must show its package and piece breakdown");
assert.match(pricedRepDashboard, /rep-stock-quantity-row[\s\S]*rep-stock-count[\s\S]*rep-stock-package-summary/, "pieces and package quantities must render together in one horizontal stock row");
pricedPackagingStore.dispatch({
  type: "LOG_REP_SALE",
  items: [
    { productId: "PRICE-CHIPS", packagingType: "carton", packagingQuantity: 1 },
    { productId: "PRICE-CHIPS", packagingType: "piece", packagingQuantity: 2 }
  ],
  customerName: "Walk-in customer",
  customerType: "Walk-in",
  paymentType: "cash",
  repName: "Pricing Rep"
});
pricedState = pricedPackagingStore.getState();
assert.equal(pricedState.invoices[0].amount, 2200, "mixed quick-sale invoice must use package-specific prices");
assert.equal(pricedState.invoices[0].items.length, 2);
assert.equal(pricedState.invoices[0].documentType, "sales_receipt");
assert.equal(pricedState.stockAssignments.reduce((total, assignment) => total + assignment.sold, 0), 12, "mixed sale must consume exactly twelve assigned pieces");
assert.equal(pricedState.orders.find((order) => order.source === "factory_dispatch")?.status, "delivered", "selling every assigned item must automatically deliver the representative dispatch order for CEO and Admin");
const pricedSaleLines = getFinancialSalesLines(pricedState).filter((line) => line.source === "Rep quick sale" && line.customerName === "Walk-in customer");
assert.equal(pricedSaleLines.length, 0, "representative sell-through lines must be absent from factory finance reports");
assert.equal(getFinancialSalesLines(pricedState).reduce((total, line) => total + Number(line.revenue || 0), 0), pricedFactoryRevenueBeforeSellThrough, "selling dispatched stock onward must not double factory revenue");
assert.equal(getFinancialInvoiceRecords(pricedState).length, pricedFactoryInvoiceCountBeforeSellThrough, "selling dispatched stock onward must not add a second financial invoice");
assert.equal(pricedState.creditLimits.find((limit) => limit.partyName === "Pricing Rep").balance, 2200, "representative sell-through must not change the factory dispatch credit balance");

authenticatePricedPackaging("priced-ceo-user");
pricedPackagingStore.dispatch({
  type: "RECORD_PRODUCTION_USAGE",
  batchDate: "2026-07-16",
  batchReference: "MIXED-PACK-001",
  finishedProductId: "PRICE-CHIPS",
  quantityProduced: 13,
  packagingBreakdown: [
    { packagingType: "carton", packagingQuantity: 1, quantity: 10 },
    { packagingType: "piece", packagingQuantity: 3, quantity: 3 }
  ],
  purpose: "Stock production",
  materials: []
});
pricedState = pricedPackagingStore.getState();
assert.equal(pricedState.products.find((product) => product.id === "PRICE-CHIPS").stock, 101, "mixed production output must add thirteen base pieces");
assert.deepEqual(pricedState.productionBatches[0].packagingBreakdown.map((item) => item.packagingQuantity), [1, 3]);

function authenticateMulti(userId) {
  const account = multiDispatchAccounts.find((item) => item.userId === userId);
  multiDispatchStore.dispatch({
    type: "SET_AUTHENTICATED_WORKSPACE",
    session: { user: { id: userId } },
    user: { id: userId, email: account.email, user_metadata: { full_name: account.name } },
    client: multiDispatchClient,
    accounts: multiDispatchAccounts,
    invites: [],
    featureModules: [],
    messages: [],
    activityLogs: multiDispatchStore.getState().activityLogs
  });
}

authenticateMulti("multi-rep-user");
assert.equal(currentUserPermissions(multiDispatchStore.getState()).canRequestStock, true);
const repStockRequestDashboard = renderDashboard({ state: scopeStateForCurrentRole(multiDispatchStore.getState()) });
assert.match(repStockRequestDashboard, /Request stock/);
assert.match(repStockRequestDashboard, /data-request-packaging-id="MULTI-A"[\s\S]*Cartons/, "stock requests must let the representative choose cartons or pieces when a carton conversion exists");
multiDispatchStore.dispatch({
  type: "SUBMIT_STOCK_REQUEST",
  items: [
    { productId: "MULTI-A", packagingType: "carton", packagingQuantity: 1, quantity: 10 },
    { productId: "MULTI-B", packagingType: "piece", packagingQuantity: 3, quantity: 3 }
  ],
  neededBy: "2099-07-20",
  priority: "urgent",
  notes: "Weekend route allocation"
});
const stockRequest = multiDispatchStore.getState().stockRequests[0];
assert.ok(stockRequest?.id.startsWith("REQ-"), "Sales Representative must be able to submit a stock request");
assert.equal(stockRequest.status, "submitted");
assert.equal(stockRequest.items.length, 2);
assert.equal(stockRequest.items[0].packagingType, "carton");
assert.equal(stockRequest.items[0].packagingQuantity, 1);
assert.equal(stockRequest.items[0].quantity, 10, "one requested carton must be saved as its correct piece quantity");

authenticateMulti("multi-ceo-user");
globalThis.window.location.hash = "#/inventory?tab=stock-requests";
const ceoStockRequests = renderInventory({ state: multiDispatchStore.getState() });
assert.match(ceoStockRequests, /class="subtab-link is-active"[\s\S]*Stock requests/);
assert.match(ceoStockRequests, new RegExp(`${stockRequest.id}[\\s\\S]*1 carton \\(10 pieces\\)`), "CEO must see representative stock requests and their packaging");

authenticateMulti("multi-admin-user");
assert.equal(currentUserRole(multiDispatchStore.getState()), "admin", "Admin must remain a distinct role");
assert.deepEqual(currentUserPermissions(multiDispatchStore.getState()).nav, ["dashboard", "orders", "inventory", "retailers", "invoices", "team", "activity-log", "settings"]);
assert.equal(currentUserPermissions(multiDispatchStore.getState()).canCoordinateStockRequests, false);
assert.equal(currentUserPermissions(multiDispatchStore.getState()).canDispatchStock, false);
globalThis.window.location.hash = "#/inventory?tab=stock-requests";
const adminStockRequests = renderInventory({ state: multiDispatchStore.getState() });
assert.match(adminStockRequests, new RegExp(`${stockRequest.id}[\\s\\S]*1 carton \\(10 pieces\\)`), "Admin must see representative stock requests and their packaging");
globalThis.window.location.hash = "#/inventory?tab=adjustments";
assert.match(renderInventory({ state: multiDispatchStore.getState() }), /class="subtab-link is-active"[\s\S]*>\s*Adjustments/);
const adminDashboard = renderDashboard({ state: multiDispatchStore.getState() });
assert.match(adminDashboard, /Admin portal/);
assert.match(adminDashboard, /Company overview/);
assert.match(adminDashboard, /admin-dashboard ceo-dashboard/, "Admin dashboard must retain its role-specific layout hook");
assert.match(adminDashboard, /ceo-command-strip admin-command-strip/, "Admin portal heading must retain its dedicated green-surface hook");
assert.match(adminDashboard, /Sales trend/);
assert.match(adminDashboard, /Last 4 days/);
assert.equal((adminDashboard.match(/class="ceo-chart-column"/g) || []).length, 4, "Admin sales trend must show four days");
assert.match(adminDashboard, /admin-dashboard-insight-row/);
assert.match(adminDashboard, /Operational attention/);
assert.match(adminDashboard, /Delayed deliveries/);
assert.match(adminDashboard, /Low stock/);
assert.match(adminDashboard, /Correction approvals/);
assert.match(adminDashboard, /Overdue invoices/);
assert.match(adminDashboard, /Recent sales orders/);
assert.match(adminDashboard, /Today's factory stock/);
assert.match(adminDashboard, /Stock split/);
assert.match(adminDashboard, /js-toggle-product-types/);
assert.doesNotMatch(adminDashboard, /Purchase Orders|Admin Operations/);
const adminTeam = renderTeam({ state: multiDispatchStore.getState() });
assert.match(adminTeam, /Staff accounts/, "Admin must be able to view the staff directory");
assert.match(adminTeam, /team-member-list/);
assert.match(adminTeam, /team-account-modal/);
assert.match(adminTeam, /data-team-activity-account-id=/, "Admin staff rows must include the activity viewer button");
assert.match(adminTeam, /id="staff-activity-modal"/, "Admin must have the staff activity modal");
assert.doesNotMatch(adminTeam, /id="account-form"|Add Staff|Create staff/, "Admin staff access must remain read-only");
const adminSavedCustomer = { id: "RTL-ADMIN-VIEW", name: "Admin View Supermarket", channel: "Supermarket", status: "active", stateName: "Kaduna", lga: "Chikun", address: "Central Market" };
const adminCustomers = renderRetailers({ state: { ...multiDispatchStore.getState(), retailers: [adminSavedCustomer] } });
assert.match(adminCustomers, /Customer outlets/);
assert.match(adminCustomers, /Admin View Supermarket/, "Admin must be able to view saved customers");
assert.match(adminCustomers, /customer-details-modal/, "Admin must be able to open saved customer details");
assert.doesNotMatch(adminCustomers, /id="retailer-form"|Add Customer|Save customer/, "Admin customer access must remain read-only");
assert.doesNotMatch(adminCustomers, /data-reset-workspace-scope=/, "Admin must not receive destructive company reset controls");
const adminCustomerDetails = renderCustomerDetails(adminSavedCustomer, { ...multiDispatchStore.getState(), retailers: [adminSavedCustomer] }, currentUserPermissions(multiDispatchStore.getState()));
assert.doesNotMatch(adminCustomerDetails, /Edit customer|Deactivate customer|Activate customer/, "Admin must not change saved customers");
const adminInvoices = renderInvoices({ state: multiDispatchStore.getState() });
assert.match(adminInvoices, /data-invoice-filter/);
assert.match(adminInvoices, /data-invoice-status-filter/);
assert.match(adminInvoices, /js-print-invoice-list/);
assert.match(adminInvoices, />Invoices</);
const adminSettings = renderSettings({ state: multiDispatchStore.getState() });
assert.ok(adminSettings.indexOf("My profile") < adminSettings.indexOf("Sales packaging"), "Admin Sales packaging settings must appear below My profile");
assert.match(adminSettings, /Send for approval/, "Admin packaging changes must be sent to the CEO");
assert.doesNotMatch(adminSettings, /Save packaging/, "Admin must not apply packaging settings directly");
assert.doesNotMatch(adminSettings, /data-reset-workspace-scope="factory"/, "Admin must not receive the factory reset control");
const stockBeforeUnauthorizedAdminDispatch = multiDispatchStore.getState().products.find((product) => product.id === "MULTI-A").stock;
multiDispatchStore.dispatch({
  type: "RECORD_STOCK_DISPATCH",
  productId: "MULTI-A",
  quantity: 1,
  recipientType: "Sales Representative",
  recipientName: "Multi Rep",
  destination: "Admin must not dispatch",
  paymentType: "cash",
  dispatchDate: "2026-07-16",
  expectedDeliveryAt: "2026-07-16"
});
assert.equal(multiDispatchStore.getState().products.find((product) => product.id === "MULTI-A").stock, stockBeforeUnauthorizedAdminDispatch, "Admin must not alter factory stock");
multiDispatchStore.dispatch({
  type: "PREPARE_PURCHASE_ORDER",
  requestId: stockRequest.id,
  items: stockRequest.items,
  paymentType: "credit",
  destination: "Van 12",
  adminNotes: "Allocate exactly as approved"
});
const purchaseOrder = multiDispatchStore.getState().purchaseOrders[0];
assert.ok(purchaseOrder?.id.startsWith("PO-"), "Admin must create a numbered Purchase Order");
assert.equal(purchaseOrder.status, "forwarded");
assert.equal(multiDispatchStore.getState().stockRequests[0].status, "po_prepared");

multiDispatchStore.dispatch({
  type: "CREATE_PROCUREMENT_ORDER",
  supplierName: "Northern Farms",
  supplierContact: "08000000000",
  productId: "MULTI-RAW",
  quantity: 12,
  unitCost: 450,
  expectedAt: "2099-07-20",
  notes: "Test raw material order"
});
const procurementOrder = multiDispatchStore.getState().procurementOrders[0];
if (procurementOrder) {
  assert.ok(procurementOrder.id.startsWith("PROC-"));
  multiDispatchStore.dispatch({ type: "MARK_PROCUREMENT_ORDERED", procurementOrderId: procurementOrder.id });
  assert.equal(multiDispatchStore.getState().procurementOrders[0].status, "ordered");
}

authenticateMulti("multi-store-user");
assert.deepEqual(currentUserPermissions(multiDispatchStore.getState()).nav, ["dashboard", "inventory", "activity-log", "settings"]);
assert.equal(currentUserPermissions(multiDispatchStore.getState()).canFulfillPurchaseOrders, false);
globalThis.window.location.hash = "#/inventory?tab=stock-requests";
const storeKeeperStockRequests = renderInventory({ state: multiDispatchStore.getState() });
assert.match(storeKeeperStockRequests, new RegExp(`${stockRequest.id}[\\s\\S]*1 carton \\(10 pieces\\)`), "Store Keeper must see representative stock requests and their packaging");
const multiStoreDashboard = renderDashboard({ state: multiDispatchStore.getState() });
assert.doesNotMatch(multiStoreDashboard, /Forwarded Purchase Orders/);
assert.match(multiStoreDashboard, /storekeeper-factory-stock-dropdown/);
assert.doesNotMatch(multiStoreDashboard, /<details\s+open/);
assert.match(multiStoreDashboard, /js-open-stock-modal/, "Store Keeper dashboard must offer Add stock beside Record dispatch");
assert.match(multiStoreDashboard, /js-open-dashboard-dispatch/);
assert.match(multiStoreDashboard, /id="stock-product-modal" class="stock-modal-backdrop" hidden/);
assert.match(multiStoreDashboard, /Finished products[\s\S]*<strong>[^<]*cartons<\/strong>[\s\S]*storekeeper-category-pieces[^>]*>[^<]*pieces<\/b>/, "Store Keeper finished products must show packages first and pieces below");
const invoiceIdsBeforePoIssue = new Set(multiDispatchStore.getState().invoices.map((invoice) => invoice.id));
const dispatchIdsBeforePoIssue = new Set(multiDispatchStore.getState().stockTransactions.map((transaction) => transaction.dispatchId).filter(Boolean));
multiDispatchStore.dispatch({
  type: "RECORD_STOCK_DISPATCH",
  items: purchaseOrder.items,
  recipientType: "Sales Representative",
  recipientName: purchaseOrder.repName,
  destination: purchaseOrder.destination,
  paymentType: purchaseOrder.paymentType,
  dispatchDate: "2026-07-16",
  expectedDeliveryAt: "2099-07-20",
  staffName: "Multi Store"
});
const poIssueState = multiDispatchStore.getState();
const poInvoice = poIssueState.invoices.find((invoice) => !invoiceIdsBeforePoIssue.has(invoice.id));
const poDispatch = poIssueState.stockTransactions.find((transaction) => transaction.dispatchId && !dispatchIdsBeforePoIssue.has(transaction.dispatchId));
assert.ok(poInvoice && poDispatch, "Issuing a Purchase Order must create its dispatch and invoice");
multiDispatchStore.dispatch({ type: "MARK_PURCHASE_ORDER_ISSUED", purchaseOrderId: purchaseOrder.id, dispatchId: poDispatch.dispatchId, invoiceId: poInvoice.id });
assert.equal(multiDispatchStore.getState().purchaseOrders[0].status, "issued");
assert.equal(multiDispatchStore.getState().stockRequests[0].status, "fulfilled");
assert.equal(multiDispatchStore.getState().purchaseOrders[0].invoiceId, poInvoice.id);

authenticateMulti("multi-store-user");
const storeKeeperSettings = renderSettings({ state: multiDispatchStore.getState() });
assert.match(storeKeeperSettings, /id="packaging-settings-form"/);
assert.match(storeKeeperSettings, /Send for approval/);
const packagingBeforeApproval = [...(multiDispatchStore.getState().client.packagingTypes || ["piece"])];
multiDispatchStore.dispatch({
  type: "REQUEST_PACKAGING_SETTINGS_CHANGE",
  packagingTypes: ["piece", "carton", "tray"],
  packagingDefaults: { piece: 1, carton: 12, tray: 24 }
});
const packagingRequest = multiDispatchStore.getState().packagingChangeRequests.find((request) => request.status === "pending");
assert.ok(packagingRequest, "Store Keeper must be able to request a Sales Packaging change");
assert.deepEqual(multiDispatchStore.getState().client.packagingTypes || ["piece"], packagingBeforeApproval, "Store Keeper requests must not change active packaging before CEO approval");
assert.match(renderSettings({ state: multiDispatchStore.getState() }), /Awaiting CEO approval/);

authenticateMulti("multi-admin-user");
multiDispatchStore.dispatch({ type: "APPROVE_PACKAGING_SETTINGS_CHANGE", requestId: packagingRequest.id });
assert.equal(multiDispatchStore.getState().packagingChangeRequests.find((request) => request.id === packagingRequest.id).status, "pending", "Admin must not approve Store Keeper packaging changes");

authenticateMulti("multi-ceo-user");
const ceoPackagingApproval = renderSettings({ state: multiDispatchStore.getState() });
assert.match(ceoPackagingApproval, /Packaging changes awaiting CEO approval/);
assert.match(ceoPackagingApproval, /js-approve-packaging-request/);
assert.match(ceoPackagingApproval, /js-reject-packaging-request/);
const ceoPackagingFormStart = ceoPackagingApproval.indexOf('id="packaging-settings-form"');
const ceoPackagingFormEnd = ceoPackagingApproval.indexOf("</form>", ceoPackagingFormStart);
assert.ok(
  ceoPackagingApproval.indexOf("packaging-approval-queue") > ceoPackagingFormEnd,
  "CEO packaging approval requests must appear at the bottom of the Sales Packaging section"
);
multiDispatchStore.dispatch({ type: "APPROVE_PACKAGING_SETTINGS_CHANGE", requestId: packagingRequest.id });
assert.equal(multiDispatchStore.getState().packagingChangeRequests.find((request) => request.id === packagingRequest.id).status, "approved");
assert.deepEqual(multiDispatchStore.getState().client.packagingTypes, ["piece", "carton", "tray"]);
assert.equal(multiDispatchStore.getState().client.packagingDefaults.carton, 12);

authenticateMulti("multi-admin-user");
const packagingBeforeAdminRequest = [...(multiDispatchStore.getState().client.packagingTypes || ["piece"])];
multiDispatchStore.dispatch({
  type: "REQUEST_PACKAGING_SETTINGS_CHANGE",
  packagingTypes: ["piece", "pack", "pouch", "jar"],
  packagingDefaults: { piece: 1, pack: 6, pouch: 10, jar: 18 }
});
const adminPackagingRequest = multiDispatchStore.getState().packagingChangeRequests.find((request) => request.status === "pending");
assert.ok(adminPackagingRequest, "Admin must be able to request multiple Sales Packaging changes");
assert.deepEqual(adminPackagingRequest.packagingTypes, ["piece", "pack", "pouch", "jar"]);
assert.deepEqual(multiDispatchStore.getState().client.packagingTypes || ["piece"], packagingBeforeAdminRequest, "Admin requests must not apply before CEO approval");
assert.match(renderSettings({ state: multiDispatchStore.getState() }), /Awaiting CEO approval/);
const packagingNotificationState = multiDispatchStore.getState();
const repPackagingNotifications = getTopbarNotificationItems({
  ...packagingNotificationState,
  user: { id: "multi-rep-user", email: "multi-rep@example.com" }
});
assert.equal(repPackagingNotifications.some((item) => item.body.includes("requested a Sales Packaging change")), false, "Packaging approval requests must not notify non-CEO staff");
const ceoPackagingNotifications = getTopbarNotificationItems({
  ...packagingNotificationState,
  user: { id: "multi-ceo-user", email: "multi-ceo@example.com" }
});
assert.equal(ceoPackagingNotifications.some((item) => item.body.includes("requested a Sales Packaging change")), true, "Packaging approval requests must notify the CEO");
multiDispatchStore.dispatch({ type: "APPROVE_PACKAGING_SETTINGS_CHANGE", requestId: adminPackagingRequest.id });
assert.equal(multiDispatchStore.getState().packagingChangeRequests.find((request) => request.id === adminPackagingRequest.id).status, "pending", "Admin must not approve their own packaging request");
multiDispatchStore.dispatch({ type: "REJECT_PACKAGING_SETTINGS_CHANGE", requestId: adminPackagingRequest.id, note: "Self review is not allowed" });
assert.equal(multiDispatchStore.getState().packagingChangeRequests.find((request) => request.id === adminPackagingRequest.id).status, "pending", "Admin must not decline their own packaging request");

authenticateMulti("multi-ceo-user");
const ceoAdminPackagingApproval = renderSettings({ state: multiDispatchStore.getState() });
assert.match(ceoAdminPackagingApproval, /Packaging changes awaiting CEO approval/);
assert.match(ceoAdminPackagingApproval, new RegExp(adminPackagingRequest.requestedBy), "the CEO queue must identify the Admin who requested the packaging change");
assert.ok(
  ceoAdminPackagingApproval.indexOf("packaging-approval-queue")
    > ceoAdminPackagingApproval.indexOf("</form>", ceoAdminPackagingApproval.indexOf('id="packaging-settings-form"')),
  "Admin packaging requests must appear at the bottom of the CEO Sales Packaging section"
);
multiDispatchStore.dispatch({ type: "APPROVE_PACKAGING_SETTINGS_CHANGE", requestId: adminPackagingRequest.id });
assert.equal(multiDispatchStore.getState().packagingChangeRequests.find((request) => request.id === adminPackagingRequest.id).status, "approved", "the CEO must be able to approve an Admin packaging request");
assert.deepEqual(multiDispatchStore.getState().client.packagingTypes, ["piece", "pack", "pouch", "jar"], "CEO approval must make the Admin packaging selection effective");
assert.equal(multiDispatchStore.getState().client.packagingDefaults.jar, 18, "CEO approval must make the Admin packaging quantities effective");

multiDispatchStore.dispatch({
  type: "SET_PACKAGING_WORKSPACE_STATE",
  packagingTypes: ["piece", "carton", "tray"],
  packagingDefaults: { piece: 1, carton: 12, tray: 24 },
  packagingChangeRequests: multiDispatchStore.getState().packagingChangeRequests
});
assert.deepEqual(multiDispatchStore.getState().client.packagingTypes, ["piece", "carton", "tray"], "approved packaging must propagate to an already-active portal");
assert.equal(multiDispatchStore.getState().client.packagingDefaults.tray, 24);

authenticateMulti("multi-admin-user");
multiDispatchStore.dispatch({
  type: "REQUEST_PACKAGING_SETTINGS_CHANGE",
  packagingTypes: ["piece", "carton"],
  packagingDefaults: { piece: 1, carton: 20 }
});
const rejectedAdminPackagingRequest = multiDispatchStore.getState().packagingChangeRequests.find((request) => request.status === "pending");
authenticateMulti("multi-ceo-user");
multiDispatchStore.dispatch({ type: "REJECT_PACKAGING_SETTINGS_CHANGE", requestId: rejectedAdminPackagingRequest.id, note: "Use the approved factory packaging mix" });
assert.equal(multiDispatchStore.getState().packagingChangeRequests.find((request) => request.id === rejectedAdminPackagingRequest.id).status, "rejected", "Only CEO must be able to decline an Admin packaging request");

let resetFixtureNumber = 0;
function createWorkspaceResetFixture(role = "ceo") {
  resetFixtureNumber += 1;
  const resetClient = {
    id: `reset-client-${resetFixtureNumber}`,
    companyName: "Reset Test Factory",
    currencySymbol: "₦",
    skuFormat: "SKU-{000}",
    packagingTypes: ["piece", "carton"]
  };
  const resetUserId = `reset-user-${resetFixtureNumber}`;
  const resetAccount = {
    id: `reset-membership-${resetFixtureNumber}`,
    clientId: resetClient.id,
    userId: resetUserId,
    name: role === "ceo" ? "Reset CEO" : "Reset Admin",
    email: `reset-${resetFixtureNumber}@example.com`,
    role,
    status: "active"
  };
  const resetStore = createStore();
  resetStore.dispatch({
    type: "SET_AUTHENTICATED_WORKSPACE",
    session: { user: { id: resetUserId } },
    user: { id: resetUserId, email: resetAccount.email },
    client: resetClient,
    accounts: [resetAccount],
    invites: [],
    featureModules: [],
    messages: [{ id: "RESET-MESSAGE", clientId: resetClient.id, body: "Preserve me" }],
    activityLogs: []
  });
  Object.assign(resetStore.getState(), {
    products: [{ id: "RESET-SKU", name: "Plantain Chips", stock: 20 }],
    stockCategories: [{ id: "RESET-CATEGORY", name: "Finished products" }],
    stockAssignments: [{ id: "RESET-ASSIGNMENT", productId: "RESET-SKU", assigned: 5 }],
    stockTransactions: [
      { id: "RESET-SUPPLY", clientId: resetClient.id, productId: "RESET-SKU", type: "supply", quantity: 5, createdAt: "2026-07-20T09:00:00.000Z" },
      { id: "RESET-SALE", clientId: resetClient.id, productId: "RESET-SKU", type: "sale", quantity: 2, createdAt: "2026-07-20T10:00:00.000Z" }
    ],
    productionBatches: [{ id: "RESET-BATCH" }],
    retailers: [{ id: "RESET-CUSTOMER", name: "Reset Customer" }],
    orders: [
      { id: "RESET-QUICK-SALE", source: "quick_sale" },
      { id: "RESET-DISPATCH", source: "factory_dispatch" }
    ],
    invoices: [{ id: "RESET-INVOICE" }],
    salesReports: [{ id: "RESET-REPORT" }],
    correctionRequests: [{ id: "RESET-CORRECTION" }],
    stockRequests: [{ id: "RESET-STOCK-REQUEST" }],
    purchaseOrders: [{ id: "RESET-PURCHASE" }],
    procurementOrders: [{ id: "RESET-PROCUREMENT" }],
    routes: [{ id: "RESET-ROUTE" }],
    creditLimits: [{ id: "RESET-CREDIT" }],
    creditLimitHistory: [{ id: "RESET-CREDIT-HISTORY" }],
    activityLogs: [{ id: "RESET-ACTIVITY", clientId: resetClient.id, recordType: "inventory", createdAt: "2026-07-20T11:00:00.000Z" }],
    packagingChangeRequests: [{ id: "RESET-PACKAGING-REQUEST" }],
    offlineSalesQueue: [{ id: "RESET-OFFLINE-SALE" }]
  });
  return resetStore;
}

const adjustmentResetStore = createWorkspaceResetFixture();
adjustmentResetStore.dispatch({ type: "RESET_WORKSPACE_DATA_SCOPE", scope: "adjustments" });
assert.equal(adjustmentResetStore.getState().correctionRequests.length, 0);
assert.equal(adjustmentResetStore.getState().retailers.length, 1, "clearing adjustments must preserve customers");

const customerResetStore = createWorkspaceResetFixture();
customerResetStore.dispatch({ type: "RESET_WORKSPACE_DATA_SCOPE", scope: "customers" });
assert.equal(customerResetStore.getState().retailers.length, 0);
assert.equal(customerResetStore.getState().invoices.length, 1, "clearing customers must preserve finance history");

const financeResetStore = createWorkspaceResetFixture();
financeResetStore.dispatch({ type: "RESET_WORKSPACE_DATA_SCOPE", scope: "finance" });
assert.equal(financeResetStore.getState().invoices.length, 0);
assert.equal(financeResetStore.getState().salesReports.length, 0);
assert.equal(financeResetStore.getState().creditLimits.length, 0);
assert.deepEqual(financeResetStore.getState().stockTransactions.map((entry) => entry.id), ["RESET-SUPPLY"], "finance reset must preserve non-financial stock supply movements");
assert.deepEqual(financeResetStore.getState().orders.map((entry) => entry.id), ["RESET-DISPATCH"], "finance reset must preserve factory dispatch operations");

const activityResetStore = createWorkspaceResetFixture();
activityResetStore.dispatch({ type: "RESET_WORKSPACE_DATA_SCOPE", scope: "activity", createdAt: "2026-07-22T12:00:00.000Z" });
assert.equal(activityResetStore.getState().salesReports.length, 0);
assert.equal(activityResetStore.getState().activityLogs.length, 1);
assert.equal(activityResetStore.getState().activityLogs[0].recordType, "activity_reset_marker");
assert.equal(getScopedActivityLogs(activityResetStore.getState()).length, 0, "cleared activity must not be reconstructed from older stock movements");

const factoryResetStore = createWorkspaceResetFixture();
const preservedResetClient = factoryResetStore.getState().client;
const preservedResetAccounts = factoryResetStore.getState().accounts;
const preservedResetMessages = factoryResetStore.getState().messages;
factoryResetStore.dispatch({ type: "RESET_WORKSPACE_DATA_SCOPE", scope: "factory" });
[
  "products", "stockAssignments", "stockTransactions", "productionBatches",
  "retailers", "orders", "invoices", "salesReports", "correctionRequests", "stockRequests",
  "purchaseOrders", "procurementOrders", "routes", "creditLimits", "creditLimitHistory",
  "activityLogs", "packagingChangeRequests", "offlineSalesQueue"
].forEach((collection) => assert.equal(factoryResetStore.getState()[collection].length, 0, `factory reset must clear ${collection}`));
assert.deepEqual(factoryResetStore.getState().stockCategories.map((category) => category.id), ["raw_materials", "finished_products", "equipment"], "factory reset must preserve the built-in stock categories needed to add new stock");
assert.deepEqual(factoryResetStore.getState().client, preservedResetClient, "factory reset must preserve company settings");
assert.deepEqual(factoryResetStore.getState().accounts, preservedResetAccounts, "factory reset must preserve staff accounts");
assert.deepEqual(factoryResetStore.getState().messages, preservedResetMessages, "factory reset must preserve staff messages");
assert.ok(factoryResetStore.getState().session?.user?.id, "factory reset must preserve the signed-in CEO session");

const unauthorizedResetStore = createWorkspaceResetFixture("admin");
unauthorizedResetStore.dispatch({ type: "RESET_WORKSPACE_DATA_SCOPE", scope: "factory" });
assert.equal(unauthorizedResetStore.getState().products.length, 1, "Admin must not be able to reset factory data");

const onboardingStore = createStore();
onboardingStore.dispatch({
  type: "SET_AUTH_CONTEXT",
  session: { user: { id: "new-ceo" } },
  user: { id: "new-ceo", email: "new-ceo@example.com" }
});
const onboardingClient = { id: "client-onboarding", companyName: "Onboarding Factory", currencySymbol: "₦" };
onboardingStore.dispatch({
  type: "SET_WORKSPACE",
  client: onboardingClient,
  accounts: [{ id: "onboarding-ceo", userId: "new-ceo", name: "New CEO", email: "new-ceo@example.com", role: "ceo", status: "active" }],
  invites: [],
  featureModules: [],
  messages: [],
  activityLogs: []
});
assert.equal(onboardingStore.getState().session?.user?.id, "new-ceo", "creating a workspace must preserve the authenticated session");
assert.equal(onboardingStore.getState().backend.status, "authenticated");
assert.ok([...browserStorage.keys()].some((key) => key.endsWith(":client-onboarding")));
onboardingStore.dispatch({ type: "DELETE_CLIENT_ACCOUNT" });
assert.equal(onboardingStore.getState().session, null, "deleting a company must clear the deleted CEO session");
assert.equal(onboardingStore.getState().user, null, "deleting a company must clear the deleted CEO identity");
assert.ok(
  [...browserStorage.keys()].every((key) => !key.endsWith(":client-onboarding")),
  "deleting a company must remove its tenant-scoped browser state"
);

console.log("Web acceptance smoke checks passed.");
