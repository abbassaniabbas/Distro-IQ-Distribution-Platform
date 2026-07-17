import assert from "node:assert/strict";

import { effectiveOrderStatus, getCustomerOrderCompletion, getFinancialSalesLines, getReturnableCustomerChoices, hasOrdersRequiringAutomaticDelay } from "../src/js/services/calculations.js";
import { getNigeriaLgas, NIGERIA_STATES_AND_LGAS, NIGERIA_STATE_NAMES, normalizeNigeriaStateName } from "../src/js/data/nigeria-locations.js";
import { buildInvoiceDocument, buildInvoicePreviewContent, buildInvoiceQuickViewMarkup, getInvoiceRecords } from "../src/js/services/invoices.js";
import { effectivePiecePrice, packagingLineAmount, packagingQuantityLabel, packagingUnitPrice, quantityInPieces } from "../src/js/services/packaging.js";
import { scopeStateForEnabledModules } from "../src/js/services/features.js";
import { currentUserPermissions, currentUserRole, scopeStateForCurrentRole } from "../src/js/services/rbac.js";
import { nextFormattedId } from "../src/js/services/tenant.js";
import { classifyAppFailure } from "../src/js/services/error-classification.js";
import { createStore } from "../src/js/state/store.js";
import { getTopbarNotificationItems } from "../src/js/ui/topbar-communications.js";
import { REQUIRED_FORM_ALERT_MESSAGE } from "../src/js/ui/form-validation.js";
import { renderAuth, renderForgotPassword } from "../src/js/views/auth.js";
import { renderBackendSetup } from "../src/js/views/backend-setup.js";
import { renderActivityLog } from "../src/js/views/activity-log.js";
import { renderAdjustments } from "../src/js/views/adjustments.js";
import { renderDashboard } from "../src/js/views/dashboard.js";
import { renderFinance } from "../src/js/views/finance.js";
import { renderInventory } from "../src/js/views/inventory.js";
import { renderInvoices } from "../src/js/views/invoices.js";
import { renderOrders } from "../src/js/views/orders.js";
import { renderPasswordReset } from "../src/js/views/password-reset.js";
import { renderCustomerDetails, renderRetailers } from "../src/js/views/retailers.js";
import { renderSettings } from "../src/js/views/settings.js";
import { buildLoginDetailsEmail } from "../src/js/views/team.js";
import { renderTeam } from "../src/js/views/team.js";

globalThis.window = { location: { hash: "#/dashboard" } };
const currentTestDate = new Date().toISOString().slice(0, 10);
const browserStorage = new Map();
globalThis.localStorage = {
  getItem(key) { return browserStorage.get(key) || null; },
  setItem(key, value) { browserStorage.set(key, String(value)); },
  removeItem(key) { browserStorage.delete(key); }
};

const client = { id: "client-test", companyName: "Test Factory", currencySymbol: "₦", packagingTypes: ["piece", "carton", "pack"], packagingDefaults: { piece: 1, carton: 10, pack: 5 } };
const accounts = [
  { id: "membership-rep", clientId: client.id, userId: "user-rep", name: "Amina Rep", email: "amina@example.com", role: "sales_rep", status: "active" },
  { id: "membership-manager", clientId: client.id, userId: "user-manager", name: "Musa Manager", email: "musa@example.com", role: "manager", status: "active" },
  { id: "membership-ceo", clientId: client.id, userId: "user-ceo", name: "Chioma CEO", email: "chioma@example.com", role: "ceo", status: "active" },
  { id: "membership-store", clientId: client.id, userId: "user-store", name: "Tola Store", email: "tola@example.com", role: "store_keeper", status: "active" },
  { id: "membership-admin", clientId: client.id, userId: "user-admin", name: "Ada Admin", email: "ada@example.com", role: "admin", status: "active" }
];
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

