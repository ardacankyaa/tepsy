import test from "node:test";
import assert from "node:assert/strict";
import { parsePaymentRequest, PaymentRequestError } from "./payment-request.mjs";

const fullPayment = {
  tableId: "table-1",
  paymentMethod: "CASH",
  idempotencyKey: "attempt-123456",
  discountPercent: "10",
  discountReason: "POS yüzde indirimi",
};

test("full payment contract omits amount and fingerprints normalized fields", () => {
  const parsed = parsePaymentRequest(fullPayment);
  assert.equal(parsed.tableId, "table-1");
  assert.equal(parsed.orderId, null);
  assert.equal(parsed.requestedAmountCents, undefined);
  assert.equal(parsed.discountPercentBasisPoints, 1000);
  assert.equal(parsed.discountReason, "POS yüzde indirimi");
  assert.match(parsed.requestFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(
    parsePaymentRequest({ ...fullPayment, tableId: " table-1 " }).requestFingerprint,
    parsed.requestFingerprint
  );
});

test("partial payment contract accepts exact decimal strings and rejects sub-kuruş values", () => {
  const parsed = parsePaymentRequest({
    orderId: "order-1",
    paymentMethod: "CREDIT_CARD",
    idempotencyKey: "attempt-234567",
    amountPaid: "12.30",
  });
  assert.equal(parsed.requestedAmountCents, 1230);
  assert.throws(
    () =>
      parsePaymentRequest({
        ...fullPayment,
        amountPaid: "12.301",
      }),
    /kuruş|decimal|precision/i
  );
});

test("payment contract rejects ambiguous targets, unsupported fields, and invalid idempotency keys", () => {
  assert.throws(
    () => parsePaymentRequest({ ...fullPayment, orderId: "order-1" }),
    PaymentRequestError
  );
  assert.throws(() => parsePaymentRequest({ ...fullPayment, tableId: 7 }), PaymentRequestError);
  assert.throws(() => parsePaymentRequest({ ...fullPayment, debug: true }), PaymentRequestError);
  assert.throws(
    () => parsePaymentRequest({ ...fullPayment, idempotencyKey: "short" }),
    PaymentRequestError
  );
});

test("discount requires a bounded string reason and request changes affect fingerprint", () => {
  assert.throws(() => parsePaymentRequest({ ...fullPayment, discountReason: "  " }), {
    code: "discount-reason-required",
  });
  assert.throws(() => parsePaymentRequest({ ...fullPayment, discountReason: { reason: "x" } }), {
    code: "invalid-discount-reason",
  });
  assert.throws(() => parsePaymentRequest({ ...fullPayment, discountReason: "x".repeat(301) }), {
    code: "invalid-discount-reason",
  });
  assert.notEqual(
    parsePaymentRequest(fullPayment).requestFingerprint,
    parsePaymentRequest({ ...fullPayment, paymentMethod: "CREDIT_CARD" }).requestFingerprint
  );
});
