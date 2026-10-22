// Production account-help verification. Every database, code and installer lives in disposable QA.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { parseEnv } = require("node:util");
const { once } = require("node:events");
const { releaseFiles, sourceHash } = require("../scripts/release-files.cjs");
const { createPrismaClient } = require("../src/lib/prisma-client.cjs");

const root = path.resolve(__dirname, "..");
const result = { startedAt: new Date().toISOString(), passed: false, checks: [] };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^(TEPSY_|RESTOPOS_)/i.test(key) &&
      !["PORT", "DATABASE_URL", "NODE_OPTIONS", "NODE_ENV"].includes(key)
  )
);
Object.assign(cleanEnv, {
  NEXT_TELEMETRY_DISABLED: "1",
  PYTHONUTF8: "1",
  npm_config_fund: "false",
});
let directory,
  parentApp,
  parentBase,
  parentServer,
  parentDb,
  profileApp,
  profileBase,
  profileId,
  childDb;
const children = new Set();

function confined(target) {
  const relative = path.relative(directory, path.resolve(target));
  assert.ok(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    "QA target escaped its disposable directory"
  );
  return target;
}
async function check(name, fn) {
  try {
    await fn();
    result.checks.push({ name, passed: true });
    console.log("PASS " + name);
  } catch (error) {
    result.checks.push({ name, passed: false, error: error.message });
    throw error;
  }
}
function copySource(target) {
  confined(target);
  fs.mkdirSync(target, { recursive: true });
  for (const relative of releaseFiles(root)) {
    const destination = path.join(target, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, relative), destination);
  }
}
function linkDirectory(source, target) {
  confined(target);
  fs.symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
}
function syncCommand(args, { cwd = parentApp, env = cleanEnv, input } = {}) {
  const command = spawnSync(process.execPath, args, {
    cwd,
    env,
    input,
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (command.error || command.status !== 0)
    throw new Error(
      "Isolated command failed: " +
        path.basename(args[0]) +
        (command.error ? " (" + command.error.code + ")" : " (exit " + command.status + ")")
    );
  return command.stdout;
}
async function command(
  args,
  { cwd = parentApp, env = cleanEnv, name = "command", timeout = 600000 } = {}
) {
  const descriptor = fs.openSync(path.join(directory, name + ".log"), "a");
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: ["ignore", descriptor, descriptor],
  });
  fs.closeSync(descriptor);
  children.add(child);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("Isolated " + name + " timed out"));
      }, timeout);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        code === 0
          ? resolve()
          : reject(new Error("Isolated " + name + " failed (exit " + code + "); see its QA log"));
      });
    });
  } finally {
    children.delete(child);
  }
}
async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve()))
  );
  assert.notEqual(port, 3000);
  return port;
}
async function api(base, route, { method = "GET", body, cookie, rawBody } = {}) {
  const response = await fetch(base + route, {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
    headers: {
      ...(body !== undefined || rawBody !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await response.text();
  return {
    status: response.status,
    data: response.headers.get("content-type")?.includes("application/json")
      ? JSON.parse(text)
      : text,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
    headers: response.headers,
  };
}
function status(response, expected) {
  assert.equal(
    response.status,
    expected,
    "Unexpected HTTP status: " + response.status + " instead of " + expected
  );
  return response.data;
}
async function ready(base, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (base === parentBase && parentServer?.exitCode !== null)
      throw new Error("Disposable parent server exited; see parent-server.log");
    try {
      const response = await api(base, "/api/auth/status");
      if (response.status === 200 && response.data.service === "tepsy") return response.data;
    } catch {
      /* Owned server is starting. */
    }
    await pause(250);
  }
  throw new Error("Disposable production server did not become ready");
}
function databaseUrl(filename) {
  return "file:" + filename.replaceAll("\\", "/");
}
function setupBody(name, code, password) {
  return {
    restaurantName: name,
    restaurantCode: code,
    ownerPassword: password,
    ownerPasswordConfirm: password,
    currency: "₺",
    sections: [{ name: "QA Salon", tableCount: 2 }],
    categories: [{ name: "QA Menu", items: [{ name: "QA Sentinel", price: "25.50" }] }],
  };
}
async function login(base, restaurantCode, password) {
  const response = await api(base, "/api/auth/login", {
    method: "POST",
    body: { restaurantCode, password, rememberDevice: true },
  });
  status(response, 200);
  assert.ok(response.cookie, "Login did not create its session cookie");
  return response.cookie;
}
async function snapshot(database) {
  const names = [
    "table",
    "category",
    "menuItem",
    "order",
    "orderItem",
    "payment",
    "refund",
    "cashShift",
    "staffUser",
    "auditEvent",
  ];
  const records = {};
  for (const name of names)
    records[name] = await database[name].findMany({ orderBy: { id: "asc" } });
  records.config = await database.restaurantConfig.findFirst({
    select: { restaurantName: true, restaurantCode: true, currency: true, isSetupCompleted: true },
  });
  return {
    hash: crypto.createHash("sha256").update(JSON.stringify(records)).digest("hex"),
    counts: Object.fromEntries(names.map((name) => [name, records[name].length])),
  };
}
function privateFileHash(filename) {
  return crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}
async function stopParent() {
  if (!parentServer?.pid || parentServer.exitCode !== null || parentServer.signalCode) return;
  const ended = once(parentServer, "exit");
  parentServer.kill();
  await Promise.race([ended, pause(5000)]);
  if (parentServer.exitCode === null && !parentServer.signalCode) {
    parentServer.kill("SIGKILL");
    await Promise.race([ended, pause(5000)]);
  }
}
async function stopProfile() {
  if (!profileApp || !fs.existsSync(path.join(profileApp, "scripts", "local-app.cjs"))) return;
  confined(profileApp);
  // Explicit QA home guarantees failure cleanup cannot resolve the user's default installation.
  await command([path.join(profileApp, "scripts", "local-app.cjs"), "stop"], {
    cwd: profileApp,
    env: { ...cleanEnv, TEPSY_LOCAL_DATA_HOME: path.dirname(profileApp) },
    name: "profile-stop",
    timeout: 30000,
  });
}
async function cleanupWorker() {
  if (!profileId) return;
  const recordFile = path.join(parentApp, ".tepsy", "restaurants", profileId, "job.json");
  if (!fs.existsSync(recordFile)) return;
  const record = JSON.parse(fs.readFileSync(recordFile, "utf8"));
  if (record.status !== "STARTING") return;
  const { commandLine } = require("../scripts/local-app.cjs");
  // Only the worker recorded in our disposable job may be terminated, together with its children.
  const pid = record.workerPid;
  if (!Number.isInteger(pid) || pid <= 0) return;
  const line = commandLine(pid).toLowerCase();
  if (
    !line.includes(path.join(parentApp, "scripts", "new-restaurant.cjs").toLowerCase()) ||
    !line.includes(profileId)
  )
    return;
  if (process.platform === "win32")
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  else {
    // The worker is detached into its own process group on Unix.
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      /* Already exited. */
    }
  }
}
async function main() {
  assert.ok(
    fs.existsSync(path.join(root, ".next", "BUILD_ID")),
    "Run npm run build before account-help integration"
  );
  fs.mkdirSync(path.join(root, ".tepsy", "qa"), { recursive: true });
  directory = fs.mkdtempSync(path.join(root, ".tepsy", "qa", "accounts-"));
  result.directory = directory;
  result.buildId = fs.readFileSync(path.join(root, ".next", "BUILD_ID"), "utf8").trim();
  parentApp = path.join(directory, "parent", "app");
  console.log("Isolated account-help suite: " + directory);
  copySource(parentApp);
  linkDirectory(path.join(root, "node_modules"), path.join(parentApp, "node_modules"));
  linkDirectory(path.join(root, ".next"), path.join(parentApp, ".next"));
  const files = releaseFiles(parentApp);
  fs.writeFileSync(
    path.join(parentApp, ".managed-install.json"),
    JSON.stringify({
      mode: "app",
      files,
      sourceHash: sourceHash(parentApp),
      lockHash: crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(parentApp, "package-lock.json")))
        .digest("hex"),
    })
  );
  const port = await freePort();
  parentBase = "http://127.0.0.1:" + port;
  const parentDatabase = confined(path.join(parentApp, "prisma", "accounts.db"));
  const parentSecret = crypto.randomBytes(48).toString("base64url");
  const privateEnv = {
    TEPSY_DATABASE_URL: databaseUrl(parentDatabase),
    TEPSY_SESSION_SECRET: parentSecret,
    TEPSY_BIND_HOST: "127.0.0.1",
    TEPSY_DEMO_MODE: "0",
    TEPSY_LOCAL_DATA_HOME: path.dirname(parentApp),
    TEPSY_DEVICES_CONFIG_PATH: path.join(parentApp, ".tepsy", "devices.json"),
    TEPSY_MENU_IMAGE_DIR: path.join(parentApp, ".tepsy", "menu-images"),
    TEPSY_BACKUP_DIR: path.join(parentApp, ".tepsy", "backups"),
    TEPSY_SESSION_REVOCATION_PATH: path.join(parentApp, ".tepsy", "revoked-sessions.db"),
    PORT: String(port),
  };
  fs.mkdirSync(path.join(parentApp, ".tepsy", "menu-images"), { recursive: true });
  fs.writeFileSync(
    path.join(parentApp, ".env"),
    Object.entries(privateEnv)
      .map(([key, value]) => key + "=" + JSON.stringify(value.replaceAll("\\", "/")))
      .join("\n") + "\n",
    { mode: 0o600 }
  );
  fs.writeFileSync(privateEnv.TEPSY_DEVICES_CONFIG_PATH, "{}\n");
  fs.writeFileSync(
    path.join(privateEnv.TEPSY_MENU_IMAGE_DIR, "qa-sentinel.txt"),
    "QA image sentinel\n"
  );
  const parentEnv = { ...cleanEnv, ...privateEnv };
  const prismaCli = path.join(parentApp, "node_modules", "prisma", "build", "index.js");
  const sql = syncCommand(
    [
      prismaCli,
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema",
      path.join(parentApp, "prisma", "schema.prisma"),
      "--script",
    ],
    { env: parentEnv }
  );
  syncCommand([prismaCli, "db", "execute", "--stdin"], {
    env: parentEnv,
    input: sql,
  });
  parentDb = createPrismaClient(privateEnv.TEPSY_DATABASE_URL);
  const serverLog = fs.openSync(path.join(directory, "parent-server.log"), "a");
  parentServer = spawn(process.execPath, [path.join(parentApp, "server.js"), "--production"], {
    cwd: parentApp,
    env: parentEnv,
    windowsHide: true,
    stdio: ["ignore", serverLog, serverLog],
  });
  fs.closeSync(serverLog);
  parentServer.once("error", (error) => {
    result.serverSpawnError = error.code || "spawn-failed";
  });
  await ready(parentBase);
  const originalPassword = "QaInitial!" + crypto.randomBytes(12).toString("hex");
  const recoveredPassword = "QaRecovered!" + crypto.randomBytes(12).toString("hex");
  const childPassword = "QaIndependent!" + crypto.randomBytes(12).toString("hex");
  const restaurantCode = "QA_PARENT";
  let oldCookie, parentCookie, childCookie, parentSnapshot, parentFiles;
  await check("parent setup and real order create preserved business sentinels", async () => {
    assert.equal((await ready(parentBase)).canSetup, true);
    status(
      await api(parentBase, "/api/setup", {
        method: "POST",
        body: setupBody("QA Existing Restaurant", restaurantCode, originalPassword),
      }),
      200
    );
    oldCookie = await login(parentBase, restaurantCode, originalPassword);
    const table = await parentDb.table.findFirst();
    const item = await parentDb.menuItem.findFirst();
    status(
      await api(parentBase, "/api/orders", {
        method: "POST",
        cookie: oldCookie,
        body: {
          tableId: table.id,
          idempotencyKey: "accounts-parent-order-" + crypto.randomBytes(8).toString("hex"),
          items: [{ menuItemId: item.id, quantity: 2 }],
        },
      }),
      201
    );
    parentSnapshot = await snapshot(parentDb);
    assert.equal(parentSnapshot.counts.order, 1);
    parentFiles = Object.fromEntries(
      [
        path.join(parentApp, ".env"),
        privateEnv.TEPSY_DEVICES_CONFIG_PATH,
        path.join(privateEnv.TEPSY_MENU_IMAGE_DIR, "qa-sentinel.txt"),
      ].map((filename) => [filename, privateFileHash(filename)])
    );
  });
  await check(
    "real local CLI proof resets once, revokes old sessions and preserves restaurant data",
    async () => {
      status(
        await api(parentBase, "/api/auth/recover", {
          method: "POST",
          body: { code: "wrong-code", newPassword: recoveredPassword },
        }),
        400
      );
      status(
        await api(parentBase, "/api/auth/recover", { method: "POST", rawBody: "{malformed" }),
        400
      );
      const output = syncCommand([
        path.join(parentApp, "scripts", "owner-recovery.cjs"),
        "--installation",
        parentApp,
      ]);
      const match = output.match(/Recovery code \/ Kurtarma kodu: ([A-Za-z0-9_-]{32})/);
      assert.ok(match, "Recovery CLI did not return its one-time code");
      const code = match[1];
      const storedCode = fs.readFileSync(
        path.join(parentApp, ".tepsy", "owner-recovery.json"),
        "utf8"
      );
      assert.equal(storedCode.includes(code), false);
      const reset = await api(parentBase, "/api/auth/recover", {
        method: "POST",
        body: { code, newPassword: recoveredPassword },
      });
      status(reset, 200);
      assert.equal(reset.headers.get("set-cookie"), null);
      assert.equal(reset.data.redirectTo, "/login");
      status(
        await api(parentBase, "/api/auth/recover", {
          method: "POST",
          body: { code, newPassword: recoveredPassword },
        }),
        400
      );
      status(await api(parentBase, "/api/tables", { cookie: oldCookie }), 401);
      status(
        await api(parentBase, "/api/auth/login", {
          method: "POST",
          body: { restaurantCode, password: originalPassword },
        }),
        401
      );
      parentCookie = await login(parentBase, restaurantCode, recoveredPassword);
      assert.deepEqual(await snapshot(parentDb), parentSnapshot);
    }
  );
  await check(
    "independent restaurant requires owner proof and retries the same reservation",
    async () => {
      const idempotencyKey = "accounts-restaurant-" + crypto.randomBytes(16).toString("hex");
      status(
        await api(parentBase, "/api/auth/restaurants", {
          method: "POST",
          body: { idempotencyKey, ownerPassword: "incorrect-password" },
        }),
        401
      );
      const body = { idempotencyKey, ownerPassword: recoveredPassword };
      const reserved = status(
        await api(parentBase, "/api/auth/restaurants", { method: "POST", body }),
        202
      );
      assert.match(reserved.id, /^[a-f0-9]{32}$/);
      profileId = reserved.id;
      profileApp = confined(path.join(parentApp, ".tepsy", "restaurants", profileId, "app"));
      const replay = status(
        await api(parentBase, "/api/auth/restaurants", { method: "POST", body }),
        202
      );
      assert.equal(replay.id, profileId);
      const deadline = Date.now() + 8 * 60 * 1000;
      for (;;) {
        const state = status(await api(parentBase, "/api/auth/restaurants?id=" + profileId), 200);
        if (state.status === "FAILED")
          throw new Error(
            "Independent restaurant worker failed; see its disposable installation.log"
          );
        if (state.status === "READY") {
          const url = new URL(state.url);
          assert.equal(url.hostname, "127.0.0.1");
          assert.notEqual(Number(url.port), 3000);
          assert.notEqual(url.origin, parentBase);
          profileBase = url.origin;
          break;
        }
        if (Date.now() > deadline)
          throw new Error("Independent restaurant was not ready within eight minutes");
        await pause(1000);
      }
      assert.equal(
        fs
          .readdirSync(path.join(parentApp, ".tepsy", "restaurants"))
          .filter((name) => /^[a-f0-9]{32}$/.test(name)).length,
        1
      );
    }
  );
  await check(
    "new profile has separate database, secret, empty setup and session cookie namespace",
    async () => {
      const state = await ready(profileBase);
      assert.equal(state.canSetup, true);
      assert.equal(state.authEnabled, false);
      const childEnv = parseEnv(fs.readFileSync(path.join(profileApp, ".env"), "utf8"));
      assert.equal(childEnv.TEPSY_INSTANCE_ID, profileId);
      assert.notEqual(childEnv.TEPSY_SESSION_SECRET, parentSecret);
      assert.equal(
        childEnv.TEPSY_DATABASE_URL,
        databaseUrl(confined(path.join(profileApp, "prisma", "dev.db")))
      );
      assert.equal(new URL(profileBase).port, childEnv.PORT);
      assert.equal(
        path.resolve(childEnv.TEPSY_MENU_IMAGE_DIR),
        path.join(profileApp, ".tepsy", "menu-images")
      );
      childDb = createPrismaClient(childEnv.TEPSY_DATABASE_URL);
      const empty = await snapshot(childDb);
      for (const count of Object.values(empty.counts)) assert.equal(count, 0);
      status(
        await api(profileBase, "/api/setup", {
          method: "POST",
          body: setupBody("QA Independent Restaurant", "QA_INDEPENDENT", childPassword),
        }),
        200
      );
      childCookie = await login(profileBase, "QA_INDEPENDENT", childPassword);
      assert.notEqual(childCookie.split("=")[0], parentCookie.split("=")[0]);
      assert.equal(childCookie.split("=")[0], "tepsy_" + profileId + "_session");
      status(await api(parentBase, "/api/tables", { cookie: childCookie }), 401);
      status(await api(profileBase, "/api/tables", { cookie: parentCookie }), 401);
      const bothCookies = parentCookie + "; " + childCookie;
      status(await api(parentBase, "/api/tables", { cookie: bothCookies }), 200);
      status(await api(profileBase, "/api/tables", { cookie: bothCookies }), 200);
      status(
        await api(profileBase, "/api/auth/logout", { method: "POST", cookie: bothCookies }),
        200
      );
      status(await api(parentBase, "/api/tables", { cookie: parentCookie }), 200);
      status(await api(profileBase, "/api/tables", { cookie: childCookie }), 401);
      childCookie = await login(profileBase, "QA_INDEPENDENT", childPassword);
      assert.deepEqual(await snapshot(parentDb), parentSnapshot);
    }
  );
  await check(
    "profile launcher restarts its own installation with no inherited profile environment",
    async () => {
      const before = await snapshot(childDb);
      await childDb.$disconnect();
      childDb = null;
      await stopProfile();
      await command([path.join(profileApp, "scripts", "local-app.cjs"), "start", "--no-open"], {
        cwd: profileApp,
        env: cleanEnv,
        name: "profile-restart",
        timeout: 120000,
      });
      assert.equal((await ready(profileBase)).restaurantCode, "QA_INDEPENDENT");
      status(await api(profileBase, "/api/tables", { cookie: childCookie }), 200);
      const childEnv = parseEnv(fs.readFileSync(path.join(profileApp, ".env"), "utf8"));
      childDb = createPrismaClient(childEnv.TEPSY_DATABASE_URL);
      assert.deepEqual(await snapshot(childDb), before);
      status(await api(parentBase, "/api/tables", { cookie: parentCookie }), 200);
      assert.deepEqual(await snapshot(parentDb), parentSnapshot);
      for (const [filename, hash] of Object.entries(parentFiles))
        assert.equal(privateFileHash(filename), hash);
      result.parentBusinessPreserved = true;
      result.parentPrivateFilesPreserved = true;
      result.parentCounts = parentSnapshot.counts;
    }
  );
  result.passed = true;
}
main()
  .catch((error) => {
    result.error = error.message;
    console.error("FAIL " + error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    const errors = [];
    for (const child of children) {
      try {
        child.kill();
      } catch {
        /* Owned helper already exited. */
      }
    }
    for (const cleanup of [
      cleanupWorker,
      async () => childDb?.$disconnect(),
      stopProfile,
      async () => parentDb?.$disconnect(),
      stopParent,
    ]) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error.message);
      }
    }
    if (errors.length) {
      result.cleanupErrors = errors;
      result.passed = false;
      process.exitCode = 1;
    }
    result.finishedAt = new Date().toISOString();
    if (directory) {
      fs.writeFileSync(path.join(directory, "results.json"), JSON.stringify(result, null, 2));
      console.log("Account-help evidence: " + path.join(directory, "results.json"));
    }
  });
