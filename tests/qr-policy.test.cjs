const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeCustomerItems,
  normalizeCustomerOrderNotes,
  serviceRequestAllowed,
  canCancelCustomerOrder,
  getPublicQrOrderStatus,
} = require("../src/lib/qr-policy.cjs");

test("customer orders reject empty, excessive and non-integer quantities", () => {
  assert.equal(normalizeCustomerItems([]), null);
  assert.equal(normalizeCustomerItems([{ menuItemId: "a", quantity: 0 }]), null);
  assert.equal(normalizeCustomerItems([{ menuItemId: "a", quantity: 1.5 }]), null);
  assert.equal(
    normalizeCustomerItems(
      Array.from({ length: 26 }, (_, i) => ({ menuItemId: String(i), quantity: 1 }))
    ),
    null
  );
});

test("customer order keeps only allowed fields and bounded notes", () => {
  assert.deepEqual(
    normalizeCustomerItems([
      { menuItemId: "a", quantity: 2, notes: "x".repeat(400), unitPrice: 0 },
    ]),
    [{ menuItemId: "a", quantity: 2, notes: "x".repeat(300) }]
  );
});

test("customer order rejects coerced identifiers, quantities, and notes", () => {
  assert.equal(normalizeCustomerItems([{ menuItemId: {}, quantity: 1 }]), null);
  assert.equal(normalizeCustomerItems([{ menuItemId: true, quantity: 1 }]), null);
  assert.equal(normalizeCustomerItems([{ menuItemId: "m1", quantity: true }]), null);
  assert.equal(normalizeCustomerItems([{ menuItemId: "m1", quantity: {} }]), null);
  assert.equal(normalizeCustomerItems([{ menuItemId: "m1", quantity: null }]), null);
  assert.equal(normalizeCustomerItems([{ menuItemId: "m1", quantity: 1, notes: {} }]), null);
  assert.equal(normalizeCustomerItems([{ menuItemId: "m1", quantity: 1, notes: true }]), null);
  assert.equal(normalizeCustomerItems([{ menuItemId: "m".repeat(101), quantity: 1 }]), null);
});

test("customer order notes accept only strings or nullish values", () => {
  assert.equal(normalizeCustomerOrderNotes(" dinner "), "dinner");
  assert.equal(normalizeCustomerOrderNotes("x".repeat(510)).length, 500);
  assert.equal(normalizeCustomerOrderNotes(null), null);
  assert.equal(normalizeCustomerOrderNotes(undefined), null);
  assert.equal(normalizeCustomerOrderNotes(false), undefined);
  assert.equal(normalizeCustomerOrderNotes({}), undefined);
});

test("service request cooldown blocks repeated presses", () => {
  assert.equal(serviceRequestAllowed(Date.now() - 5000, Date.now()), false);
  assert.equal(serviceRequestAllowed(Date.now() - 61000, Date.now()), true);
});

test("customer may cancel only an unapproved QR order at their table", () => {
  assert.equal(
    canCancelCustomerOrder(
      { tableId: "t1", source: "QR", status: "AWAITING_WAITER_APPROVAL" },
      "t1"
    ),
    true
  );
  assert.equal(
    canCancelCustomerOrder({ tableId: "t1", source: "QR", status: "PENDING" }, "t1"),
    false
  );
  assert.equal(
    canCancelCustomerOrder(
      { tableId: "t2", source: "QR", status: "AWAITING_WAITER_APPROVAL" },
      "t1"
    ),
    false
  );
});

test("public QR status returns only the status for a QR order belonging to the token table", () => {
  assert.equal(typeof getPublicQrOrderStatus, "function");
  const order = {
    tableId: "t1",
    source: "QR",
    status: "PREPARING",
    totalPrice: "99.00",
    notes: "private order note",
    items: [{ menuItemId: "secret" }],
  };

  assert.deepEqual(getPublicQrOrderStatus(order, "t1"), { status: "PREPARING" });
});

test("public QR status rejects other tables, staff orders and unknown statuses", () => {
  const order = { tableId: "t1", source: "QR", status: "PENDING" };
  assert.equal(getPublicQrOrderStatus(order, "t2"), null);
  assert.equal(getPublicQrOrderStatus({ ...order, source: "STAFF" }, "t1"), null);
  assert.equal(getPublicQrOrderStatus({ ...order, status: "INTERNAL_ONLY" }, "t1"), null);
});
