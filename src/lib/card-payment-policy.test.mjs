import test from "node:test";
import assert from "node:assert/strict";
import { assertCardPaymentAllowed } from "./card-payment-policy.mjs";
import { parsePaymentRequest } from "./payment-request.mjs";

const card = { paymentMethod: "CREDIT_CARD", manualCardConfirmed: true };
test("manual card payment requires explicit confirmation without a terminal", () => {
  assert.throws(
    () =>
      assertCardPaymentAllowed(
        { paymentMethod: "CREDIT_CARD" },
        { enabled: false, adapter: "MANUAL" }
      ),
    { code: "manual-card-confirmation-required" }
  );
  assert.equal(assertCardPaymentAllowed(card, { enabled: false, adapter: "MANUAL" }), "MANUAL");
  assert.equal(assertCardPaymentAllowed(card, { enabled: true, adapter: "MANUAL" }), "MANUAL");
});
test("configured terminal cannot be bypassed by manual confirmation or connectivity", () => {
  for (const connected of [true, false]) {
    assert.throws(
      () => assertCardPaymentAllowed(card, { enabled: true, adapter: "NEXO_LOCAL", connected }),
      { code: "terminal-payment-unavailable" }
    );
  }
  assert.throws(() => assertCardPaymentAllowed(card, undefined), {
    code: "terminal-config-unavailable",
  });
  assert.equal(assertCardPaymentAllowed({ paymentMethod: "CASH" }, undefined), null);
});
test("manual confirmation is a strict boolean and does not change financial replay identity", () => {
  const base = {
    tableId: "table-1",
    paymentMethod: "CREDIT_CARD",
    idempotencyKey: "card-attempt-1",
  };
  const confirmed = parsePaymentRequest({ ...base, manualCardConfirmed: true });
  assert.equal(confirmed.manualCardConfirmed, true);
  assert.equal(confirmed.requestFingerprint, parsePaymentRequest(base).requestFingerprint);
  assert.throws(() => parsePaymentRequest({ ...base, manualCardConfirmed: "true" }), {
    code: "invalid-card-confirmation",
  });
});
