import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateCashShiftClose,
  attachPaymentToCashShift,
  CashShiftError,
  parseCashShiftCloseRequest,
  parseCashShiftOpenRequest,
  requireOpenCashShift,
} from "./cash-shift.mjs";

test("cash shift opening accepts exact nonnegative money and bounded notes", () => {
  assert.deepEqual(parseCashShiftOpenRequest({ openingCash: "100.05", openingNote: "İlk sayım" }), {
    openingCashCents: 10005,
    openingNote: "İlk sayım",
  });
  assert.deepEqual(parseCashShiftOpenRequest({ openingCash: "0.00" }), {
    openingCashCents: 0,
    openingNote: null,
  });
  assert.throws(() => parseCashShiftOpenRequest({ openingCash: "-0.01" }), CashShiftError);
  assert.throws(() => parseCashShiftOpenRequest({ openingCash: "1.001" }), /kuruş|decimal/i);
  assert.throws(
    () => parseCashShiftOpenRequest({ openingCash: "1.00", admin: true }),
    CashShiftError
  );
});

test("cash shift close accepts a nonnegative exact cash count and rejects malformed notes", () => {
  assert.deepEqual(
    parseCashShiftCloseRequest({
      shiftId: "shift-1",
      closingCash: "100.30",
      closingNote: "Kapanış",
    }),
    {
      shiftId: "shift-1",
      closingCashCents: 10030,
      closingNote: "Kapanış",
    }
  );
  assert.throws(
    () => parseCashShiftCloseRequest({ shiftId: "shift-1", closingCash: "100.301" }),
    /kuruş|decimal/i
  );
  assert.throws(
    () =>
      parseCashShiftCloseRequest({
        shiftId: "shift-1",
        closingCash: "100.00",
        closingNote: { x: 1 },
      }),
    CashShiftError
  );
  assert.throws(
    () => parseCashShiftCloseRequest({ shiftId: "shift-1", closingCash: "100.00", extra: true }),
    CashShiftError
  );
});

test("payment operations require the unique active cash shift", () => {
  const active = { id: "shift-1", status: "OPEN", activeKey: "ACTIVE" };
  assert.equal(requireOpenCashShift(active), active);
  assert.throws(() => requireOpenCashShift(null), { code: "shift-not-open" });
  assert.throws(() => requireOpenCashShift({ ...active, status: "CLOSED" }), {
    code: "shift-not-open",
  });
  assert.throws(() => requireOpenCashShift({ ...active, activeKey: null }), {
    code: "shift-not-open",
  });
  assert.deepEqual(attachPaymentToCashShift(active, { orderId: "order-1", amountPaid: "10.00" }), {
    orderId: "order-1",
    amountPaid: "10.00",
    cashShiftId: "shift-1",
  });
  assert.throws(() => attachPaymentToCashShift(null, { orderId: "order-1" }), {
    code: "shift-not-open",
  });
});

test("close summary uses exact cents, cash-only expected float, actual difference, and a payment snapshot", () => {
  const close = calculateCashShiftClose({
    shift: { id: "shift-1", openingCash: "100.05" },
    closingCashCents: 10030,
    closedAt: new Date("2026-09-24T18:00:00.000Z"),
    payments: [
      {
        id: "p2",
        orderId: "o1",
        paymentMethod: "CASH",
        amountPaid: { toString: () => "0.10" },
        createdAt: new Date("2026-09-24T17:01:00.000Z"),
      },
      {
        id: "p1",
        orderId: "o1",
        paymentMethod: "CASH",
        amountPaid: "0.20",
        createdAt: new Date("2026-09-24T17:00:00.000Z"),
      },
      {
        id: "p3",
        orderId: "o2",
        paymentMethod: "CREDIT_CARD",
        amountPaid: "5.05",
        createdAt: new Date("2026-09-24T17:02:00.000Z"),
      },
      {
        id: "p4",
        orderId: "o3",
        paymentMethod: "OTHER",
        amountPaid: "0.50",
        createdAt: new Date("2026-09-24T17:03:00.000Z"),
      },
    ],
  });

  assert.deepEqual(
    {
      openingCash: close.openingCash,
      cashPayments: close.cashPayments,
      cardPayments: close.cardPayments,
      otherPayments: close.otherPayments,
      expectedCash: close.expectedCash,
      closingCash: close.closingCash,
      cashDifference: close.cashDifference,
      paymentCount: close.paymentCount,
    },
    {
      openingCash: "100.05",
      cashPayments: "0.30",
      cardPayments: "5.05",
      otherPayments: "0.50",
      expectedCash: "100.35",
      closingCash: "100.30",
      cashDifference: "-0.05",
      paymentCount: 4,
    }
  );
  assert.deepEqual(
    close.paymentsSnapshot.map((payment) => payment.id),
    ["p1", "p2", "p3", "p4"]
  );
  assert.equal(close.paymentsSnapshot[0].amountPaid, "0.20");
});

test("close summary handles empty shifts and checks money overflow", () => {
  const empty = calculateCashShiftClose({
    shift: { id: "shift-2", openingCash: "25.00" },
    closingCashCents: 2500,
    closedAt: new Date("2026-09-24T18:00:00.000Z"),
    payments: [],
  });
  assert.equal(empty.expectedCash, "25.00");
  assert.equal(empty.cashDifference, "0.00");
  assert.throws(
    () =>
      calculateCashShiftClose({
        shift: { id: "shift-2", openingCash: "90071992547409.91" },
        closingCashCents: 0,
        payments: [
          {
            id: "overflow",
            orderId: "o1",
            paymentMethod: "CASH",
            amountPaid: "0.01",
            createdAt: new Date("2026-09-24T17:00:00.000Z"),
          },
        ],
      }),
    { code: "invalid-money" }
  );
});
