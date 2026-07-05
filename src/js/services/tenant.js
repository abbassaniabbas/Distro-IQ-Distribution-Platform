import { DEFAULT_BRAND_COLOR, isValidHexColor, normalizeBrandColor } from "./branding.js";
import { ROLE_OPTIONS } from "./rbac.js";

export { ROLE_OPTIONS } from "./rbac.js";

const DEFAULT_CURRENCY = "NGN";
const DEFAULT_TIMEZONE = "Africa/Lagos";

export const TIMEZONE_OPTIONS = [
  "Africa/Lagos",
  "Africa/Accra",
  "Africa/Nairobi",
  "Europe/London",
  "UTC"
];

export const CURRENCY_OPTIONS = [
  {
    value: "NGN",
    label: "Nigerian Naira (₦)",
    symbol: "₦"
  },
  {
    value: "USD",
    label: "US Dollar ($)",
    symbol: "$"
  },
  {
    value: "GBP",
    label: "British Pound (£)",
    symbol: "£"
  }
];

function fallbackId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

export function createId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${crypto.randomUUID().split("-")[0]}`.toUpperCase();
  }

  return fallbackId(prefix);
}

export function createClientProfile(formData) {
  const currency = CURRENCY_OPTIONS.find((item) => item.value === formData.currency) || CURRENCY_OPTIONS[0];

  return {
    id: createId("CLT"),
    companyName: formData.companyName.trim(),
    logoDataUrl: formData.logoDataUrl || "",
    brandColor: normalizeBrandColor(formData.brandColor || DEFAULT_BRAND_COLOR),
    timezone: formData.timezone || DEFAULT_TIMEZONE,
    currency: currency.value || DEFAULT_CURRENCY,
    currencySymbol: currency.symbol,
    createdAt: new Date().toISOString()
  };
}

export function generateTemporaryPassword() {
  const words = ["Distro", "Route", "Stock", "Ledger", "Depot", "Retail"];
  const word = words[Math.floor(Math.random() * words.length)];
  const number = Math.floor(1000 + Math.random() * 9000);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();

  return `${word}-${number}-${suffix}`;
}

export function createAccountInvite({ client, name, email, role }) {
  const accountId = createId("USR");
  const temporaryPassword = generateTemporaryPassword();
  const normalizedEmail = email.trim().toLowerCase();
  const displayName = name.trim();

  const account = {
    id: accountId,
    clientId: client.id,
    name: displayName,
    email: normalizedEmail,
    role,
    status: "invited",
    temporaryPassword,
    passwordResetRequired: true,
    createdAt: new Date().toISOString()
  };

  const invite = {
    id: createId("INVITE"),
    clientId: client.id,
    accountId,
    to: normalizedEmail,
    subject: `Temporary access for ${client.companyName}`,
    resetLink: "",
    temporaryPassword,
    status: "ready",
    createdAt: new Date().toISOString()
  };

  return {
    account,
    invite
  };
}

export function getScopedAccounts(state) {
  if (!state.client?.id) return [];
  return state.accounts.filter((account) => account.clientId === state.client.id);
}

export function getScopedInvites(state) {
  if (!state.client?.id) return [];
  return state.invites.filter((invite) => invite.clientId === state.client.id);
}

export function validateClientForm(values) {
  const errors = {};

  if (!values.companyName?.trim()) {
    errors.companyName = "Factory name is required.";
  }

  if (!values.timezone) {
    errors.timezone = "Timezone is required.";
  }

  if (!values.currency) {
    errors.currency = "Currency is required.";
  }

  if (!isValidHexColor(values.brandColor)) {
    errors.brandColor = "Enter a valid hex colour, like #0B1F3A.";
  }

  return errors;
}

export function validateAccountForm(values, existingAccounts) {
  const errors = {};
  const email = values.email?.trim().toLowerCase();

  if (!values.name?.trim()) {
    errors.name = "Full name is required.";
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "A valid email is required.";
  }

  if (existingAccounts.some((account) => account.email === email)) {
    errors.email = "This email is already invited for this company.";
  }

  if (!values.role || !ROLE_OPTIONS.some((role) => role.value === values.role)) {
    errors.role = "Role is required.";
  }

  return errors;
}
