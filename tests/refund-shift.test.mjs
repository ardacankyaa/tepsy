import test from "node:test";
import assert from "node:assert/strict";
import { calculateCashShiftClose } from "../src/lib/cash-shift.mjs";
test("cash refunds reduce expected drawer balance without deleting original collections", () => {
  const result = calculateCashShiftClose({
    shift: { id: "shift", openingCash: "100" },
    payments: [
      { id: "p", orderId: "o", paymentMethod: "CASH", amountPaid: "50", createdAt: new Date() },
    ],
    refunds: [
      { id: "r", paymentId: "p", paymentMethod: "CASH", amount: "20", createdAt: new Date() },
    ],
    closingCashCents: 13000,
  });
  assert.equal(result.expectedCash, "130.00");
  assert.equal(result.cashPayments, "50.00");
  assert.equal(result.cashRefunds, "20.00");
  assert.equal(result.cashDifference, "0.00");
});
