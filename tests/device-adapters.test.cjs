const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const fs = require("node:fs/promises");
const os = require("node:os");

test("TCP receipt adapter sends exact ESC/POS bytes and rejects a closed port", async () => {
  const { printReceipt } = await import("../src/lib/devices/printers.js");
  const { buildReceiptEscPos } = await import("../src/lib/devices/receipt.js");
  const chunks = [];
  let completed;
  const received = new Promise((resolve) => {
    completed = resolve;
  });
  const server = net.createServer((socket) => {
    socket.on("data", (bytes) => chunks.push(bytes));
    socket.on("end", () => completed(Buffer.concat(chunks)));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const receipt = {
    kind: "PAYMENT",
    items: [{ name: "Tea", quantity: 2, unitPrice: 10 }],
    totalAmount: 20,
  };
  const config = {
    enabled: true,
    adapter: "TCP_ESC_POS",
    host: "127.0.0.1",
    port,
    charsPerLine: 32,
    cutPaper: true,
  };
  try {
    const result = await printReceipt(receipt, config);
    assert.equal(result.accepted, true);
    assert.deepEqual(await received, buildReceiptEscPos(receipt, config));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  await assert.rejects(printReceipt(receipt, config), (e) => e.code === "ECONNREFUSED");
});

test("disabled and browser-only server printers never report a successful send", async () => {
  const { printReceipt } = await import("../src/lib/devices/printers.js");
  for (const [config, code] of [
    [{ enabled: false }, "PRINTER_DISABLED"],
    [{ enabled: true, adapter: "BROWSER" }, "BROWSER_FALLBACK_REQUIRED"],
  ]) {
    await assert.rejects(printReceipt({ items: [] }, config), (e) => e.code === code);
  }
});

test("reachable NEXO port is not a bank payment approval and refusal does not enable payments", async () => {
  const { getPaymentTerminalStatus, requestTerminalPayment } =
    await import("../src/lib/devices/payments.js");
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const config = {
    enabled: true,
    adapter: "NEXO_LOCAL",
    host: "127.0.0.1",
    port: server.address().port,
  };
  try {
    const status = await getPaymentTerminalStatus(config);
    assert.equal(status.connected, true);
    assert.equal(status.implemented, false);
    assert.equal(status.canInitiatePayment, false);
    await assert.rejects(
      requestTerminalPayment(config, { amount: 10 }),
      (e) => e.code === "ADAPTER_NOT_IMPLEMENTED"
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  const status = await getPaymentTerminalStatus(config);
  assert.equal(status.connected, false);
  assert.equal(status.canInitiatePayment, false);
  const manual = await getPaymentTerminalStatus({ adapter: "MANUAL" });
  assert.equal(manual.canInitiatePayment, false);
  await assert.rejects(
    requestTerminalPayment({ adapter: "MANUAL" }, {}),
    (e) => e.code === "MANUAL_CONFIRMATION_REQUIRED"
  );
});

test(
  "Windows RAW spooler compiles and rejects a missing queue without leaving receipt files",
  { skip: process.platform !== "win32" },
  async () => {
    const { printReceipt } = await import("../src/lib/devices/printers.js");
    const prefix = "tepsy-" + process.pid + "-";
    const before = (await fs.readdir(os.tmpdir())).filter((name) => name.startsWith(prefix));
    await assert.rejects(
      printReceipt(
        { items: [], totalAmount: 1 },
        {
          enabled: true,
          adapter: "WINDOWS_SPOOLER",
          printerName: "TEPSY-Nonexistent-QA-Queue-" + process.pid,
        }
      ),
      (e) => e.code === "SPOOLER_REJECTED" && e.win32Code === 1801
    );
    const after = (await fs.readdir(os.tmpdir())).filter((name) => name.startsWith(prefix));
    assert.deepEqual(after, before);
  }
);

test("Turkish receipt bytes use CP857 without replacing supported letters", async () => {
  const { buildReceiptEscPos } = await import("../src/lib/devices/receipt.js");
  const payload = buildReceiptEscPos({
    items: [{ name: "ÇüçıİÖÜŞşöĞğ", quantity: 1, unitPrice: 1 }],
    totalAmount: 1,
  });
  assert.ok(
    payload.includes(
      Buffer.from([0x80, 0x81, 0x87, 0x8d, 0x98, 0x99, 0x9a, 0x9e, 0x9f, 0x94, 0xa6, 0xa7])
    )
  );
});
