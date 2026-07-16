export const PACKAGING_OPTIONS = [
  { value: "piece", label: "Pieces", singular: "piece" },
  { value: "carton", label: "Cartons", singular: "carton" },
  { value: "pack", label: "Packs", singular: "pack" },
  { value: "tray", label: "Trays", singular: "tray" },
  { value: "pouch", label: "Pouches", singular: "pouch" },
  { value: "sachet", label: "Sachets", singular: "sachet" },
  { value: "jar", label: "Jars / tubs", singular: "jar / tub" },
  { value: "display_box", label: "Display boxes", singular: "display box" }
];

const VALID_PACKAGING_TYPES = new Set(PACKAGING_OPTIONS.map((option) => option.value));

export function normalizePackagingTypes(values) {
  const requested = Array.isArray(values) ? values : [];
  const normalized = [...new Set(["piece", ...requested.map(String)])]
    .filter((value) => VALID_PACKAGING_TYPES.has(value));
  return PACKAGING_OPTIONS.map((option) => option.value).filter((value) => normalized.includes(value));
}

export function enabledPackagingTypes(client) {
  return normalizePackagingTypes(client?.packagingTypes || ["piece"]);
}

export function normalizePackagingDefaults(values, packagingTypes = PACKAGING_OPTIONS.map((option) => option.value)) {
  const source = values && typeof values === "object" && !Array.isArray(values) ? values : {};
  const enabled = new Set(normalizePackagingTypes(packagingTypes));
  return Object.fromEntries(PACKAGING_OPTIONS
    .filter((option) => enabled.has(option.value))
    .map((option) => {
      if (option.value === "piece") return [option.value, 1];
      const quantity = Math.max(0, Math.floor(Number(source[option.value] || 0)));
      return [option.value, quantity];
    }));
}

export function packagingDefaults(client) {
  return normalizePackagingDefaults(client?.packagingDefaults, enabledPackagingTypes(client));
}

export function packagingOption(value) {
  return PACKAGING_OPTIONS.find((option) => option.value === value) || PACKAGING_OPTIONS[0];
}

export function productPackagingTypes(client, product) {
  return enabledPackagingTypes(client).filter((type) => (
    type === "piece" || packagingMultiplier(product, type, client) > 0
  ));
}

export function packagingMultiplier(product, packagingType, client) {
  if (!packagingType || packagingType === "piece") return 1;
  const productValue = Number(product?.packagingConversions?.[packagingType] || 0);
  if (productValue > 0) return productValue;
  return Math.max(0, Number(packagingDefaults(client)[packagingType] || 0));
}

export function quantityInPieces(product, quantity, packagingType, client) {
  const multiplier = packagingMultiplier(product, packagingType, client);
  return multiplier > 0 ? Number(quantity || 0) * multiplier : 0;
}

export function packagingUnitPrice(product, packagingType, client) {
  if (!packagingType || packagingType === "piece") return Math.max(0, Number(product?.unitPrice || 0));
  const savedPrice = Number(product?.packagingPrices?.[packagingType] || 0);
  if (savedPrice > 0) return savedPrice;
  return Math.max(0, Number(product?.unitPrice || 0)) * packagingMultiplier(product, packagingType, client);
}

export function effectivePiecePrice(product, packagingType, client) {
  const multiplier = packagingMultiplier(product, packagingType, client);
  return multiplier > 0 ? packagingUnitPrice(product, packagingType, client) / multiplier : 0;
}

export function packagingLineAmount(product, packagingQuantity, packagingType, client) {
  return Number(packagingQuantity || 0) * packagingUnitPrice(product, packagingType, client);
}

export function packagingQuantityLabel(quantity, packagingType) {
  const option = packagingOption(packagingType);
  return `${quantity} ${Number(quantity) === 1 ? option.singular : option.label.toLowerCase()}`;
}
