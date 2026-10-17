const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

test("device config can use an isolated path and preserves QR origin when later updates omit it", async () => {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "tepsy-device-store-"));
  const configPath = path.join(tempDirectory, "devices.json");
  const previousPath = process.env.TEPSY_DEVICES_CONFIG_PATH;
  process.env.TEPSY_DEVICES_CONFIG_PATH = configPath;

  try {
    const { getDeviceConfigPath, readDeviceConfig, writeDeviceConfig } =
      await import("../src/lib/devices/config.js");
    assert.equal(getDeviceConfigPath(), configPath);
    await writeDeviceConfig({
      network: { qrBaseUrl: "http://10.69.70.206:3017" },
      receiptPrinter: { adapter: "BROWSER" },
      paymentTerminal: { adapter: "MANUAL" },
    });
    await writeDeviceConfig({
      receiptPrinter: { adapter: "WINDOWS_SPOOLER", printerName: "Test Printer" },
      paymentTerminal: { adapter: "MANUAL" },
    });
    assert.equal((await readDeviceConfig()).network.qrBaseUrl, "http://10.69.70.206:3017");
  } finally {
    if (previousPath === undefined) delete process.env.TEPSY_DEVICES_CONFIG_PATH;
    else process.env.TEPSY_DEVICES_CONFIG_PATH = previousPath;
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
});
