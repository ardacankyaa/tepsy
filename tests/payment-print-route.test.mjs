import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readPaymentReceipt } from "../src/lib/payment-receipts.mjs";
import { PaymentRequestError } from "../src/lib/payment-request.mjs";
import { validateReceipt } from "../src/lib/devices/validation.js";
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
  await readFile(new URL("../src/app/api/print/receipt/route.js", import.meta.url), "utf8")
)
  .replace(/^import[\s\S]*?from "[^"]+";\r?$/gm, "")
  .replace(/export /g, "");

test("payment receipt printing uses immutable database amounts and currency even if client tampers with payload", async () => {
  const snapshot = {
    id: "p1",
    receiptNumber: "TPS-P1",
    snapshotKind: "PAYMENT_SNAPSHOT",
    restaurantName: "Original cafe",
    currency: "€",
    tableNumber: "12",
    section: "Garden",
    timestamp: "2026-10-10T10:00:00Z",
    grossTotal: "100.00",
    discountAmount: "0.00",
    netTotal: "100.00",
    amountPaid: "25.00",
    totalPaid: "25.00",
    remainingBalance: "75.00",
    totalAmount: "25.00",
    paymentMethod: "CASH",
    items: [{ name: "Original Tea", quantity: 5, unitPrice: "20.00" }],
  };
  let printed;
  const deps = {
    readRequestJson,
    NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) },
    prisma: {
      payment: { findUnique: async () => ({ id: "p1", idempotencyKey: "attempt" }) },
      paymentAttempt: {
        findUnique: async () => ({ responseJson: JSON.stringify({ receipt: snapshot }) }),
      },
      restaurantConfig: {
        findFirst: async () => {
          throw new Error("New restaurant settings must not replace receipt snapshot");
        },
      },
    },
    authorizePaymentAccess: async () => null,
    readPaymentReceipt,
    PaymentRequestError,
    validateReceipt,
    readDeviceConfig: async () => ({ receiptPrinter: { adapter: "BROWSER" } }),
    printReceipt: async (receipt) => {
      printed = receipt;
      return { accepted: true };
    },
    deviceErrorResponse: () => {
      throw new Error("Unexpected printer error");
    },
  };
  const post = new Function(...Object.keys(deps), `${source}\nreturn POST;`)(
    ...Object.values(deps)
  );
  const result = await post({
    json: async () => ({
      paymentId: "p1",
      restaurantName: "Forged cafe",
      currency: "$",
      amountPaid: "999.00",
      items: [{ name: "Forged Item" }],
    }),
  });
  assert.equal(result.status, 200);
  assert.equal(printed.amountPaid, 25);
  assert.equal(printed.currency, "€");
  assert.equal(printed.restaurantName, "Original cafe");
  assert.equal(printed.items[0].name, "Original Tea");
  assert.equal(printed.receiptNumber, "TPS-P1");
});
