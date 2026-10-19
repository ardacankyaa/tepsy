const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const installations = require("../src/lib/restaurant-installations.cjs");
const { sessionCookieNames } = require("../src/lib/session-cookies.cjs");

test("independent restaurant environment removes inherited data, secrets and provider configuration", () => {
  const env = installations.isolatedEnvironment(
    {
      PATH: "runtime",
      TEPSY_DATABASE_URL: "file:old.db",
      RESTOPOS_SESSION_SECRET: "old",
      TEPSY_PAYMENT_TOKEN: "secret",
      DATABASE_URL: "file:also-old.db",
      STRIPE_SECRET_KEY: "secret",
      NODE_OPTIONS: "--require=evil",
    },
    path.resolve("fresh-home"),
    "a".repeat(32),
    43123
  );
  assert.equal(env.PATH, "runtime");
  assert.equal(env.TEPSY_INSTANCE_ID, "a".repeat(32));
  assert.equal(env.TEPSY_DEMO_MODE, "0");
  assert.equal(env.TEPSY_BIND_HOST, "0.0.0.0");
  assert.match(env.TEPSY_DATABASE_URL, /fresh-home\/app\/prisma\/dev.db$/);
  for (const key of [
    "RESTOPOS_SESSION_SECRET",
    "TEPSY_PAYMENT_TOKEN",
    "DATABASE_URL",
    "STRIPE_SECRET_KEY",
    "NODE_OPTIONS",
  ])
    assert.equal(env[key], undefined);
  assert.equal(env.TEPSY_SESSION_SECRET, undefined);
  assert.notEqual(sessionCookieNames(env).current, sessionCookieNames({}).current);
  assert.equal(sessionCookieNames({}).legacy, "restopos_session");
  assert.equal(sessionCookieNames({ TEPSY_DEMO_MODE: "1" }).current, "tepsy_demo_session");
  assert.throws(() => sessionCookieNames({ TEPSY_INSTANCE_ID: "../bad" }));
});

test("only current owner proof can authorize a new restaurant, never staff admin or stale owner", () => {
  const options = {
    ownerVersion: "current",
    verifyPassword: (password, hash) => password === "correct" && hash === "hash",
  };
  const config = { isSetupCompleted: true, authEnabled: true, accessPasswordHash: "hash" };
  assert.equal(
    installations.hasOwnerProof(
      config,
      "",
      { userId: "staff", role: "ADMIN", credentialVersion: "current" },
      options
    ),
    false
  );
  assert.equal(
    installations.hasOwnerProof(
      config,
      "",
      { userId: "owner", role: "ADMIN", credentialVersion: "old" },
      options
    ),
    false
  );
  assert.equal(
    installations.hasOwnerProof(
      config,
      "",
      { userId: "owner", role: "ADMIN", credentialVersion: "current" },
      options
    ),
    true
  );
  assert.equal(installations.hasOwnerProof(config, "wrong", null, options), false);
  assert.equal(installations.hasOwnerProof(config, "correct", null, options), true);
  assert.equal(
    installations.hasOwnerProof({ ...config, authEnabled: false }, "correct", null, options),
    false
  );
});

