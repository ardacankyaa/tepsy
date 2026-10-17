const test = require("node:test");
const assert = require("node:assert/strict");
const { orderListPage } = require("../src/lib/order-list-query.cjs");

test("orders list is bounded by default and even for oversized requests", () => {
  assert.deepEqual(orderListPage(new URLSearchParams()), { take: 200 });
  assert.deepEqual(orderListPage(new URLSearchParams("limit=5000")), { take: 200 });
});

test("orders list accepts smaller pages and a cursor", () => {
  assert.deepEqual(orderListPage(new URLSearchParams("limit=25&cursor=order-1")), {
    take: 25,
    cursor: { id: "order-1" },
    skip: 1,
  });
});
