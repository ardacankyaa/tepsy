import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOrderRequest } from "../src/lib/order-input.mjs";

test("staff orders reject coerced ids, quantities, and notes", () => {
  assert.throws(() => normalizeOrderRequest({ tableId: {}, items: [] }), { code: "invalid-table" });
  assert.throws(
    () => normalizeOrderRequest({ tableId: "t1", items: [{ menuItemId: {}, quantity: 1 }] }),
    { code: "invalid-items" }
  );
  assert.throws(
    () => normalizeOrderRequest({ tableId: "t1", items: [{ menuItemId: "m1", quantity: true }] }),
    { code: "invalid-items" }
  );
  assert.throws(
    () => normalizeOrderRequest({ tableId: "t1", items: [{ menuItemId: "m1", quantity: null }] }),
    { code: "invalid-items" }
  );
  assert.throws(
    () =>
      normalizeOrderRequest({
        tableId: "t1",
        items: [{ menuItemId: "m1", quantity: 1, notes: {} }],
      }),
    { code: "invalid-items" }
  );
  assert.throws(
    () =>
      normalizeOrderRequest({
        tableId: "t".repeat(101),
        items: [{ menuItemId: "m1", quantity: 1 }],
      }),
    { code: "invalid-table" }
  );
  assert.throws(
    () =>
      normalizeOrderRequest({
        tableId: "t1",
        items: [{ menuItemId: "m".repeat(101), quantity: 1 }],
      }),
    { code: "invalid-items" }
  );
});

test("staff orders accept strict numeric-string quantities for older clients", () => {
  assert.deepEqual(
    normalizeOrderRequest({
      tableId: " t1 ",
      items: [{ menuItemId: " m1 ", quantity: "2", notes: " no ice " }],
      notes: " birthday ",
    }),
    {
      tableId: "t1",
      items: [{ menuItemId: "m1", quantity: 2, notes: "no ice" }],
      notes: "birthday",
    }
  );
});
