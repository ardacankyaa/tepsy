const test = require("node:test");
const assert = require("node:assert/strict");

let selectLocalIPv4;
try {
  ({ selectLocalIPv4 } = require("../src/lib/network-address.cjs"));
} catch {
  // Keep the pre-implementation failure as an assertion about the missing behavior.
}

test("QR base address prefers a physical private IPv4 over virtual adapters", () => {
  assert.equal(typeof selectLocalIPv4, "function", "a LAN IPv4 selector is required");
  const interfaces = {
    "vEthernet (Default Switch)": [{ address: "172.25.0.1", family: "IPv4", internal: false }],
    "Loopback Pseudo-Interface 1": [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    Ethernet: [{ address: "10.69.70.206", family: "IPv4", internal: false }],
    "Wi-Fi": [{ address: "192.168.1.40", family: "IPv4", internal: false }],
  };
  assert.equal(selectLocalIPv4(interfaces), "10.69.70.206");
});

test("QR base address falls back to localhost when there is no private IPv4", () => {
  assert.equal(typeof selectLocalIPv4, "function", "a LAN IPv4 selector is required");
  assert.equal(
    selectLocalIPv4({ Ethernet: [{ address: "169.254.5.8", family: "IPv4", internal: false }] }),
    "localhost"
  );
});
