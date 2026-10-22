const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const recovery = require("../src/lib/owner-recovery.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tepsy-recovery-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test("recovery codes are private, expire and require the current owner credential", async (t) => {
  const root = fixture(t);
  const issued = recovery.issueRecoveryCode({ root, passwordHash: "old", now: 1000 });
  const stored = fs.readFileSync(path.join(root, ".tepsy", "owner-recovery.json"), "utf8");
  assert.equal(stored.includes(issued.code), false);
  for (const [code, passwordHash, now] of [
    ["wrong", "old", 1001],
    [issued.code, "changed", 1001],
    [issued.code, "old", issued.expiresAt],
  ]) {
    assert.equal(
      await recovery.consumeRecoveryCode({
        root,
        code,
        passwordHash,
        now,
        update: async () => {
          throw new Error("must not update");
        },
      }),
      false
    );
  }
  assert.equal(
    await recovery.consumeRecoveryCode({
      root,
      code: issued.code,
      passwordHash: "old",
      now: 1001,
      update: async () => true,
    }),
    true
  );
  assert.equal(
    await recovery.consumeRecoveryCode({
      root,
      code: issued.code,
      passwordHash: "old",
      now: 1001,
      update: async () => true,
    }),
    false
  );
});
test("concurrent redemption updates once and failed CAS cannot be replayed", async (t) => {
  const root = fixture(t);
  const issued = recovery.issueRecoveryCode({ root, passwordHash: "old" });
  let writes = 0;
  const options = {
    root,
    code: issued.code,
    passwordHash: "old",
    update: async () => {
      writes++;
      await new Promise((resolve) => setImmediate(resolve));
      return true;
    },
  };
  assert.deepEqual(
    (
      await Promise.all([
        recovery.consumeRecoveryCode(options),
        recovery.consumeRecoveryCode(options),
      ])
    ).sort(),
    [false, true]
  );
  assert.equal(writes, 1);
  const next = recovery.issueRecoveryCode({ root, passwordHash: "old" });
  assert.equal(
    await recovery.consumeRecoveryCode({ ...options, code: next.code, update: async () => false }),
    false
  );
  assert.equal(await recovery.consumeRecoveryCode({ ...options, code: next.code }), false);
});
test("legacy recovery state remains compatible", async (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, ".restopos"));
  fs.writeFileSync(path.join(root, ".restopos", "owner-recovery.json"), "{}");
  const issued = recovery.issueRecoveryCode({ root, passwordHash: "old" });
  assert.equal(fs.existsSync(path.join(root, ".tepsy", "owner-recovery.json")), false);
  assert.equal(
    await recovery.consumeRecoveryCode({
      root,
      code: issued.code,
      passwordHash: "old",
      update: async () => true,
    }),
    true
  );
});
test("a challenge replaced between checking and claiming cannot reset the password", async (t) => {
  const root = fixture(t);
  const issued = recovery.issueRecoveryCode({ root, passwordHash: "old" });
  const originalRename = fs.renameSync;
  let intercepted = false;
  fs.renameSync = (source, target) => {
    if (!intercepted && target.endsWith(".claimed")) {
      intercepted = true;
      fs.writeFileSync(
        source,
        JSON.stringify({
          version: 1,
          expiresAt: Date.now() + 600000,
          codeHash: "0".repeat(64),
          credentialVersion: "unrelated",
        })
      );
    }
    return originalRename(source, target);
  };
  try {
    assert.equal(
      await recovery.consumeRecoveryCode({
        root,
        code: issued.code,
        passwordHash: "old",
        update: async () => {
          throw new Error("must not update");
        },
      }),
      false
    );
  } finally {
    fs.renameSync = originalRename;
  }
});
test("CLI resolves the selected installation's private environment and refuses relative targets", (t) => {
  const { recoveryInstallation, recoveryRuntime } = require("../scripts/owner-recovery.cjs");
  const root = fixture(t);
  fs.writeFileSync(path.join(root, ".env"), 'RESTOPOS_DATABASE_URL="file:./custom.sqlite"\n');
  assert.equal(
    recoveryRuntime(root, { TEPSY_DATABASE_URL: "file:./wrong.db" }).databasePath,
    path.join(root, "prisma", "custom.sqlite")
  );
  assert.equal(recoveryInstallation(["--installation", root]), root);
  assert.throws(() => recoveryInstallation(["--installation", "relative"]));
  assert.equal(
    recoveryInstallation([], root, { TEPSY_LOCAL_DATA_HOME: path.join(root, "private") }),
    path.join(root, "private", "app")
  );
  fs.writeFileSync(path.join(root, ".managed-install.json"), "{}");
  assert.equal(
    recoveryInstallation([], root, { TEPSY_LOCAL_DATA_HOME: path.join(root, "private") }),
    root
  );
});
test("recovery requires the actual loopback peer, and its independent shared quota is bounded", () => {
  const request = (peer) => ({
    headers: new Headers({
      "x-tepsy-client-ip": peer,
      "x-forwarded-for": "127.0.0.1",
      origin: "http://localhost:3000",
    }),
  });
  assert.equal(recovery.isLocalRecoveryRequest(request("198.51.100.4")), false);
  assert.equal(recovery.isLocalRecoveryRequest(request("::ffff:127.0.0.1")), true);
  assert.equal(
    recovery.isLocalRecoveryRequest({ headers: new Headers({ origin: "http://localhost" }) }),
    false
  );
  const reserve = recovery.createRecoveryThrottle({ now: () => 1000, state: {} });
  for (let index = 0; index < 8; index++) assert.equal(reserve().allowed, true);
  assert.equal(reserve().allowed, false);
});

