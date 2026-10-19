import { centsToMoney, moneyToCents } from "./finance.mjs";

const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

export class CashShiftError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "CashShiftError";
    this.status = status;
    this.code = code;
  }
}

function requireObject(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new CashShiftError(400, "invalid-body", "Vardiya isteği geçersiz.");
  }
}

function exactMoneyCents(value) {
  try {
    return moneyToCents(value);
  } catch (error) {
    throw new CashShiftError(
      400,
      error.code || "invalid-money",
      "Tutar sıfır veya pozitif, kuruş hassasiyetinde olmalıdır."
    );
  }
}

function normalizeNote(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new CashShiftError(400, "invalid-note", `${fieldName} geçersiz.`);
  }
  const note = value.trim();
  if (note.length > 300)
    throw new CashShiftError(400, "invalid-note", `${fieldName} en fazla 300 karakter olabilir.`);
  return note || null;
}

function assertAllowedKeys(body, supportedKeys) {
  if (Object.keys(body).some((key) => !supportedKeys.has(key))) {
    throw new CashShiftError(400, "invalid-body", "Vardiya isteği desteklenmeyen alan içeriyor.");
  }
}

export function parseCashShiftOpenRequest(body) {
  requireObject(body);
  assertAllowedKeys(body, new Set(["openingCash", "openingNote"]));
  if (!Object.hasOwn(body, "openingCash")) {
    throw new CashShiftError(400, "opening-cash-required", "Açılış nakit sayımı zorunludur.");
  }
  return {
    openingCashCents: exactMoneyCents(body.openingCash),
    openingNote: normalizeNote(body.openingNote, "Açılış notu"),
  };
}

export function parseCashShiftCloseRequest(body) {
  requireObject(body);
  assertAllowedKeys(body, new Set(["shiftId", "closingCash", "closingNote"]));
  const shiftId = typeof body.shiftId === "string" ? body.shiftId.trim() : "";
  if (!shiftId || shiftId.length > 128) {
    throw new CashShiftError(400, "invalid-shift-id", "Geçerli vardiya kimliği zorunludur.");
  }
  if (!Object.hasOwn(body, "closingCash")) {
    throw new CashShiftError(400, "closing-cash-required", "Kapanış nakit sayımı zorunludur.");
  }
  return {
    shiftId,
    closingCashCents: exactMoneyCents(body.closingCash),
    closingNote: normalizeNote(body.closingNote, "Kapanış notu"),
  };
}

export function requireOpenCashShift(shift) {
  if (!shift || shift.status !== "OPEN" || shift.activeKey !== "ACTIVE") {
    throw new CashShiftError(409, "shift-not-open", "Tahsilat için açık kasa vardiyası gerekir.");
  }
  return shift;
}

export function attachPaymentToCashShift(shift, paymentData) {
  const activeShift = requireOpenCashShift(shift);
  return { ...paymentData, cashShiftId: activeShift.id };
}

function addCents(total, amount, fieldName) {
  const result = total + amount;
  if (!Number.isSafeInteger(result)) {
    throw new CashShiftError(
      400,
      "invalid-money",
      `${fieldName} desteklenen tutar sınırını aşıyor.`
    );
  }
  return result;
}

function paymentCreatedAt(payment) {
  const date = payment.createdAt instanceof Date ? payment.createdAt : new Date(payment.createdAt);
  if (Number.isNaN(date.getTime())) {
    throw new CashShiftError(500, "invalid-payment-date", "Ödeme kaydının tarihi geçersiz.");
  }
  return date;
}

export function calculateCashShiftClose({
  shift,
  payments,
  refunds = [],
  closingCashCents,
  closedAt = new Date(),
}) {
  if (!shift?.id) throw new CashShiftError(409, "shift-not-found", "Vardiya bulunamadı.");
  if (!Array.isArray(payments))
    throw new CashShiftError(500, "invalid-payment-snapshot", "Vardiya ödeme dökümü geçersiz.");
  if (!Number.isSafeInteger(closingCashCents) || closingCashCents < 0) {
    throw new CashShiftError(400, "invalid-closing-cash", "Kapanış nakit sayımı geçersiz.");
  }

  const openingCashCents = exactMoneyCents(shift.openingCash);
  let cashPaymentsCents = 0;
  let cardPaymentsCents = 0;
  let otherPaymentsCents = 0;
  const snapshot = payments
    .map((payment) => {
      const tipCents = exactMoneyCents(payment.tipAmount || 0);
      const amountCents = addCents(
        exactMoneyCents(payment.amountPaid),
        tipCents,
        "Bahşiş dahil tahsilat"
      );
      if (payment.paymentMethod === "CASH") {
        cashPaymentsCents = addCents(cashPaymentsCents, amountCents, "Nakit tahsilat toplamı");
      } else if (payment.paymentMethod === "CREDIT_CARD") {
        cardPaymentsCents = addCents(cardPaymentsCents, amountCents, "Kart tahsilat toplamı");
      } else {
        otherPaymentsCents = addCents(otherPaymentsCents, amountCents, "Diğer tahsilat toplamı");
      }
      const createdAt = paymentCreatedAt(payment);
      return {
        id: payment.id,
        orderId: payment.orderId,
        paymentMethod: payment.paymentMethod,
        amountPaid: centsToMoney(amountCents),
        ...(tipCents ? { tipAmount: centsToMoney(tipCents) } : {}),
        createdAt: createdAt.toISOString(),
      };
    })
    .sort((left, right) => {
      const timeDelta = left.createdAt.localeCompare(right.createdAt);
      return timeDelta || String(left.id).localeCompare(String(right.id));
    });

  const refundTotals = { CASH: 0, CREDIT_CARD: 0, OTHER: 0 };
  for (const refund of refunds) {
    const method =
      refund.paymentMethod === "CASH"
        ? "CASH"
        : refund.paymentMethod === "CREDIT_CARD"
          ? "CREDIT_CARD"
          : "OTHER";
    refundTotals[method] = addCents(
      refundTotals[method],
      exactMoneyCents(refund.amount),
      "İade toplamı"
    );
  }
  const expectedCashCents =
    addCents(openingCashCents, cashPaymentsCents, "Beklenen kasa nakdi") - refundTotals.CASH;
  if (expectedCashCents < 0)
    throw new CashShiftError(409, "invalid-drawer", "Kasadaki kayıtlı nakit negatif olamaz.");
  const cashDifferenceCents = closingCashCents - expectedCashCents;
  if (
    !Number.isSafeInteger(cashDifferenceCents) ||
    Math.abs(cashDifferenceCents) > MAX_SAFE_CENTS
  ) {
    throw new CashShiftError(400, "invalid-money", "Kasa farkı desteklenen tutar sınırını aşıyor.");
  }

  return {
    openingCash: centsToMoney(openingCashCents),
    cashPayments: centsToMoney(cashPaymentsCents),
    cardPayments: centsToMoney(cardPaymentsCents),
    otherPayments: centsToMoney(otherPaymentsCents),
    expectedCash: centsToMoney(expectedCashCents),
    closingCash: centsToMoney(closingCashCents),
    cashDifference: centsToMoney(cashDifferenceCents),
    paymentCount: payments.length,
    paymentsSnapshot: snapshot,
    cashRefunds: centsToMoney(refundTotals.CASH),
    cardRefunds: centsToMoney(refundTotals.CREDIT_CARD),
    otherRefunds: centsToMoney(refundTotals.OTHER),
    refundsSnapshot: refunds.map((refund) => ({
      ...refund,
      amount: centsToMoney(exactMoneyCents(refund.amount)),
    })),
    closedAt: closedAt.toISOString(),
  };
}
