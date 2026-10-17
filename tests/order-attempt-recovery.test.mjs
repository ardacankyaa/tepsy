import assert from "node:assert/strict";
import test from "node:test";

const policy = await import("../src/lib/order-idempotency.mjs");

test("corrupt saved cart data is discarded before a screen attempts to render it", () => {
  let stored = JSON.stringify({
    idempotencyKey: "attempt-123",
    body: JSON.stringify({ idempotencyKey: "attempt-123", tableId: "t1", items: null }),
  });
  globalThis.window = {
    sessionStorage: {
      getItem: () => stored,
      removeItem: () => {
        stored = null;
      },
    },
  };
  try {
    assert.equal(policy.restoreOrderAttempt("attempt", "tableId", "t1"), null);
    assert.equal(stored, null);
  } finally {
    delete globalThis.window;
  }
});

test("restored order attempts keep the original id and body even if the draft changes", () => {
  const values = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };

  try {
    assert.equal(typeof policy.restoreOrCreateOrderAttempt, "function");
    const first = policy.restoreOrCreateOrderAttempt(
      "tepsy:order-attempt:test",
      { tableId: "table-1", items: [{ menuItemId: "item-a", quantity: 1 }] },
      "tableId",
      "table-1"
    );
    const afterRefresh = policy.restoreOrCreateOrderAttempt(
      "tepsy:order-attempt:test",
      { tableId: "table-1", items: [{ menuItemId: "item-b", quantity: 2 }] },
      "tableId",
      "table-1"
    );

    assert.ok(first);
    assert.equal(afterRefresh.idempotencyKey, first.idempotencyKey);
    assert.equal(afterRefresh.body, first.body);
    assert.deepEqual(JSON.parse(afterRefresh.body).items, [{ menuItemId: "item-a", quantity: 1 }]);
  } finally {
    delete globalThis.window;
  }
});

test("order attempt creation stops if session storage cannot preserve the retry", () => {
  globalThis.window = {
    sessionStorage: {
      getItem: () => null,
      setItem: () => {
        throw new Error("storage unavailable");
      },
      removeItem: () => {},
    },
  };

  try {
    assert.equal(
      policy.restoreOrCreateOrderAttempt(
        "tepsy:order-attempt:test",
        { tableId: "table-1", items: [{ menuItemId: "item-a", quantity: 1 }] },
        "tableId",
        "table-1"
      ),
      null
    );
  } finally {
    delete globalThis.window;
  }
});
