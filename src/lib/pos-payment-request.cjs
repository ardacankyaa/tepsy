function createPaymentRequest({
  tableId,
  paymentMethod,
  discountPercent,
  discountReason,
  idempotencyKey,
  partialAmount,
}) {
  const percent = Number(discountPercent ?? 0);
  if (
    !tableId ||
    !["CASH", "CREDIT_CARD", "OTHER"].includes(paymentMethod) ||
    !idempotencyKey ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100
  )
    return null;
  const reason =
    discountReason === undefined ? "POS yüzde indirimi" : String(discountReason).trim();
  if (percent && (!reason || reason.length > 300)) return null;
  const payload = {
    tableId,
    paymentMethod,
    discountPercent: String(percent),
    discountReason: percent ? reason : null,
    idempotencyKey,
  };
  if (!percent) delete payload.discountReason;
  if (String(partialAmount || "").trim()) {
    const value = String(partialAmount).trim().replace(",", ".");
    if (!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) <= 0) return null;
    payload.amountPaid = Number(value).toFixed(2);
  }
  return payload;
}

module.exports = { createPaymentRequest };
