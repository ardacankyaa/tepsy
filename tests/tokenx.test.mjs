import test from "node:test";
import assert from "node:assert/strict";
import { buildTokenXBasket, createTokenXClient } from "../src/lib/devices/tokenx.mjs";
import { openTransferStore } from "../src/lib/devices/terminal-transfer-store.mjs";
import { parsePaymentRequest } from "../src/lib/payment-request.mjs";
import {
  sendTokenXAccount,
  assertTokenXTransferCurrent,
} from "../src/lib/devices/terminal-transfer.mjs";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { validateDeviceConfig } from "../src/lib/devices/validation.js";
import { assertCardPaymentAllowed } from "../src/lib/card-payment-policy.mjs";

export function fixture() {
  return {
    basketID: "06445b22-524b-4ce4-b2e8-e728a7c36b18",
    terminal: {
      terminalId: "AV0000000001",
      categorySections: [{ category: "İçecek", sectionNo: 2 }],
    },
    fiscal: { terminal: "AV0000000001", sections: [{ sectionNo: 2, taxPercent: 1000 }] },
    restaurant: { currency: "₺" },
    parsed: parsePaymentRequest({
      tableId: "table-1",
      paymentMethod: "CREDIT_CARD",
      idempotencyKey: "transfer-test-1",
    }),
    orders: [
      {
        id: "order-1",
        tableId: "table-1",
        status: "DELIVERED",
        totalPrice: "37.50",
        table: { tableNumber: "Masa 3", section: "Salon" },
        payments: [],
        discountAmount: "0",
        items: [
          {
            id: "line-1",
            menuItemName: "Çay",
            menuItemCategoryName: "İçecek",
            quantity: 3,
            unitPrice: "12.50",
            menuItem: { name: "New name", price: "100.00" },
          },
          {
            id: "cancelled",
            status: "CANCELLED",
            menuItemName: "Su",
            menuItemCategoryName: "İçecek",
            quantity: 1,
            unitPrice: "10.00",
          },
        ],
      },
    ],
  };
}

test("TokenX basket sends historical names and unit prices, thousandth quantities and terminal fiscal rates", () => {
  const built = buildTokenXBasket(fixture());
  assert.deepEqual(built.basket.items, [
    { name: "Çay", price: 1250, sectionNo: 2, taxPercent: 1000, quantity: 3000, unit: "Adet" },
  ]);
  assert.equal(built.totalCents, 3750);
  assert.equal(built.basket.title, "Masa 3");
  assert.equal(built.basket.paymentItems, undefined, "Exporting a bill must not claim a payment");
});

test("TokenX computes the same rounded whole-account discount as checkout", () => {
  const input = fixture();
  input.parsed = parsePaymentRequest({
    tableId: "table-1",
    paymentMethod: "CREDIT_CARD",
    idempotencyKey: "discount-test",
    discountPercent: "10",
    discountReason: "Kampanya",
  });
  const built = buildTokenXBasket(input);
  assert.equal(built.totalCents, 3375);
  assert.deepEqual(built.basket.adjust, {
    description: "Kampanya",
    discountOrSurcharge: 0,
    type: 0,
    value: 375,
  });
});

test("TokenX refuses unknown tax mappings, mismatched fiscal terminal, foreign currency, partial payments and inconsistent totals", () => {
  const variants = [
    (v) => {
      v.terminal.categorySections = [];
    },
    (v) => {
      v.fiscal.terminal = "AV9999999999";
    },
    (v) => {
      v.restaurant.currency = "€";
    },
    (v) => {
      v.parsed.requestedAmountCents = 1000;
    },
    (v) => {
      v.orders[0].payments = [{ amountPaid: "1.00" }];
    },
    (v) => {
      v.orders[0].totalPrice = "38.00";
    },
    (v) => {
      v.orders[0].status = "PAID";
    },
  ];
  for (const mutate of variants) {
    const input = fixture();
    mutate(input);
    assert.throws(
      () => buildTokenXBasket(input),
      (e) => e.status >= 400 && e.status < 500
    );
  }
});

const env = {
  TEPSY_TOKENX_AUTH_URL: "https://test-api.devtokeninc.com/app-store/external/v1/auth/token",
  TEPSY_TOKENX_API_URL: "https://test-api.devtokeninc.com/dtokc/integration/v1",
  TEPSY_TOKENX_CLIENT_ID: "test-client",
  TEPSY_TOKENX_CLIENT_SECRET: "test-secret",
};

