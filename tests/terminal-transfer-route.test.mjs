import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parsePaymentRequest, PaymentRequestError } from "../src/lib/payment-request.mjs";
import { requireOpenCashShift } from "../src/lib/cash-shift.mjs";
import { allowedRolesForPath } from "../src/lib/security-policy.cjs";
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
  await readFile(new URL("../src/app/api/pos/terminal/route.js", import.meta.url), "utf8")
)
  .replace(/^import[\s\S]*?from "[^"]+";\r?$/gm, "")
  .replace(/export /g, "");
function route({ denied = false, shift = true, enabled = true } = {}) {
  let sends = 0,
    configReads = 0,
    accountReads = 0;
  const dependencies = {
    readRequestJson,
    NextResponse: { json: (data, options = {}) => ({ data, status: options.status || 200 }) },
    authorizePaymentAccess: async () => {
      if (denied) throw new PaymentRequestError(403, "forbidden", "Forbidden");
    },
    prisma: {
      cashShift: {
        findUnique: async () =>
          shift ? { id: "shift", activeKey: "ACTIVE", status: "OPEN" } : null,
      },
      $transaction: (fn) => fn({}),
    },
    parsePaymentRequest,
    PaymentRequestError,
    requireOpenCashShift,
    readDeviceConfig: async () => {
      configReads++;
      return { paymentTerminal: { enabled, adapter: "TOKENX_CLOUD" } };
    },
    getDeviceConfigPath: () => "private/.tepsy/devices.json",
    transferStorePath: () => "private/.tepsy/terminal-transfers.db",
    loadTransferAccount: async () => {
      accountReads++;
      return { orders: [{ id: "server-order" }], restaurant: { currency: "₺" } };
    },
    sendTokenXAccount: async ({ account }) => {
      sends++;
      assert.equal(account.orders[0].id, "server-order");
      return { basketID: "provider-basket", isReplay: false };
    },
  };
  return {
    post: new Function(...Object.keys(dependencies), `${source}\nreturn POST;`)(
      ...Object.values(dependencies)
    ),
    counts: () => ({ sends, configReads, accountReads }),
  };
}
const payment = {
  tableId: "t1",
  paymentMethod: "CREDIT_CARD",
  idempotencyKey: "terminal-route-test",
};
test("terminal transfer is cashier/admin only and checks authorization before reading configuration or sending data", async () => {
  assert.deepEqual(allowedRolesForPath("/api/pos/terminal", "POST"), ["ADMIN", "CASHIER"]);
  const handler = route({ denied: true });
  const result = await handler.post({ json: async () => payment });
  assert.equal(result.status, 403);
  assert.deepEqual(handler.counts(), { sends: 0, configReads: 0, accountReads: 0 });
});
test("terminal transfer uses server account reads without recording a payment or accepting client prices", async () => {
  const handler = route();
  const result = await handler.post({ json: async () => payment });
  assert.equal(result.status, 200);
  assert.equal(result.data.accepted, true);
  assert.equal(result.data.paymentApproved, false);
  const tampered = await handler.post({
    json: async () => ({ ...payment, items: [{ unitPrice: "0.01" }] }),
  });
  assert.equal(tampered.status, 400);
  assert.equal(handler.counts().sends, 1);
});
test("direct selected-item and tipped requests cannot read or send a TokenX basket", async () => {
  const handler = route();
  for (const request of [
    { ...payment, selectedItems: [{ orderItemId: "line-1", quantity: 1 }] },
    { ...payment, tipAmount: "2.50" },
  ]) {
    const result = await handler.post({ json: async () => request });
    assert.equal(result.status, 409);
    assert.equal(result.data.code, "terminal-selection-unsupported");
  }
  assert.deepEqual(handler.counts(), { sends: 0, configReads: 0, accountReads: 0 });
});
test("closed shifts block terminal export and disabled adapters do not send anything", async () => {
  const closed = route({ shift: false });
  assert.equal((await closed.post({ json: async () => payment })).status, 409);
  assert.equal(closed.counts().sends, 0);
  const disabled = route({ enabled: false });
  assert.equal((await disabled.post({ json: async () => payment })).data.skipped, true);
  assert.equal(disabled.counts().sends, 0);
});
