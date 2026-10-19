import { createHash } from "node:crypto";
import {
  discountPercentToBasisPoints,
  paymentAmountToCents,
  moneyToCents,
  validatePaymentMethod,
} from "./finance.mjs";

import { PaymentRequestError } from "./payment-errors.mjs";
export { PaymentRequestError } from "./payment-errors.mjs";

export function parsePaymentRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new PaymentRequestError(400, "invalid-body", "Ödeme isteği geçersiz.");
  }

  const supportedKeys = new Set([
    "tableId",
    "orderId",
    "paymentMethod",
    "idempotencyKey",
    "amountPaid",
    "discountPercent",
    "discountReason",
    "manualCardConfirmed",
    "selectedItems",
    "tipAmount",
  ]);
  if (Object.keys(body).some((key) => !supportedKeys.has(key))) {
    throw new PaymentRequestError(
      400,
      "invalid-body",
      "Ödeme isteği desteklenmeyen alan içeriyor."
    );
  }

  const hasTableId = Object.hasOwn(body, "tableId");
  const hasOrderId = Object.hasOwn(body, "orderId");
  if (hasTableId === hasOrderId) {
    throw new PaymentRequestError(400, "invalid-target", "Bir masa veya sipariş seçilmelidir.");
  }
  const tableId = hasTableId && typeof body.tableId === "string" ? body.tableId.trim() : "";
  const orderId = hasOrderId && typeof body.orderId === "string" ? body.orderId.trim() : "";
  if ((hasTableId && !tableId) || (hasOrderId && !orderId)) {
    throw new PaymentRequestError(400, "invalid-target", "Masa veya sipariş kimliği geçersiz.");
  }

  const paymentMethod = validatePaymentMethod(body.paymentMethod);
  if (body.manualCardConfirmed !== undefined && typeof body.manualCardConfirmed !== "boolean") {
    throw new PaymentRequestError(400, "invalid-card-confirmation", "Manuel kart onayı geçersiz.");
  }
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    throw new PaymentRequestError(
      400,
      "invalid-idempotency-key",
      "Geçerli bir ödeme isteği anahtarı zorunludur."
    );
  }

  const requestedAmountCents = Object.hasOwn(body, "amountPaid")
    ? paymentAmountToCents(body.amountPaid)
    : undefined;
  const discountPercentBasisPoints = Object.hasOwn(body, "discountPercent")
    ? discountPercentToBasisPoints(body.discountPercent)
    : 0;
  const discountReasonInput =
    body.discountReason === undefined
      ? ""
      : typeof body.discountReason === "string"
        ? body.discountReason.trim()
        : null;
  if (discountReasonInput === null || discountReasonInput.length > 300) {
    throw new PaymentRequestError(400, "invalid-discount-reason", "İndirim açıklaması geçersiz.");
  }
  const discountReason = discountPercentBasisPoints > 0 ? discountReasonInput : null;
  if (discountPercentBasisPoints > 0 && !discountReason) {
    throw new PaymentRequestError(
      400,
      "discount-reason-required",
      "İndirim için açıklama zorunludur."
    );
  }

  const tipCents = body.tipAmount === undefined ? 0 : moneyToCents(body.tipAmount);
  if (tipCents > 100000000)
    throw new PaymentRequestError(400, "invalid-tip", "Bahşiş tutarı çok yüksek.");
  let selectedItems;
  if (body.selectedItems !== undefined) {
    if (
      !Array.isArray(body.selectedItems) ||
      !body.selectedItems.length ||
      body.selectedItems.length > 500 ||
      requestedAmountCents !== undefined
    )
      throw new PaymentRequestError(
        400,
        "invalid-selected-items",
        "Ürün seçimi ile özel tutar birlikte kullanılamaz."
      );
    const ids = new Set();
    selectedItems = body.selectedItems
      .map((s) => {
        if (
          !s ||
          typeof s.orderItemId !== "string" ||
          !s.orderItemId ||
          s.orderItemId.length > 128 ||
          !Number.isInteger(s.quantity) ||
          s.quantity < 1 ||
          s.quantity > 1000 ||
          ids.has(s.orderItemId)
        )
          throw new PaymentRequestError(400, "invalid-selected-items", "Ürün seçimi geçersiz.");
        ids.add(s.orderItemId);
        return { orderItemId: s.orderItemId, quantity: s.quantity };
      })
      .sort((a, b) => a.orderItemId.localeCompare(b.orderItemId));
  }
  const requestFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        tableId: tableId || null,
        orderId: orderId || null,
        paymentMethod,
        requestedAmountCents: requestedAmountCents ?? null,
        discountPercentBasisPoints,
        discountReason,
        ...(tipCents ? { tipCents } : {}),
        ...(selectedItems ? { selectedItems } : {}),
      })
    )
    .digest("hex");

  return {
    tipCents,
    selectedItems,
    manualCardConfirmed: body.manualCardConfirmed === true,
    tableId: tableId || null,
    orderId: orderId || null,
    paymentMethod,
    idempotencyKey,
    requestFingerprint,
    requestedAmountCents,
    discountPercentBasisPoints,
    discountReason,
  };
}
