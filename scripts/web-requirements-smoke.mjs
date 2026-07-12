import assert from "node:assert/strict";

import { effectiveOrderStatus, getReturnableCustomerChoices } from "../src/js/services/calculations.js";
import { buildInvoiceDocument, getInvoiceRecords } from "../src/js/services/invoices.js";
import { scopeStateForEnabledModules } from "../src/js/services/features.js";
import { scopeStateForCurrentRole } from "../src/js/services/rbac.js";
import { createStore } from "../src/js/state/store.js";
import { renderAuth } from "../src/js/views/auth.js";
import { renderDashboard } from "../src/js/views/dashboard.js";
import { renderFinance } from "../src/js/views/finance.js";
import { renderInventory } from "../src/js/views/inventory.js";
import { renderInvoices } from "../src/js/views/invoices.js";
import { renderSettings } from "../src/js/views/settings.js";

globalThis.window = { location: { hash: "#/dashboard" } };

const client = { id: "client-test", companyName: "Test Factory", currencySymbol: "₦" };
const accounts = [
  { id: "membership-rep", userId: "user-rep", name: "Amina Rep", email: "amina@example.com", role: "sales_rep", status: "active" },
  { id: "membership-manager", userId: "user-manager", name: "Musa Manager", email: "musa@example.com", role: "manager", status: "active" },
  { id: "membership-ceo", userId: "user-ceo", name: "Chioma CEO", email: "chioma@example.com", role: "ceo", status: "active" },
  { id: "membership-accountant", userId: "user-accountant", name: "Bola Accountant", email: "bola@example.com", role: "accountant", status: "active" },
  { id: "membership-store", userId: "user-store", name: "Tola Store", email: "tola@example.com", role: "store_keeper", status: "active" }
];
const store = createStore();

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
  staffName: "Musa Manager"
});
assert.equal(store.getState().stockAssignments.length, 0, "raw materials must not be assigned to a representative");
assert.equal(store.getState().products.find((item) => item.id === "RAW-OIL").stock, 50);

store.dispatch({
  type: "RECORD_PRODUCTION_USAGE",
  batchDate: "2026-07-10",
  batchReference: "BATCH-REJECTED",
  materials: [{ productId: "RAW-OIL", quantity: 51 }]
});
assert.equal(store.getState().products.find((item) => item.id === "RAW-OIL").stock, 50, "batch usage above stock on hand must be rejected");
assert.equal(store.getState().productionBatches.length, 0);

store.dispatch({
  type: "RECORD_PRODUCTION_USAGE",
  batchDate: "2026-07-10",
  batchReference: "BATCH-1001",
  materials: [{ productId: "RAW-OIL", quantity: 5 }]
});
assert.equal(store.getState().products.find((item) => item.id === "RAW-OIL").stock, 45);
assert.equal(store.getState().productionBatches[0].materials[0].productId, "RAW-OIL");
globalThis.window.location.hash = "#/inventory?tab=production-usage";
const productionUsage = renderInventory({ state: store.getState() });
assert.match(productionUsage, /Production usage/);
assert.match(productionUsage, /BATCH-1001/);

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
  staffName: "Musa Manager"
});

let state = store.getState();
const assignment = state.stockAssignments[0];
assert.equal(state.products.find((item) => item.id === "SKU-CHIPS").stock, 80, "dispatch must immediately reduce factory stock");
assert.equal(assignment.assigned, 20);
assert.equal(assignment.repUserId, "user-rep", "assignment must be scoped to the selected representative account");

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
  paymentType: "credit",
  repName: "Amina Rep"
});
assert.equal(store.getState().stockTransactions.filter((item) => item.type === "sale").length, 0, "walk-in credit must be rejected");

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
const sale = state.stockTransactions.find((item) => item.type === "sale");
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

assert.equal(effectiveOrderStatus({ status: "in_transit", dueAt: "2026-07-01" }, "2026-07-11"), "delayed");
assert.equal(effectiveOrderStatus({ status: "delivered", dueAt: "2026-07-01" }, "2026-07-11"), "delivered");

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
assert.match(managerDashboard, /Submitted sales reports/);
assert.match(managerDashboard, /js-view-report-details/);
assert.match(managerDashboard, /Musa Manager/);
assert.match(managerDashboard, /Test Factory/);

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

console.log("Web acceptance smoke checks passed.");
