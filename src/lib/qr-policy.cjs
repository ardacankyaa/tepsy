function normalizeCustomerItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 25) return null;
  const normalized = items.map((item) => {
    const rawQuantity = item?.quantity;
    const quantity =
      typeof rawQuantity === "number"
        ? rawQuantity
        : typeof rawQuantity === "string" && /^\d+$/.test(rawQuantity.trim())
          ? Number(rawQuantity.trim())
          : NaN;
    const notes =
      item?.notes == null
        ? ""
        : typeof item.notes === "string"
          ? item.notes.trim().slice(0, 300)
          : null;
    return {
      menuItemId: typeof item?.menuItemId === "string" ? item.menuItemId.trim() : "",
      quantity,
      notes,
    };
  });
  if (
    normalized.some(
      (item) =>
        !item.menuItemId ||
        item.menuItemId.length > 100 ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 20 ||
        item.notes === null
    )
  )
    return null;
  return normalized;
}

function normalizeCustomerOrderNotes(notes) {
  if (notes == null) return null;
  if (typeof notes !== "string") return undefined;
  return notes.trim().slice(0, 500) || null;
}

function serviceRequestAllowed(lastRequestAt, now = Date.now()) {
  return !lastRequestAt || now - new Date(lastRequestAt).getTime() >= 60000;
}

function canCancelCustomerOrder(order, tableId) {
  return (
    order?.tableId === tableId &&
    order.source === "QR" &&
    order.status === "AWAITING_WAITER_APPROVAL"
  );
}

const PUBLIC_QR_STATUSES = new Set([
  "AWAITING_WAITER_APPROVAL",
  "PENDING",
  "PREPARING",
  "READY",
  "DELIVERED",
  "PAID",
  "CANCELLED",
]);

function getPublicQrOrderStatus(order, tableId) {
  if (
    !order ||
    order.tableId !== tableId ||
    order.source !== "QR" ||
    !PUBLIC_QR_STATUSES.has(order.status)
  )
    return null;
  return { status: order.status };
}

module.exports = {
  normalizeCustomerItems,
  normalizeCustomerOrderNotes,
  serviceRequestAllowed,
  canCancelCustomerOrder,
  getPublicQrOrderStatus,
};
