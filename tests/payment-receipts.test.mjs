import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  buildPaymentReceipt,
  buildAccountPaymentReceipt,
  listPaymentHistory,
  parsePaymentHistoryQuery,
  legacyPaymentReceipt,
  readPaymentReceipt,
} from "../src/lib/payment-receipts.mjs";
import { executeIdempotentPayment } from "../src/lib/payment-idempotency.mjs";

const orders = [
  {
    id: "o1",
    tableId: "t1",
    totalPrice: "60.00",
    discountAmount: "0",
    items: [
      {
        id: "i1",
        menuItemName: "Original tea",
        menuItem: { name: "Renamed tea" },
        quantity: 3,
        unitPrice: "20.00",
      },
    ],
    payments: [{ amountPaid: "60.00" }],
  },
  {
    id: "o2",
    tableId: "t1",
    totalPrice: "40.00",
    discountAmount: "0",
    items: [{ id: "i2", menuItemName: "Cake", quantity: 1, unitPrice: "40.00" }],
    payments: [],
  },
];
const input = {
  response: {
    table: { id: "t1", tableNumber: "12", section: "Garden" },
    orders,
    payments: [
      {
        id: "p1",
        amountPaid: "60.00",
        paymentMethod: "CASH",
        createdAt: "2026-10-10T10:00:00.000Z",
      },
    ],
    grossTotal: "100.00",
    discountAmount: "0.00",
    netTotal: "100.00",
    remainingBalance: "40.00",
    amountPaid: "60.00",
    timestamp: "2026-10-10T10:00:00.000Z",
  },
  restaurant: { restaurantName: "Original cafe", currency: "€" },
  cardVerification: null,
};

