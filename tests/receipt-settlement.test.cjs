const test = require("node:test");
const assert = require("node:assert/strict");

test("narrow thermal receipts preserve every monetary digit and the configured currency", async () => {
  const { buildReceiptEscPos } = await import("../src/lib/devices/receipt.js");
  const { validateReceipt } = await import("../src/lib/devices/validation.js");
  const receipt = validateReceipt({
    restaurantName: "Cafe",
    currency: "€",
    items: [{ name: "Meal", quantity: 1, unitPrice: 1234567.89 }],
    totalAmount: 1234567.89,
  });
  const printed = buildReceiptEscPos(receipt, { charsPerLine: 24 }).toString("latin1");
  assert.equal(printed.match(/1234567\.89 EUR/g)?.length, 2);
  assert.ok(!printed.includes(" TL"));
  assert.ok(printed.split("\n").every((line, index) => index === 0 || line.length <= 24));
});

test("partial-payment receipt shows paid and remaining amounts separately", async () => {
  const { buildReceiptEscPos } = await import("../src/lib/devices/receipt.js");
  const data = {
    restaurantName: "Cafe",
    tableNumber: "1",
    section: "Salon",
    orderId: "order-1",
    paymentMethod: "CASH",
    timestamp: new Date("2026-09-24T10:00:00Z"),
    items: [{ name: "Tea", quantity: 2, unitPrice: 10 }],
    grossTotal: 20,
    discountAmount: 2,
    netTotal: 18,
    amountPaid: 5,
    remainingBalance: 13,
    totalAmount: 5,
  };
  const printed = buildReceiptEscPos(data).toString("latin1");
  assert.match(printed, /ODENEN\s+5\.00 TL/);
  assert.match(printed, /KALAN\s+13\.00 TL/);
});

test("separate installment thermal receipt retains its identifier, original timestamp and amount on narrow paper", async () => {
  const { buildReceiptEscPos } = await import("../src/lib/devices/receipt.js");
  const { validateReceipt } = await import("../src/lib/devices/validation.js");
  const receipt = validateReceipt({
    receiptNumber: "TPS-CM123456789012345678901234",
    currency: "€",
    timestamp: "2026-10-10T10:00:00Z",
    restaurantName: "Cafe",
    paymentMethod: "CREDIT_CARD",
    items: [],
    grossTotal: 100,
    discountAmount: 0,
    netTotal: 100,
    amountPaid: 33.33,
    totalPaid: 66.66,
    remainingBalance: 33.34,
    totalAmount: 33.33,
  });
  const printed = buildReceiptEscPos(receipt, { charsPerLine: 24 }).toString("latin1");
  assert.match(printed, /ODENEN\s+33\.33 EUR/);
  assert.match(printed, /TOPLAM TAHSIL\s+66\.66 EUR/);
  assert.match(printed, /KALAN\s+33\.34 EUR/);
  assert.match(printed, /KART/);
  assert.equal(printed.replaceAll(/\s/g, "").includes("TPS-CM123456789012345678901234"), true);
  assert.equal(receipt.timestamp.toISOString(), "2026-10-10T10:00:00.000Z");
});

test("thermal receipts feed three blank lines before cutting and wrap complete product names", async () => {
  const { buildReceiptEscPos } = await import("../src/lib/devices/receipt.js");
  const name = "Very long product with extras and allergy information";
  const bytes = buildReceiptEscPos(
    { items: [{ name, quantity: 1, unitPrice: 12.5 }], totalAmount: 12.5 },
    { charsPerLine: 24, cutPaper: true }
  );
  const text = bytes.subarray(6, -3).toString("latin1");
  assert.ok(text.endsWith("\n\n\n\n"), "cutter needs feed after footer");
  assert.ok(
    text.replaceAll(/\s/g, "").includes(name.replaceAll(/\s/g, "")),
    "product identity must not be truncated"
  );
  assert.deepEqual([...bytes.subarray(-3)], [0x1d, 0x56, 0x01]);
});
test("unpaid account printout has no cash or card payment claim", async () => {
  const { buildReceiptEscPos } = await import("../src/lib/devices/receipt.js");
  const { validateReceipt } = await import("../src/lib/devices/validation.js");
  const bytes = buildReceiptEscPos(
    validateReceipt({ kind: "BILL", items: [], totalAmount: 100, paymentMethod: "CASH" })
  );
  const text = bytes.toString("latin1");
  assert.ok(text.includes("HESAP DOKUMU"));
  assert.ok(!text.includes("NAKIT"));
});
