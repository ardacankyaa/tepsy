import test from "node:test";
import assert from "node:assert/strict";
import { planItemPayment, itemAvailability } from "../src/lib/item-payments.mjs";
import { parsePaymentRequest } from "../src/lib/payment-request.mjs";
import { calculateCashShiftClose } from "../src/lib/cash-shift.mjs";
const order = () => ({
  id: "order1",
  status: "DELIVERED",
  totalPrice: "180",
  discountAmount: "0",
  payments: [],
  items: [
    { id: "a", quantity: 1, unitPrice: "100", menuItemName: "Club sandwich" },
    { id: "b", quantity: 1, unitPrice: "50", menuItemName: "Limonata" },
    { id: "c", quantity: 1, unitPrice: "30", menuItemName: "Espresso" },
  ],
});
test("cash drawer includes collected tips once while principal remains separate", () => {
  const close = calculateCashShiftClose({
    shift: { id: "shift", openingCash: "20" },
    payments: [
      {
        id: "p",
        orderId: "o",
        paymentMethod: "CASH",
        amountPaid: "100",
        tipAmount: "10",
        createdAt: new Date(),
      },
    ],
    closingCashCents: 13000,
  });
  assert.equal(close.expectedCash, "130.00");
  assert.equal(close.cashPayments, "110.00");
  assert.equal(close.paymentsSnapshot[0].tipAmount, "10.00");
});
test("club sandwich and lemonade are paid together, espresso remains, duplicate quantity rejected", () => {
  const o = order();
  const p = planItemPayment(
    [o],
    [
      { orderItemId: "a", quantity: 1 },
      { orderItemId: "b", quantity: 1 },
    ]
  );
  assert.equal(p.allocations[0].amountCents, 15000);
  assert.equal(p.allocations[0].nextStatus, "DELIVERED");
  o.items[0].paidQuantity = 1;
  o.items[1].paidQuantity = 1;
  o.payments = [{ amountPaid: "150", itemsJson: JSON.stringify(p.allocations[0].paymentItems) }];
  assert.equal(itemAvailability(o).items[0].remainingQuantity, 0);
  assert.throws(
    () => planItemPayment([o], [{ orderItemId: "a", quantity: 1 }]),
    (e) => e.code === "item-already-paid"
  );
  const last = planItemPayment([o], [{ orderItemId: "c", quantity: 1 }]);
  assert.equal(last.allocations[0].amountCents, 3000);
  assert.equal(last.allocations[0].nextStatus, "PAID");
});
test("discounted quantities allocate every cent exactly across three payments", () => {
  const o = {
    id: "o",
    status: "READY",
    totalPrice: "1",
    discountAmount: "0.01",
    payments: [],
    items: [
      { id: "a", quantity: 2, unitPrice: "0.33" },
      { id: "b", quantity: 1, unitPrice: "0.34" },
    ],
  };
  let sum = 0;
  for (const id of ["a", "a", "b"]) {
    const p = planItemPayment([o], [{ orderItemId: id, quantity: 1 }]).allocations[0];
    sum += p.amountCents;
    o.items.find((i) => i.id === id).paidQuantity =
      (o.items.find((i) => i.id === id).paidQuantity || 0) + 1;
    o.payments.push({ amountPaid: (p.amountCents / 100).toFixed(2), itemsJson: "[]" });
  }
  assert.equal(sum, 99);
});
test("legacy unallocated partial payments cannot be guessed as item payments", () => {
  const o = order();
  o.payments = [{ amountPaid: "1" }];
  assert.equal(itemAvailability(o).itemPaymentsAvailable, false);
  assert.throws(
    () => planItemPayment([o], [{ orderItemId: "a", quantity: 1 }]),
    (e) => e.code === "unallocated-payment"
  );
});
test("closed and cancelled orders cannot receive selected-item payments by order id", () => {
  for (const status of ["PAID", "CANCELLED"]) {
    assert.throws(
      () => planItemPayment([{ ...order(), status }], [{ orderItemId: "a", quantity: 1 }]),
      (error) => error.status === 409 && error.code === "invalid-order-state"
    );
  }
});
test("selected items and tips are fingerprinted, canonicalized and validated", () => {
  const b = {
    tableId: "t1",
    paymentMethod: "CASH",
    idempotencyKey: "item-test-1",
    selectedItems: [{ orderItemId: "a", quantity: 1 }],
    tipAmount: "5",
  };
  assert.equal(parsePaymentRequest(b).tipCents, 500);
  assert.notEqual(
    parsePaymentRequest(b).requestFingerprint,
    parsePaymentRequest({ ...b, tipAmount: "6" }).requestFingerprint
  );
  assert.throws(() => parsePaymentRequest({ ...b, amountPaid: "10" }));
  assert.throws(() =>
    parsePaymentRequest({ ...b, selectedItems: [...b.selectedItems, ...b.selectedItems] })
  );
  assert.throws(() => parsePaymentRequest({ ...b, tipAmount: "-1" }));
});
