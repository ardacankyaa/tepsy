import assert from "node:assert/strict";
import test from "node:test";

const finance = await import("./finance.mjs").catch(() => null);

test("money amounts convert to integer kuruş without Decimal string concatenation", () => {
  assert.equal(typeof finance?.moneyToCents, "function", "finance helper exposes moneyToCents");
  assert.equal(finance.moneyToCents("12.30"), 1230);
  assert.equal(finance.moneyToCents("8.20"), 820);
  assert.equal(finance.moneyToCents("12"), 1200);
});

test("money parsing rejects invalid or sub-kuruş values instead of silently changing them", () => {
  assert.equal(typeof finance?.moneyToCents, "function", "finance helper exposes moneyToCents");
  assert.throws(() => finance.moneyToCents("1.001"), /money|kuruş|decimal/i);
  assert.throws(() => finance.moneyToCents("NaN"), /money|kuruş|decimal/i);
  assert.throws(() => finance.moneyToCents("-0.01"), /money|negative|kuruş/i);
});

test("payment amounts must be positive exact kuruş values", () => {
  assert.equal(
    typeof finance?.paymentAmountToCents,
    "function",
    "finance helper exposes paymentAmountToCents"
  );
  assert.equal(finance.paymentAmountToCents("0.10"), 10);
  assert.throws(() => finance.paymentAmountToCents("0"), /positive|payment/i);
  assert.throws(() => finance.paymentAmountToCents("-1"), /positive|payment/i);
  assert.throws(() => finance.paymentAmountToCents("1.001"), /money|kuruş|decimal/i);
});

test("money serializes as fixed two-decimal text", () => {
  assert.equal(typeof finance?.centsToMoney, "function", "finance helper exposes centsToMoney");
  assert.equal(finance.centsToMoney(0), "0.00");
  assert.equal(finance.centsToMoney(1230), "12.30");
  assert.equal(finance.centsToMoney(5), "0.05");
});

test("item totals use exact kuruş multiplication and addition", () => {
  assert.equal(
    typeof finance?.calculateItemsTotalCents,
    "function",
    "finance helper exposes calculateItemsTotalCents"
  );
  assert.equal(
    finance.calculateItemsTotalCents([
      { unitPrice: "0.10", quantity: 3 },
      { unitPrice: "0.20", quantity: 1 },
    ]),
    50
  );
  assert.throws(
    () => finance.calculateItemsTotalCents([{ unitPrice: "1.00", quantity: -1 }]),
    /quantity|item/i
  );
});

test("discount calculation is capped at the gross amount", () => {
  assert.equal(
    typeof finance?.discountToCents,
    "function",
    "finance helper exposes discountToCents"
  );
  assert.equal(finance.discountToCents(10000, "15"), 1500);
  assert.equal(finance.discountToCents(10001, "12.5"), 1250);
  assert.throws(() => finance.discountToCents(10000, "100.01"), /discount|percent/i);
});

test("table discount allocation is proportional and preserves every kuruş", () => {
  assert.equal(
    typeof finance?.allocateDiscountAcrossOrders,
    "function",
    "finance helper exposes allocateDiscountAcrossOrders"
  );
  const allocation = finance.allocateDiscountAcrossOrders(
    [
      { id: "order-a", totalPrice: "1.00", createdAt: "2026-09-24T10:00:00Z" },
      { id: "order-b", totalPrice: "2.00", createdAt: "2026-09-24T10:01:00Z" },
    ],
    50
  );
  assert.deepEqual(allocation, [
    { orderId: "order-a", discountCents: 17 },
    { orderId: "order-b", discountCents: 33 },
  ]);
  assert.equal(
    allocation.reduce((sum, row) => sum + row.discountCents, 0),
    50
  );
});

test("payment allocation subtracts previous payments and preserves the remaining balance", () => {
  assert.equal(typeof finance?.planPayment, "function", "finance helper exposes planPayment");
  const plan = finance.planPayment(
    [
      {
        id: "order-a",
        status: "PENDING",
        totalPrice: "50.00",
        payments: [{ amountPaid: "10.00" }],
        createdAt: "2026-09-24T10:00:00.000Z",
      },
      {
        id: "order-b",
        status: "READY",
        totalPrice: "80.00",
        payments: [],
        createdAt: "2026-09-24T10:01:00.000Z",
      },
    ],
    4500
  );

  assert.equal(plan.totalDueCents, 12000);
  assert.equal(plan.appliedCents, 4500);
  assert.equal(plan.remainingBalanceCents, 7500);
  assert.deepEqual(plan.allocations, [
    { orderId: "order-a", amountCents: 4000, remainingCents: 0, nextStatus: "PAID" },
    { orderId: "order-b", amountCents: 500, remainingCents: 7500, nextStatus: "READY" },
  ]);
});

test("payment allocation is stable by order creation time and rejects overpayment", () => {
  assert.equal(typeof finance?.planPayment, "function", "finance helper exposes planPayment");
  const orders = [
    {
      id: "later",
      status: "PENDING",
      totalPrice: "10.00",
      payments: [],
      createdAt: "2026-09-24T10:02:00Z",
    },
    {
      id: "earlier",
      status: "PENDING",
      totalPrice: "10.00",
      payments: [],
      createdAt: "2026-09-24T10:01:00Z",
    },
  ];
  const plan = finance.planPayment(orders, 1200);
  assert.deepEqual(
    plan.allocations.map((row) => [row.orderId, row.amountCents]),
    [
      ["earlier", 1000],
      ["later", 200],
    ]
  );
  assert.throws(() => finance.planPayment(orders, 2001), /exceed|balance|due/i);
});

test("closed and QR-pending orders cannot receive payment allocations", () => {
  assert.equal(typeof finance?.planPayment, "function", "finance helper exposes planPayment");
  for (const status of ["PAID", "CANCELLED", "AWAITING_WAITER_APPROVAL"]) {
    assert.throws(
      () =>
        finance.planPayment([{ id: "order-a", status, totalPrice: "10.00", payments: [] }], 1000),
      /state|status|payable|eligible/i
    );
  }
});
