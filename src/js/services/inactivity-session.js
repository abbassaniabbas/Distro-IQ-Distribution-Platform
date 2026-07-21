export const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
export const INACTIVITY_LOGOUT_ROLES = new Set(["ceo", "admin", "store_keeper"]);

export function requiresInactivityLogout(role) {
  return INACTIVITY_LOGOUT_ROLES.has(String(role || "").toLowerCase());
}

export function remainingInactivityMs(lastActivity, now = Date.now()) {
  const elapsed = Math.max(0, Number(now) - Number(lastActivity || 0));
  return Math.max(0, INACTIVITY_TIMEOUT_MS - elapsed);
}

export function createInactivitySession({ getState, getRole, onTimeout, storage = window.localStorage }) {
  let timer = null;
  let storageKey = "";
  let timeoutRunning = false;
  let lastPersistedAt = 0;

  function clearTimer() {
    if (timer) window.clearTimeout(timer);
    timer = null;
  }

  function keyForState(state) {
    if (!state?.session || !state?.client?.id || !state?.user?.id || !requiresInactivityLogout(getRole(state))) {
      return "";
    }
    return `distro-iq:last-activity:${state.client.id}:${state.user.id}`;
  }

  function readLastActivity() {
    const value = Number(storageKey ? storage.getItem(storageKey) : 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  async function expire() {
    if (timeoutRunning) return;
    timeoutRunning = true;
    clearTimer();
    if (storageKey) storage.removeItem(storageKey);
    try {
      await onTimeout();
    } finally {
      timeoutRunning = false;
    }
  }

  function schedule() {
    clearTimer();
    if (!storageKey) return;

    const lastActivity = readLastActivity();
    const remaining = remainingInactivityMs(lastActivity);
    if (!lastActivity || remaining <= 0) {
      void expire();
      return;
    }
    timer = window.setTimeout(expire, remaining);
  }

  function noteActivity() {
    if (!storageKey || timeoutRunning) return;

    const now = Date.now();
    if (now - lastPersistedAt < 1000) return;
    lastPersistedAt = now;
    storage.setItem(storageKey, String(now));
    schedule();
  }

  function checkWhenVisible() {
    if (document.visibilityState !== "visible" || !storageKey) return;
    const lastActivity = readLastActivity();
    if (!lastActivity || remainingInactivityMs(lastActivity) <= 0) {
      void expire();
    } else {
      schedule();
    }
  }

  function handleStorage(event) {
    if (event.key === storageKey) schedule();
  }

  ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"].forEach((eventName) => {
    window.addEventListener(eventName, noteActivity, { passive: true });
  });
  document.addEventListener("visibilitychange", checkWhenVisible);
  window.addEventListener("storage", handleStorage);

  return {
    handleStateChange(state = getState()) {
      const nextKey = keyForState(state);
      if (nextKey === storageKey) return;

      clearTimer();
      if (storageKey) storage.removeItem(storageKey);
      storageKey = nextKey;
      lastPersistedAt = 0;
      if (!storageKey) return;

      const lastActivity = readLastActivity();
      if (!lastActivity) storage.setItem(storageKey, String(Date.now()));
      schedule();
    },
    clear() {
      clearTimer();
      if (storageKey) storage.removeItem(storageKey);
      storageKey = "";
    }
  };
}
