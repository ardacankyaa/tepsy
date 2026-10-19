import { createHash, randomUUID } from "node:crypto";
import { moneyToCents, centsToMoney } from "./finance.mjs";
import { PaymentRequestError } from "./payment-request.mjs";
import { readPaymentReceipt } from "./payment-receipts.mjs";

export function parseRefund(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (key) =>
        !["paymentId", "amount", "reason", "idempotencyKey", "externallyConfirmed"].includes(key)
    )
  )
    throw new PaymentRequestError(400, "invalid-refund", "İade bilgileri geçersiz.");
  const paymentId = typeof body.paymentId === "string" ? body.paymentId.trim() : "";
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (
    !/^[A-Za-z0-9._:-]{1,128}$/.test(paymentId) ||
    !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey) ||
    reason.length < 3 ||
    reason.length > 300 ||
    body.externallyConfirmed !== true
  )
    throw new PaymentRequestError(
      400,
      "invalid-refund",
      "İade nedeni ve dışarıda tamamlanan iadenin onayı gereklidir."
    );
  const amountCents = moneyToCents(body.amount);
  if (amountCents <= 0)
    throw new PaymentRequestError(400, "invalid-refund", "İade tutarı pozitif olmalıdır.");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ paymentId, amountCents, reason }))
    .digest("hex");
  return { paymentId, idempotencyKey, reason, amountCents, fingerprint };
}
export async function refundPayment(tx, input, actor) {
  const replay = await tx.refund.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (replay) {
    if (replay.requestFingerprint !== input.fingerprint)
      throw new PaymentRequestError(
        409,
        "refund-conflict",
        "İade anahtarı başka bir işlemde kullanılmış."
      );
    return { response: JSON.parse(replay.responseJson), replay: true };
  }
  const receipt = await readPaymentReceipt(tx, input.paymentId);
  // Always scope to the immutable primary receipt ID, even for split order allocations.
  const canonical = await tx.payment.findUnique({ where: { id: receipt.id } });
  const shift = await tx.cashShift.findUnique({ where: { activeKey: "ACTIVE" } });
  const config = await tx.restaurantConfig.findFirst();
  if (!shift || shift.status !== "OPEN")
    throw new PaymentRequestError(409, "shift-not-open", "İade için açık kasa vardiyası gerekir.");
  if (!receipt.currency || receipt.currency !== config.currency)
    throw new PaymentRequestError(
      409,
      "refund-currency",
      "İadenin para birimi mevcut kasayla eşleşmiyor; geçmiş para birimi doğrulanmalıdır."
    );
  if (!canonical) throw new PaymentRequestError(404, "payment-not-found", "Tahsilat bulunamadı.");
  const refunds = await tx.refund.findMany({ where: { paymentId: receipt.id } });
  const remaining =
    moneyToCents(receipt.amountPaid) - refunds.reduce((n, r) => n + moneyToCents(r.amount), 0);
  if (input.amountCents > remaining)
    throw new PaymentRequestError(409, "over-refund", "İade tutarı kalan tahsilatı aşıyor.");
  if (receipt.paymentMethod === "CASH") {
    const payments = await tx.payment.findMany({
      where: { cashShiftId: shift.id, paymentMethod: "CASH" },
    });
    const paidRefunds = await tx.refund.findMany({
      where: { cashShiftId: shift.id, paymentMethod: "CASH" },
    });
    const cash =
      moneyToCents(shift.openingCash) +
      payments.reduce((n, p) => n + moneyToCents(p.amountPaid), 0) -
      paidRefunds.reduce((n, r) => n + moneyToCents(r.amount), 0);
    if (input.amountCents > cash)
      throw new PaymentRequestError(
        409,
        "insufficient-drawer",
        "Kasadaki kayıtlı nakit iade için yetersiz."
      );
  }
  const id = randomUUID();
  const response = {
    id,
    paymentId: receipt.id,
    receiptNumber: `TPS-R-${id.toUpperCase()}`,
    amount: centsToMoney(input.amountCents),
    currency: receipt.currency,
    paymentMethod: receipt.paymentMethod,
    reason: input.reason,
    ...actor,
    createdAt: new Date().toISOString(),
    remainingRefundable: centsToMoney(remaining - input.amountCents),
    externalRefundRecorded: true,
  };
  await tx.refund.create({
    data: {
      id,
      paymentId: receipt.id,
      cashShiftId: shift.id,
      amount: response.amount,
      currency: receipt.currency,
      paymentMethod: receipt.paymentMethod,
      reason: input.reason,
      ...actor,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.fingerprint,
      responseJson: JSON.stringify(response),
    },
  });
  await tx.auditEvent.create({
    data: {
      ...actor,
      action: "PAYMENT_REFUND",
      entityId: receipt.id,
      detailsJson: JSON.stringify({
        refundId: id,
        amount: response.amount,
        currency: receipt.currency,
        reason: input.reason,
      }),
    },
  });
  return { response, replay: false };
}
