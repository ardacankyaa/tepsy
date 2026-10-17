const test = require("node:test");
const assert = require("node:assert/strict");
const {
  allowedRolesForPath,
  canBootstrapPasswordChange,
  canChangeOwnerPassword,
  currentStaffSession,
  requiresLocalBootstrap,
  disconnectStaffSockets,
  disconnectAllSockets,
  scheduleSessionExpiryDisconnect,
  decodeCookieValue,
} = require("../src/lib/security-policy.cjs");

test("malformed percent escapes in session cookies are treated as absent values", () => {
  assert.equal(decodeCookieValue("%"), "");
  assert.equal(decodeCookieValue("%E0%A4%A"), "");
  assert.equal(decodeCookieValue("signed%2Etoken"), "signed.token");
});

test("only cashier and administrator can send a payment mutation", () => {
  assert.deepEqual(allowedRolesForPath("/api/pos/payment", "POST"), ["ADMIN", "CASHIER"]);
  assert.deepEqual(allowedRolesForPath("/api/pos/shift", "POST"), ["ADMIN", "CASHIER"]);
  assert.deepEqual(allowedRolesForPath("/api/pos/shift", "PATCH"), ["ADMIN", "CASHIER"]);
  assert.deepEqual(allowedRolesForPath("/admin/reports", "GET"), ["ADMIN", "CASHIER"]);
});

test("QR review is limited to waiter and administrator", () => {
  assert.deepEqual(allowedRolesForPath("/api/qr-requests", "PATCH"), ["ADMIN", "WAITER"]);
  assert.deepEqual(allowedRolesForPath("/api/service-requests", "PATCH"), ["ADMIN", "WAITER"]);
});

test("kitchen staff cannot mutate tables while cashier can reach line-item API", () => {
  assert.equal(allowedRolesForPath("/api/tables", "PUT").includes("KITCHEN"), false);
  assert.equal(allowedRolesForPath("/api/orders/abc", "PATCH").includes("CASHIER"), true);
  assert.equal(allowedRolesForPath("/api/orders", "POST").includes("CASHIER"), true);
});

test("only administrators can change per-section floor plan canvas dimensions", () => {
  assert.deepEqual(allowedRolesForPath("/api/floor-plan/canvas", "PUT"), ["ADMIN"]);
  assert.equal(allowedRolesForPath("/api/floor-plan/canvas", "GET").includes("WAITER"), true);
  assert.equal(allowedRolesForPath("/api/floor-plan/canvas", "HEAD").includes("WAITER"), true);
});

test("disabled or reassigned staff lose their signed session immediately", async () => {
  const signed = { userId: "user-1", role: "WAITER", expiresAt: Date.now() + 60000 };
  assert.equal(
    await currentStaffSession(signed, async () => ({
      id: "user-1",
      role: "WAITER",
      isActive: false,
    })),
    null
  );
  assert.equal(
    await currentStaffSession(signed, async () => ({
      id: "user-1",
      role: "ADMIN",
      isActive: true,
    })),
    null
  );
});

test("active staff keep the role recorded in the database", async () => {
  const signed = { userId: "user-1", role: "WAITER", expiresAt: Date.now() + 60000 };
  assert.equal(
    (
      await currentStaffSession(signed, async () => ({
        id: "user-1",
        role: "WAITER",
        isActive: true,
      }))
    ).role,
    "WAITER"
  );
});

test("a staff PIN or profile change invalidates older signed sessions", async () => {
  const issuedAt = Date.now() - 1000;
  const signed = { userId: "user-1", role: "WAITER", issuedAt, expiresAt: Date.now() + 60000 };
  assert.equal(
    await currentStaffSession(signed, async () => ({
      id: "user-1",
      role: "WAITER",
      isActive: true,
      updatedAt: new Date(),
    })),
    null
  );
});

test("signed owner session remains usable without a staff row when its credential version matches", async () => {
  const signed = {
    userId: "owner",
    role: "ADMIN",
    credentialVersion: "current",
    expiresAt: Date.now() + 60000,
  };
  assert.equal((await currentStaffSession(signed, async () => null, "current")).role, "ADMIN");
});

test("a password change invalidates an older owner session", async () => {
  const signed = {
    userId: "owner",
    role: "ADMIN",
    credentialVersion: "before-change",
    expiresAt: Date.now() + 60000,
  };
  assert.equal(await currentStaffSession(signed, async () => null, "after-change"), null);
  assert.equal(
    await currentStaffSession(
      { ...signed, credentialVersion: undefined },
      async () => null,
      "after-change"
    ),
    null
  );
});

test("an existing owner password remains required when login protection is disabled", () => {
  assert.equal(typeof canBootstrapPasswordChange, "function");
  assert.equal(canBootstrapPasswordChange({ authEnabled: false, accessPasswordHash: null }), true);
  assert.equal(
    canBootstrapPasswordChange({ authEnabled: false, accessPasswordHash: "stored-hash" }),
    false
  );
});

