function normalizedError(error) {
  return String(error?.message || error || "").trim();
}

function safeErrorDetail(error) {
  return normalizedError(error)
    .replace(/((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization)\s*[:=]\s*)\S+/gi, "$1[hidden]")
    .slice(0, 500);
}

export function classifyAppFailure({ error = "", configured = true, online } = {}) {
  const detail = safeErrorDetail(error);
  const text = detail.toLowerCase();
  const isOnline = typeof online === "boolean"
    ? online
    : (typeof navigator === "undefined" || navigator.onLine !== false);

  if (!isOnline) {
    return {
      category: "network",
      label: "Network error",
      title: "No internet connection",
      message: "Check your internet connection and try again.",
      detail: ""
    };
  }

  if (
    !configured ||
    /not configured|invalid api key|project url|publishable key|api key.*invalid/.test(text)
  ) {
    return {
      category: "configuration",
      label: "Configuration error",
      title: "Backend configuration problem",
      message: "The app cannot connect because its backend URL or public API key needs attention.",
      detail
    };
  }

  if (
    /pgrst|schema cache|database|postgres|sql|column .* does not exist|relation .* does not exist|permission denied for (?:table|schema)|could not find the function|function .* does not exist|42703|42p01/.test(text)
  ) {
    return {
      category: "database",
      label: "Database error",
      title: "Database update required",
      message: "The backend is reachable, but the database does not match what this version of the app requires.",
      detail
    };
  }

  if (
    /edge function|functionsfetcherror|function service|backend service|server error|status 5\d\d/.test(text)
  ) {
    return {
      category: "backend",
      label: "Backend error",
      title: "Backend service problem",
      message: "The app reached the backend, but a required server operation failed.",
      detail
    };
  }

  if (
    /invalid login|authentication|auth session|refresh token|jwt|not authenticated|session.*expired/.test(text)
  ) {
    return {
      category: "authentication",
      label: "Authentication error",
      title: "Sign-in service problem",
      message: "Your session or the authentication service could not be verified.",
      detail
    };
  }

  if (
    /failed to fetch|networkerror|network request|load failed|connection|timed? out|timeout|offline|could not resolve|err_(?:name|network|internet)/.test(text)
  ) {
    return {
      category: "network",
      label: "Network error",
      title: "Connection problem",
      message: "The app could not reach the online service. Check your connection and try again.",
      detail: ""
    };
  }

  return {
    category: "backend",
    label: "Backend error",
    title: "Backend request failed",
    message: "The app reached an unexpected backend failure while opening the workspace.",
    detail
  };
}