test("a final installment retains fully paid connected orders and the prior immutable receipt", async () => {
  const prior = buildPaymentReceipt(input);
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE "Order" (id TEXT, tableId TEXT, status TEXT); CREATE TABLE Payment (id TEXT, orderId TEXT, amountPaid NUMERIC, paymentMethod TEXT, idempotencyKey TEXT, createdAt INTEGER); CREATE TABLE PaymentAttempt (idempotencyKey TEXT, responseJson TEXT);
    INSERT INTO "Order" VALUES ('o1','t1','PAID'),('o2','t1','PAID'),('unrelated','t1','PAID');
    INSERT INTO Payment VALUES ('p1','o1',60,'CASH','attempt-one',1000),('p2','o2',40,'CREDIT_CARD','attempt-two',2000);`);
  db.prepare("INSERT INTO PaymentAttempt VALUES (?,?)").run(
    "attempt-one",
    JSON.stringify({ receipt: prior })
  );
  let included;
  const client = {
    $queryRawUnsafe: async (sql, ...args) => db.prepare(sql).all(...args),
    order: {
      findMany: async ({ where }) => {
        included = where.id.in;
        return orders.map((order) => ({ ...order, payments: [{ amountPaid: order.totalPrice }] }));
      },
    },
  };
  const response = {
    ...input.response,
    orders: [{ ...orders[1], payments: [{ amountPaid: "40.00" }] }],
    payments: [{ id: "p2", amountPaid: "40.00", paymentMethod: "CREDIT_CARD" }],
    grossTotal: "40.00",
    netTotal: "40.00",
    amountPaid: "40.00",
    remainingBalance: "0.00",
  };
  const final = await buildAccountPaymentReceipt(client, { ...input, response });
  assert.deepEqual(new Set(included), new Set(["o1", "o2"]));
  assert.equal(final.grossTotal, "100.00");
  assert.equal(final.totalPaid, "100.00");
  assert.equal(final.amountPaid, "40.00");
  assert.equal(final.remainingBalance, "0.00");
  assert.deepEqual(
    final.items.map((item) => item.name),
    ["Original tea", "Cake"]
  );
  assert.equal(prior.totalPaid, "60.00");
  assert.equal(prior.remainingBalance, "40.00");
  db.close();
});

test("installment receipt preserves full account scope, original names, exact amount and remaining balance", () => {
  const receipt = buildPaymentReceipt(input);
  assert.equal(receipt.id, "p1");
  assert.deepEqual(receipt.orderIds, ["o1", "o2"]);
  assert.equal(receipt.items[0].name, "Original tea");
  assert.equal(receipt.items[0].total, "60.00");
  assert.equal(receipt.amountPaid, "60.00");
  assert.equal(receipt.totalPaid, "60.00");
  assert.equal(receipt.remainingBalance, "40.00");
  assert.equal(receipt.currency, "€");
  input.restaurant.restaurantName = "Changed cafe";
  assert.equal(receipt.restaurantName, "Original cafe");
  input.restaurant.restaurantName = "Original cafe";
});

test("an immutable installment receipt survives retry without creating another payment", async () => {
  const receipt = buildPaymentReceipt(input);
  let stored;
  let writes = 0;
  const client = {
    paymentAttempt: {
      findUnique: async () => stored,
      create: async ({ data }) => {
        stored = data;
      },
    },
  };
  const parsed = { idempotencyKey: "payment-123", requestFingerprint: "same" };
  const create = async () => {
    writes++;
    return { receipt };
  };
  await executeIdempotentPayment(client, parsed, create);
  const replay = await executeIdempotentPayment(client, parsed, create);
  assert.equal(writes, 1);
  assert.equal(replay.isReplay, true);
  assert.deepEqual(replay.response.receipt, receipt);
});

test("a transaction allocated across two orders has one receipt for their sum, not the first allocation", () => {
  const receipt = buildPaymentReceipt({
    ...input,
    response: {
      ...input.response,
      payments: [
        { id: "first", amountPaid: "10.25", paymentMethod: "CREDIT_CARD" },
        { id: "second", amountPaid: "5.75", paymentMethod: "CREDIT_CARD" },
      ],
    },
    cardVerification: "MANUAL",
  });
  assert.equal(receipt.id, "first");
  assert.equal(receipt.amountPaid, "16.00");
  assert.equal(receipt.cardVerification, "MANUAL");
});

test("second installment includes the earlier closed order and keeps the first receipt frozen", () => {
  const firstReceipt = buildPaymentReceipt(input);
  const original = JSON.stringify(firstReceipt);
  const settledOrders = [orders[0], { ...orders[1], payments: [{ amountPaid: "40.00" }] }];
  const secondResponse = {
    ...input.response,
    orders: [settledOrders[1]],
    payments: [{ id: "p2", amountPaid: "40.00", paymentMethod: "CREDIT_CARD" }],
    grossTotal: "40.00",
    discountAmount: "0.00",
    netTotal: "40.00",
    remainingBalance: "0.00",
  };
  const secondReceipt = buildPaymentReceipt({
    ...input,
    response: secondResponse,
    accountOrders: settledOrders,
  });
  assert.equal(secondReceipt.amountPaid, "40.00");
  assert.equal(secondReceipt.grossTotal, "100.00");
  assert.equal(secondReceipt.netTotal, "100.00");
  assert.equal(secondReceipt.totalPaid, "100.00");
  assert.equal(secondReceipt.remainingBalance, "0.00");
  assert.deepEqual(secondReceipt.orderIds, ["o1", "o2"]);
  assert.deepEqual(
    secondReceipt.items.map((item) => item.name),
    ["Original tea", "Cake"]
  );
  assert.equal(JSON.stringify(firstReceipt), original);
  assert.equal(firstReceipt.totalPaid, "60.00");
  assert.equal(firstReceipt.remainingBalance, "40.00");
});

test("any allocation retrieves its original complete receipt without reading changed catalog or restaurant", async () => {
  const receipt = buildPaymentReceipt(input);
  const client = {
    payment: {
      findUnique: async ({ where }) =>
        where.id === "allocated-id" ? { id: where.id, idempotencyKey: "key" } : null,
    },
    paymentAttempt: { findUnique: async () => ({ responseJson: JSON.stringify({ receipt }) }) },
  };
  assert.deepEqual(await readPaymentReceipt(client, "allocated-id"), receipt);
  await assert.rejects(readPaymentReceipt(client, "missing"), (error) => error.status === 404);
  await assert.rejects(readPaymentReceipt(client, 42), (error) => error.status === 400);
});

test("damaged stored receipt fails explicitly instead of silently rebuilding current menu data", async () => {
  const client = {
    payment: { findUnique: async () => ({ id: "p1", idempotencyKey: "key" }) },
    paymentAttempt: { findUnique: async () => ({ responseJson: "{bad-json" }) },
  };
  await assert.rejects(
    readPaymentReceipt(client, "p1"),
    (error) => error.status === 500 && error.code === "invalid-payment-receipt"
  );
});

test("legacy payment confirms recorded collection without inventing old product names, balance or currency", () => {
  const receipt = legacyPaymentReceipt({
    id: "old1",
    orderId: "o1",
    amountPaid: "15.50",
    paymentMethod: "CASH",
    createdAt: "2026-01-01T10:00:00.000Z",
  });
  assert.equal(receipt.snapshotKind, "LEGACY_PAYMENT");
  assert.equal(receipt.amountPaid, "15.50");
  assert.equal(receipt.currency, null);
  assert.equal(receipt.remainingBalance, null);
  assert.deepEqual(receipt.items, []);
});

test("payment history validates limits, identifiers, order scope and opaque cursor", () => {
  assert.deepEqual(
    parsePaymentHistoryQuery(
      new URL("http://local/api/pos/payments?tableId=t1&orderIds=o1,o2&limit=1")
    ),
    { tableId: "t1", orderIds: ["o1", "o2"], limit: 1, before: null }
  );
  for (const suffix of [
    "limit=0",
    "limit=51",
    "limit=1.5",
    "before=garbage",
    "tableId=%27%20OR%201=1--",
    `orderIds=${Array.from({ length: 101 }, (_, i) => `o${i}`).join(",")}`,
  ]) {
    assert.throws(
      () => parsePaymentHistoryQuery(new URL(`http://local/api/pos/payments?${suffix}`)),
      (error) => error.status === 400
    );
  }
});

