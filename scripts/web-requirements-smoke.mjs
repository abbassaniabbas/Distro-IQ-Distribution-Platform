import assert from "node:assert/strict";

import { effectiveOrderStatus, getCustomerOrderCompletion, getReturnableCustomerChoices } from "../src/js/services/calculations.js";
import { buildInvoiceDocument, buildInvoicePreviewContent, getInvoiceRecords } from "../src/js/services/invoices.js";
import { scopeStateForEnabledModules } from "../src/js/services/features.js";
import { currentUserRole, scopeStateForCurrentRole } from "../src/js/services/rbac.js";
import { createStore } from "../src/js/state/store.js";
import { renderAuth } from "../src/js/views/auth.js";
import { renderActivityLog } from "../src/js/views/activity-log.js";
import { renderDashboard } from "../src/js/views/dashboard.js";
import { renderFinance } from "../src/js/views/finance.js";
import { renderInventory } from "../src/js/views/inventory.js";
import { renderInvoices } from "../src/js/views/invoices.js";
import { renderOrders } from "../src/js/views/orders.js";
import { renderSettings } from "../src/js/views/settings.js";
import { buildLoginDetailsEmail } from "../src/js/views/team.js";
import { renderTeam } from "../src/js/views/team.js";

globalThis.window = { location: { hash: "#/dashboard" } };
const browserStorage = new Map();
globalThis.localStorage = {
  getItem(key) { return browserStorage.get(key) || null; },
  setItem(key, value) { browserStorage.set(key, String(value)); },
  removeItem(key) { browserStorage.delete(key); }
};

const client = { id: "client-test", companyName: "Test Factory", currencySymbol: "₦" };
const accounts = [
  { id: "membership-rep", userId: "user-rep", name: "Amina Rep", email: "amina@example.com", role: "sales_rep", status: "active" },
  { id: "membership-manager", userId: "user-manager", name: "Musa Manager", email: "musa@example.com", role: "manager", status: "active" },
  { id: "membership-ceo", userId: "user-ceo", name: "Chioma CEO", email: "chioma@example.com", role: "ceo", status: "active" },
  { id: "membership-accountant", userId: "user-accountant", name: "Bola Accountant", email: "bola@example.com", role: "accountant", status: "active" },
  { id: "membership-store", userId: "user-store", name: "Tola Store", email: "tola@example.com", role: "store_keeper", status: "active" }
];
const store = createStore();

assert.equal(
  currentUserRole({ accounts: [], user: { user_metadata: { role: "ceo" } } }),
  "sales_rep",
  "untrusted user metadata must not grant a privileged role"
);

const loginHtml = renderAuth({ routeId: "login" });
assert.equal((loginHtml.match(/type="radio" name="role"/g) || []).length, 5, "login must show five role cards");
assert.doesNotMatch(loginHtml, /<select name="role"/, "login role selection must not use a dropdown");

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
const managerSettings = renderSettings({ state: store.getState() });
assert.match(managerSettings, /name="creditLimitEmailEnabled" type="checkbox"/);
assert.match(managerSettings, /name="creditLimitSmsEnabled" type="checkbox"/);
assert.doesNotMatch(managerSettings, /name="creditLimitEmailEnabled" type="checkbox" checked/);
assert.doesNotMatch(managerSettings, /name="creditLimitSmsEnabled" type="checkbox" checked/);
const managerTeam = renderTeam({ state: store.getState() });
assert.doesNotMatch(managerTeam, /<option value="ceo">/);
assert.doesNotMatch(managerTeam, /<option value="manager">/);
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

store.dispatch({
  type: "RECORD_STOCK_DISPATCH",
  productId: "RAW-OIL",
  quantity: 5,
  recipientType: "Sales Representative",
  recipientName: "Amina Rep",
  destination: "Route A",
  dispatchDate: "2026-07-10",
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
globalThis.window.location.hash = "#/inventory?tab=production-usage";
const productionUsage = renderInventory({ state: store.getState() });
assert.match(productionUsage, /Production usage/);
assert.match(productionUsage, /BATCH-1001/);
assert.match(productionUsage, /Customer orders/);
assert.match(productionUsage, /Plantain Chips/);
assert.match(productionUsage, /Sell raw material/);

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
  dispatchDate: "2026-07-10",
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
  repName: "Amina Rep"
});

state = store.getState();
const sale = state.stockTransactions.find((item) => item.type === "sale" && item.productId === "SKU-CHIPS");
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
const representativeInvoices = renderInvoices({ state: scopeStateForCurrentRole(state) });
assert.match(representativeInvoices, /My invoices/);
assert.match(representativeInvoices, /js-download-invoice/);
assert.match(representativeInvoices, /js-print-invoice/);

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
assert.match(storeKeeperInventory, /name="sku" value="PRD-\d+"/, "new products must receive an editable automatic Product ID");

assert.equal(effectiveOrderStatus({ status: "in_transit", expectedDeliveryAt: "2026-07-01" }, "2026-07-11"), "delayed");
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
  revisedExpectedDeliveryAt: "2026-07-13",
  note: "Replacement van assigned"
});
assert.equal(store.getState().orders.find((order) => order.id === "ORD-AUTO-DELAY").delayReason, "Vehicle issue");
assert.equal(store.getState().orders.find((order) => order.id === "ORD-AUTO-DELAY").delayHistory.length, 1);
const delayedOrdersPage = renderOrders({ state: store.getState() });
assert.match(delayedOrdersPage, /order-delay-attention-icon/);
assert.match(delayedOrdersPage, /Delivery attention/);
assert.doesNotMatch(delayedOrdersPage, /Automatically detected/);
assert.match(delayedOrdersPage, /data-search-suggestions="[^"]*Late Outlet/);
assert.match(delayedOrdersPage, /Replacement van assigned|Review delay plan/);

