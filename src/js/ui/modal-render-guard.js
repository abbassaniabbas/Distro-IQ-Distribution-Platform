export const OPEN_WORKSPACE_MODAL_SELECTOR = [
  ".stock-modal-backdrop:not([hidden])",
  ".login-details-modal-backdrop:not([hidden])"
].join(", ");

export const MODAL_SAFE_BACKGROUND_ACTIONS = new Set([
  "SET_OPERATIONAL_RECORDS",
  "SET_FEATURE_MODULES",
  "SET_PACKAGING_WORKSPACE_STATE",
  "HYDRATE_PRODUCT_IMAGES",
  "AUTO_UPDATE_DELAYED_ORDERS"
]);

export function hasOpenWorkspaceModal(root = document) {
  return Boolean(root?.querySelector?.(OPEN_WORKSPACE_MODAL_SELECTOR));
}

export function shouldDeferRenderForModal(action, root = document) {
  return Boolean(
    MODAL_SAFE_BACKGROUND_ACTIONS.has(String(action?.type || ""))
    && hasOpenWorkspaceModal(root)
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
    if (!pending || hasOpenWorkspaceModal(root) || releaseScheduled) return;
    releaseScheduled = true;
    schedule(() => {
      releaseScheduled = false;
      if (!pending || hasOpenWorkspaceModal(root)) return;
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
    },
    get pending() {
      return pending;
    }
  };
}
