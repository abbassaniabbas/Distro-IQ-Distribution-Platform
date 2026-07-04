import { isValidHexColor, normalizeBrandColor } from "../services/branding.js";
import { qs } from "./dom.js";

export function bindBrandColorInputs(form) {
  const picker = qs("[data-brand-color-picker]", form);
  const input = qs("[data-brand-color-input]", form);

  if (!picker || !input) return;

  picker.addEventListener("input", () => {
    input.value = normalizeBrandColor(picker.value);
  });

  input.addEventListener("input", () => {
    const color = normalizeBrandColor(input.value);

    if (isValidHexColor(color)) {
      picker.value = color;
    }
  });

  input.addEventListener("blur", () => {
    input.value = normalizeBrandColor(input.value);
  });
}
