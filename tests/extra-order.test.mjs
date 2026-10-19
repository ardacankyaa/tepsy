import test from "node:test";
import assert from "node:assert/strict";
import { validateOrderPatch } from "../src/lib/order-workflow.mjs";
test("unkeyed additions cannot hide pending items in a delivered or ready ticket", () => {
  for (const status of ["PENDING", "PREPARING", "READY", "DELIVERED"])
    assert.throws(
      () =>
        validateOrderPatch(
          { addItems: [{ menuItemId: "coffee", quantity: 1 }] },
          { status, payments: [] }
        ),
      (error) => error.code === "new-ticket-required"
    );
});
