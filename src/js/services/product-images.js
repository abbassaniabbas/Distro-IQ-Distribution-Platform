const DATABASE_NAME = "distro-iq-product-images";
const DATABASE_VERSION = 1;
const STORE_NAME = "images";

function storageKey(clientId, productId) {
  const client = String(clientId || "").trim();
  const product = String(productId || "").trim();
  return client && product ? `${client}:${product}` : "";
}

function openImageDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("Durable image storage is unavailable in this browser."));
      return;
    }

    const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error || new Error("Product image storage could not be opened.")));
  });
}

function runImageRequest(mode, operation) {
  return openImageDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = operation(store);
    request?.addEventListener("success", () => resolve(request.result));
    request?.addEventListener("error", () => reject(request.error || new Error("Product image storage failed.")));
    transaction.addEventListener("complete", () => database.close());
    transaction.addEventListener("abort", () => {
      database.close();
      reject(transaction.error || new Error("Product image storage was interrupted."));
    });
  }));
}

export async function saveProductImage({ clientId, productId, dataUrl }) {
  const key = storageKey(clientId, productId);
  const imageData = String(dataUrl || "");
  if (!key || !imageData.startsWith("data:image/")) return "";

  await runImageRequest("readwrite", (store) => store.put({
    key,
    clientId: String(clientId),
    productId: String(productId),
    dataUrl: imageData,
    updatedAt: new Date().toISOString()
  }));
  return key;
}

export async function removeProductImage(imageStorageKey) {
  const key = String(imageStorageKey || "").trim();
  if (!key || !globalThis.indexedDB) return;
  await runImageRequest("readwrite", (store) => store.delete(key));
}

export async function restoreProductImages(clientId, products = []) {
  if (!clientId || !globalThis.indexedDB) return [];

  const restored = [];
  let storedRecords = [];

  try {
    storedRecords = await runImageRequest("readonly", (store) => store.getAll());
  } catch {
    storedRecords = [];
  }

  const recordsByKey = new Map(storedRecords.map((record) => [String(record?.key || ""), record]));
  const recordsByProductId = new Map();
  storedRecords.forEach((record) => {
    const productId = String(record?.productId || "");
    if (!productId || !String(record?.dataUrl || "").startsWith("data:image/")) return;
    const current = recordsByProductId.get(productId);
    if (!current || String(record.updatedAt || "") > String(current.updatedAt || "")) {
      recordsByProductId.set(productId, record);
    }
  });

  for (const product of products) {
    try {
      let imageStorageKey = String(product.imageStorageKey || "").trim();
      let imageUrl = String(product.imageUrl || "");
      const canonicalStorageKey = storageKey(clientId, product.id);

      if (imageUrl.startsWith("data:image/") && !imageStorageKey) {
        imageStorageKey = await saveProductImage({ clientId, productId: product.id, dataUrl: imageUrl });
      } else if (!imageUrl && (imageStorageKey || canonicalStorageKey)) {
        const restoreKey = imageStorageKey || canonicalStorageKey;
        const record = recordsByKey.get(restoreKey) || recordsByProductId.get(String(product.id || ""));
        imageUrl = String(record?.dataUrl || "");
        if (imageUrl) {
          imageStorageKey = record?.key || restoreKey;
          if (imageStorageKey !== canonicalStorageKey) {
            imageStorageKey = await saveProductImage({
              clientId,
              productId: product.id,
              dataUrl: imageUrl
            });
          }
        }
      }

      if (imageUrl) {
        restored.push({ productId: product.id, imageUrl, imageStorageKey });
      }
    } catch {
      // A damaged image record must not prevent other stock pictures from loading.
    }
  }

  return restored;
}

export { storageKey as productImageStorageKey };
