const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isoDateValue(value) {
  const date = String(value || "").trim().slice(0, 10);
  return ISO_DATE_PATTERN.test(date) ? date : "";
}

export function normalizeDateRange(fromValue, toValue) {
  const from = isoDateValue(fromValue);
  const to = isoDateValue(toValue);

  return from && to && from > to
    ? { from: to, to: from }
    : { from, to };
}

export function dateIsWithinRange(value, fromValue, toValue) {
  const date = isoDateValue(value);
  if (!date) return false;

  const { from, to } = normalizeDateRange(fromValue, toValue);
  return (!from || date >= from) && (!to || date <= to);
}
