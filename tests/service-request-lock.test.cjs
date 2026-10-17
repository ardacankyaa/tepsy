const test = require("node:test");
const assert = require("node:assert/strict");
const { withServiceRequestLock } = require("../src/lib/service-request-lock.cjs");

test("simultaneous service calls for a table respect the cooldown decision", async () => {
  let pending = false;
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      withServiceRequestLock("t1", "WAITER", async () => {
        if (pending) return 429;
        await new Promise((resolve) => setTimeout(resolve, 5));
        pending = true;
        return 202;
      })
    )
  );
  assert.equal(results.filter((status) => status === 202).length, 1);
  assert.equal(results.filter((status) => status === 429).length, 7);
});

test("failed service work releases the lock for the next request", async () => {
  await assert.rejects(
    withServiceRequestLock("t1", "BILL", async () => {
      throw new Error("database unavailable");
    })
  );
  assert.equal(await withServiceRequestLock("t1", "BILL", async () => "recovered"), "recovered");
});
