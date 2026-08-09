export const OPEN_WORKSPACE_MODAL_SELECTOR = [
  ".stock-modal-backdrop:not([hidden])",
  ".login-details-modal-backdrop:not([hidden])"
].join(", ");

export const MODAL_SAFE_BACKGROUND_ACTIONS = new Set([
  "SET_WORKSPACE",
  "SET_OPERATIONAL_RECORDS",
  "SET_FEATURE_MODULES",
  "SET_PACKAGING_WORKSPACE_STATE",
  "HYDRATE_PRODUCT_IMAGES",
  "AUTO_UPDATE_DELAYED_ORDERS"
]);

export const FORM_SAFE_BACKGROUND_ACTIONS = new Set([
  "SET_OPERATIONAL_RECORDS",
  "SET_FEATURE_MODULES",
  "SET_PACKAGING_WORKSPACE_STATE",
  "HYDRATE_PRODUCT_IMAGES",
  "AUTO_UPDATE_DELAYED_ORDERS"
]);

export function hasOpenWorkspaceModal(root = document) {
  return Boolean(root?.querySelector?.(OPEN_WORKSPACE_MODAL_SELECTOR));
}

export function hasActiveWorkspaceForm(root = document) {
  const activeElement = root?.ownerDocument?.activeElement || globalThis.document?.activeElement;
  const activeForm = activeElement?.closest?.("form");
  const hasFocusedForm = Boolean(
    activeForm &&
    root?.contains?.(activeForm) &&
    activeForm.dataset.allowBackgroundRefresh !== "true"
  );
  const dirtyForms = [...(root?.querySelectorAll?.('form[data-live-editing="true"]') || [])];
  const hasVisibleDirtyForm = dirtyForms.some((form) => (
    form.dataset.allowBackgroundRefresh !== "true" &&
    !form.closest?.("[hidden]")
  ));
  return hasFocusedForm || hasVisibleDirtyForm;
}

export function shouldDeferRenderForModal(action, root = document) {
  const actionType = String(action?.type || "");
  return Boolean(
    (MODAL_SAFE_BACKGROUND_ACTIONS.has(actionType) && hasOpenWorkspaceModal(root)) ||
    ((FORM_SAFE_BACKGROUND_ACTIONS.has(actionType) || (actionType === "SET_WORKSPACE" && action?.backgroundRefresh === true)) && hasActiveWorkspaceForm(root))
  );
}

export function createModalRenderGuard({
  root = document,
  onRelease,
  schedule = (callback) => queueMicrotask(callback)
} = {}) {
  let pending = false;
  let releaseScheduled = false;

  const releaseWhenClosed = () => {
    if (!pending || hasOpenWorkspaceModal(root) || hasActiveWorkspaceForm(root) || releaseScheduled) return;
    releaseScheduled = true;
    schedule(() => {
      releaseScheduled = false;
      if (!pending || hasOpenWorkspaceModal(root) || hasActiveWorkspaceForm(root)) return;
      pending = false;
      onRelease?.();
    });
  };

  const observer = typeof MutationObserver === "function"
    ? new MutationObserver(releaseWhenClosed)
    : null;

  observer?.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["hidden", "aria-hidden", "class"]
  });
  root?.addEventListener?.("focusout", releaseWhenClosed);
  const markEdited = (event) => {
    const form = event.target?.closest?.("form");
    if (!form || form.dataset.allowBackgroundRefresh === "true") return;
    form.dataset.liveEditing = "true";
  };
  const clearEdited = (event) => {
    const form = event.target?.closest?.("form") || event.target;
    if (form?.matches?.("form")) delete form.dataset.liveEditing;
    releaseWhenClosed();
  };
  root?.addEventListener?.("input", markEdited);
  root?.addEventListener?.("change", markEdited);
  root?.addEventListener?.("reset", clearEdited);

  return {
    deferIfNeeded(action) {
      if (!shouldDeferRenderForModal(action, root)) return false;
      pending = true;
      return true;
    },
    clear() {
      pending = false;
      releaseScheduled = false;
    },
    disconnect() {
      pending = false;
      releaseScheduled = false;
      observer?.disconnect();
      root?.removeEventListener?.("focusout", releaseWhenClosed);
      root?.removeEventListener?.("input", markEdited);
      root?.removeEventListener?.("change", markEdited);
      root?.removeEventListener?.("reset", clearEdited);
    },
    get pending() {
      return pending;
    }
  };
}
