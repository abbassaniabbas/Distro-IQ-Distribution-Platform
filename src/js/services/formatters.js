let currencyFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0
});

const compactFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1
});

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric"
});

const dateTimeFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

export function formatCurrency(value) {
  return currencyFormatter.format(Number(value || 0));
}

export function setCurrencySettings(client) {
  currencyFormatter = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: client?.currency || "NGN",
    maximumFractionDigits: 0
  });
}

export function formatCompact(value) {
  return compactFormatter.format(Number(value || 0));
}

export function formatNumber(value) {
  return new Intl.NumberFormat("en").format(Number(value || 0));
}

export function formatPercent(value) {
  return `${Math.round(Number(value || 0))}%`;
}

export function formatDate(value) {
  if (!value) return "Not set";
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

export function formatDateTime(value) {
  if (!value) return "Not set";
  return dateTimeFormatter.format(new Date(value));
}

export function statusText(status) {
  return String(status || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function statusClass(status) {
  return String(status || "").replace(/_/g, "-").toLowerCase();
}