test("an admin staff session cannot change the owner password without its current password", () => {
  assert.equal(typeof canChangeOwnerPassword, "function");
  assert.equal(
    canChangeOwnerPassword({
      canBootstrap: false,
      session: { userId: "staff-1", role: "ADMIN" },
      knowsCurrent: false,
    }),
    false
  );
  assert.equal(
    canChangeOwnerPassword({
      canBootstrap: false,
      session: { userId: "owner", role: "ADMIN" },
      knowsCurrent: false,
    }),
    false
  );
  assert.equal(
    canChangeOwnerPassword({
      canBootstrap: false,
      session: { userId: "staff-1", role: "ADMIN" },
      knowsCurrent: true,
    }),
    true
  );
  assert.equal(
    canChangeOwnerPassword({
      canBootstrap: false,
      session: { userId: "owner", role: "ADMIN" },
      knowsCurrent: true,
    }),
    true
  );
  assert.equal(
    canChangeOwnerPassword({ canBootstrap: true, session: null, knowsCurrent: false }),
    true
  );
});

test("unprotected configured restaurant cannot expose staff APIs to LAN clients", () => {
  const config = { isSetupCompleted: true, authEnabled: false, accessPasswordHash: null };
  assert.equal(requiresLocalBootstrap(config, "192.168.1.8"), true);
  assert.equal(requiresLocalBootstrap(config, "127.0.0.1"), false);
});

test("incomplete or missing setup remains local-only until authentication is configured", () => {
  const incompleteConfig = {
    isSetupCompleted: false,
    authEnabled: false,
    accessPasswordHash: null,
  };
  assert.equal(requiresLocalBootstrap(incompleteConfig, "192.168.1.8"), true);
  assert.equal(requiresLocalBootstrap(null, "192.168.1.8"), true);
  assert.equal(requiresLocalBootstrap(incompleteConfig, "127.0.0.1"), false);
  assert.equal(
    requiresLocalBootstrap(
      { ...incompleteConfig, authEnabled: true, accessPasswordHash: "scrypt-hash" },
      "192.168.1.8"
    ),
    false
  );
});

test("authenticated sockets disconnect when their session expires and clear the timer on early disconnect", () => {
  let scheduled;
  let disconnected = false;
  let disconnectListener;
  let cleared;
  let timerUnrefed = false;
  let clock = 10_000;
  const socket = {
    data: { session: { expiresAt: 10_100 } },
    once(event, listener) {
      assert.equal(event, "disconnect");
      disconnectListener = listener;
    },
    disconnect(force) {
      disconnected = force;
    },
  };

  scheduleSessionExpiryDisconnect(socket, {
    now: () => clock,
    setTimer(callback, delay) {
      scheduled = {
        callback,
        delay,
        unref() {
          timerUnrefed = true;
        },
      };
      return scheduled;
    },
    clearTimer(timer) {
      cleared = timer;
    },
  });

  assert.equal(scheduled.delay, 100);
  assert.equal(timerUnrefed, true);
  clock = 10_100;
  scheduled.callback();
  assert.equal(disconnected, true);
  disconnectListener();
  assert.equal(cleared, scheduled);
});

test("staff access changes disconnect old sockets", () => {
  const disconnected = [];
  const socket = (userId) => ({
    data: { session: { userId } },
    disconnect: () => disconnected.push(userId),
  });
  disconnectStaffSockets(
    {
      sockets: {
        sockets: new Map([
          ["a", socket("u1")],
          ["b", socket("u2")],
        ]),
      },
    },
    "u1"
  );
  assert.deepEqual(disconnected, ["u1"]);
});

test("switching authentication disconnects every existing socket", () => {
  let disconnected = false;
  disconnectAllSockets({
    disconnectSockets: (force) => {
      disconnected = force;
    },
  });
  assert.equal(disconnected, true);
});

test("remembered socket expiry uses bounded timers without early disconnect and cleans up the active timer", () => {
  const duration = 30 * 24 * 60 * 60 * 1000;
  let clock = 0,
    disconnected = false,
    disconnectListener,
    cleared;
  const scheduled = [];
  const socket = {
    data: { session: { expiresAt: duration } },
    once(event, fn) {
      disconnectListener = fn;
    },
    disconnect() {
      disconnected = true;
    },
  };
  scheduleSessionExpiryDisconnect(socket, {
    now: () => clock,
    setTimer(callback, delay) {
      const timer = { callback, delay, unref() {} };
      scheduled.push(timer);
      return timer;
    },
    clearTimer(timer) {
      cleared = timer;
    },
  });
  assert.equal(scheduled[0].delay, 2_147_483_647);
  clock = scheduled[0].delay;
  scheduled[0].callback();
  assert.equal(disconnected, false);
  assert.equal(scheduled[1].delay, duration - clock);
  disconnectListener();
  assert.equal(cleared, scheduled[1]);
  clock = duration;
  scheduled[1].callback();
  assert.equal(disconnected, false, "cleared callback cannot disconnect a closed socket");
});
