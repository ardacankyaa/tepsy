import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as finance from "../src/lib/finance.mjs";
import * as cashShift from "../src/lib/cash-shift.mjs";
// Request doubles expose json(); real-stream size limits are covered in request-body tests.
const readRequestJson = async (request) => {
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error("Invalid JSON request body."), {
      code: "invalid-json-body",
      status: 400,
    });
  }
};

const source = (
  await readFile(new URL("../src/app/api/pos/shift/route.js", import.meta.url), "utf8")
)
  .replace(/^import[\s\S]*?from "[^"]+";\r?$/gm, "")
  .replace(/export /g, "");

function makeRoute(closed = false) {
  let shift = {
    id: "short-shift",
    status: closed ? "CLOSED" : "OPEN",
    activeKey: closed ? null : "ACTIVE",
    openingCash: "100.00",
    cashPayments: closed ? "10.00" : "0.00",
    cardPayments: "0.00",
    otherPayments: "0.00",
    closingCash: closed ? "109.75" : null,
    expectedCash: closed ? "110.00" : null,
    cashDifference: closed ? "-0.25" : null,
    paymentCount: closed ? 1 : 0,
    paymentsSnapshot: "[]",
    closedAt: closed ? new Date("2026-10-15T12:00:00Z") : null,
  };
  let writes = 0;
  const client = {
    refund: { findMany: async () => [] },
    restaurantConfig: { findFirst: async () => ({ authEnabled: false }) },
    cashShift: {
      findUnique: async ({ where }) =>
        where.id === shift.id || (where.activeKey && where.activeKey === shift.activeKey)
          ? { ...shift }
          : null,
      findFirst: async () => (shift.status === "CLOSED" ? { ...shift } : null),
      updateMany: async ({ data }) => {
        writes++;
        shift = { ...shift, ...data };
        return { count: 1 };
      },
    },
    payment: {
      findMany: async () => [
        {
          id: "cash-payment",
          orderId: "order-1",
          paymentMethod: "CASH",
          amountPaid: "10.00",
          createdAt: new Date("2026-10-15T11:00:00Z"),
        },
      ],
    },
  };
  client.$transaction = async (fn) => {
    const before = { ...shift };
    try {
      return await fn(client);
    } catch (error) {
      shift = before;
      throw error;
    }
  };
  const dependencies = {
    readRequestJson,
    ...finance,
    ...cashShift,
    prisma: client,
    NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) },
    global: {},
    console: { error() {} },
  };
  return {
    ...new Function(...Object.keys(dependencies), `${source}\nreturn { GET, PATCH };`)(
      ...Object.values(dependencies)
    ),
    writes: () => writes,
  };
}

test("closed shift GET preserves a historical cash shortage as a signed exact amount", async () => {
  const response = await makeRoute(true).GET({});
  assert.equal(response.status, 200);
  assert.equal(response.body.currentShift, null);
  assert.equal(response.body.latestClosedShift.cashDifference, "-0.25");
  assert.equal(response.body.latestClosedShift.closingCash, "109.75");
});

test("closing a short cash drawer succeeds and repeats the original signed snapshot", async () => {
  const route = makeRoute();
  const request = { json: async () => ({ shiftId: "short-shift", closingCash: "109.75" }) };
  const response = await route.PATCH(request);
  assert.equal(response.status, 200);
  assert.equal(response.body.cashDifference, "-0.25");
  assert.equal(response.body.shift.cashDifference, "-0.25");
  assert.equal(response.body.expectedCash, "110.00");
  assert.equal(response.body.paymentsSnapshot.length, 1);
  assert.deepEqual(await route.PATCH(request), response);
  assert.equal(route.writes(), 1);
  assert.equal((await route.GET({})).body.latestClosedShift.cashDifference, "-0.25");
});

test("a signed cash difference never permits a negative closing cash count or payment", async () => {
  const route = makeRoute();
  const response = await route.PATCH({
    json: async () => ({ shiftId: "short-shift", closingCash: "-0.25" }),
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "negative-money");
  assert.equal(route.writes(), 0);
  assert.throws(() => finance.moneyToCents("-0.25"), { code: "negative-money" });
  assert.throws(() => finance.paymentAmountToCents("-0.25"), { code: "invalid-payment" });
});