test("history matches zero-allocation snapshot orders, groups multi-order attempts and pages without changing totals", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE TABLE "Order" (id TEXT, tableId TEXT, totalPrice NUMERIC, discountAmount NUMERIC, tipAmount NUMERIC, status TEXT); CREATE TABLE "Table" (id TEXT, tableNumber TEXT, section TEXT); CREATE TABLE Payment (id TEXT, orderId TEXT, amountPaid NUMERIC, tipAmount NUMERIC, paymentMethod TEXT, idempotencyKey TEXT, createdAt INTEGER); CREATE TABLE PaymentAttempt (idempotencyKey TEXT, responseJson TEXT);`
  );
  db.exec(`INSERT INTO "Order" VALUES ('o1','t1',65,0,0,'PAID'),('o2','t1',35,0,10,'PAID'),('old','t1',99,0,0,'PAID'); INSERT INTO "Table" VALUES ('t1','12','Garden');
    INSERT INTO Payment VALUES ('p1','o1',60,10,'CASH','a1',1000),('p2','o2',15,0,'CREDIT_CARD','a2',2000),('p3','o1',5,0,'CREDIT_CARD','a2',2000),('p4','o2',20,0,'CASH','a3',3000);`);
  db.exec(`INSERT INTO Payment VALUES ('unrelated','old',99,0,'CASH',NULL,500);`);
  const insert = db.prepare("INSERT INTO PaymentAttempt VALUES (?,?)");
  insert.run("a1", JSON.stringify({ receipt: buildPaymentReceipt(input) }));
  insert.run(
    "a2",
    JSON.stringify({
      orders: [{ id: "o1" }, { id: "o2" }],
      amountPaid: "20.00",
      timestamp: "2026-10-10T10:01:00.000Z",
    })
  );
  const client = {
    refund: { findMany: async () => [] },
    $queryRawUnsafe: async (sql, ...args) => db.prepare(sql).all(...args),
  };
  const scope = new URL("http://local/api/pos/payments?tableId=t1&orderIds=o2&limit=1");
  const first = await listPaymentHistory(client, parsePaymentHistoryQuery(scope));
  assert.equal(first.payments.length, 1);
  assert.equal(first.payments[0].amountPaid, "20.00");
  assert.deepEqual(first.totals, {
    cash: "80.00",
    card: "20.00",
    other: "0.00",
    total: "100.00",
    paymentCount: 3,
  });
  assert.deepEqual(first.totalsByCurrency, [
    {
      currency: null,
      cash: "20.00",
      card: "20.00",
      other: "0.00",
      total: "40.00",
      paymentCount: 2,
    },
    { currency: "€", cash: "60.00", card: "0.00", other: "0.00", total: "60.00", paymentCount: 1 },
  ]);
  assert.deepEqual(first.account, {
    grossTotal: "100.00",
    discountAmount: "0.00",
    netTotal: "100.00",
    totalPaid: "100.00",
    remainingBalance: "0.00",
    remainingTipAmount: "0.00",
    orderIds: ["o1", "o2"],
  });
  assert.ok(first.nextCursor);
  scope.searchParams.set("before", first.nextCursor);
  const second = await listPaymentHistory(client, parsePaymentHistoryQuery(scope));
  assert.equal(second.payments[0].amountPaid, "20.00");
  assert.equal(second.payments[0].paymentMethod, "CREDIT_CARD");
  assert.deepEqual(second.totals, first.totals);
  scope.searchParams.set("before", second.nextCursor);
  const third = await listPaymentHistory(client, parsePaymentHistoryQuery(scope));
  assert.equal(third.payments[0].id, "p1");
  assert.equal(third.payments[0].amountPaid, "60.00");
  assert.equal(third.nextCursor, null);
  db.close();
});

test("history groups TRY, USD and unknown legacy amounts separately without inventing an exchange rate", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE "Order" (id TEXT, tableId TEXT, totalPrice NUMERIC, discountAmount NUMERIC, status TEXT); CREATE TABLE Payment (id TEXT, orderId TEXT, amountPaid NUMERIC, paymentMethod TEXT, idempotencyKey TEXT, createdAt INTEGER); CREATE TABLE PaymentAttempt (idempotencyKey TEXT, responseJson TEXT);
    INSERT INTO "Order" VALUES ('o1','t1',9,0,'PAID'),('o2','t1',12.34,0,'PAID'),('o3','t1',5.66,0,'PAID'),('o4','t1',4,0,'PAID');
    INSERT INTO Payment VALUES ('p1','o1',9,'CASH','a1',1000),('p2','o2',12.34,'CASH','a2',2000),('p3','o3',5.66,'CREDIT_CARD','a3',3000),('p4','o4',4,'OTHER',NULL,4000);`);
  const insert = db.prepare("INSERT INTO PaymentAttempt VALUES (?,?)");
  for (const [id, currency, method, amount] of [
    ["p1", "₺", "CASH", "9.00"],
    ["p2", "$", "CASH", "12.34"],
    ["p3", "$", "CREDIT_CARD", "5.66"],
  ]) {
    insert.run(
      `a${id.slice(1)}`,
      JSON.stringify({
        receipt: {
          ...buildPaymentReceipt(input),
          id,
          receiptNumber: `TPS-${id.toUpperCase()}`,
          currency,
          paymentMethod: method,
          amountPaid: amount,
        },
      })
    );
  }
  const client = {
    refund: { findMany: async () => [] },
    $queryRawUnsafe: async (sql, ...args) => db.prepare(sql).all(...args),
  };
  const result = await listPaymentHistory(
    client,
    parsePaymentHistoryQuery(new URL("http://local/api/pos/payments?tableId=t1"))
  );
  assert.deepEqual(
    result.totalsByCurrency.find((row) => row.currency === "$"),
    { currency: "$", cash: "12.34", card: "5.66", other: "0.00", total: "18.00", paymentCount: 2 }
  );
  assert.deepEqual(
    result.totalsByCurrency.find((row) => row.currency === "₺"),
    { currency: "₺", cash: "9.00", card: "0.00", other: "0.00", total: "9.00", paymentCount: 1 }
  );
  assert.deepEqual(
    result.totalsByCurrency.find((row) => row.currency === null),
    { currency: null, cash: "0.00", card: "0.00", other: "4.00", total: "4.00", paymentCount: 1 }
  );
  assert.equal(result.payments.find((row) => row.id === "p2").currency, "$");
  assert.equal(result.account, null);
  db.close();
});

