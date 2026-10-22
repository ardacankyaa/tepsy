const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const AMBIGUOUS_CLIENT_STATUSES = new Set([408, 409, 425, 429]);

export function createIdempotencyKey() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();

  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  return `tepsy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function createOrderAttempt(payload) {
  const idempotencyKey = createIdempotencyKey();
  return {
    idempotencyKey,
    body: JSON.stringify({ ...payload, idempotencyKey }),
  };
}

export function restoreOrderAttempt(storageKey, scopeField, scopeValue) {
  if (typeof window === "undefined") return null;

  try {
    const serialized = window.sessionStorage.getItem(storageKey);
    if (!serialized) return null;

    const attempt = JSON.parse(serialized);
    if (
      !IDEMPOTENCY_KEY_PATTERN.test(attempt?.idempotencyKey || "") ||
      typeof attempt?.body !== "string"
    ) {
      window.sessionStorage.removeItem(storageKey);
      return null;
    }

    const payload = JSON.parse(attempt.body);
    if (
      payload?.[scopeField] !== scopeValue ||
      payload?.idempotencyKey !== attempt.idempotencyKey ||
      !Array.isArray(payload.items) ||
      payload.items.length === 0 ||
      payload.items.some(
        (item) =>
          typeof item?.menuItemId !== "string" ||
          !Number.isInteger(item.quantity) ||
          item.quantity < 1
      )
    ) {
      window.sessionStorage.removeItem(storageKey);
      return null;
    }
    return attempt;
  } catch {
    return null;
  }
}

export function persistOrderAttempt(storageKey, attempt) {
  if (typeof window === "undefined") return false;
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(attempt));
    return true;
  } catch {
    return false;
  }
}

export function restoreOrCreateOrderAttempt(storageKey, payload, scopeField, scopeValue) {
  if (payload?.[scopeField] !== scopeValue) return null;

  const existing = restoreOrderAttempt(storageKey, scopeField, scopeValue);
  if (existing) return existing;

  const attempt = createOrderAttempt(payload);
  return persistOrderAttempt(storageKey, attempt) ? attempt : null;
}

export function clearOrderAttempt(storageKey) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Storage can be unavailable in private or restricted browsing modes.
  }
}

export function isDefinitiveOrderRejection(status) {
  return status >= 400 && status < 500 && !AMBIGUOUS_CLIENT_STATUSES.has(status);
}

const ORDER_REJECTION_MESSAGES = {
  "menu-item-unavailable": [
    "Sepetteki bir ürün artık satışta değil. Menüyü yenileyip ürünü sepetten çıkarın.",
    "A cart item is no longer available. Refresh the menu and remove it from the cart.",
  ],
  "table-not-found": [
    "Masa bulunamadı. Masa listesine dönüp yeniden seçin.",
    "The table was not found. Return to the table list and select it again.",
  ],
  "archived-table": [
    "Bu masa arşivlendi ve sipariş alamaz. Başka bir masa seçin.",
    "This table was archived and cannot receive orders. Select another table.",
  ],
  "invalid-items": [
    "Sepetteki ürünler veya adetler geçersiz. Sepeti kontrol edin.",
    "The cart items or quantities are invalid. Check the cart.",
  ],
  "invalid-quantity": [
    "Ürün adedi 1 ile 99 arasında olmalıdır.",
    "Item quantities must be between 1 and 99.",
  ],
};

// Explains a server rejection code to staff; unknown codes return null.
export function orderRejectionMessage(code, isTr) {
  const messages = Object.hasOwn(ORDER_REJECTION_MESSAGES, code)
    ? ORDER_REJECTION_MESSAGES[code]
    : null;
  return messages ? messages[isTr ? 0 : 1] : null;
}
