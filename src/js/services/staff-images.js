export const STAFF_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
export const STAFF_IMAGE_HELP_TEXT = "Optional PNG, JPG, or WebP up to 5 MB";
export const MAX_STAFF_IMAGE_BYTES = 5 * 1024 * 1024;
const STAFF_IMAGE_SIZE = 384;

export function validateStaffImageFile(file) {
  if (!file) return "";
  if (!STAFF_IMAGE_ACCEPT.split(",").includes(String(file.type || "").toLowerCase())) {
    return "Choose a PNG, JPG, or WebP staff image.";
  }
  if (Number(file.size || 0) > MAX_STAFF_IMAGE_BYTES) {
    return "Choose a staff image smaller than 5 MB.";
  }
  return "";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(new Error("The staff image could not be read.")));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("The selected staff image is not valid.")));
    image.src = dataUrl;
  });
}

export async function readStaffImage(file) {
  const validationError = validateStaffImageFile(file);
  if (validationError) throw new Error(validationError);

  const sourceUrl = await readFileAsDataUrl(file);
  const image = await loadImage(sourceUrl);
  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = Math.max(0, (image.naturalWidth - sourceSize) / 2);
  const sourceY = Math.max(0, (image.naturalHeight - sourceSize) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = STAFF_IMAGE_SIZE;
  canvas.height = STAFF_IMAGE_SIZE;
  const context = canvas.getContext("2d", { alpha: false });

  if (!context) throw new Error("The staff image could not be prepared.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, STAFF_IMAGE_SIZE, STAFF_IMAGE_SIZE);
  context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, STAFF_IMAGE_SIZE, STAFF_IMAGE_SIZE);
  return canvas.toDataURL("image/jpeg", 0.82);
}
