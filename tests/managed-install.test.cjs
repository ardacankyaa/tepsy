const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { managedPaths, managedEnvironment } = require("../scripts/local-paths.cjs");
const { sessionCookieNames } = require("../src/lib/session-cookies.cjs");
const { resolveRuntimeConfig } = require("../scripts/runtime-config.cjs");

test("managed installations use distinct user directories with explicit and legacy overrides", () => {
  const home = path.resolve("test-home");
  const local = path.join(home, "local");
  const win = managedPaths({ LOCALAPPDATA: local }, "win32", home);
  assert.equal(win.app, path.join(local, "TEPSY", "app"));
  assert.equal(win.demo, path.join(local, "TEPSY", "demo"));
  assert.equal(
    managedPaths({}, "darwin", home).dataHome,
    path.join(home, "Library", "Application Support", "TEPSY")
  );
  assert.equal(
    managedPaths({ XDG_DATA_HOME: local }, "linux", home).dataHome,
    path.join(local, "tepsy")
  );
  assert.equal(managedPaths({ RESTOPOS_LOCAL_DATA_HOME: local }, "win32", home).dataHome, local);
  assert.equal(
    managedPaths({ TEPSY_LOCAL_DATA_HOME: home, RESTOPOS_LOCAL_DATA_HOME: local }).dataHome,
    home
  );
});

test("demo removes real restaurant credentials and device paths and binds only to loopback", () => {
  const input = {
    PORT: "8000",
    TEPSY_SESSION_SECRET: "real",
    RESTOPOS_DATABASE_URL: "file:real.db",
    TEPSY_DEVICES_CONFIG_PATH: "real.json",
    PATH: "kept",
  };
  const app = path.resolve("demo");
  const env = managedEnvironment(input, app, "demo");
  assert.equal(env.PORT, "3001");
  assert.equal(env.TEPSY_BIND_HOST, "127.0.0.1");
  assert.equal(env.TEPSY_SESSION_SECRET, undefined);
  assert.equal(env.RESTOPOS_DATABASE_URL, undefined);
  assert.equal(env.TEPSY_DEVICES_CONFIG_PATH, path.join(app, ".tepsy", "devices.json"));
  assert.equal(
    env.TEPSY_DATABASE_URL,
    "file:" + path.join(app, ".tepsy", "qa", "demo.db").replaceAll("\\", "/")
  );
  assert.equal(env.PATH, "kept");
  assert.equal(input.TEPSY_SESSION_SECRET, "real");
  assert.equal(managedEnvironment(input, app, "app").TEPSY_SESSION_SECRET, "real");
  assert.equal(managedEnvironment(input, app, "demo", "3200").PORT, "3200");
  for (const port of ["", "bad", "0", "65536", "3.5"])
    assert.throws(() => managedEnvironment(input, app, "demo", port));
});

test("demo cookies cannot overwrite the real restaurant remembered session", () => {
  assert.deepEqual(sessionCookieNames({}), {
    current: "tepsy_session",
    legacy: "restopos_session",
  });
  assert.deepEqual(sessionCookieNames({ TEPSY_DEMO_MODE: "1" }), {
    current: "tepsy_demo_session",
    legacy: "restopos_demo_session",
  });
  const normal = Object.values(sessionCookieNames({}));
  for (const cookie of Object.values(sessionCookieNames({ TEPSY_DEMO_MODE: "1" })))
    assert.ok(!normal.includes(cookie));
});

test("explicit bind addresses reject hostnames and preserve the default LAN binding", () => {
  assert.equal(resolveRuntimeConfig({}, process.cwd()).host, "0.0.0.0");
  assert.equal(
    resolveRuntimeConfig({ TEPSY_BIND_HOST: "127.0.0.1" }, process.cwd()).host,
    "127.0.0.1"
  );
  assert.equal(resolveRuntimeConfig({ RESTOPOS_BIND_HOST: "::1" }, process.cwd()).host, "::1");
  assert.throws(() => resolveRuntimeConfig({ TEPSY_BIND_HOST: "example.org" }, process.cwd()));
});

test("source sync retains local data, removes retired managed code and rejects source overwrite", () => {
  const fs = require("node:fs");
  const { syncSource } = require("../scripts/local-app.cjs");
  const qa = path.resolve(".tepsy/qa");
  fs.mkdirSync(qa, { recursive: true });
  const directory = fs.mkdtempSync(path.join(qa, "source-sync-"));
  try {
    fs.mkdirSync(path.join(directory, "src"));
    fs.mkdirSync(path.join(directory, "prisma"));
    fs.writeFileSync(path.join(directory, "src", "retired-test-route.js"), "old route");
    fs.writeFileSync(path.join(directory, "prisma", "dev.db"), "existing restaurant");
    fs.writeFileSync(path.join(directory, ".env"), "existing credentials");
    fs.writeFileSync(
      path.join(directory, ".managed-install.json"),
      JSON.stringify({
        files: ["src/retired-test-route.js", "prisma/dev.db", ".env", "../outside.json"],
      })
    );
    syncSource(directory);
    assert.equal(fs.existsSync(path.join(directory, "src", "retired-test-route.js")), false);
    assert.equal(
      fs.readFileSync(path.join(directory, "prisma", "dev.db"), "utf8"),
      "existing restaurant"
    );
    assert.equal(fs.readFileSync(path.join(directory, ".env"), "utf8"), "existing credentials");
    assert.ok(fs.existsSync(path.join(directory, "server.js")));
    assert.throws(() => syncSource(process.cwd()));
    assert.throws(() => syncSource(path.join(process.cwd(), "src", "invalid-install")));
  } finally {
    assert.ok(directory.startsWith(qa + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