function routeFixture(root) {
  const source = fs
    .readFileSync(path.join(__dirname, "../src/app/api/auth/recover/route.js"), "utf8")
    .replace(/^import[\s\S]*?from "[^"]+";\r?$/gm, "")
    .replace(/export /g, "");
  const state = {
    passwordHash: "old",
    reads: 0,
    writes: [],
    invalidations: 0,
    disconnects: 0,
    conflict: false,
  };
  const dependencies = {
    NextResponse: {
      json: (body, options = {}) => ({
        body,
        status: options.status || 200,
        headers: options.headers || {},
      }),
    },
    prisma: {
      restaurantConfig: {
        findFirst: async () => {
          state.reads++;
          return { id: "owner-config", accessPasswordHash: state.passwordHash };
        },
        updateMany: async (input) => {
          state.writes.push(input);
          if (state.conflict || input.where.accessPasswordHash !== state.passwordHash)
            return { count: 0 };
          state.passwordHash = input.data.accessPasswordHash;
          return { count: 1 };
        },
      },
    },
    hashCredential: (password) => "new:" + password,
    readAuthenticationBody: (request) => request.json(),
    disconnectAllSockets: () => {
      state.disconnects++;
    },
    invalidateAuthConfigCache: () => {
      state.invalidations++;
    },
    consumeRecoveryCode: (options) => recovery.consumeRecoveryCode({ ...options, root }),
    isLocalRecoveryRequest: recovery.isLocalRecoveryRequest,
    reserveRecoveryAttempt: recovery.createRecoveryThrottle({ state: {} }),
    global: {},
    console: { error() {} },
  };
  const handler = new Function(...Object.keys(dependencies), source + "\nreturn POST;")(
    ...Object.values(dependencies)
  );
  const request = (body, peer = "127.0.0.1") => ({
    headers: new Headers({ "x-tepsy-client-ip": peer }),
    json: async () => body,
  });
  return { state, post: (body, peer) => handler(request(body, peer)) };
}

test("recovery route rejects remote spoofing and weak passwords before database work", async (t) => {
  const { post, state } = routeFixture(fixture(t));
  assert.equal(
    (await post({ code: "anything", newPassword: "strong-password" }, "198.51.100.4")).status,
    403
  );
  assert.equal((await post({ code: "anything", newPassword: "short" })).status, 400);
  assert.equal(state.reads, 0);
  assert.equal(state.writes.length, 0);
});
test("recovery route uses credential CAS, invalidates all sessions and creates no login cookie", async (t) => {
  const root = fixture(t);
  const { post, state } = routeFixture(root);
  const { code } = recovery.issueRecoveryCode({ root, passwordHash: "old" });
  const response = await post({ code, newPassword: "strong-password" });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { success: true, redirectTo: "/login" });
  assert.deepEqual(state.writes, [
    {
      where: { id: "owner-config", accessPasswordHash: "old" },
      data: { accessPasswordHash: "new:strong-password", authEnabled: true },
    },
  ]);
  assert.equal(state.invalidations, 1);
  assert.equal(state.disconnects, 1);
  assert.equal(response.headers["Set-Cookie"], undefined);
  assert.equal(
    (await post({ code, newPassword: "another-password" })).body.code,
    "invalid-recovery-code"
  );
  assert.equal(state.writes.length, 1);
});
test("a password changed during recovery cannot be overwritten by an older proof", async (t) => {
  const root = fixture(t);
  const { post, state } = routeFixture(root);
  const { code } = recovery.issueRecoveryCode({ root, passwordHash: "old" });
  state.conflict = true;
  assert.equal(
    (await post({ code, newPassword: "strong-password" })).body.code,
    "invalid-recovery-code"
  );
  assert.equal(state.passwordHash, "old");
  assert.equal(state.invalidations, 0);
  state.conflict = false;
  assert.equal((await post({ code, newPassword: "strong-password" })).status, 400);
  assert.equal(state.writes.length, 1);
});
test("recovery CLI uses only the selected installation's Prisma dependency", (t) => {
  const { recoveryPrismaClient } = require("../scripts/owner-recovery.cjs");
  const root = fixture(t);
  assert.throws(() => recoveryPrismaClient(root), /selected installation.*dependencies/i);
  const moduleDirectory = path.join(root, "node_modules", "@prisma", "client");
  fs.mkdirSync(moduleDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(moduleDirectory, "index.js"),
    "module.exports = { PrismaClient: class InstallationClient { constructor(options) { this.options = options; } } };"
  );
  const legacy = recoveryPrismaClient(root)("file:legacy.db");
  assert.equal(legacy.constructor.name, "InstallationClient");
  assert.deepEqual(legacy.options, { datasources: { db: { url: "file:legacy.db" } } });
  const factory = path.join(root, "src", "lib", "prisma-client.cjs");
  fs.mkdirSync(path.dirname(factory), { recursive: true });
  fs.writeFileSync(
    factory,
    "module.exports = { createPrismaClient: function installationFactory() {} };"
  );
  assert.equal(recoveryPrismaClient(root).name, "installationFactory");
});
