import { resetWorkspaceData } from "../services/backend.js";
import { isBackendConfigured } from "../services/supabase-client.js";
import { currentUserRole } from "../services/rbac.js";
import { confirmActionDialog, requestTextDialog } from "./action-dialog.js";
import { qsa } from "./dom.js";
import { showToast } from "./toast.js";

const RESET_COPY = {
  adjustments: {
    title: "Delete all adjustments?",
    message: "This permanently removes every pending, approved, and rejected correction request.",
    confirmLabel: "Delete all adjustments",
    success: "All adjustments deleted"
  },
  customers: {
    title: "Delete all customers?",
    message: "This permanently removes every saved customer outlet. Sales and stock records are not removed by this action.",
    confirmLabel: "Delete all customers",
    success: "All customers deleted"
  },
  finance: {
    title: "Clear all finance data?",
    message: "This permanently removes invoices, sales reports, credit limits, credit history, quick-sale finance records, returns, and stock-loss finance entries.",
    confirmLabel: "Clear finance data",
    success: "All finance data cleared"
  },
  activity: {
    title: "Clear all activity records?",
    message: "This permanently clears the visible activity log and all submitted sales reports for every role.",
    confirmLabel: "Clear activity records",
    success: "Activity records and submitted reports cleared"
  }
};

async function confirmFactoryReset() {
  const confirmation = await requestTextDialog({
    title: "Reset factory data",
    message: "This permanently clears stock, movements, customers, orders, finance, reports, adjustments, and activity. Staff accounts, sign-ins, messages, and factory settings remain.",
    label: "Type RESET to confirm",
    placeholder: "RESET",
    confirmLabel: "Reset factory data"
  });

  return String(confirmation || "").trim().toUpperCase() === "RESET";
}

async function confirmScopedReset(scope) {
  if (scope === "factory") return confirmFactoryReset();
  const copy = RESET_COPY[scope];
  if (!copy) return false;
  return confirmActionDialog({
    title: copy.title,
    message: copy.message,
    confirmLabel: copy.confirmLabel,
    tone: "danger"
  });
}

export function bindWorkspaceDataResetButtons({ root, store, signal }) {
  qsa("[data-reset-workspace-scope]", root).forEach((button) => {
    button.addEventListener("click", async () => {
      const state = store.getState();
      const scope = String(button.dataset.resetWorkspaceScope || "");
      if (currentUserRole(state) !== "ceo") return;
      if (!await confirmScopedReset(scope)) return;

      button.disabled = true;
      try {
        let resetResult = {};
        if (isBackendConfigured()) {
          resetResult = await resetWorkspaceData({ clientId: state.client.id, scope });
        }
        store.dispatch({
          type: "RESET_WORKSPACE_DATA_SCOPE",
          scope,
          markerId: resetResult.markerId || "",
          createdAt: resetResult.completedAt || new Date().toISOString(),
          message: scope === "factory" ? "Factory operational data reset" : RESET_COPY[scope]?.success
        });
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
      }
    }, { signal });
  });
}