test("TokenX authenticates using Basic auth, then sends the official basket endpoint with a Bearer token", async () => {
  const requests = [];
  const client = createTokenXClient({
    env,
    fetchImpl: async (url, options) => {
      requests.push({ url, ...options });
      return Response.json(
        requests.length === 1
          ? {
              status: 201,
              result: {
                accessToken: "private-access-token",
                expiresIn: 86400,
                tokenType: "Bearer",
              },
            }
          : { status: 0 }
      );
    },
  });
  const basket = buildTokenXBasket(fixture()).basket;
  await client.sendBasket("AV0000000001", basket);
  assert.equal(requests.length, 2);
  assert.equal(
    requests[0].headers.Authorization,
    `Basic ${Buffer.from("test-client:test-secret").toString("base64")}`
  );
  assert.equal(requests[1].url, env.TEPSY_TOKENX_API_URL + "/basket");
  assert.equal(requests[1].headers.Authorization, "Bearer private-access-token");
  assert.equal(requests[1].headers["terminal-id"], "AV0000000001");
  assert.deepEqual(JSON.parse(requests[1].body), basket);
  assert.equal(requests[1].redirect, "error");
});

test("TokenX never treats HTTP success with provider failure as accepted and never retries a basket POST", async () => {
  for (const failure of [
    () => Response.json({ status: 9, description: "private provider details" }),
    () => {
      throw new Error("private transport detail");
    },
  ]) {
    let calls = 0;
    const client = createTokenXClient({
      env,
      fetchImpl: async () => {
        calls++;
        if (calls === 1)
          return Response.json({
            result: { accessToken: "secret", expiresIn: 60, tokenType: "Bearer" },
          });
        return failure();
      },
    });
    await assert.rejects(
      client.sendBasket("AV0000000001", { basketID: "sample" }),
      (error) => !error.message.includes("private") && !error.message.includes("secret")
    );
    assert.equal(calls, 2);
  }
  assert.throws(() =>
    createTokenXClient({ env: { ...env, TEPSY_TOKENX_AUTH_URL: "http://example.com" } })
  );
});

test("terminal reservations survive retries and reject overlapping changed accounts without creating another basket", () => {
  const store = openTransferStore(":memory:");
  try {
    const input = {
      basket: { basketID: "basket-1", items: [] },
      orderIds: ["order-1", "order-2"],
      fingerprint: "original",
      terminalId: "AV1",
    };
    assert.equal(store.reserve(input).isNew, true);
    assert.equal(store.reserve({ ...input, basket: { basketID: "unused-new-id" } }).isNew, false);
    assert.equal(store.reserve(input).transfer.basket.basketID, "basket-1");
    assert.throws(
      () => store.reserve({ ...input, fingerprint: "changed" }),
      (e) => e.code === "terminal-account-changed"
    );
    assert.throws(
      () => store.reserve({ ...input, orderIds: ["order-2", "order-3"] }),
      (e) => e.code === "terminal-account-changed"
    );
    store.mark("basket-1", "SENT");
    assert.equal(store.reserve(input).transfer.state, "SENT");
  } finally {
    store.close();
  }
});

function transferFixture(t) {
  const qa = path.resolve(".tepsy/qa");
  mkdirSync(qa, { recursive: true });
  const directory = mkdtempSync(path.join(qa, "tokenx-"));
  t.after(() => {
    assert.ok(directory.startsWith(qa + path.sep));
    rmSync(directory, { recursive: true, force: true });
  });
  const input = fixture();
  return {
    account: { orders: input.orders, restaurant: input.restaurant },
    parsed: input.parsed,
    terminal: input.terminal,
    filename: path.join(directory, "transfers.db"),
    fiscal: input.fiscal,
  };
}

test("TokenX export persists before dispatch, survives restart, reuses the basket and blocks changed overlapping orders", async (t) => {
  const setup = transferFixture(t);
  let sends = 0;
  const provider = {
    identity: "test-provider",
    getFiscal: async () => setup.fiscal,
    sendBasket: async (id, basket) => {
      sends++;
      const inspection = openTransferStore(setup.filename);
      try {
        assert.equal(inspection.readForOrders(["order-1"]).state, "PENDING");
        assert.equal(inspection.readForOrders(["order-1"]).basket.basketID, basket.basketID);
      } finally {
        inspection.close();
      }
    },
  };
  const first = await sendTokenXAccount({ ...setup, provider });
  const retry = await sendTokenXAccount({ ...setup, provider });
  assert.equal(sends, 1);
  assert.equal(first.basketID, retry.basketID);
  assert.equal(retry.isReplay, true);
  setup.account.orders[0].items[0].quantity = 4;
  setup.account.orders[0].totalPrice = "50.00";
  await assert.rejects(
    sendTokenXAccount({ ...setup, provider }),
    (e) => e.code === "terminal-account-changed"
  );
  assert.equal(sends, 1);
});

