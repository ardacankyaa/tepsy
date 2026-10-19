import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRefund,
  refundPayment,
  refundPrincipalCents,
  summarizeRefunds,
} from "../src/lib/refunds.mjs";
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

function refundTransaction({ receipt, refunds = [], cashPayments = [] }) {
  const state = [...refunds];
  const created = [];
  const tx = {
    payment: {
      findUnique: async () => ({
        id: receipt.id,
        idempotencyKey: "payment-key",
        amountPaid: receipt.amountPaid,
        paymentMethod: receipt.paymentMethod,
      }),
      findMany: async ({ where }) =>
        cashPayments.filter((payment) => payment.cashShiftId === where.cashShiftId),
    },
    paymentAttempt: {
      findUnique: async () => ({ responseJson: JSON.stringify({ receipt }) }),
    },
    refund: {
      findUnique: async ({ where }) =>
        state.find((refund) => refund.idempotencyKey === where.idempotencyKey) || null,
      findMany: async ({ where }) =>
        state.filter(
          (refund) =>
            (!where.paymentId || refund.paymentId === where.paymentId) &&
            (!where.cashShiftId || refund.cashShiftId === where.cashShiftId)
        ),
      create: async ({ data }) => {
        state.push(data);
        created.push(data);
      },
    },
    cashShift: {
      findUnique: async () => ({ id: "shift-1", status: "OPEN", openingCash: "0.00" }),
    },
    restaurantConfig: { findFirst: async () => ({ currency: receipt.currency }) },
    auditEvent: { create: async () => {} },
  };
  return { tx, state, created };
}

test("refunds allocate bill principal first and then the collected tip", async () => {
  const receipt = {
    id: "payment-1",
    amountPaid: "100.00",
    tipAmount: "20.00",
    collectedTotal: "120.00",
    paymentMethod: "CREDIT_CARD",
    currency: "₺",
  };
  const { tx, created } = refundTransaction({ receipt });
  const first = await refundPayment(tx, parseRefund({ ...valid, amount: "30.00" }), {
    actorId: "owner",
    actorName: "Owner",
  });
  assert.equal(first.response.amount, "30.00");
  assert.equal(first.response.principalAmount, "30.00");
  assert.equal(first.response.tipAmount, "0.00");
  assert.equal(first.response.remainingRefundable, "90.00");

  const second = await refundPayment(
    tx,
    parseRefund({ ...valid, amount: "80.00", idempotencyKey: "refund-key-456" }),
    { actorId: "owner", actorName: "Owner" }
  );
  assert.equal(second.response.amount, "80.00");
  assert.equal(second.response.principalAmount, "70.00");
  assert.equal(second.response.tipAmount, "10.00");
  assert.equal(second.response.remainingPrincipalRefundable, "0.00");
  assert.equal(second.response.remainingTipRefundable, "10.00");
  assert.equal(created[1].tipAmount, "10.00");

  await assert.rejects(
    refundPayment(
      tx,
      parseRefund({ ...valid, amount: "11.00", idempotencyKey: "refund-key-789" }),
      { actorId: "owner", actorName: "Owner" }
    ),
    (error) => error.code === "over-refund"
  );
});

test("cash refund availability includes collected tips and legacy receipts cap at principal", async () => {
  const receipt = {
    id: "payment-1",
    amountPaid: "30.00",
    tipAmount: "5.00",
    collectedTotal: "35.00",
    paymentMethod: "CASH",
    currency: "₺",
  };
  const { tx, created } = refundTransaction({
    receipt,
    cashPayments: [{ cashShiftId: "shift-1", amountPaid: "30.00", tipAmount: "5.00" }],
  });
  const refund = await refundPayment(tx, parseRefund({ ...valid, amount: "35.00" }), {
    actorId: "owner",
    actorName: "Owner",
  });
  assert.equal(refund.response.tipAmount, "5.00");
  assert.equal(created[0].amount, "35.00");

  const legacy = { id: "old-payment", amountPaid: "30.00", paymentMethod: "CASH", currency: "₺" };
  const legacyTx = refundTransaction({ receipt: legacy }).tx;
  await assert.rejects(
    refundPayment(legacyTx, parseRefund({ ...valid, paymentId: "old-payment", amount: "30.01" }), {
      actorId: "owner",
      actorName: "Owner",
    }),
    (error) => error.code === "over-refund"
  );
});

test("refund summaries separate returned bill principal and tips by payment method", () => {
  const refunds = [
    { amount: "80.00", tipAmount: "10.00", paymentMethod: "CASH" },
    { amount: "5.00", paymentMethod: "CREDIT_CARD" },
  ];
  assert.equal(refundPrincipalCents(refunds[0]), 7000);
  assert.deepEqual(summarizeRefunds(refunds), {
    amountCents: 8500,
    tipCents: 1000,
    principalCents: 7500,
  });
  assert.deepEqual(summarizeRefunds(refunds, "CASH"), {
    amountCents: 8000,
    tipCents: 1000,
    principalCents: 7000,
  });
});
