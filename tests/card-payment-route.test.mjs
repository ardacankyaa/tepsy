import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as finance from "../src/lib/finance.mjs";
import * as paymentRequest from "../src/lib/payment-request.mjs";
import * as shifts from "../src/lib/cash-shift.mjs";
import * as idempotency from "../src/lib/payment-idempotency.mjs";
import { assertCardPaymentAllowed } from "../src/lib/card-payment-policy.mjs";

// Exercise the actual route with injected persistence; never open a restaurant DB.
const source = (
  await readFile(new URL("../src/app/api/pos/payment/route.js", import.meta.url), "utf8")
)
  .replace(/^import[\s\S]*?from "[^"]+";\r?$/gm, "")
  .replace(/export /g, "");
function makeRoute(terminal, attempt = null) {
  let writes = 0;
  const rejectWrite = async () => {
    writes++;
    throw new Error("unexpected mutation");
  };
  const tx = {
    paymentAttempt: { findUnique: async () => attempt, create: rejectWrite },
    payment: { create: rejectWrite },
    order: { updateMany: rejectWrite },
    table: { updateMany: rejectWrite },
    cashShift: { findUnique: rejectWrite },
  };
  const deps = {
    ...finance,
    ...paymentRequest,
    ...shifts,
    ...idempotency,
    assertCardPaymentAllowed,
    getDeviceConfigPath: () => "private/.tepsy/devices.json",
    transferStorePath: () => "private/.tepsy/terminal-transfers.db",
    assertTokenXTransferCurrent: async () => {
      throw new paymentRequest.PaymentRequestError(
        409,
        "terminal-account-changed",
        "Changed account"
      );
    },
    authorizePaymentAccess: async () => null,
    prisma: { $transaction: (fn) => fn(tx) },
    readDeviceConfig: async () => ({ paymentTerminal: terminal }),
    NextResponse: { json: (body, options) => ({ body, status: options.status }) },
    global: {},
  };
  return {
    post: new Function(...Object.keys(deps), `${source}\nreturn POST;`)(...Object.values(deps)),
    writes: () => writes,
  };
}
const body = { tableId: "t1", paymentMethod: "CREDIT_CARD", idempotencyKey: "card-route-123" };
test("card route rejects missing manual confirmation before any payment writes", async () => {
  const route = makeRoute({ enabled: false, adapter: "MANUAL" });
  const result = await route.post({ json: async () => body });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "manual-card-confirmation-required");
  assert.equal(route.writes(), 0);
});
test("card route refuses integrated payments even with a manual-confirmation bypass", async () => {
  const route = makeRoute({ enabled: true, adapter: "NEXO_LOCAL" });
  const result = await route.post({ json: async () => ({ ...body, manualCardConfirmed: true }) });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "terminal-payment-unavailable");
  assert.equal(route.writes(), 0);
});
test("completed payment replay stays idempotent after device configuration changes", async () => {
  const saved = { success: true, amountPaid: "12.00", orders: [], cardVerification: "MANUAL" };
  const route = makeRoute(
    { enabled: true, adapter: "NEXO_LOCAL" },
    {
      requestFingerprint: paymentRequest.parsePaymentRequest(body).requestFingerprint,
      responseJson: JSON.stringify(saved),
    }
  );
  const result = await route.post({ json: async () => body });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, saved);
  assert.equal(route.writes(), 0);
});

test("TokenX requests export before confirmation and refuses a stale export before payment writes", async () => {
  const route = makeRoute({ enabled: true, adapter: "TOKENX_CLOUD" });
  const challenge = await route.post({ json: async () => body });
  assert.equal(challenge.status, 409);
  assert.equal(challenge.body.terminalBasketTransferRequired, true);
  const stale = await route.post({ json: async () => ({ ...body, manualCardConfirmed: true }) });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "terminal-account-changed");
  assert.equal(route.writes(), 0);
});
