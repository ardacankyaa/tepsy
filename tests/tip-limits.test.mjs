import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import * as finance from "../src/lib/finance.mjs";
import * as paymentRequest from "../src/lib/payment-request.mjs";
import * as shifts from "../src/lib/cash-shift.mjs";
import * as idempotency from "../src/lib/payment-idempotency.mjs";
import qrPolicy from "../src/lib/qr-policy.cjs";
import { assertCardPaymentAllowed } from "../src/lib/card-payment-policy.mjs";
import { readRequestJson } from "../src/lib/request-json.mjs";

const NextResponse = { json: (body, options = {}) => ({ body, status: options.status || 200 }) };

async function routeSource(route) {
  return (await readFile(new URL(`../src/app/api/${route}/route.js`, import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?from "[^"]+";\r?$/gm, "")
    .replace(/export /g, "");
}

const json = (url, body) => new Request(url, { method: "POST", body: JSON.stringify(body) });

async function qrRoute() {
  const created = [];
  let tableReads = 0;
  const tx = {
    table: {
      findUnique: async () => {
        tableReads++;
        return { id: "table-1", isArchived: false };
      },
    },
    restaurantConfig: { findFirst: async () => ({ qrOrderEnabled: true }) },
    order: {
      findFirst: async () => null,
      create: async ({ data }) => {
        created.push(data);
        return { id: `order-${created.length}`, status: data.status };
      },
    },
    menuItem: {
      findMany: async () => [
        {
          id: "tea",
          name: "Tea",
          price: new Prisma.Decimal("12.50"),
          category: { name: "Drinks" },
        },
      ],
    },
  };
  const dependencies = {
    ...finance,
    ...qrPolicy,
    Prisma,
    NextResponse,
    readRequestJson,
    prisma: { $transaction: (work) => work(tx) },
    findIdempotentOrder: async () => null,
    optionalOrderIdempotencyKey: () => null,
    orderRequestFingerprint: () => "fingerprint",
    OrderIdempotencyError: class extends Error {},
    withOrderIdempotencyLock: (key, work) => work(),
    global: {},
  };
  const POST = new Function(
    ...Object.keys(dependencies),
    `${await routeSource("public/orders")}\nreturn POST;`
  )(...Object.values(dependencies));
  const order = (tipAmount, quantity = 2) =>
    POST(
      json("http://localhost/api/public/orders", {
        token: "a".repeat(48),
        items: [{ menuItemId: "tea", quantity }],
        tipAmount,
      })
    );
  return { order, created, tableReads: () => tableReads };
}

test("anonymous QR tips cannot exceed the order total", async () => {
  const qr = await qrRoute();
  const over = await qr.order("25.01");
  assert.equal(over.status, 400);
  assert.equal(over.body.error, "Bahşiş sipariş tutarını aşamaz.");
  assert.equal(qr.created.length, 0);
  const exact = await qr.order("25.00");
  assert.equal(exact.status, 202);
  assert.equal(qr.created[0].tipAmount, "25.00");
  assert.equal((await qr.order("2.50")).status, 202);
  assert.equal((await qr.order(undefined)).status, 202);
  assert.equal(qr.created.at(-1).tipAmount, "0.00");
});

test("QR tips above the absolute ceiling are refused before any database work", async () => {
  const qr = await qrRoute();
  assert.equal(finance.MAX_QR_TIP_CENTS, 1_000_000);
  for (const tip of ["10000.01", "1000000", "-1", "1.001", "abc"]) {
    const result = await qr.order(tip, 20);
    assert.equal(result.status, 400, tip);
  }
  assert.equal(qr.tableReads(), 0);
  assert.equal(qr.created.length, 0);
});

function staffPaymentRoute(orders) {
  const reached = [];
  const tx = {
    paymentAttempt: { findUnique: async () => null, create: async () => {} },
    cashShift: {
      findUnique: async () => ({ id: "shift-1", status: "OPEN", activeKey: "ACTIVE" }),
    },
    table: { findUnique: async () => ({ id: "table-1" }) },
    order: { findMany: async () => orders, findUnique: async () => orders[0] },
    payment: {
      create: async ({ data }) => {
        reached.push(data);
        throw new paymentRequest.PaymentRequestError(418, "reached-payment", "stop");
      },
    },
  };
  const dependencies = {
    ...finance,
    ...paymentRequest,
    ...shifts,
    ...idempotency,
    assertCardPaymentAllowed,
    readRequestJson,
    authorizePaymentAccess: async () => null,
    prisma: { $transaction: (work) => work(tx) },
    readDeviceConfig: async () => ({ paymentTerminal: { enabled: false, adapter: "MANUAL" } }),
    NextResponse,
    global: {},
  };
  return { dependencies, reached };
}

test("staff checkout tips cannot exceed the account bill, counting tips already taken", async () => {
  const source = await routeSource("pos/payment");
  const orders = [
    {
      id: "order-1",
      status: "DELIVERED",
      totalPrice: "40.00",
      discountAmount: "0.00",
      items: [],
      payments: [{ amountPaid: "10.00", tipAmount: "5.00" }],
    },
    {
      id: "order-2",
      status: "DELIVERED",
      totalPrice: "20.00",
      discountAmount: "0.00",
      items: [],
      payments: [],
    },
  ];
  const pay = async (tipAmount) => {
    const { dependencies, reached } = staffPaymentRoute(orders);
    const POST = new Function(...Object.keys(dependencies), `${source}\nreturn POST;`)(
      ...Object.values(dependencies)
    );
    const result = await POST(
      json("http://localhost/api/pos/payment", {
        tableId: "table-1",
        paymentMethod: "CASH",
        idempotencyKey: `tip-limit-${tipAmount}`,
        ...(tipAmount === undefined ? {} : { tipAmount }),
      })
    );
    return { result, reached };
  };
  const over = await pay("55.01");
  assert.equal(over.result.status, 400);
  assert.equal(over.result.body.code, "tip-exceeds-bill");
  assert.equal(over.reached.length, 0, "no payment is written for a rejected tip");
  for (const tip of ["55.00", "1.00", undefined]) {
    const allowed = await pay(tip);
    assert.equal(allowed.result.body.code, "reached-payment", String(tip));
    assert.equal(allowed.reached[0].tipAmount, tip ?? "0.00");
  }
  const ceiling = await pay("1000000.01");
  assert.equal(ceiling.result.status, 400);
  assert.equal(ceiling.result.body.code, "invalid-tip");
});
