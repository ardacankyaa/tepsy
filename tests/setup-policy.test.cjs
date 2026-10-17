const test = require("node:test");
const assert = require("node:assert/strict");
const { canAccessInitialSetup, canRunSetup } = require("../src/lib/setup-policy.cjs");

test("initial setup is denied outside loopback, even for an empty database", () => {
  const emptyConfig = { isSetupCompleted: false };
  assert.equal(canAccessInitialSetup(emptyConfig, "192.168.1.8"), false);
  assert.equal(canAccessInitialSetup(emptyConfig, "203.0.113.8"), false);
  assert.equal(canAccessInitialSetup(emptyConfig, undefined), false);
  assert.equal(canAccessInitialSetup(emptyConfig, "not-an-ip"), false);
});

test("initial setup accepts IPv4 and IPv6 loopback addresses", () => {
  const emptyConfig = { isSetupCompleted: false };
  assert.equal(canAccessInitialSetup(emptyConfig, "127.0.0.1"), true);
  assert.equal(canAccessInitialSetup(emptyConfig, "127.42.0.1"), true);
  assert.equal(canAccessInitialSetup(emptyConfig, "::1"), true);
  assert.equal(canAccessInitialSetup(emptyConfig, "0:0:0:0:0:0:0:1"), true);
  assert.equal(canAccessInitialSetup(emptyConfig, "::ffff:127.0.0.1"), true);
});

test("completed setup does not use the initial-setup loopback gate", () => {
  assert.equal(canAccessInitialSetup({ isSetupCompleted: true }, "192.168.1.8"), true);
});

test("setup rejects a restaurant with existing business records", () => {
  assert.equal(canRunSetup({ tables: 1, orders: 0, payments: 0, staff: 0, categories: 0 }), false);
  assert.equal(canRunSetup({ tables: 0, orders: 1, payments: 0, staff: 0, categories: 0 }), false);
});

test("setup accepts an empty database even if a config placeholder exists", () => {
  assert.equal(
    canRunSetup({
      tables: 0,
      orders: 0,
      payments: 0,
      staff: 0,
      categories: 0,
      isSetupCompleted: false,
      hasAccessPassword: false,
    }),
    true
  );
});

test("setup cannot erase a configured owner account", () => {
  assert.equal(
    canRunSetup({
      tables: 0,
      orders: 0,
      payments: 0,
      staff: 0,
      categories: 0,
      isSetupCompleted: true,
      hasAccessPassword: true,
    }),
    false
  );
});
