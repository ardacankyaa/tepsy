import assert from "node:assert/strict";
import test from "node:test";

const policy = await import("../src/lib/order-idempotency-server.mjs").catch(() => null);

test("order idempotency key is optional for legacy requests and validates supplied keys", () => {
  assert.equal(
    typeof policy?.optionalOrderIdempotencyKey,
    "function",
    "order creation has a key parser"
  );
  assert.equal(policy.optionalOrderIdempotencyKey({ tableId: "t1" }), null);
  assert.equal(
    policy.optionalOrderIdempotencyKey({ idempotencyKey: "  client-attempt-123  " }),
    "client-attempt-123"
  );
  assert.throws(() => policy.optionalOrderIdempotencyKey({ idempotencyKey: "bad key" }), {
    code: "invalid-idempotency-key",
    status: 400,
  });
  assert.throws(() => policy.optionalOrderIdempotencyKey({ idempotencyKey: "x".repeat(129) }), {
    code: "invalid-idempotency-key",
    status: 400,
  });
});

test("order request fingerprint includes the source and normalized request", () => {
  assert.equal(
    typeof policy?.orderRequestFingerprint,
    "function",
    "order creation fingerprints its request"
  );
  const request = {
    tableId: "t1",
    items: [{ menuItemId: "m1", quantity: 1, notes: null }],
    notes: null,
  };
  assert.equal(
    policy.orderRequestFingerprint("STAFF", request),
    "4602af7e68cbccf6b8dbbfca0f20d685a47a5c9e0bdc1ad574ee0f9bb7f8bd42"
  );
  assert.notEqual(
    policy.orderRequestFingerprint("QR", request),
    policy.orderRequestFingerprint("STAFF", request)
  );
});

test("a matching order key returns the existing order while a changed request is rejected", async () => {
  assert.equal(
    typeof policy?.findIdempotentOrder,
    "function",
    "order creation can find an earlier request"
  );
  const order = { id: "order-1", requestFingerprint: "fingerprint-1", status: "PENDING" };
  let lookups = 0;
  const client = {
    order: {
      async findUnique({ where }) {
        lookups += 1;
        assert.deepEqual(where, { idempotencyKey: "client-attempt-123" });
        return order;
      },
    },
  };

  assert.equal(await policy.findIdempotentOrder(client, null, "fingerprint-1"), null);
  assert.equal(
    await policy.findIdempotentOrder(client, "client-attempt-123", "fingerprint-1"),
    order
  );
  await assert.rejects(
    () => policy.findIdempotentOrder(client, "client-attempt-123", "fingerprint-2"),
    { code: "idempotency-conflict", status: 409 }
  );
  assert.equal(lookups, 2);
});

test("concurrent operations with one key run in order", async () => {
  assert.equal(
    typeof policy?.withOrderIdempotencyLock,
    "function",
    "same-process attempts can be serialized"
  );
  let active = 0;
  let maxActive = 0;
  const results = await Promise.all(
    [1, 2, 3].map((value) =>
      policy.withOrderIdempotencyLock("client-attempt-123", async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return value;
      })
    )
  );

  assert.deepEqual(results, [1, 2, 3]);
  assert.equal(maxActive, 1);
});

test("order responses prefer saved menu item names over current menu names", () => {
  assert.equal(
    typeof policy?.preferOrderItemNameSnapshots,
    "function",
    "order reads apply menu name snapshots"
  );
  const order = {
    items: [{ menuItemName: "Espresso at sale", menuItem: { id: "m1", name: "Renamed espresso" } }],
  };
  const processed = policy.preferOrderItemNameSnapshots(order);
  assert.equal(processed.items[0].menuItemName, "Espresso at sale");
  assert.equal(processed.items[0].menuItem.name, "Renamed espresso");

  const legacyOrder = {
    items: [{ menuItemName: null, menuItem: { id: "m2", name: "Legacy tea" } }],
  };
  assert.equal(
    policy.preferOrderItemNameSnapshots(legacyOrder).items[0].menuItemName,
    "Legacy tea"
  );
});
