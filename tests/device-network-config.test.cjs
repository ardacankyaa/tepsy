const test = require("node:test");
const assert = require("node:assert/strict");

test("device config persists a normalized QR origin alongside printer and terminal settings", async () => {
  const { validateDeviceConfig } = await import("../src/lib/devices/validation.js");
  const config = validateDeviceConfig({
    network: { qrBaseUrl: "http://10.69.70.206:3017/" },
    receiptPrinter: { adapter: "BROWSER" },
    paymentTerminal: { adapter: "MANUAL" },
  });
  assert.equal(config.network.qrBaseUrl, "http://10.69.70.206:3017");
});

test("QR origin rejects credentials, loopback hosts, paths and non-web protocols", async () => {
  const { validateDeviceConfig } = await import("../src/lib/devices/validation.js");
  const invalidUrls = [
    "javascript:alert(1)",
    "http://user:secret@10.69.70.206:3017",
    "http://localhost:3017",
    "http://127.0.0.1:3017",
    "http://[::1]:3017",
    "http://[::ffff:127.0.0.1]:3017",
    "http://[::]:3017",
    "http://0.0.0.0:3017",
    "http://pos.localhost:3017",
    "http://10.69.70.206:3017/menu",
    "http://10.69.70.206:3017?table=1",
  ];
  for (const qrBaseUrl of invalidUrls) {
    assert.throws(() => validateDeviceConfig({ network: { qrBaseUrl } }), undefined, qrBaseUrl);
  }
});

test("validated device config retains its QR origin when other device settings are updated", async () => {
  const { preserveNetworkSettings, validateDeviceConfig } =
    await import("../src/lib/devices/validation.js");
  const current = validateDeviceConfig({ network: { qrBaseUrl: "https://pos.cafe.example" } });
  const nextInput = preserveNetworkSettings(
    {
      receiptPrinter: { adapter: "BROWSER" },
      paymentTerminal: { adapter: "MANUAL" },
    },
    current
  );
  const next = validateDeviceConfig(nextInput);
  assert.equal(next.network.qrBaseUrl, "https://pos.cafe.example");
});

test("printer width validates explicit invalid values instead of silently resetting to 42", async () => {
  const { validateDeviceConfig } = await import("../src/lib/devices/validation.js");
  for (const charsPerLine of [0, "", 23, 65, 32.5])
    assert.throws(() =>
      validateDeviceConfig({ receiptPrinter: { adapter: "BROWSER", charsPerLine } })
    );
  assert.equal(
    validateDeviceConfig({ receiptPrinter: { adapter: "BROWSER", charsPerLine: 32 } })
      .receiptPrinter.charsPerLine,
    32
  );
});
