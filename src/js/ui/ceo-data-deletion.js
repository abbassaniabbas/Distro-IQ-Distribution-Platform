import { deleteCeoWorkspaceData } from "../services/backend.js";
import { currentUserRole } from "../services/rbac.js";
import { isBackendConfigured } from "../services/supabase-client.js";
import { confirmActionDialog } from "./action-dialog.js";
import { escapeHtml, qs, qsa } from "./dom.js";
import { icon } from "./icons.js";
import { showToast } from "./toast.js";

const DELETE_COPY = {
  sales_reports: {
    noun: "sales report",
    message: "This permanently deletes the selected submitted sales reports only. The sales and return transactions referenced by those reports will remain."
  },
  invoices: {
    noun: "invoice",
    message: "This permanently deletes the selected invoices only. Sales orders and sales activity will remain."
  },
  product_revenue: {
    noun: "revenue record",
    message: "This permanently deletes the selected revenue, cost, and profit records. Other finance sections will remain."
  },
  representative_credit_limits: {
    noun: "sales representative credit report",
    message: "This permanently deletes the selected sales representative credit reports only."
  },
  customer_credit_limits: {
    noun: "customer credit term",
    message: "This permanently deletes the selected customer credit terms only."
  },
  representative_credit_history: {
    noun: "sales representative credit history entry",
    message: "This permanently deletes the selected sales representative credit terms history only."
  },
  customer_credit_history: {
    noun: "customer credit history entry",
    message: "This permanently deletes the selected customer credit terms history only."
  },
  activity: {
    noun: "activity entry",
    message: "This permanently deletes the selected activity entries only. Sales orders and submitted sales reports will remain."
  },
  orders: {
    noun: "sales order",
    message: "This permanently deletes the selected sales orders and their directly linked invoice and sale records."
  }
};

export function ceoSelectionCell(scope, id, label) {
  return `
    <td class="record-select-cell" data-export-ignore>
      <input
        type="checkbox"
        data-ceo-delete-item="${escapeHtml(scope)}"
        value="${escapeHtml(id)}"
        aria-label="Select ${escapeHtml(label)}"
      >
    </td>
  `;
}

export function ceoSelectAllCheckbox(scope, disabled = false) {
  return `
    <input
      type="checkbox"
      data-ceo-select-all="${escapeHtml(scope)}"
      aria-label="Select or deselect every row"
      ${disabled ? "disabled" : ""}
    >
  `;
}

export function ceoDeleteControls({ scope }) {
  return `
    <div class="ceo-delete-controls" data-ceo-delete-controls="${escapeHtml(scope)}">
      <button class="button warning" type="button" data-ceo-delete-selected="${escapeHtml(scope)}" disabled>
        ${icon("trash")}
        <span>Delete</span>
      </button>
    </div>
  `;
}

function selectedIds(root, scope) {
  return qsa(`[data-ceo-delete-item="${scope}"]:checked`, root).map((checkbox) => checkbox.value);
}

async function confirmDeletion(scope, ids) {
  const copy = DELETE_COPY[scope];
  if (!copy || !ids.length) return false;
  const plural = ids.length === 1
    ? copy.noun
    : copy.noun.endsWith("entry")
      ? `${copy.noun.slice(0, -5)}entries`
      : `${copy.noun}s`;

  return confirmActionDialog({
    title: `Delete ${ids.length} ${plural}?`,
    message: copy.message,
    confirmLabel: "Delete",
    tone: "danger"
  });
}

export function bindCeoDataDeletion({ root, store, signal }) {
  if (currentUserRole(store.getState()) !== "ceo") return;

  qsa("[data-ceo-delete-controls]", root).forEach((controls) => {
    if (controls.dataset.ceoDeleteBound === "true") return;
    controls.dataset.ceoDeleteBound = "true";
    const scope = controls.dataset.ceoDeleteControls;
    const selectAll = qs(`[data-ceo-select-all="${scope}"]`, root);
    const deleteSelected = qs(`[data-ceo-delete-selected="${scope}"]`, controls);
    const checkboxes = qsa(`[data-ceo-delete-item="${scope}"]`, root);

    const updateControls = () => {
      const selected = checkboxes.filter((checkbox) => checkbox.checked);
      if (deleteSelected) {
        deleteSelected.disabled = selected.length === 0;
        const label = qs("span", deleteSelected);
        if (label) label.textContent = selected.length ? `Delete (${selected.length})` : "Delete";
      }
      if (selectAll) {
        selectAll.checked = checkboxes.length > 0 && selected.length === checkboxes.length;
        selectAll.indeterminate = selected.length > 0 && selected.length < checkboxes.length;
      }
    };

    checkboxes.forEach((checkbox) => checkbox.addEventListener("change", updateControls, { signal }));
    selectAll?.addEventListener("change", () => {
      checkboxes.forEach((checkbox) => {
        checkbox.checked = selectAll.checked;
      });
      updateControls();
    }, { signal });

    const remove = async (ids, button) => {
      const uniqueIds = [...new Set(ids.filter(Boolean))];
      if (!uniqueIds.length || !await confirmDeletion(scope, uniqueIds)) return;

      button.disabled = true;
      try {
        if (isBackendConfigured()) {
          await deleteCeoWorkspaceData({
            clientId: store.getState().client?.id,
            scope,
            ids: uniqueIds
          });
        }
        store.dispatch({
          type: "DELETE_CEO_DATA_RECORDS",
          scope,
          ids: uniqueIds,
          message: `${uniqueIds.length} record${uniqueIds.length === 1 ? "" : "s"} deleted`
        });
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
      }
    };

    deleteSelected?.addEventListener("click", () => remove(selectedIds(root, scope), deleteSelected), { signal });
    updateControls();
  });
}