test("refund history includes tips in the refundable total and separates refunded tip", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE "Order" (id TEXT, tableId TEXT, totalPrice NUMERIC, discountAmount NUMERIC, status TEXT);
    CREATE TABLE Payment (id TEXT, orderId TEXT, amountPaid NUMERIC, paymentMethod TEXT, idempotencyKey TEXT, createdAt INTEGER);
    CREATE TABLE PaymentAttempt (idempotencyKey TEXT, responseJson TEXT);
    INSERT INTO "Order" VALUES ('o1','t1',100,0,'PAID');
    INSERT INTO Payment VALUES ('p1','o1',100,'CASH','a1',1000);`);
  db.prepare("INSERT INTO PaymentAttempt VALUES (?,?)").run(
    "a1",
    JSON.stringify({
      receipt: {
        id: "p1",
        receiptNumber: "TPS-P1",
        tableId: "t1",
        tableNumber: "12",
        section: "Garden",
        orderIds: ["o1"],
        amountPaid: "100.00",
        tipAmount: "20.00",
        collectedTotal: "120.00",
        paymentMethod: "CASH",
        timestamp: "2026-10-10T10:00:00.000Z",
        currency: "₺",
      },
    })
  );
  const client = {
    $queryRawUnsafe: async (sql, ...args) => db.prepare(sql).all(...args),
    refund: {
      findMany: async () => [
        {
          id: "r1",
          paymentId: "p1",
          amount: "110.00",
          tipAmount: "10.00",
          currency: "₺",
          reason: "Partial tip refund",
          actorName: "Owner",
          createdAt: new Date("2026-10-10T11:00:00.000Z"),
        },
      ],
    },
  };
  const result = await listPaymentHistory(
    client,
    parsePaymentHistoryQuery(new URL("http://local/api/pos/payments?tableId=t1"))
  );
  assert.equal(result.payments[0].amountPaid, "100.00");
  assert.equal(result.payments[0].tipAmount, "20.00");
  assert.equal(result.payments[0].collectedTotal, "120.00");
  assert.equal(result.payments[0].refundedAmount, "110.00");
  assert.equal(result.payments[0].refundedTipAmount, "10.00");
  assert.equal(result.payments[0].refundablePrincipalAmount, "0.00");
  assert.equal(result.payments[0].refundableTipAmount, "10.00");
  assert.equal(result.payments[0].refundableAmount, "10.00");
  assert.equal(result.payments[0].refunds[0].tipAmount, "10.00");
  db.close();
});