const loginHtml = renderAuth({ routeId: "login" });
assert.equal((loginHtml.match(/type="radio" name="role"/g) || []).length, 4, "login must show the four supported role cards");
assert.match(loginHtml, /value="admin"/, "Admin must be available as a distinct sign-in role");
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
assert.equal(classifyAppFailure({ configured: true, error: "Auth session expired", online: true }).category, "authentication");
assert.equal(classifyAppFailure({ configured: true, error: "Failed to fetch", online: false }).category, "network");
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
assert.equal(currentUserPermissions(store.getState()).canAssignStock, true);
assert.equal(currentUserPermissions(store.getState()).canReconcileStock, true);
assert.equal(currentUserPermissions(store.getState()).canLogSalesReturns, true);
const managerSettings = renderSettings({ state: store.getState() });
assert.match(managerSettings, /name="skuFormat"/);
assert.match(managerSettings, /name="invoiceFormat"/);
assert.match(managerSettings, /id="packaging-settings-form"/);
assert.ok(managerSettings.indexOf("Factory settings") < managerSettings.indexOf("Sales packaging"), "CEO Sales packaging settings must appear below Factory settings");
assert.match(managerSettings, /class="settings-primary"[\s\S]*Factory settings[\s\S]*Sales packaging/);
assert.equal((managerSettings.match(/id="packaging-settings-form"/g) || []).length, 1, "CEO Sales Packaging must render once");
assert.match(managerSettings, /name="packagingTypes" value="carton"/);
assert.doesNotMatch(managerSettings, /name="packagingDefault-|Default pieces per/);
assert.match(managerSettings, /Set the quantity inside each stock item/);
assert.doesNotMatch(managerSettings, /name="timezone"/);
assert.doesNotMatch(managerSettings, /Saved delivery note preview/);
assert.match(managerSettings, /data-open-password-modal/);
assert.match(managerSettings, /name="oldPassword"/);
assert.match(managerSettings, /data-open-delete-factory/);
assert.match(managerSettings, /id="profile-staff-image"[^>]+type="file"/, "profile settings must accept an optional staff image");
assert.match(managerSettings, /staff-image-preview staff-image-picker[^>]+aria-label="Choose profile picture"/, "profile picture selection must use the circular avatar surface");
assert.doesNotMatch(managerSettings, /Staff image \(optional\)|Remove image/, "profile settings must not show file-upload instructions or removal text");
const managerTeam = renderTeam({ state: store.getState() });
assert.doesNotMatch(managerTeam, /<option value="ceo">/, "CEO must not be assignable as a staff role");
assert.doesNotMatch(managerTeam, /<option value="manager">/);
assert.match(managerTeam, /<option value="admin">Admin<\/option>/);
assert.match(managerTeam, /team-member-list/);
assert.match(managerTeam, /data-team-account-id="membership-rep"/);
assert.match(managerTeam, /team-account-modal/);
assert.match(managerTeam, /Add Staff/);
assert.match(managerTeam, /Create staff/);
assert.match(managerTeam, /id="new-staff-image"[^>]+type="file"/, "staff creation must accept an optional staff image");
assert.match(managerTeam, /staff-image-preview staff-image-picker[^>]+aria-label="Choose staff profile picture"/, "staff creation must use the circular avatar surface as its picker");
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

authenticate("user-rep");
const salesBeforeRejectedWalkInCredit = store.getState().stockTransactions.filter((item) => item.type === "sale").length;
store.dispatch({
  type: "LOG_REP_TRANSACTION",
  assignmentIds: [assignment.id],
  productId: "SKU-CHIPS",
  customerId: "",
  customerName: "Walk-in customer",
  customerType: "Walk-in",
  quantity: 2,
  transactionType: "sale",
  paymentType: "credit",
  repName: "Amina Rep"
});
assert.equal(
  store.getState().stockTransactions.filter((item) => item.type === "sale").length,
  salesBeforeRejectedWalkInCredit,
  "walk-in credit must be rejected"
);

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
assert.ok(sale, "cash walk-in sale must be saved");
assert.equal(sale.partyName, "Walk-in customer");
assert.equal(state.stockAssignments[0].sold, 2);
const cashInvoice = getInvoiceRecords(state).find((invoice) => invoice.transactionId === sale.id);
assert.ok(cashInvoice, "every cash sale must create an invoice");
assert.equal(cashInvoice.status, "paid");
assert.equal(cashInvoice.paymentType, "cash");
assert.equal(cashInvoice.repName, "Amina Rep");
assert.equal(cashInvoice.items[0].productName, "Plantain Chips");
const invoiceDocument = buildInvoiceDocument(cashInvoice, state);
assert.match(invoiceDocument, /DistroIQ Sales, Stock &amp; Distribution/);
assert.match(invoiceDocument, /Test Factory/);
assert.match(invoiceDocument, /Walk-in customer/);
assert.match(invoiceDocument, /Plantain Chips/);
assert.match(invoiceDocument, /Sold by Amina Rep/);
const invoicePreview = buildInvoicePreviewContent(cashInvoice, state);
assert.match(invoicePreview, /invoice-modal-document/);
assert.match(invoicePreview, /Bill to/);
assert.match(invoicePreview, /Plantain Chips/);
assert.doesNotMatch(invoicePreview, /iframe/);
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
assert.match(repDashboard, /rep-factory-return-form/, "representatives must be able to return stock in hand to the factory");
assert.match(repDashboard, /rep-product-family-grid/, "representative catalogue must group products into families");
assert.match(repDashboard, /js-toggle-rep-product-types/, "representatives must be able to open product types");
assert.match(repDashboard, /js-open-rep-product-sizes/, "representatives must be able to open product sizes");
assert.match(repDashboard, /id="rep-product-size-modal"/, "product sizes must open in a catalogue modal");
assert.match(repDashboard, /js-select-rep-product-size/, "each catalogue size must be selectable");
assert.match(repDashboard, /name="salePackagingType"/, "quick sales must support configured packaging types");

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
globalThis.window.location.hash = "#/activity-log";
const activityWithUserFilter = renderActivityLog({ state: store.getState() });
const userFilterMarkup = activityWithUserFilter.match(/<select id="activity-user-filter">([\s\S]*?)<\/select>/)?.[1] || "";
assert.doesNotMatch(userFilterMarkup, /@/, "activity user filter must show names without email addresses");
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

authenticate("user-ceo");
const ceoDashboard = renderDashboard({ state: store.getState() });
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
assert.match(storeKeeperDashboard, /name="dispatchProductId"/);
assert.match(storeKeeperDashboard, /name="dispatchQuantity"/);
assert.match(storeKeeperDashboard, /data-dispatch-item-template/);
assert.match(storeKeeperDashboard, /js-add-dispatch-item/);
assert.doesNotMatch(storeKeeperDashboard, /href="#\/inventory\?tab=dispatch"/);
authenticate("user-manager");
const ceoCustomersPage = renderRetailers({ state: store.getState() });
assert.match(ceoCustomersPage, /Add Customer/);
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
assert.doesNotMatch(financeOverview, /Customer balances/);
assert.match(financeOverview, /Sales reports/);
assert.match(financeOverview, /Invoices/);
assert.match(financeOverview, /Product revenue/);
assert.match(financeOverview, /Credit limits/);
assert.match(financeOverview, /Credit history/);
assert.match(financeOverview, /Cash in/);
assert.match(financeOverview, /Gross profit/);
assert.match(financeOverview, /Stock loss/);
assert.match(financeOverview, /finance-compact-summary/);
assert.equal((financeOverview.match(/finance-compact-summary-card/g) || []).length, 6);
assert.ok(financeOverview.indexOf("Cash in") < financeOverview.indexOf("Credit aging"), "compact finance summary must appear above Credit aging");
assert.doesNotMatch(financeOverview, /Customer returns reducing sales|Written-off stock at cost value/);
assert.match(financeOverview, /Credit aging[\s\S]*₦1,500/, "open credit orders must feed the credit-aging view");

globalThis.window.location.hash = "#/finance?tab=invoices";
const ceoFinanceInvoices = renderFinance({ state: store.getState() });
assert.match(ceoFinanceInvoices, /Download, print, and confirm customer payments/);
assert.match(ceoFinanceInvoices, /js-view-invoice/);
assert.match(ceoFinanceInvoices, /js-download-invoice/);

globalThis.window.location.hash = "#/finance?tab=product-revenue";
const ceoProductRevenue = renderFinance({ state: store.getState() });
assert.match(ceoProductRevenue, /Revenue, cost, and profit/);

globalThis.window.location.hash = "#/finance?tab=credit-limits";
const financeLimits = renderFinance({ state: store.getState() });
assert.match(financeLimits, /Sales representative credit reports/);
assert.match(financeLimits, /Customer credit reports/);
const representativeCreditReports = financeLimits.match(/data-credit-report-type="representative"[\s\S]*?<\/section>/)?.[0] || "";
const customerCreditReports = financeLimits.match(/data-credit-report-type="customer"[\s\S]*?<\/section>/)?.[0] || "";
assert.equal((representativeCreditReports.match(/js-open-credit-account/g) || []).length, 1, "sales representative credit reports must be listed separately");
assert.equal((customerCreditReports.match(/js-open-credit-account/g) || []).length, 11, "customer credit reports must be listed separately");
assert.doesNotMatch(financeLimits, /Credit exposure/);
assert.equal((financeLimits.match(/js-open-credit-account/g) || []).length, 12);
assert.match(financeLimits, /id="credit-account-modal"/);
assert.match(financeLimits, /data-credit-account-detail/);

globalThis.window.location.hash = "#/finance?tab=credit-history";
const financeHistory = renderFinance({ state: store.getState() });
assert.match(financeHistory, /Sales representative credit terms history/);
assert.match(financeHistory, /Customer credit terms history/);
assert.match(financeHistory, /credit-history-account/);
assert.match(financeHistory, /Download CSV/);
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
assert.ok(creditSaleInvoice, "every credit sale must create an invoice");
assert.equal(creditSaleInvoice.status, "open");
assert.equal(creditSaleInvoice.paymentType, "credit");

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
store.dispatch({
  type: "DIRECT_RECORD_CORRECTION",
  transactionId: correctionDispatch.id,
  requestedQuantity: Number(correctionDispatch.quantity),
  reason: "CEO corrected the dispatch directly"
});
assert.equal(store.getState().correctionRequests.length, correctionRequestCountBeforeCeoAdjustment, "CEO direct adjustments must not create approval requests");
assert.equal(store.getState().stockTransactions.find((transaction) => transaction.id === correctionDispatch.id).quantity, Number(correctionDispatch.quantity));
const productSizeDashboard = renderDashboard({ state: store.getState() });
assert.ok(productSizeDashboard.indexOf("Sales trend") < productSizeDashboard.indexOf(">Products<"), "CEO Sales trend must appear above Products");
assert.match(productSizeDashboard, /id="ceo-product-size-modal"/);
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
  reason: "Customer received one additional pack"
});
const saleCorrectionRequest = store.getState().correctionRequests.find((request) => request.transactionId === correctionSale.id && request.status === "pending");
assert.ok(saleCorrectionRequest, "Sales Representative must request approval instead of editing a saved sale");
const repCorrectionDashboard = renderDashboard({ state: scopeStateForCurrentRole(store.getState()) });
assert.match(repCorrectionDashboard, /Correction awaiting approval/);
assert.match(repCorrectionDashboard, /Send for approval/);
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
const multiDispatchClient = { id: "client-multi-dispatch", companyName: "Multi Dispatch Factory", currencySymbol: "₦" };
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
  { productId: "MULTI-A", name: "Plantain Chips 50g", stock: 20, unitPrice: 500 },
  { productId: "MULTI-B", name: "Kuli Kuli 100g", stock: 15, unitPrice: 800 },
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
  destination: "Van 12",
  paymentType: "credit",
  dispatchDate: "2026-07-15",
  expectedDeliveryAt: "2026-07-16",
  staffName: "Multi CEO"
});
const multiDispatchState = multiDispatchStore.getState();
assert.equal(multiDispatchState.products.find((product) => product.id === "MULTI-A").stock, 17);
assert.equal(multiDispatchState.products.find((product) => product.id === "MULTI-B").stock, 13);
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