authenticate("user-manager");
globalThis.window.location.hash = "#/inventory?tab=assignments";
const ledger = renderInventory({ state: store.getState() });
assert.match(ledger, /data-assignment-rep-filter/);
assert.match(ledger, /js-export-assignment-pdf/);
assert.match(ledger, /js-open-assignment-details/);
assert.match(ledger, /assignment-details-modal/);
assert.doesNotMatch(ledger, /<th>Variance<\/th>/, "variance must not crowd the representative stock ledger table");
assert.match(ledger, />18<\/strong>[\s\S]*Still with representative/, "the ledger must show unsold stock as stock in hand");
assert.match(ledger, /Product ID/);
assert.doesNotMatch(ledger, />SKU</);

const managerDashboard = renderDashboard({ state: store.getState() });
assert.doesNotMatch(managerDashboard, /Recent sales orders/);
assert.doesNotMatch(managerDashboard, /Consolidated sales activity/);
assert.doesNotMatch(managerDashboard, /Submitted sales reports/);
assert.match(managerDashboard, /Musa Manager/);
assert.match(managerDashboard, /Test Factory/);

globalThis.window.location.hash = "#/activity-log?tab=recent-orders";
const managerRecentOrders = renderActivityLog({ state: store.getState() });
assert.match(managerRecentOrders, /Activity log pages/);
assert.match(managerRecentOrders, /Recent sales orders/);
globalThis.window.location.hash = "#/activity-log?tab=sales-activity";
assert.match(renderActivityLog({ state: store.getState() }), /Consolidated sales activity/);
globalThis.window.location.hash = "#/activity-log?tab=submitted-reports";
const managerSubmittedReports = renderActivityLog({ state: store.getState() });
assert.match(managerSubmittedReports, /Submitted sales reports/);
assert.match(managerSubmittedReports, /js-view-report-details/);

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
assert.match(ceoDashboard, /Submitted sales reports/, "CEO must see submitted representative reports");
assert.match(ceoDashboard, /js-view-report-details/, "CEO must be able to open the detailed report view");
assert.doesNotMatch(ceoDashboard, /js-review-report/, "CEO report access must remain read-only");
assert.match(ceoDashboard, /Chioma CEO/);

authenticate("user-store");
assert.match(renderDashboard({ state: store.getState() }), /Tola Store/);
authenticate("user-accountant");
assert.match(renderDashboard({ state: store.getState() }), /Bola Accountant/);

authenticate("user-manager");
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
const creditPage = renderInventory({ state: store.getState() });
assert.match(creditPage, /Sales representative credit limits/);
assert.match(creditPage, /Customer credit limits/);
assert.match(creditPage, /Amina Rep/);
assert.match(creditPage, /Sahad Stores/);

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
assert.match(financeOverview, /Customer balances/);
assert.match(financeOverview, /Credit limits/);
assert.match(financeOverview, /Credit history/);
assert.match(financeOverview, /Credit aging[\s\S]*₦1,500/, "open credit orders must feed the credit-aging view");

globalThis.window.location.hash = "#/finance?tab=customer-balances";
const customerBalances = renderFinance({ state: store.getState() });
assert.match(customerBalances, /Invoices, due dates, and payment status/);
assert.match(customerBalances, /js-view-invoice/);
assert.match(customerBalances, /js-download-invoice/);
assert.match(customerBalances, /js-print-invoice/);
assert.match(customerBalances, /icon-button js-download-invoice/);
assert.match(customerBalances, /icon-button invoice-paid-action/);

authenticate("user-accountant");
globalThis.window.location.hash = "#/finance?tab=invoices";
const accountantInvoices = renderFinance({ state: store.getState() });
assert.match(accountantInvoices, /Download, print, and confirm customer payments/);
assert.match(accountantInvoices, /js-view-invoice/);
assert.match(accountantInvoices, /js-download-invoice/);
authenticate("user-manager");

globalThis.window.location.hash = "#/finance?tab=credit-limits";
const financeLimits = renderFinance({ state: store.getState() });
assert.equal((financeLimits.match(/data-finance-page-row="credit-exposure"/g) || []).length, 12);
assert.equal((financeLimits.match(/hidden data-finance-page-row="credit-exposure"/g) || []).length, 2);

globalThis.window.location.hash = "#/finance?tab=credit-history";
const financeHistory = renderFinance({ state: store.getState() });
assert.match(financeHistory, /Sales representative credit terms history/);
assert.match(financeHistory, /Customer credit terms history/);
assert.match(financeHistory, /credit-history-account/);
assert.match(financeHistory, /Download CSV/);
assert.equal((financeHistory.match(/data-finance-page-row="credit-history-representative"/g) || []).length, 12);
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

authenticate("user-manager");
store.dispatch({
  type: "CREATE_ACCOUNT",
  payload: {
    name: "Security Test",
    email: "security-test@example.com",
    phoneNumber: "08000000000",
    role: "sales_rep"
  }
});
const temporaryPassword = store.getState().invites.find((invite) => invite.to === "security-test@example.com")?.temporaryPassword;
assert.ok(temporaryPassword, "temporary password must be available once for staff handoff");
assert.ok(
  [...browserStorage.values()].every((value) => !String(value).includes(temporaryPassword)),
  "temporary passwords must never be persisted in browser storage"
);

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