test("an uncertain TokenX POST is reconciled by GET with the same basket UUID and is never blindly resent", async (t) => {
  const setup = transferFixture(t);
  let sends = 0,
    saved;
  const provider = {
    identity: "test-provider",
    getFiscal: async () => setup.fiscal,
    sendBasket: async (id, basket) => {
      sends++;
      saved = basket;
      throw new Error("timeout");
    },
    getBasket: async (id, basketID) => ({ ...saved, basketID, total: 3750 }),
  };
  await assert.rejects(sendTokenXAccount({ ...setup, provider }), /timeout/);
  await assert.rejects(
    sendTokenXAccount({ ...setup, provider }),
    (e) => e.code === "terminal-transfer-pending"
  );
  assert.equal(sends, 1);
  const db = new DatabaseSync(setup.filename);
  db.prepare("UPDATE Transfer SET createdAt=?").run(Date.now() - 31000);
  db.close();
  const recovered = await sendTokenXAccount({ ...setup, provider });
  assert.equal(recovered.basketID, saved.basketID);
  assert.equal(recovered.isReplay, true);
  assert.equal(sends, 1);
});

test("TokenX configuration stores terminal identifiers and fiscal mappings without accepting credentials", () => {
  const terminal = {
    enabled: true,
    adapter: "TOKENX_CLOUD",
    terminalId: "AV0000000001",
    categorySections: [{ category: "İçecek", sectionNo: 2 }],
  };
  assert.deepEqual(validateDeviceConfig({ paymentTerminal: terminal }).paymentTerminal, terminal);
  assert.throws(() =>
    validateDeviceConfig({ paymentTerminal: { ...terminal, clientSecret: "not-allowed" } })
  );
  assert.throws(() =>
    validateDeviceConfig({
      paymentTerminal: { ...terminal, categorySections: [{ category: "İçecek", sectionNo: -1 }] },
    })
  );
  assert.throws(
    () => assertCardPaymentAllowed({ paymentMethod: "CREDIT_CARD" }, terminal),
    (e) =>
      e.code === "manual-card-confirmation-required" && e.terminalBasketTransferRequired === true
  );
  assert.equal(
    assertCardPaymentAllowed({ paymentMethod: "CREDIT_CARD", manualCardConfirmed: true }, terminal),
    "MANUAL"
  );
});

test("concurrent TokenX checkout attempts reserve only one outgoing basket", async (t) => {
  const setup = transferFixture(t);
  let release, sent;
  const sending = new Promise((resolve) => {
    sent = resolve;
  });
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  let sends = 0;
  const provider = {
    identity: "parallel-provider",
    getFiscal: async () => setup.fiscal,
    sendBasket: async () => {
      sends++;
      sent();
      await wait;
    },
  };
  const first = sendTokenXAccount({ ...setup, provider });
  await sending;
  await assert.rejects(
    sendTokenXAccount({ ...setup, provider }),
    (e) => e.code === "terminal-transfer-pending"
  );
  release();
  await first;
  assert.equal(sends, 1);
});

test("manual card confirmation requires the persisted transferred account to match current server data", async (t) => {
  const setup = transferFixture(t);
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const provider = {
    identity: createTokenXClient({ env }).identity,
    getFiscal: async () => setup.fiscal,
    sendBasket: async () => {},
  };
  const client = {
    order: { findMany: async () => setup.account.orders },
    restaurantConfig: { findFirst: async () => setup.account.restaurant },
  };
  await assert.rejects(
    assertTokenXTransferCurrent(client, setup.parsed, setup.terminal, setup.filename),
    (e) => e.code === "terminal-transfer-required"
  );
  await sendTokenXAccount({ ...setup, provider });
  await assertTokenXTransferCurrent(client, setup.parsed, setup.terminal, setup.filename);
  setup.account.orders[0].items[0].unitPrice = "15.00";
  setup.account.orders[0].totalPrice = "45.00";
  await assert.rejects(
    assertTokenXTransferCurrent(client, setup.parsed, setup.terminal, setup.filename),
    (e) => e.code === "terminal-account-changed"
  );
});
