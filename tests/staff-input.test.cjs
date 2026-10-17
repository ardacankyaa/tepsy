const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeStaffCreate, normalizeStaffUpdate } = require("../src/lib/staff-input.cjs");

test("staff create accepts typed values and applies the waiter default", () => {
  assert.deepEqual(normalizeStaffCreate({ name: " Ayşe ", pin: "1234" }), {
    name: "Ayşe",
    role: "WAITER",
    pin: "1234",
  });
  assert.deepEqual(normalizeStaffCreate({ name: "Ada", role: "CASHIER", pin: "5678" }), {
    name: "Ada",
    role: "CASHIER",
    pin: "5678",
  });
});

test("staff create rejects object and boolean scalar coercion", () => {
  for (const body of [
    { name: {}, pin: "1234" },
    { name: "Ada", role: {}, pin: "1234" },
    { name: "Ada", role: true, pin: "1234" },
    { name: "Ada", pin: true },
    { name: "Ada", pin: {} },
  ]) {
    assert.throws(() => normalizeStaffCreate(body), /geçersiz/i);
  }
});

test("staff update keeps an explicit false and valid PIN", () => {
  assert.deepEqual(normalizeStaffUpdate({ id: "u1", isActive: false, pin: "8246" }), {
    isActive: false,
    pin: "8246",
  });
});

test("staff update rejects misleading booleans, blank names and short PINs", () => {
  for (const body of [
    { id: "u1", isActive: "false" },
    { id: "u1", name: " " },
    { id: "u1", pin: "12" },
  ]) {
    assert.throws(() => normalizeStaffUpdate(body), /geçersiz/i);
  }
});