authenticatePricedPackaging("priced-rep-user");
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
assert.equal(pricedState.stockAssignments.reduce((total, assignment) => total + assignment.sold, 0), 12, "mixed sale must consume exactly twelve assigned pieces");
const pricedSaleLines = getFinancialSalesLines(pricedState).filter((line) => line.source === "Rep quick sale" && line.customerName === "Walk-in customer");
assert.equal(pricedSaleLines.reduce((total, line) => total + line.revenue, 0), 2200);
assert.equal(pricedSaleLines.reduce((total, line) => total + line.cost, 0), 1440);
assert.equal(pricedSaleLines.reduce((total, line) => total + line.profit, 0), 760, "profit must use discounted package revenue and base-piece cost");

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
assert.match(renderDashboard({ state: scopeStateForCurrentRole(multiDispatchStore.getState()) }), /Request stock/);
multiDispatchStore.dispatch({
  type: "SUBMIT_STOCK_REQUEST",
  items: [
    { productId: "MULTI-A", quantity: 2 },
    { productId: "MULTI-B", quantity: 3 }
  ],
  neededBy: "2099-07-20",
  priority: "urgent",
  notes: "Weekend route allocation"
});
const stockRequest = multiDispatchStore.getState().stockRequests[0];
assert.ok(stockRequest?.id.startsWith("REQ-"), "Sales Representative must be able to submit a stock request");
assert.equal(stockRequest.status, "submitted");
assert.equal(stockRequest.items.length, 2);

