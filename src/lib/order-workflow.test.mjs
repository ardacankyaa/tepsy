import assert from "node:assert/strict";
import test from "node:test";

const workflow = await import("./order-workflow.mjs").catch(() => null);

test("order status transitions progress through service without allowing PATCH to mark PAID", () => {
  assert.equal(
    typeof workflow?.isValidOrderTransition,
    "function",
    "order workflow exposes isValidOrderTransition"
  );
  assert.equal(workflow.isValidOrderTransition("PENDING", "PREPARING"), true);
  assert.equal(workflow.isValidOrderTransition("PREPARING", "READY"), true);
  assert.equal(workflow.isValidOrderTransition("READY", "DELIVERED"), true);
  assert.equal(workflow.isValidOrderTransition("DELIVERED", "PAID"), false);
});

test("paid and cancelled orders are terminal", () => {
  assert.equal(
    typeof workflow?.isValidOrderTransition,
    "function",
    "order workflow exposes isValidOrderTransition"
  );
  assert.equal(workflow.isValidOrderTransition("PAID", "PENDING"), false);
  assert.equal(workflow.isValidOrderTransition("CANCELLED", "PENDING"), false);
});

test("a waiter can approve a QR order while it remains non-payable until PENDING", () => {
  assert.equal(
    typeof workflow?.validateOrderPatch,
    "function",
    "order workflow exposes validateOrderPatch"
  );
  assert.deepEqual(
    workflow.validateOrderPatch({ status: "PENDING" }, { status: "AWAITING_WAITER_APPROVAL" }),
    { action: "status", status: "PENDING" }
  );
  assert.throws(
    () =>
      workflow.validateOrderPatch(
        { addItems: [{ menuItemId: "m1", quantity: 1 }] },
        { status: "AWAITING_WAITER_APPROVAL" }
      ),
    /approval|pending|action/i
  );
});

test("an order mutation accepts one explicit action and rejects combined actions", () => {
  assert.equal(
    typeof workflow?.validateOrderPatch,
    "function",
    "order workflow exposes validateOrderPatch"
  );
  assert.deepEqual(workflow.validateOrderPatch({ status: "READY" }, { status: "PREPARING" }), {
    action: "status",
    status: "READY",
  });
  assert.throws(
    () =>
      workflow.validateOrderPatch(
        { status: "READY", addItems: [{ menuItemId: "m1", quantity: 1 }] },
        { status: "PREPARING" }
      ),
    /one|single|action/i
  );
});

test("paid orders reject financial edits even when the requested action is otherwise valid", () => {
  assert.equal(
    typeof workflow?.validateOrderPatch,
    "function",
    "order workflow exposes validateOrderPatch"
  );
  assert.throws(
    () =>
      workflow.validateOrderPatch(
        { addItems: [{ menuItemId: "m1", quantity: 1 }] },
        { status: "PAID" }
      ),
    /closed|terminal|paid|mutable/i
  );
  assert.throws(
    () => workflow.validateOrderPatch({ cancelItemId: "item-1" }, { status: "CANCELLED" }),
    /closed|terminal|paid|mutable/i
  );
});

test("role permissions distinguish kitchen, waiter, and cashier order actions", () => {
  assert.equal(
    typeof workflow?.isOrderActionAllowedForRole,
    "function",
    "order workflow exposes isOrderActionAllowedForRole"
  );
  assert.equal(
    workflow.isOrderActionAllowedForRole("KITCHEN", { action: "status", status: "READY" }),
    true
  );
  assert.equal(workflow.isOrderActionAllowedForRole("KITCHEN", { action: "addItems" }), false);
  assert.equal(
    workflow.isOrderActionAllowedForRole("WAITER", { action: "status", status: "DELIVERED" }),
    true
  );
  assert.equal(
    workflow.isOrderActionAllowedForRole("WAITER", { action: "status", status: "PENDING" }),
    true
  );
  assert.equal(workflow.isOrderActionAllowedForRole("CASHIER", { action: "addItems" }), true);
  assert.equal(
    workflow.isOrderActionAllowedForRole("CASHIER", { action: "status", status: "READY" }),
    false
  );
});

test("kitchen item updates require the observed status and cannot cancel a charged item", () => {
  const order = { status: "PREPARING", payments: [] };
  assert.throws(
    () =>
      workflow.validateOrderPatch(
        {
          itemStatusUpdate: {
            itemId: "item-1",
            expectedStatus: "PENDING",
            status: "CANCELLED",
          },
        },
        order
      ),
    /invalid|status/i
  );
  assert.throws(
    () =>
      workflow.validateOrderPatch(
        {
          itemStatusUpdate: {
            itemId: "item-1",
            status: "READY",
          },
        },
        order
      ),
    /invalid|status/i
  );
  assert.deepEqual(
    workflow.validateOrderPatch(
      {
        itemStatusUpdate: {
          itemId: "item-1",
          expectedStatus: "PENDING",
          status: "READY",
        },
      },
      order
    ),
    {
      action: "itemStatusUpdate",
      itemId: "item-1",
      expectedStatus: "PENDING",
      status: "READY",
    }
  );
});
