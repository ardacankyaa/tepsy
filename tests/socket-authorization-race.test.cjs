const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const security = require("../src/lib/security-policy.cjs");

function harness({ bootstrap = false, lookup } = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
  const handlers = {};
  const signed = {
    userId: "staff-1",
    role: "WAITER",
    issuedAt: 1000,
    expiresAt: Date.now() + 60000,
  };
  const dependencies = {
    io: {
      use(fn) {
        handlers.handshake = fn;
      },
      on(event, fn) {
        handlers[event] = fn;
      },
    },
    getAuthConfig: async () => ({
      authEnabled: !bootstrap,
      accessPasswordHash: bootstrap ? null : "hash",
    }),
    requiresLocalBootstrap: () => false,
    readCookie: () => "signed-cookie",
    cookieNames: { current: "tepsy_session", legacy: "restopos_session" },
    verifyLocalSession: () => signed,
    currentStaffSession: security.currentStaffSession,
    prisma: {
      staffUser: {
        findUnique:
          lookup ||
          (async () => ({ id: "staff-1", role: "WAITER", isActive: true, updatedAt: new Date(0) })),
      },
    },
    credentialSessionVersion: () => "owner-version",
    sessionTokenKey: () => "cookie-key",
    scheduleSessionExpiryDisconnect: () => {},
    getSocketAuthorizationRevision: () => security.getSocketAuthorizationRevision?.() || 0,
  };
  const start = source.indexOf("  io.use(async (socket, next) => {");
  const end = source.indexOf('  server.on("error",', start);
  assert.ok(start >= 0 && end > start);
  new Function(...Object.keys(dependencies), source.slice(start, end))(
    ...Object.values(dependencies)
  );
  const socket = {
    data: {},
    handshake: { address: "127.0.0.1", headers: {} },
    joined: [],
    disconnected: false,
    join(room) {
      this.joined.push(room);
    },
    disconnect() {
      this.disconnected = true;
    },
  };
  async function authenticate() {
    let error;
    await handlers.handshake(socket, (value) => {
      error = value;
    });
    return error;
  }
  return { handlers, socket, authenticate };
}

test("staff access changes during an asynchronous handshake reject its stale lookup", async () => {
  let resolveLookup, lookupStarted;
  const started = new Promise((resolve) => {
    lookupStarted = resolve;
  });
  const pending = new Promise((resolve) => {
    resolveLookup = resolve;
  });
  const { authenticate } = harness({
    lookup: () => {
      lookupStarted();
      return pending;
    },
  });
  const authenticating = authenticate();
  await started;
  security.disconnectStaffSockets(undefined, "staff-1");
  resolveLookup({ id: "staff-1", role: "WAITER", isActive: true, updatedAt: new Date(0) });
  const error = await authenticating;
  assert.equal(error?.message, "unauthorized");
});

test("staff disable, PIN changes and deletion also reject a handshake awaiting registration", async () => {
  const { handlers, socket, authenticate } = harness();
  assert.equal(await authenticate(), undefined);
  security.disconnectStaffSockets(undefined, "staff-1");
  handlers.connection(socket);
  assert.equal(socket.disconnected, true);
  assert.deepEqual(socket.joined, []);
});

test("owner password or auth changes reject pending staff and unauthenticated bootstrap sockets", async () => {
  for (const bootstrap of [false, true]) {
    const { handlers, socket, authenticate } = harness({ bootstrap });
    assert.equal(await authenticate(), undefined);
    security.disconnectAllSockets(undefined);
    handlers.connection(socket);
    assert.equal(socket.disconnected, true);
    assert.deepEqual(socket.joined, []);
  }
});

test("unchanged authorization keeps valid pending staff connections usable", async () => {
  const { handlers, socket, authenticate } = harness();
  assert.equal(await authenticate(), undefined);
  handlers.connection(socket);
  assert.equal(socket.disconnected, false);
  assert.deepEqual(socket.joined, ["role:WAITER"]);
});

test("independent API and host module copies share pending-handshake invalidation", () => {
  const moduleCopy = { exports: {} };
  const file = path.resolve(__dirname, "../src/lib/security-policy.cjs");
  const source = fs.readFileSync(file, "utf8");
  const moduleRequire = require("node:module").createRequire(file);
  new Function("module", "exports", "require", source)(
    moduleCopy,
    moduleCopy.exports,
    moduleRequire
  );
  const before = security.getSocketAuthorizationRevision();
  moduleCopy.exports.disconnectStaffSockets(undefined, "staff-1");
  assert.equal(security.getSocketAuthorizationRevision(), before + 1);
  security.disconnectAllSockets(undefined);
  assert.equal(moduleCopy.exports.getSocketAuthorizationRevision(), before + 2);
});