authenticateMulti("multi-admin-user");
assert.equal(currentUserRole(multiDispatchStore.getState()), "admin", "Admin must remain a distinct role");
assert.deepEqual(currentUserPermissions(multiDispatchStore.getState()).nav, ["dashboard", "orders", "inventory", "invoices", "activity-log", "settings"]);
assert.equal(currentUserPermissions(multiDispatchStore.getState()).canCoordinateStockRequests, false);
assert.equal(currentUserPermissions(multiDispatchStore.getState()).canDispatchStock, false);
globalThis.window.location.hash = "#/inventory?tab=adjustments";
assert.match(renderInventory({ state: multiDispatchStore.getState() }), /class="subtab-link is-active"[\s\S]*>\s*Adjustments/);
const adminDashboard = renderDashboard({ state: multiDispatchStore.getState() });
assert.match(adminDashboard, /Admin portal/);
assert.match(adminDashboard, /Company overview/);
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
const adminInvoices = renderInvoices({ state: multiDispatchStore.getState() });
assert.match(adminInvoices, /data-invoice-filter/);
assert.match(adminInvoices, /data-invoice-status-filter/);
assert.match(adminInvoices, />Invoices</);
const adminSettings = renderSettings({ state: multiDispatchStore.getState() });
assert.ok(adminSettings.indexOf("My profile") < adminSettings.indexOf("Sales packaging"), "Admin Sales packaging settings must appear below My profile");
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
const multiStoreDashboard = renderDashboard({ state: multiDispatchStore.getState() });
assert.doesNotMatch(multiStoreDashboard, /Forwarded Purchase Orders/);
assert.match(multiStoreDashboard, /storekeeper-factory-stock-dropdown/);
assert.doesNotMatch(multiStoreDashboard, /<details\s+open/);
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
assert.match(ceoPackagingApproval, /Pending approval/);
assert.match(ceoPackagingApproval, /js-approve-packaging-request/);
assert.match(ceoPackagingApproval, /js-reject-packaging-request/);
multiDispatchStore.dispatch({ type: "APPROVE_PACKAGING_SETTINGS_CHANGE", requestId: packagingRequest.id });
assert.equal(multiDispatchStore.getState().packagingChangeRequests.find((request) => request.id === packagingRequest.id).status, "approved");
assert.deepEqual(multiDispatchStore.getState().client.packagingTypes, ["piece", "carton", "tray"]);
assert.equal(multiDispatchStore.getState().client.packagingDefaults.carton, 12);

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
assert.ok(
  [...browserStorage.keys()].every((key) => !key.endsWith(":client-onboarding")),
  "deleting a company must remove its tenant-scoped browser state"
);

console.log("Web acceptance smoke checks passed.");