test("idempotent private jobs reserve one isolated installation and do not expose paths", (t) => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "tepsy-installations-"));
  t.after(() => fs.rmSync(source, { recursive: true, force: true }));
  const live = path.join(source, "prisma", "dev.db");
  fs.mkdirSync(path.dirname(live), { recursive: true });
  fs.writeFileSync(live, "existing restaurant must survive");
  let launches = 0;
  const options = { launch: () => launches++ };
  const key = "requested-restaurant-1234567890";
  const first = installations.reserveInstallation(source, key, "owner-version", options);
  const replay = installations.reserveInstallation(source, key, "owner-version", options);
  assert.deepEqual(replay, first);
  assert.match(first.id, /^[a-f0-9]{32}$/);
  assert.deepEqual(Object.keys(first).sort(), ["id", "status"]);
  assert.equal(first.status, "STARTING");
  assert.equal(launches, 1);
  assert.equal(fs.readFileSync(live, "utf8"), "existing restaurant must survive");
  assert.throws(
    () => installations.reserveInstallation(source, key, "new-version", options),
    /credential|yetki/i
  );
  assert.throws(() => installations.reserveInstallation(source, "../x", "owner-version", options));
  assert.equal(installations.installationStatus(source, "b".repeat(32)), null);
  installations.updateInstallation(source, first.id, { status: "READY", port: 43123 });
  assert.deepEqual(installations.installationStatus(source, first.id), {
    id: first.id,
    status: "READY",
    url: "http://127.0.0.1:43123/setup",
  });
  installations.updateInstallation(source, first.id, {
    status: "FAILED",
    error: "private /path/token",
  });
  const failed = installations.installationStatus(source, first.id);
  assert.equal(failed.url, undefined);
  assert.equal(JSON.stringify(failed).includes("/path/token"), false);
});

test("worker persists only fresh instance settings and completes once without touching parent data", async (t) => {
  const { runInstallation } = require("../scripts/new-restaurant.cjs");
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "tepsy-worker-"));
  t.after(() => fs.rmSync(source, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(source, ".env"),
    "TEPSY_SESSION_SECRET=parent-private-secret\nDATABASE_URL=file:parent.db\n"
  );
  const state = installations.reserveInstallation(source, "worker-creation-key-123456", "owner", {
    launch() {},
  });
  let calls = 0;
  await runInstallation(source, "create", state.id, {
    portFor: async () => 43124,
    launch: async (_source, _id, env) => {
      calls++;
      assert.equal(env.TEPSY_INSTANCE_ID, state.id);
      assert.notEqual(env.TEPSY_SESSION_SECRET, "parent-private-secret");
      assert.ok(env.TEPSY_SESSION_SECRET.length >= 32);
      assert.equal(env.DATABASE_URL, undefined);
    },
  });
  const file = path.join(installations.installationPaths(source, state.id).app, ".env");
  const persisted = fs.readFileSync(file, "utf8");
  assert.equal(persisted.includes("parent-private-secret"), false);
  assert.match(persisted, /TEPSY_INSTANCE_ID=/);
  assert.equal(installations.installationStatus(source, state.id).status, "READY");
  await runInstallation(source, "create", state.id, { launch: () => calls++ });
  assert.equal(calls, 1);
  assert.equal(fs.readFileSync(file, "utf8"), persisted);
  assert.match(fs.readFileSync(path.join(source, ".env"), "utf8"), /parent-private-secret/);
});

test("failed worker and abandoned jobs expose a bounded failure without paths or secrets", async (t) => {
  const { runInstallation } = require("../scripts/new-restaurant.cjs");
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "tepsy-worker-failure-"));
  t.after(() => fs.rmSync(source, { recursive: true, force: true }));
  const state = installations.reserveInstallation(source, "worker-failure-key-123456", "owner", {
    launch() {},
  });
  await assert.rejects(
    runInstallation(source, "create", state.id, {
      portFor: async () => 43125,
      launch: async () => {
        throw new Error("private token in /parent/path");
      },
    }),
    /Mevcut restoranınız korunuyor/
  );
  assert.equal(installations.installationStatus(source, state.id).status, "FAILED");
  assert.equal(
    JSON.stringify(installations.installationStatus(source, state.id)).includes("private token"),
    false
  );
  const abandoned = installations.reserveInstallation(
    source,
    "worker-abandoned-key-123456",
    "owner",
    { launch() {} }
  );
  installations.updateInstallation(source, abandoned.id, {
    createdAt: Date.now() - installations.MAX_STARTING_MS - 1,
  });
  assert.equal(installations.installationStatus(source, abandoned.id).status, "FAILED");
});
