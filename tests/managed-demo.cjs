const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { io } = require("socket.io-client");

const root = path.resolve(__dirname, "..");
const qa = path.join(root, ".tepsy", "qa");
fs.mkdirSync(qa, { recursive: true });
const directory = fs.mkdtempSync(path.join(qa, "managed-demo-"));
const dataHome = path.join(directory, "managed");
const demo = path.join(dataHome, "demo");
const env = { ...process.env, TEPSY_LOCAL_DATA_HOME: dataHome, NEXT_TELEMETRY_DISABLED: "1" };
const evidence = { startedAt: new Date().toISOString(), directory, checks: [], passed: false };
let base;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function command(name, args = [], overrides = {}, expectedStatus = 0) {
  const log = fs.openSync(path.join(directory, name + ".log"), "a");
  try {
    const result = spawnSync(process.execPath, ["scripts/local-app.cjs", name, ...args], {
      cwd: root,
      env: { ...env, ...overrides },
      windowsHide: true,
      stdio: ["ignore", log, log],
      timeout: 600000,
    });
    if (result.error) throw result.error;
    assert.equal(
      result.status,
      expectedStatus,
      name + " returned unexpected status; see " + directory
    );
  } finally {
    fs.closeSync(log);
  }
}
async function concurrentCommand(name, args, label) {
  const log = fs.openSync(path.join(directory, label + ".log"), "a");
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["scripts/local-app.cjs", name, ...args], {
        cwd: root,
        env,
        timeout: 600000,
        windowsHide: true,
        stdio: ["ignore", log, log],
      });
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(label + " failed (" + code + "); see " + directory))
      );
    });
  } finally {
    fs.closeSync(log);
  }
}
async function api(route, { body, cookie, method = body ? "POST" : "GET" } = {}) {
  const response = await fetch(base + route, {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
    headers: {
      Connection: "close",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : await response.text();
  return {
    status: response.status,
    data,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
async function main() {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  base = "http://127.0.0.1:" + port;
  const sentinel = path.join(directory, "restaurant.db");
  fs.writeFileSync(sentinel, "never connect to this restaurant database");
  env.TEPSY_DATABASE_URL = "file:" + sentinel.replaceAll("\\", "/");
  env.TEPSY_SESSION_SECRET = "real restaurant secret that demo must ignore";
  await Promise.all([
    concurrentCommand("demo", ["--no-open", "--port", String(port)], "cold-start-1"),
    concurrentCommand("demo", ["--no-open", "--port", String(port)], "cold-start-2"),
  ]);
  evidence.checks.push("concurrent cold source install, schema, seed, build and production launch");
  const status = await api("/api/auth/status");
  assert.equal(status.status, 200);
  assert.equal(status.data.restaurantCode, "DEMO01");
  assert.equal(status.data.canSetup, false);
  assert.equal(status.data.session, null);
  const owner = await api("/api/auth/login", {
    body: { restaurantCode: "DEMO01", password: "TepsyDemo123!", rememberDevice: true },
  });
  assert.equal(owner.status, 200, JSON.stringify(owner.data));
  assert.ok(owner.cookie.startsWith("tepsy_demo_session="));
  const tables = await api("/api/tables", { cookie: owner.cookie });
  assert.equal(tables.status, 200);
  assert.equal(tables.data.length, 13);
  const token = tables.data[0].qrToken;
  const menu = await api("/api/public/menu?token=" + token);
  assert.equal(menu.status, 200);
  assert.equal(menu.data.items.length, 14);
  assert.equal(menu.data.orderingEnabled, true);
  assert.equal((await api("/api/orders", { cookie: owner.cookie })).status, 200);
  for (const [username, role] of [
    ["Garson", "WAITER"],
    ["Mutfak", "KITCHEN"],
    ["Kasa", "CASHIER"],
  ]) {
    const result = await api("/api/auth/login", {
      body: { restaurantCode: "DEMO01", username, pin: "1234" },
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.session.role, role);
    assert.ok(result.cookie.startsWith("tepsy_demo_session="));
  }
  const wrongNamespace = owner.cookie.replace("tepsy_demo_session=", "tepsy_session=");
  assert.equal((await api("/api/tables", { cookie: wrongNamespace })).status, 401);
  const socket = io(base, {
    transports: ["websocket"],
    reconnection: false,
    extraHeaders: { Cookie: owner.cookie },
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Demo socket timeout")), 8000);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("connect_error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  } finally {
    socket.disconnect();
  }
  evidence.checks.push(
    "owner/staff login, isolated HTTP/socket session, guest QR and sample orders"
  );
  const buildId = fs.readFileSync(path.join(demo, ".next", "BUILD_ID"), "utf8");
  const secret = fs.readFileSync(path.join(demo, ".tepsy", "session-secret"));
  const originalPid = fs.readFileSync(path.join(demo, ".tepsy", "production.pid"), "utf8");
  await Promise.all([
    concurrentCommand("demo", ["--no-open", "--port", String(port)], "double-start-1"),
    concurrentCommand("demo", ["--no-open", "--port", String(port)], "double-start-2"),
  ]);
  assert.equal(fs.readFileSync(path.join(demo, ".tepsy", "production.pid"), "utf8"), originalPid);
  evidence.checks.push("concurrent launchers serialize and reuse the same owned server");
  const demoRuntimeRecord = path.join(demo, ".tepsy", "production-runtime.json");
  fs.unlinkSync(demoRuntimeRecord);
  command("demo", ["--no-open", "--port", String(port)]);
  assert.notEqual(
    fs.readFileSync(path.join(demo, ".tepsy", "production.pid"), "utf8"),
    originalPid
  );
  evidence.checks.push("missing legacy runtime metadata restarts only the verified owned server");
  command("demo-stop");
  assert.equal(fs.existsSync(demoRuntimeRecord), false);
  command("demo", ["--no-open", "--port", String(port)]);
  assert.equal(fs.readFileSync(path.join(demo, ".next", "BUILD_ID"), "utf8"), buildId);
  assert.ok(fs.readFileSync(path.join(demo, ".tepsy", "session-secret")).equals(secret));
  assert.equal(
    (await api("/api/auth/status", { cookie: owner.cookie })).data.session.userId,
    "owner"
  );
  assert.equal((await api("/api/tables", { cookie: owner.cookie })).data[0].qrToken, token);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "never connect to this restaurant database");
  assert.ok(!fs.existsSync(path.join(dataHome, "app", "prisma", "dev.db")));
  evidence.checks.push(
    "second launch and stopped restart preserve seed, build, owner session and real data isolation"
  );
  // Simulate an older installed release while its server is still running.
  // The same launcher used by START.bat must update it without a separate stop.
  const updateMarkerPath = path.join(demo, ".managed-install.json");
  const oldRelease = JSON.parse(fs.readFileSync(updateMarkerPath, "utf8"));
  const beforeUpdatePid = fs.readFileSync(path.join(demo, ".tepsy", "production.pid"), "utf8");
  const beforeUpdateTables = (await api("/api/tables", { cookie: owner.cookie })).data;
  const beforeUpdateOrders = (await api("/api/orders", { cookie: owner.cookie })).data;
  fs.appendFileSync(path.join(demo, "server.js"), "\n// Previous release fixture.\n");
  fs.writeFileSync(
    updateMarkerPath,
    JSON.stringify({ ...oldRelease, sourceHash: "previous-release" })
  );
  command("demo", ["--no-open", "--port", String(port)]);
  assert.notEqual(
    fs.readFileSync(path.join(demo, ".tepsy", "production.pid"), "utf8"),
    beforeUpdatePid
  );
  assert.notEqual(fs.readFileSync(path.join(demo, ".next", "BUILD_ID"), "utf8"), buildId);
  assert.ok(
    fs
      .readFileSync(path.join(demo, "server.js"))
      .equals(fs.readFileSync(path.join(root, "server.js")))
  );
  assert.equal(
    JSON.parse(fs.readFileSync(updateMarkerPath, "utf8")).sourceHash,
    require("../scripts/release-files.cjs").sourceHash(root)
  );
  assert.deepEqual((await api("/api/tables", { cookie: owner.cookie })).data, beforeUpdateTables);
  assert.deepEqual((await api("/api/orders", { cookie: owner.cookie })).data, beforeUpdateOrders);
  assert.ok(fs.readFileSync(path.join(demo, ".tepsy", "session-secret")).equals(secret));
  assert.equal(
    (await api("/api/auth/status", { cookie: owner.cookie })).data.session.userId,
    "owner"
  );
  evidence.checks.push(
    "a start command updates and restarts a running older release without a manual stop, preserving tables, orders and credentials"
  );
  command("demo-stop");
  await wait(300);
  await assert.rejects(() =>
    fetch(base + "/api/auth/status", { signal: AbortSignal.timeout(1000) })
  );
  evidence.checks.push("owned process shutdown");
  // The normal launcher must use its initialized SQLite file even after relocating a build.
  const app = path.join(dataHome, "app");
  require("../scripts/local-app.cjs").syncSource(app);
  fs.cpSync(path.join(demo, "node_modules"), path.join(app, "node_modules"), { recursive: true });
  fs.cpSync(path.join(demo, ".next"), path.join(app, ".next"), { recursive: true });
  const marker = JSON.parse(fs.readFileSync(path.join(demo, ".managed-install.json"), "utf8"));
  fs.writeFileSync(
    path.join(app, ".managed-install.json"),
    JSON.stringify({ ...marker, mode: "app" })
  );
  const normalEnv = {
    TEPSY_DATABASE_URL: "",
    RESTOPOS_DATABASE_URL: "",
    TEPSY_BIND_HOST: "127.0.0.1",
  };
  command("start", ["--no-open", "--port", String(port)], normalEnv);
  try {
    const fresh = await api("/api/auth/status");
    assert.equal(fresh.status, 200);
    assert.equal(fresh.data.canSetup, true);
    assert.equal(fresh.data.isSetupCompleted, false);
    assert.equal(fresh.data.hasStaff, false);
    assert.equal(fresh.data.session, null);
    assert.equal((await api("/setup")).status, 200);
    assert.equal((await api("/login")).status, 200);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "never connect to this restaurant database");
    evidence.checks.push(
      "fresh real installation uses its default database, contains no demo data and offers setup"
    );
    // A service answering on a different installation's port must never count as our server.
    const secondListener = net.createServer();
    await new Promise((resolve) => secondListener.listen(0, "127.0.0.1", resolve));
    const secondPort = secondListener.address().port;
    await new Promise((resolve) => secondListener.close(resolve));
    command("demo", ["--no-open", "--port", String(secondPort)]);
    const normalPidPath = path.join(app, ".tepsy", "production.pid");
    const normalPid = fs.readFileSync(normalPidPath, "utf8");
    const normalRuntime = JSON.parse(
      fs.readFileSync(path.join(app, ".tepsy", "production-runtime.json"), "utf8")
    );
    assert.equal(normalRuntime.pid, Number(normalPid));
    assert.equal(normalRuntime.port, port);
    const normalDatabase = path.join(app, "prisma", "dev.db");
    const snapshot = () =>
      ["", "-wal"].map((suffix) =>
        fs.existsSync(normalDatabase + suffix)
          ? fs.readFileSync(normalDatabase + suffix).toString("base64")
          : null
      );
    const before = snapshot();
    command("demo", ["--no-open", "--port", String(port)], {}, 1);
    assert.match(
      fs.readFileSync(path.join(directory, "demo.log"), "utf8"),
      new RegExp("Port " + port + " is in use")
    );
    assert.equal(fs.readFileSync(normalPidPath, "utf8"), normalPid);
    assert.deepEqual(snapshot(), before);
    assert.equal((await api("/api/auth/status")).data.canSetup, true);
    command("demo-stop");
    evidence.checks.push(
      "wrong-port demo rejects another installation and preserves its owned process/database"
    );
  } finally {
    command("stop");
  }
  const ipv6 = net.createServer();
  let ipv6Port;
  try {
    await new Promise((resolve, reject) => {
      ipv6.once("error", reject);
      ipv6.listen(0, "::1", resolve);
    });
    ipv6Port = ipv6.address().port;
    await new Promise((resolve) => ipv6.close(resolve));
  } catch (error) {
    if (!["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code)) throw error;
    evidence.ipv6Unavailable = error.code;
  }
  if (ipv6Port) {
    const previousBase = base;
    base = "http://[::1]:" + ipv6Port;
    command("start", ["--no-open", "--port", String(ipv6Port)], {
      ...normalEnv,
      TEPSY_BIND_HOST: "::1",
    });
    try {
      const ipv6Status = await api("/api/auth/status");
      assert.equal(ipv6Status.status, 200);
      assert.equal(ipv6Status.data.canSetup, true);
      evidence.checks.push(
        "IPv6-only bind uses its real readiness address and serves initial setup"
      );
    } finally {
      command("stop");
      base = previousBase;
    }
  }
  evidence.passed = true;
}
main()
  .catch((error) => {
    evidence.error = error.message;
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const name of ["demo-stop", "stop"]) {
      try {
        command(name);
      } catch (error) {
        evidence.cleanupError = error.message;
        process.exitCode = 1;
        evidence.passed = false;
      }
    }
    evidence.completedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(directory, "results.json"),
      JSON.stringify(evidence, null, 2) + "\n"
    );
    console.log("Managed installation evidence: " + path.join(directory, "results.json"));
  });
