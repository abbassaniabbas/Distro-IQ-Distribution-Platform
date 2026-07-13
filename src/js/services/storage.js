const LEGACY_STORAGE_KEY = "distro-iq-snack-factory-state-v3";
const STORAGE_KEY_PREFIX = "distro-iq-snack-factory-state-v4";

function workspaceStorageKey(clientId) {
  const normalizedClientId = String(clientId || "").trim();
  return normalizedClientId ? `${STORAGE_KEY_PREFIX}:${normalizedClientId}` : "";
}

function parseStoredValue(value) {
  if (!value) return null;

  const parsed = JSON.parse(value);
  return parsed && typeof parsed === "object" ? parsed : null;
}

export function loadStoredState(clientId) {
  try {
    const storageKey = workspaceStorageKey(clientId);
    if (!storageKey) return null;

    const scopedState = parseStoredValue(localStorage.getItem(storageKey));
    if (scopedState) return scopedState;

    // One-time, tenant-safe migration from the former global browser key.
    const legacyState = parseStoredValue(localStorage.getItem(LEGACY_STORAGE_KEY));
    if (legacyState?.client?.id !== clientId) return null;

    localStorage.setItem(storageKey, JSON.stringify(legacyState));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return legacyState;
  } catch {
    return null;
  }
}

export function saveStoredState(state) {
  try {
    const storageKey = workspaceStorageKey(state?.client?.id);
    if (!storageKey) return;
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Local persistence is helpful, but the app should still run without it.
  }
}

export function clearStoredState(clientId) {
  try {
    const storageKey = workspaceStorageKey(clientId);
    if (storageKey) localStorage.removeItem(storageKey);
  } catch {
    // Ignore storage failures so reset still works in private browsing modes.
  }
}
