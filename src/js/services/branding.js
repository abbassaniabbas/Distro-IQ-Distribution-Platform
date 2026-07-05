export const DEFAULT_BRAND_COLOR = "#0B1F3A";
export const LOGO_ACCEPT = "image/png,image/jpeg";
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const LOGO_HELP_TEXT = "PNG or JPG up to 2 MB";

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const LOGO_EXT_PATTERN = /\.(png|jpe?g)$/i;

export function normalizeBrandColor(value) {
  const color = String(value || DEFAULT_BRAND_COLOR).trim();
  return color.startsWith("#") ? color.toUpperCase() : `#${color}`.toUpperCase();
}

export function isValidHexColor(value) {
  return HEX_COLOR_PATTERN.test(normalizeBrandColor(value));
}

export function getBrandColor(client) {
  const color = normalizeBrandColor(client?.brandColor);
  return isValidHexColor(color) ? color : DEFAULT_BRAND_COLOR;
}

export function validateLogoFile(file) {
  if (!file) return "";

  const isAcceptedType = LOGO_ACCEPT.split(",").includes(file.type);
  const isAcceptedName = LOGO_EXT_PATTERN.test(file.name || "");

  if (!isAcceptedType && !isAcceptedName) {
    return "Choose a PNG or JPG logo file.";
  }

  if (file.size > MAX_LOGO_BYTES) {
    return "Choose a smaller logo file under 2 MB.";
  }

  return "";
}

export function readLogoFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(new Error("Logo could not be read.")));
    reader.readAsDataURL(file);
  });
}
