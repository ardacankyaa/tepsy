const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canArchiveTable,
  canSetTableAvailable,
  canUpdateTableFields,
} = require("../src/lib/table-archive.cjs");

test("table with an open order cannot be archived", () => {
  assert.equal(canArchiveTable([{ status: "READY" }]), false);
  assert.equal(canArchiveTable([{ status: "DELIVERED" }]), false);
});

test("table with only settled orders can be archived", () => {
  assert.equal(canArchiveTable([{ status: "PAID" }, { status: "CANCELLED" }]), true);
});

test("table cannot be made available while it has an open order", () => {
  assert.equal(canSetTableAvailable([{ status: "PREPARING" }]), false);
  assert.equal(canSetTableAvailable([{ status: "PAID" }]), true);
});

test("waiter may update status but not administrative table details", () => {
  assert.equal(canUpdateTableFields("WAITER", { id: "t1", status: "BILL_REQUESTED" }), true);
  assert.equal(canUpdateTableFields("WAITER", { id: "t1", tableNumber: "VIP" }), false);
  assert.equal(canUpdateTableFields("ADMIN", { id: "t1", tableNumber: "VIP" }), true);
});
