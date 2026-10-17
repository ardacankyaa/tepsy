const test = require("node:test");
const assert = require("node:assert/strict");
const { createDebouncedRefresh } = require("../src/lib/event-refresh.cjs");

test("several socket events in one burst trigger one refresh", async () => {
  let calls = 0;
  const refresh = createDebouncedRefresh(() => {
    calls += 1;
  }, 10);
  refresh();
  refresh();
  refresh();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, 1);
  refresh();
  refresh.dispose();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, 1);
});
