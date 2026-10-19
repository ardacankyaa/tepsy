import test from "node:test";
import assert from "node:assert/strict";
import { parseRefund, refundPayment } from "../src/lib/refunds.mjs";
const valid = {
  paymentId: "payment-1",
  idempotencyKey: "refund-key-123",
  amount: "12.34",
  reason: "Wrong collection",
  externallyConfirmed: true,
};
test("refunds require exact positive money, a reason and explicit external confirmation", () => {
  assert.equal(parseRefund(valid).amountCents, 1234);
  for (const patch of [
    { amount: "0" },
    { amount: "-1" },
    { amount: "0.001" },
    { reason: "" },
    { externallyConfirmed: false },
    { paymentId: "../secret" },
    { extra: "field" },
  ])
    assert.throws(() => parseRefund({ ...valid, ...patch }));
});
test("an uncertain refund replay returns its original record even after the shift closes", async () => {
  const input = parseRefund(valid),
    stored = { id: "saved-refund", amount: "12.34" };
  const tx = {
    refund: {
      findUnique: async () => ({
        requestFingerprint: input.fingerprint,
        responseJson: JSON.stringify(stored),
      }),
    },
  };
  assert.deepEqual(await refundPayment(tx, input, { actorId: "owner", actorName: "Owner" }), {
    response: stored,
    replay: true,
  });
  await assert.rejects(
    refundPayment(tx, parseRefund({ ...valid, amount: "13" }), {}),
    (e) => e.code === "refund-conflict"
  );
});
