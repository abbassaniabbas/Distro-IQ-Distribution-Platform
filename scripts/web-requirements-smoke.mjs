import assert from "node:assert/strict";

import { getReturnableCustomerChoices } from "../src/js/services/calculations.js";
import { scopeStateForCurrentRole } from "../src/js/services/rbac.js";
import { createStore } from "../src/js/state/store.js";
import { renderAuth } from "../src/js/views/auth.js";
import { renderDashboard } from "../src/js/views/dashboard.js";
import { renderInventory } from "../src/js/views/inventory.js";

globalThis.window = { location: { hash: "#/dashboard" } };

const client = { id: "client-test", companyName: "Test Factory", currencySymbol: "₦" };
const accounts = [
  { id: "membership-rep", userId: "user-rep", name: "Amina Rep", email: "amina@example.com", role: "sales_rep", status: "active" },
  { id: "membership-manager", userId: "user-manager", name: "Musa Manager", email: "musa@example.com", role: "manager", status: "active" },
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

store.dispatch({ type: "TOGGLE_PRODUCT_STATUS", productId: "SKU-CHIPS" });
state = store.getState();
const repScope = scopeStateForCurrentRole(state);
assert.equal(repScope.stockAssignments.length, 0, "inactive products must be hidden from representative stock flows");
assert.ok(repScope.stockTransactions.some((item) => item.id === sale.id), "past transactions must remain intact");

authenticate("user-store");
globalThis.window.location.hash = "#/inventory?tab=stock-health";
const storeKeeperInventory = renderInventory({ state: store.getState() });
assert.doesNotMatch(storeKeeperInventory, /<h3>Plantain Chips<\/h3>/, "inactive products must be hidden from Store Keeper stock cards");

authenticate("user-manager");
globalThis.window.location.hash = "#/inventory?tab=assignments";
const ledger = renderInventory({ state: store.getState() });
assert.match(ledger, /data-assignment-rep-filter/);
assert.match(ledger, /js-export-assignment-pdf/);
assert.match(ledger, /assignment-variance-cell is-discrepant/);
assert.match(ledger, />18<\/strong>/, "variance must reflect assigned minus sold and returned");

store.dispatch({ type: "TOGGLE_PRODUCT_STATUS", productId: "SKU-CHIPS" });
authenticate("user-rep");
assert.equal(scopeStateForCurrentRole(store.getState()).stockAssignments.length, 1, "reactivated products must return to representative stock flows");

console.log("Web acceptance smoke checks passed.");
