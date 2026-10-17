import test from "node:test";
import assert from "node:assert/strict";
import { executeIdempotentPayment, readIdempotentPaymentResponse } from "./payment-idempotency.mjs";

function paymentAttemptStore() {
  const attempts = new Map();
  return {
    attempts,
    paymentAttempt: {
      async findUnique({ where }) {
        return attempts.get(where.idempotencyKey) || null;
      },
      async create({ data }) {
        if (attempts.has(data.idempotencyKey)) {
          const error = new Error("duplicate attempt");
          error.code = "P2002";
          throw error;
        }
        attempts.set(data.idempotencyKey, { ...data });
      },
    },
  };
}

test("successful payment response is snapshotted and returned unchanged on retry", async () => {
  const db = paymentAttemptStore();
  const parsed = { idempotencyKey: "cash-attempt-1", requestFingerprint: "fingerprint-1" };
  let created = 0;
  const first = await executeIdempotentPayment(db, parsed, async () => {
    created += 1;
    return { success: true, amountPaid: "5.00", timestamp: "2026-09-24T12:00:00.000Z" };
  });
  const retry = await executeIdempotentPayment(db, parsed, async () => {
    created += 1;
    throw new Error("must not run a second time");
  });

  assert.equal(first.isReplay, false);
  assert.equal(retry.isReplay, true);
  assert.deepEqual(retry.response, first.response);
  assert.equal(created, 1);
});

test("idempotent retry after a shift closes returns the stored response before shift checks", async () => {
  const db = paymentAttemptStore();
  const parsed = { idempotencyKey: "cash-attempt-2", requestFingerprint: "fingerprint-2" };
  await executeIdempotentPayment(db, parsed, async () => ({
    success: true,
    remainingBalance: "0.00",
  }));

  const retry = await executeIdempotentPayment(db, parsed, async () => {
    throw Object.assign(new Error("shift is closed"), { code: "shift-not-open" });
  });
  assert.equal(retry.response.remainingBalance, "0.00");
  assert.equal(retry.isReplay, true);
});

test("reusing an idempotency key with a changed request is rejected", async () => {
  const db = paymentAttemptStore();
  await executeIdempotentPayment(
    db,
    {
      idempotencyKey: "cash-attempt-3",
      requestFingerprint: "first",
    },
    async () => ({ success: true })
  );

  await assert.rejects(
    () =>
      readIdempotentPaymentResponse(db, {
        idempotencyKey: "cash-attempt-3",
        requestFingerprint: "changed",
      }),
    { code: "idempotency-conflict", status: 409 }
  );
});
