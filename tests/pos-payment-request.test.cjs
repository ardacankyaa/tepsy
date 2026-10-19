const test = require("node:test");
const assert = require("node:assert/strict");
const { createPaymentRequest } = require("../src/lib/pos-payment-request.cjs");

test("item selection sends identifiers and quantities with a separate tip, never client prices", () => {
  const input = {
    tableId: "t",
    paymentMethod: "CASH",
    idempotencyKey: "selected-1",
    selectedItems: [{ orderItemId: "item", quantity: 2 }],
    tipAmount: "10,50",
  };
  const p = createPaymentRequest(input);
  assert.deepEqual(p.selectedItems, input.selectedItems);
  assert.equal(p.tipAmount, "10.50");
  assert.equal(p.amountPaid, undefined);
  assert.equal(createPaymentRequest({ ...input, partialAmount: "30" }), null);
  assert.equal(createPaymentRequest({ ...input, tipAmount: "-1" }), null);
});

test("full payment delegates the remaining balance to the server", () => {
  assert.deepEqual(
    createPaymentRequest({
      tableId: "t1",
      paymentMethod: "CASH",
      discountPercent: 10,
      idempotencyKey: "attempt-1",
      partialAmount: "",
    }),
    {
      tableId: "t1",
      paymentMethod: "CASH",
      discountPercent: "10",
      discountReason: "POS yüzde indirimi",
      idempotencyKey: "attempt-1",
    }
  );
});

test("partial payment uses a fixed two-decimal string", () => {
  assert.equal(
    createPaymentRequest({
      tableId: "t1",
      paymentMethod: "CASH",
      discountPercent: 0,
      idempotencyKey: "attempt-2",
      partialAmount: "12.30",
    }).amountPaid,
    "12.30"
  );
  assert.equal(
    createPaymentRequest({
      tableId: "t1",
      paymentMethod: "CASH",
      discountPercent: 0,
      idempotencyKey: "attempt-2",
      partialAmount: "12.305",
    }),
    null
  );
});

test("custom discount reason is sent with the payment and cannot be blank", () => {
  assert.equal(
    createPaymentRequest({
      tableId: "t1",
      paymentMethod: "CASH",
      discountPercent: 15,
      discountReason: "  Misafir ikramı  ",
      idempotencyKey: "attempt-3",
      partialAmount: "",
    }).discountReason,
    "Misafir ikramı"
  );
  assert.equal(
    createPaymentRequest({
      tableId: "t1",
      paymentMethod: "CASH",
      discountPercent: 15,
      discountReason: "   ",
      idempotencyKey: "attempt-4",
      partialAmount: "",
    }),
    null
  );
});
