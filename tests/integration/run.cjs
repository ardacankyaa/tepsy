// Real production-server verification. All writes are confined to a fresh QA directory.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { io } = require("socket.io-client");
const { runBrowserChecks } = require("./browser.cjs");

const root = path.resolve(__dirname, "../..");
const browserGroups = process.argv.slice(2);
const qaRoot = path.join(root, ".tepsy", "qa");
const protectedPaths = [
  "prisma/dev.db",
  ".tepsy/devices.json",
  ".tepsy/session-secret",
  ".tepsy/revoked-sessions.db",
  ".tepsy/menu-images",
];
function fingerprint(name) {
  const target = path.join(root, name);
  if (!fs.existsSync(target)) return null;
  const digest = crypto.createHash("sha256");
  function add(entry, relative) {
    if (fs.statSync(entry).isDirectory()) {
      for (const child of fs.readdirSync(entry).sort())
        add(path.join(entry, child), path.join(relative, child));
    } else {
      digest.update(relative);
      digest.update(fs.readFileSync(entry));
    }
  }
  add(target, name);
  return digest.digest("hex");
}
const before = Object.fromEntries(protectedPaths.map((name) => [name, fingerprint(name)]));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const result = { startedAt: new Date().toISOString(), checks: [], browser: {}, passed: false };
let directory;
let server;
let base;
let env;
const sockets = new Set();

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => {
        result.checks.push({ name, passed: true });
        console.log(`PASS ${name}`);
      },
      (error) => {
        result.checks.push({ name, passed: false, error: error.message });
        throw error;
      }
    );
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
  return port;
}

async function api(route, { method = "GET", body, cookie, headers = {}, rawBody } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
    ...(rawBody instanceof ReadableStream ? { duplex: "half" } : {}),
    headers: {
      ...(body === undefined && rawBody === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: rawBody === undefined ? (body === undefined ? undefined : JSON.stringify(body)) : rawBody,
  });
  const text = await response.text();
  const data = response.headers.get("content-type")?.includes("application/json")
    ? JSON.parse(text)
    : text;
  return {
    status: response.status,
    data,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
    headers: response.headers,
  };
}

function expectStatus(response, status) {
  assert.equal(response.status, status, JSON.stringify(response.data));
  return response.data;
}

async function startServer() {
  const log = fs.openSync(path.join(directory, "server.log"), "a");
  server = spawn(process.execPath, ["server.js", "--production"], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ["ignore", log, log],
  });
  fs.closeSync(log);
  let startError;
  server.once("error", (error) => {
    startError = error;
  });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (startError) throw startError;
    if (server.exitCode !== null)
      throw new Error(
        `Isolated production server exited (${server.exitCode}); see ${directory}/server.log`
      );
    try {
      if ((await api("/api/auth/status")).status === 200) return;
    } catch {
      /* The owned server is still starting. */
    }
    await wait(200);
  }
  throw new Error("Isolated production server did not become ready within 60 seconds");
}

async function stopServer() {
  if (!server || !server.pid || server.exitCode !== null) return;
  const ownedServer = server;
  const exited = once(ownedServer, "exit");
  ownedServer.kill();
  await Promise.race([exited, wait(5000)]);
  if (ownedServer.exitCode === null && !ownedServer.signalCode) {
    ownedServer.kill("SIGKILL");
    await Promise.race([exited, wait(5000)]);
  }
  server = null;
}

async function runFixtureChecks(cookie) {
  const output = path.join(directory, "fixtures");
  result.fixtureDirectory = output;
  fs.mkdirSync(output, { recursive: true });
  const log = fs.openSync(path.join(output, "suite.log"), "a");
  const child = spawn(
    process.execPath,
    [path.join(root, "tests", "browser", "run.cjs"), ...browserGroups],
    {
      cwd: root,
      env: {
        ...env,
        TEPSY_UI_URL: base,
        RESTOPOS_UI_URL: base,
        TEPSY_UI_OUTPUT: output,
        RESTOPOS_UI_OUTPUT: output,
        TEPSY_UI_COOKIE: cookie,
        RESTOPOS_UI_COOKIE: cookie,
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      fs.writeSync(log, chunk);
      process.stdout.write(chunk);
    });
  }
  try {
    const [code] = await once(child, "close");
    assert.equal(code, 0, `Fixture browser suite failed; see ${output}/suite.log`);
  } finally {
    fs.closeSync(log);
  }
}

function socketEvent(socket, name, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, received);
      reject(new Error(`Socket ${name} event timed out`));
    }, timeout);
    function received(value) {
      clearTimeout(timer);
      resolve(value);
    }
    socket.once(name, received);
  });
}

async function connect(cookie, { rejected = false } = {}) {
  const socket = io(base, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 6000,
    extraHeaders: cookie ? { Cookie: cookie } : {},
  });
  sockets.add(socket);
  if (rejected) {
    await socketEvent(socket, "connect_error");
    assert.equal(socket.connected, false);
    socket.disconnect();
  } else {
    await socketEvent(socket, "connect");
  }
  return socket;
}

function signSession(cookie, expiresAt) {
  const token = cookie.slice(cookie.indexOf("=") + 1);
  const session = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
  const payload = Buffer.from(JSON.stringify({ ...session, expiresAt })).toString("base64url");
  const secret = env.TEPSY_SESSION_SECRET || env.RESTOPOS_SESSION_SECRET;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `tepsy_session=${payload}.${signature}`;
}

async function main() {
  assert.ok(
    fs.existsSync(path.join(root, ".next", "BUILD_ID")),
    "Run npm run build before this integration suite"
  );
  fs.mkdirSync(qaRoot, { recursive: true });
  directory = fs.mkdtempSync(path.join(qaRoot, "integration-"));
  const database = path.join(directory, "test.db");
  const devices = path.join(directory, "devices.json");
  assert.equal(path.dirname(database), directory);
  assert.ok(directory.startsWith(`${qaRoot}${path.sep}integration-`));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const sessionSecret = crypto.randomBytes(48).toString("hex");
  const dbUrl = `file:${database.replaceAll("\\", "/")}`;
  env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    TEPSY_DATABASE_URL: dbUrl,
    RESTOPOS_DATABASE_URL: dbUrl,
    TEPSY_DEVICES_CONFIG_PATH: devices,
    RESTOPOS_DEVICES_CONFIG_PATH: devices,
    TEPSY_BACKUP_DIR: path.join(directory, "backups"),
    TEPSY_MENU_IMAGE_DIR: path.join(directory, "menu-images"),
    TEPSY_SESSION_SECRET: sessionSecret,
    TEPSY_SESSION_REVOCATION_PATH: path.join(directory, "revoked-sessions.db"),
    RESTOPOS_SESSION_SECRET: sessionSecret,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  // Never allow isolated tests to authenticate to a real terminal provider.
  for (const key of Object.keys(env)) if (/^(TEPSY|RESTOPOS)_TOKENX_/.test(key)) delete env[key];
  result.directory = directory;
  result.base = base;
  result.buildId = fs.readFileSync(path.join(root, ".next", "BUILD_ID"), "utf8").trim();
  console.log(`Isolated production suite: ${directory}`);
  const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
  const migration = spawnSync(
    process.execPath,
    [
      prismaCli,
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema-datamodel",
      path.join(root, "prisma", "schema.prisma"),
      "--script",
    ],
    { cwd: root, env, windowsHide: true, encoding: "utf8" }
  );
  if (migration.error) throw migration.error;
  assert.equal(migration.status, 0, migration.stderr);
  const applied = spawnSync(
    process.execPath,
    [prismaCli, "db", "execute", "--url", dbUrl, "--stdin"],
    { cwd: root, env, input: migration.stdout, windowsHide: true, encoding: "utf8" }
  );
  if (applied.error) throw applied.error;
  assert.equal(applied.status, 0, applied.stderr);
  await startServer();

  await check(
    "demo seed requires explicit disposable data and preserves every existing record",
    async () => {
      const demoPath = path.join(directory, "demo.db");
      const demoUrl = "file:" + demoPath.replaceAll("\\", "/");
      const initialized = spawnSync(
        process.execPath,
        [prismaCli, "db", "execute", "--url", demoUrl, "--stdin"],
        { cwd: root, env, input: migration.stdout, encoding: "utf8", windowsHide: true }
      );
      assert.equal(initialized.status, 0, initialized.stderr);
      const seedEnv = { ...env, TEPSY_SEED_DATABASE_URL: demoUrl };
      const seeded = spawnSync(process.execPath, ["prisma/seed.js"], {
        cwd: root,
        env: seedEnv,
        encoding: "utf8",
        windowsHide: true,
      });
      assert.equal(seeded.status, 0, seeded.stderr);
      const { PrismaClient } = require("@prisma/client");
      const demo = new PrismaClient({ datasources: { db: { url: demoUrl } } });
      try {
        const beforeSeed = {
          tables: await demo.table.count(),
          categories: await demo.category.count(),
          menu: await demo.menuItem.count(),
          config: await demo.restaurantConfig.findFirst(),
        };
        assert.ok(beforeSeed.tables > 0 && beforeSeed.categories > 0 && beforeSeed.menu > 0);
        assert.equal(beforeSeed.config.isSetupCompleted, true);
        assert.equal(beforeSeed.config.restaurantCode, "DEMO01");
        assert.equal(beforeSeed.config.authEnabled, true);
        const { verifyCredential } = await import("../../src/lib/auth-local.js");
        assert.ok(verifyCredential("TepsyDemo123!", beforeSeed.config.accessPasswordHash));
        const staff = await demo.staffUser.findMany();
        assert.equal(staff.length, 3);
        assert.ok(staff.every((user) => verifyCredential("1234", user.pinHash)));
        assert.equal(await demo.order.count(), 2);
        assert.equal(await demo.table.count({ where: { qrToken: null } }), 0);
        const replay = spawnSync(process.execPath, ["prisma/seed.js"], {
          cwd: root,
          env: seedEnv,
          encoding: "utf8",
          windowsHide: true,
        });
        assert.notEqual(replay.status, 0);
        assert.deepEqual(
          {
            tables: await demo.table.count(),
            categories: await demo.category.count(),
            menu: await demo.menuItem.count(),
            config: await demo.restaurantConfig.findFirst(),
          },
          beforeSeed
        );
        const noSeedEnv = { ...env };
        delete noSeedEnv.TEPSY_SEED_DATABASE_URL;
        delete noSeedEnv.RESTOPOS_SEED_DATABASE_URL;
        const missing = spawnSync(process.execPath, ["prisma/seed.js"], {
          cwd: root,
          env: noSeedEnv,
          encoding: "utf8",
          windowsHide: true,
        });
        assert.notEqual(missing.status, 0);
        assert.match(missing.stderr, /SEED_DATABASE_URL/);
        const liveTarget = spawnSync(process.execPath, ["prisma/seed.js"], {
          cwd: root,
          env: { ...env, TEPSY_SEED_DATABASE_URL: dbUrl },
          encoding: "utf8",
          windowsHide: true,
        });
        assert.notEqual(liveTarget.status, 0);
        assert.match(liveTarget.stderr, /restaurant database/);
      } finally {
        await demo.$disconnect();
      }
    }
  );

  await check("untrusted Host cannot reach the local bootstrap server", async () => {
    const status = await new Promise((resolve, reject) => {
      http
        .get(
          `${base}/api/auth/status`,
          {
            headers: { Host: "rebind.attacker.invalid", Origin: "http://rebind.attacker.invalid" },
          },
          (response) => {
            response.resume();
            response.on("end", () => resolve(response.statusCode));
          }
        )
        .on("error", reject);
    });
    assert.equal(status, 421);
  });

  const password = `Integration-${crypto.randomBytes(12).toString("hex")}`;
  let owner;
  let code;
  let tables;
  let espresso;
  const staff = {};
  const credentials = {};
  let shift;
  let paidOrder;
  let qrOrder;
  let qrToken;
  let otherToken;
  let waiterSocket;
  let kitchenSocket;
  let cashReceipt, cardReceipt, photoImage, setupLogo;
  await check(
    "fresh entry offers setup and validates credentials and optional logo before creating records",
    async () => {
      assert.equal(expectStatus(await api("/api/auth/status"), 200).canSetup, true);
      assert.equal((await api("/")).headers.get("location"), "/login");
      expectStatus(
        await api("/api/setup", {
          method: "POST",
          body: {
            restaurantName: "Fresh QA",
            restaurantCode: "FRESH",
            ownerPassword: "bad",
            ownerPasswordConfirm: "bad",
            sections: [{ name: "Salon", tableCount: 1 }],
          },
        }),
        400
      );
      const sharp = require("sharp");
      const image = await sharp({
        create: { width: 32, height: 32, channels: 4, background: "#cf6520" },
      })
        .png()
        .toBuffer();
      setupLogo = expectStatus(
        await api("/api/setup/logo", {
          method: "POST",
          headers: { "Content-Type": "image/png" },
          rawBody: image,
        }),
        201
      );
    }
  );

  await check(
    "fresh database setup creates real tables and products without replacing data",
    async () => {
      expectStatus(
        await api("/api/setup", {
          method: "POST",
          body: {
            restaurantName: "TEPSY Integration Restaurant",
            restaurantLogoUrl: setupLogo.imageUrl,
            restaurantCode: "QA_RESTAURANT",
            ownerPassword: password,
            ownerPasswordConfirm: password,
            currency: "₺",
            sections: [{ name: "QA Salon", tableCount: 12 }],
            categories: [
              {
                name: "QA Drinks",
                items: [
                  { name: "QA Espresso", price: "42.50" },
                  { name: "QA Tea", price: "18.25" },
                ],
              },
            ],
          },
        }),
        200
      );
      code = "QA_RESTAURANT";
      const setupLogin = await api("/api/auth/login", {
        method: "POST",
        body: { restaurantCode: code, password, rememberDevice: true },
      });
      expectStatus(setupLogin, 200);
      owner = setupLogin.cookie;
      assert.match(setupLogin.headers.get("set-cookie"), /HttpOnly/i);
      assert.match(setupLogin.headers.get("set-cookie"), /Max-Age=2592000/i);
      const config = expectStatus(await api("/api/config", { cookie: owner }), 200);
      assert.equal(config.isSetupCompleted, true);
      assert.equal(config.restaurantLogoUrl, setupLogo.imageUrl);
      assert.equal(config.authEnabled, true);
      expectStatus(
        await api("/api/setup/logo", {
          method: "POST",
          cookie: owner,
          headers: { "Content-Type": "image/png" },
          rawBody: Buffer.from("bad"),
        }),
        409
      );
      code = config.restaurantCode;
      tables = expectStatus(await api("/api/tables", { cookie: owner }), 200).sort((a, b) =>
        a.tableNumber.localeCompare(b.tableNumber, undefined, { numeric: true })
      );
      assert.equal(tables.length, 12);
      espresso = expectStatus(await api("/api/menu-items", { cookie: owner }), 200).find(
        (item) => item.name === "QA Espresso"
      );
      assert.equal(Number(espresso.price), 42.5);
      expectStatus(
        await api("/api/setup", {
          method: "POST",
          cookie: owner,
          body: {
            restaurantName: "Do not replace",
            restaurantCode: code,
            ownerPassword: password,
            ownerPasswordConfirm: password,
            sections: [{ name: "Another", tableCount: 1 }],
          },
        }),
        409
      );
      assert.equal(expectStatus(await api("/api/tables", { cookie: owner }), 200).length, 12);
    }
  );

  await check(
    "owner bootstrap enforces authentication immediately and rejects forged, expired and wrong credentials",
    async () => {
      const boot = await api("/api/auth/change-password", {
        method: "POST",
        cookie: owner,
        body: { currentPassword: password, newPassword: password },
      });
      expectStatus(boot, 200);
      owner = boot.cookie;
      assert.ok(owner);
      expectStatus(await api("/api/staff"), 401);
      expectStatus(
        await api("/api/auth/login", {
          method: "POST",
          body: { restaurantCode: code, password: "wrong-password" },
        }),
        401
      );
      const login = await api("/api/auth/login", {
        method: "POST",
        body: { restaurantCode: code, password },
      });
      expectStatus(login, 200);
      owner = login.cookie;
      expectStatus(await api("/api/staff", { cookie: `${owner}x` }), 401);
      expectStatus(await api("/api/staff", { cookie: signSession(owner, Date.now() - 1000) }), 401);
      const redirect = await api("/admin");
      assert.equal(redirect.status, 302);
      assert.equal(redirect.headers.get("location"), "/login");
      expectStatus(
        await api("/api/config", {
          method: "PUT",
          cookie: owner,
          headers: { Origin: "http://untrusted.invalid" },
          body: { restaurantName: "Origin attack" },
        }),
        403
      );
    }
  );

  await check(
    "staff roles enforce API and page permissions; disabled identity loses access",
    async () => {
      for (const role of ["ADMIN", "WAITER", "KITCHEN", "CASHIER"]) {
        const name = `QA ${role}`;
        staff[role] = expectStatus(
          await api("/api/staff", {
            method: "POST",
            cookie: owner,
            body: { name, role, pin: "8246" },
          }),
          201
        );
        const login = await api("/api/auth/login", {
          method: "POST",
          body: { restaurantCode: code, username: name, pin: "8246" },
        });
        expectStatus(login, 200);
        credentials[role] = login.cookie;
      }
      expectStatus(await api("/api/staff", { cookie: credentials.WAITER }), 403);
      for (const route of [
        "/api/Staff",
        "/API/staff",
        "/api/%73taff",
        "/api/%64evices",
        "/api/Devices",
        "/%61pi/devices",
        "/api/staff/",
      ]) {
        const response = await api(route, { cookie: credentials.WAITER });
        assert.notEqual(response.status, 200, `Waiter read restricted data through ${route}`);
      }
      expectStatus(
        await api("/api/pos/payment", { method: "POST", cookie: credentials.WAITER, body: {} }),
        403
      );
      expectStatus(await api("/api/qr-requests", { cookie: credentials.KITCHEN }), 403);
      expectStatus(
        await api("/api/menu-items", { method: "POST", cookie: credentials.CASHIER, body: {} }),
        403
      );
      expectStatus(await api("/api/devices", { cookie: credentials.CASHIER }), 403);
      const redirect = await api("/admin", { cookie: credentials.WAITER });
      assert.equal(redirect.status, 302);
      assert.equal(redirect.headers.get("location"), "/order");
      const disabled = expectStatus(
        await api("/api/staff", {
          method: "POST",
          cookie: owner,
          body: { name: "QA Disabled", role: "WAITER", pin: "1234" },
        }),
        201
      );
      const disabledLogin = await api("/api/auth/login", {
        method: "POST",
        body: { restaurantCode: code, username: "QA Disabled", pin: "1234" },
      });
      expectStatus(disabledLogin, 200);
      const liveSocket = await connect(disabledLogin.cookie);
      const disconnected = socketEvent(liveSocket, "disconnect");
      expectStatus(
        await api("/api/staff", {
          method: "PUT",
          cookie: owner,
          body: { id: disabled.id, isActive: false },
        }),
        200
      );
      await disconnected;
      expectStatus(await api("/api/tables", { cookie: disabledLogin.cookie }), 401);
      await connect(disabledLogin.cookie, { rejected: true });
      await connect(undefined, { rejected: true });
    }
  );

  await check(
    "authentication endpoints reject malformed and oversized JSON before verifying credentials",
    async () => {
      for (const route of ["/api/auth/login", "/api/auth/change-password"]) {
        for (const rawBody of ["null", "[]", "{"])
          expectStatus(await api(route, { method: "POST", rawBody }), 400);
        expectStatus(
          await api(route, {
            method: "POST",
            rawBody: JSON.stringify({ password: "x".repeat(20_000) }),
          }),
          413
        );
      }
    }
  );

  await check(
    "all public JSON writes reject oversized declared and chunked requests without authentication",
    async () => {
      const large = JSON.stringify({
        token: "a".repeat(48),
        type: "WAITER",
        orderId: "unknown",
        padding: "x".repeat(40_000),
      });
      for (const [route, method] of [
        ["/api/public/orders", "POST"],
        ["/api/public/orders", "DELETE"],
        ["/api/public/service-requests", "POST"],
      ]) {
        expectStatus(await api(route, { method, rawBody: large }), 413);
        const rawBody = new ReadableStream({
          start(controller) {
            const bytes = new TextEncoder().encode(large);
            for (let offset = 0; offset < bytes.length; offset += 8192)
              controller.enqueue(bytes.subarray(offset, offset + 8192));
            controller.close();
          },
        });
        expectStatus(await api(route, { method, rawBody }), 413);
      }
      expectStatus(await api("/api/auth/status"), 200);
    }
  );

  await check("only the owner can assign or change administrator accounts", async () => {
    expectStatus(
      await api("/api/config", {
        method: "PUT",
        cookie: credentials.ADMIN,
        body: { authEnabled: false },
      }),
      403
    );
    const target = expectStatus(
      await api("/api/staff", {
        method: "POST",
        cookie: owner,
        body: { name: "QA Second Admin", role: "ADMIN", pin: "1234" },
      }),
      201
    );
    for (const changes of [{ role: "WAITER" }, { isActive: false }, { pin: "9999" }]) {
      expectStatus(
        await api("/api/staff", {
          method: "PUT",
          cookie: credentials.ADMIN,
          body: { id: target.id, ...changes },
        }),
        403
      );
    }
    expectStatus(
      await api(`/api/staff?id=${target.id}`, { method: "DELETE", cookie: credentials.ADMIN }),
      403
    );
    expectStatus(
      await api("/api/staff", {
        method: "POST",
        cookie: credentials.ADMIN,
        body: { name: "QA Forbidden Admin", role: "ADMIN", pin: "1234" },
      }),
      403
    );
    expectStatus(
      await api("/api/staff", {
        method: "PUT",
        cookie: credentials.ADMIN,
        body: { id: staff.WAITER.id, role: "ADMIN" },
      }),
      403
    );
    const demoted = expectStatus(
      await api("/api/staff", {
        method: "PUT",
        cookie: owner,
        body: { id: target.id, role: "WAITER" },
      }),
      200
    );
    assert.equal(demoted.role, "WAITER");
    expectStatus(
      await api(`/api/staff?id=${target.id}`, { method: "DELETE", cookie: credentials.ADMIN }),
      200
    );
  });

  await check("connected sockets expire with the authenticated session", async () => {
    const expiring = await connect(signSession(credentials.WAITER, Date.now() + 1200));
    await socketEvent(expiring, "disconnect", 6000);
    assert.equal(expiring.connected, false);
  });

  await check(
    "staff order uses server prices, validates quantities and missing products, emits real updates",
    async () => {
      waiterSocket = await connect(credentials.WAITER);
      kitchenSocket = await connect(credentials.KITCHEN);
      for (const quantity of [0, -1, 1.5, 100]) {
        expectStatus(
          await api("/api/orders", {
            method: "POST",
            cookie: credentials.WAITER,
            body: { tableId: tables[0].id, items: [{ menuItemId: espresso.id, quantity }] },
          }),
          400
        );
      }
      expectStatus(
        await api("/api/orders", {
          method: "POST",
          cookie: credentials.WAITER,
          body: { tableId: tables[0].id, items: [{ menuItemId: "missing", quantity: 1 }] },
        }),
        400
      );
      expectStatus(
        await api("/api/orders", {
          method: "POST",
          cookie: credentials.WAITER,
          rawBody: "{broken",
        }),
        400
      );
      const received = socketEvent(kitchenSocket, "order:new");
      const orderEvents = [];
      const onOrder = (order) => orderEvents.push(order.id);
      kitchenSocket.on("order:new", onOrder);
      const body = {
        tableId: tables[0].id,
        idempotencyKey: "integration-staff-order",
        totalPrice: "0.01",
        items: [{ menuItemId: espresso.id, quantity: 2, unitPrice: "0.01" }],
      };
      const concurrent = await Promise.all(
        Array.from({ length: 3 }, () =>
          api("/api/orders", { method: "POST", cookie: credentials.WAITER, body })
        )
      );
      const created = concurrent.map((response) => expectStatus(response, 201));
      paidOrder = created[0];
      assert.deepEqual(
        created.map((order) => order.id),
        [paidOrder.id, paidOrder.id, paidOrder.id]
      );
      assert.equal(Number(paidOrder.totalPrice), 85);
      assert.equal(Number(paidOrder.items[0].unitPrice), 42.5);
      assert.equal((await received).id, paidOrder.id);
      const replay = expectStatus(
        await api("/api/orders", { method: "POST", cookie: credentials.WAITER, body }),
        201
      );
      assert.equal(replay.id, paidOrder.id);
      expectStatus(
        await api("/api/orders", {
          method: "POST",
          cookie: credentials.WAITER,
          body: { ...body, items: [{ menuItemId: espresso.id, quantity: 3 }] },
        }),
        409
      );
      assert.equal(
        expectStatus(await api(`/api/orders?tableId=${tables[0].id}`, { cookie: owner }), 200)
          .length,
        1
      );
      assert.equal(
        expectStatus(await api("/api/tables", { cookie: owner }), 200).find(
          (table) => table.id === tables[0].id
        ).status,
        "OCCUPIED"
      );
      await wait(200);
      kitchenSocket.off("order:new", onOrder);
      assert.deepEqual(
        orderEvents,
        [paidOrder.id],
        "retries must not duplicate kitchen notifications"
      );
    }
  );

  await check("kitchen preparation and waiter delivery enforce state and role rules", async () => {
    const orderPath = `/api/orders/${paidOrder.id}`;
    expectStatus(
      await api(orderPath, {
        method: "PATCH",
        cookie: credentials.KITCHEN,
        body: { addItems: [{ menuItemId: espresso.id, quantity: 1 }] },
      }),
      403
    );
    expectStatus(
      await api(orderPath, {
        method: "PATCH",
        cookie: credentials.KITCHEN,
        body: { status: "PREPARING" },
      }),
      200
    );
    const itemId = paidOrder.items[0].id;
    expectStatus(
      await api(orderPath, {
        method: "PATCH",
        cookie: credentials.KITCHEN,
        body: { itemStatusUpdate: { itemId, expectedStatus: "PREPARING", status: "READY" } },
      }),
      200
    );
    expectStatus(
      await api(orderPath, {
        method: "PATCH",
        cookie: credentials.KITCHEN,
        body: { itemStatusUpdate: { itemId, expectedStatus: "PREPARING", status: "PENDING" } },
      }),
      409
    );
    expectStatus(
      await api(orderPath, {
        method: "PATCH",
        cookie: credentials.KITCHEN,
        body: { itemStatusUpdate: { itemId, expectedStatus: "READY", status: "CANCELLED" } },
      }),
      400
    );
    assert.equal(Number(expectStatus(await api(orderPath, { cookie: owner }), 200).totalPrice), 85);
    const ready = socketEvent(waiterSocket, "order:ready");
    expectStatus(
      await api(orderPath, {
        method: "PATCH",
        cookie: credentials.KITCHEN,
        body: { status: "READY" },
      }),
      200
    );
    assert.equal((await ready).id, paidOrder.id);
    expectStatus(
      await api(orderPath, {
        method: "PATCH",
        cookie: credentials.KITCHEN,
        body: { status: "DELIVERED" },
      }),
      403
    );
    expectStatus(
      await api(orderPath, {
        method: "PATCH",
        cookie: credentials.WAITER,
        body: { status: "DELIVERED" },
      }),
      200
    );
    expectStatus(
      await api(orderPath, {
        method: "PATCH",
        cookie: credentials.WAITER,
        body: { status: "PENDING" },
      }),
      409
    );
    assert.equal(
      expectStatus(await api(orderPath, { cookie: owner }), 200).items[0].status,
      "DELIVERED"
    );
  });

  await check(
    "cash and manual card settlement preserve balances, retry idempotency and failure atomicity",
    async () => {
      shift = expectStatus(
        await api("/api/pos/shift", {
          method: "POST",
          cookie: credentials.CASHIER,
          body: { openingCash: "100.00" },
        }),
        201
      ).shift;
      const firstBody = {
        orderId: paidOrder.id,
        paymentMethod: "CASH",
        idempotencyKey: `cash-${paidOrder.id}`,
        amountPaid: "20.00",
      };
      const first = expectStatus(
        await api("/api/pos/payment", {
          method: "POST",
          cookie: credentials.CASHIER,
          body: firstBody,
        }),
        200
      );
      assert.equal(first.amountPaid, "20.00");
      assert.equal(first.remainingBalance, "65.00");
      assert.deepEqual(
        expectStatus(
          await api("/api/pos/payment", {
            method: "POST",
            cookie: credentials.CASHIER,
            body: firstBody,
          }),
          200
        ),
        first
      );
      expectStatus(
        await api("/api/pos/payment", {
          method: "POST",
          cookie: credentials.CASHIER,
          body: { ...firstBody, amountPaid: "21.00" },
        }),
        409
      );
      expectStatus(
        await api("/api/orders/" + paidOrder.id, {
          method: "PATCH",
          cookie: owner,
          body: { addItems: [{ menuItemId: espresso.id, quantity: 1 }] },
        }),
        409
      );
      const cardBody = {
        orderId: paidOrder.id,
        paymentMethod: "CREDIT_CARD",
        idempotencyKey: `card-${paidOrder.id}`,
      };
      expectStatus(
        await api("/api/pos/payment", {
          method: "POST",
          cookie: credentials.CASHIER,
          body: cardBody,
        }),
        409
      );
      const originalDeviceConfig = expectStatus(
        await api("/api/devices", { cookie: owner }),
        200
      ).config;
      const beforeFailure = expectStatus(
        await api("/api/orders/" + paidOrder.id, { cookie: owner }),
        200
      );
      const shiftBeforeFailure = expectStatus(
        await api("/api/pos/shift", { cookie: credentials.CASHIER }),
        200
      );
      expectStatus(
        await api("/api/devices", {
          method: "PUT",
          cookie: owner,
          body: {
            ...originalDeviceConfig,
            paymentTerminal: {
              enabled: true,
              adapter: "NEXO_LOCAL",
              host: "127.0.0.1",
              port: 20007,
            },
          },
        }),
        200
      );
      const failed = await api("/api/pos/payment", {
        method: "POST",
        cookie: credentials.CASHIER,
        body: { ...cardBody, manualCardConfirmed: true },
      });
      expectStatus(failed, 503);
      assert.equal(failed.data.code, "terminal-payment-unavailable");
      const afterFailure = expectStatus(
        await api("/api/orders/" + paidOrder.id, { cookie: owner }),
        200
      );
      assert.equal(afterFailure.status, "DELIVERED");
      assert.deepEqual(
        afterFailure.payments,
        beforeFailure.payments,
        "failed terminal payment must leave the ledger unchanged"
      );
      assert.equal(Number(afterFailure.totalPrice), 85);
      assert.equal(Number(afterFailure.payments[0].amountPaid), 20);
      assert.equal(Number(afterFailure.discountAmount), 0);
      assert.equal(
        expectStatus(await api("/api/tables", { cookie: owner }), 200).find(
          (table) => table.id === tables[0].id
        ).status,
        "OCCUPIED"
      );
      assert.deepEqual(
        expectStatus(await api("/api/pos/shift", { cookie: credentials.CASHIER }), 200),
        shiftBeforeFailure
      );
      expectStatus(
        await api("/api/devices", { method: "PUT", cookie: owner, body: originalDeviceConfig }),
        200
      );
      const completed = expectStatus(
        await api("/api/pos/payment", {
          method: "POST",
          cookie: credentials.CASHIER,
          body: { ...cardBody, manualCardConfirmed: true },
        }),
        200
      );
      assert.equal(completed.remainingBalance, "0.00");
      assert.equal(completed.amountPaid, "65.00");
      assert.equal(completed.cardVerification, "MANUAL");
      assert.equal(completed.orders[0].status, "PAID");
      assert.equal(completed.table.status, "AVAILABLE");
      assert.deepEqual(
        expectStatus(
          await api("/api/pos/payment", {
            method: "POST",
            cookie: credentials.CASHIER,
            body: { ...cardBody, manualCardConfirmed: true },
          }),
          200
        ),
        completed
      );
      const persisted = expectStatus(
        await api("/api/orders/" + paidOrder.id, { cookie: owner }),
        200
      );
      assert.equal(persisted.payments.length, 2);
      assert.deepEqual(
        persisted.payments
          .map((payment) => [payment.paymentMethod, Number(payment.amountPaid)])
          .sort(),
        [
          ["CASH", 20],
          ["CREDIT_CARD", 65],
        ]
      );
      expectStatus(
        await api("/api/orders/" + paidOrder.id, {
          method: "PATCH",
          cookie: owner,
          body: { status: "CANCELLED" },
        }),
        409
      );
    }
  );

  await check(
    "split-payment history exposes each receipt once and reprints authoritative snapshots",
    async () => {
      expectStatus(await api("/api/pos/payments"), 401);
      expectStatus(await api("/api/pos/payments", { cookie: credentials.WAITER }), 403);
      expectStatus(await api("/api/pos/payments", { cookie: credentials.KITCHEN }), 403);
      const history = expectStatus(
        await api(`/api/pos/payments?tableId=${tables[0].id}`, { cookie: credentials.CASHIER }),
        200
      );
      assert.equal(history.payments.length, 2);
      assert.deepEqual(history.totals, {
        cash: "20.00",
        card: "65.00",
        other: "0.00",
        total: "85.00",
        paymentCount: 2,
      });
      const entry = (method) =>
        history.payments.find((payment) => payment.paymentMethod === method);
      cashReceipt = expectStatus(
        await api("/api/pos/payments/" + entry("CASH").id, { cookie: credentials.CASHIER }),
        200
      ).receipt;
      cardReceipt = expectStatus(
        await api("/api/pos/payments/" + entry("CREDIT_CARD").id, { cookie: credentials.CASHIER }),
        200
      ).receipt;
      for (const [receipt, paid, balance, cumulative, method] of [
        [cashReceipt, "20.00", "65.00", "20.00", "CASH"],
        [cardReceipt, "65.00", "0.00", "85.00", "CREDIT_CARD"],
      ]) {
        assert.equal(receipt.snapshotKind, "PAYMENT_SNAPSHOT");
        assert.equal(receipt.amountPaid, paid);
        assert.equal(receipt.totalAmount, paid);
        assert.equal(receipt.remainingBalance, balance);
        assert.equal(receipt.totalPaid, cumulative);
        assert.equal(receipt.paymentMethod, method);
        assert.equal(receipt.tableId, tables[0].id);
        assert.deepEqual(receipt.orderIds, [paidOrder.id]);
        assert.equal(receipt.items[0].name, "QA Espresso");
        assert.equal(Number(receipt.items[0].unitPrice), 42.5);
        assert.equal(receipt.items[0].quantity, 2);
      }
      assert.notEqual(cashReceipt.id, cardReceipt.id);
      assert.notEqual(cashReceipt.receiptNumber, cardReceipt.receiptNumber);
      assert.equal(cardReceipt.cardVerification, "MANUAL");
      expectStatus(await api("/api/pos/payments/" + cashReceipt.id), 401);
      expectStatus(
        await api("/api/pos/payments/" + cashReceipt.id, { cookie: credentials.WAITER }),
        403
      );
      expectStatus(await api("/api/pos/payments/missing", { cookie: credentials.CASHIER }), 404);
      const firstPage = expectStatus(
        await api(`/api/pos/payments?tableId=${tables[0].id}&limit=1`, {
          cookie: credentials.CASHIER,
        }),
        200
      );
      assert.equal(firstPage.payments.length, 1);
      assert.ok(firstPage.nextCursor);
      const secondPage = expectStatus(
        await api(
          `/api/pos/payments?tableId=${tables[0].id}&limit=1&before=${encodeURIComponent(firstPage.nextCursor)}`,
          { cookie: credentials.CASHIER }
        ),
        200
      );
      assert.equal(secondPage.payments.length, 1);
      assert.notEqual(firstPage.payments[0].id, secondPage.payments[0].id);
      assert.deepEqual(
        firstPage.totals,
        history.totals,
        "pagination must retain account-wide totals"
      );
      const original = expectStatus(await api("/api/devices", { cookie: owner }), 200).config;
      const received = [];
      const receiver = net.createServer((socket) => {
        const bytes = [];
        socket.on("data", (chunk) => bytes.push(chunk));
        socket.on("end", () => received.push(Buffer.concat(bytes)));
      });
      await new Promise((resolve, reject) => {
        receiver.once("error", reject);
        receiver.listen(0, "127.0.0.1", resolve);
      });
      try {
        expectStatus(
          await api("/api/devices", {
            method: "PUT",
            cookie: owner,
            body: {
              ...original,
              receiptPrinter: {
                enabled: true,
                adapter: "TCP_ESC_POS",
                host: "127.0.0.1",
                port: receiver.address().port,
                charsPerLine: 42,
                cutPaper: false,
                openCashDrawer: false,
              },
            },
          }),
          200
        );
        for (const receipt of [cashReceipt, cardReceipt]) {
          const printed = expectStatus(
            await api("/api/print/receipt", {
              method: "POST",
              cookie: credentials.CASHIER,
              body: {
                paymentId: receipt.id,
                amountPaid: "999.00",
                paymentMethod: "OTHER",
                restaurantName: "Spoofed receipt",
              },
            }),
            200
          );
          assert.equal(printed.accepted, true);
        }
        const deadline = Date.now() + 3000;
        while (received.length < 2 && Date.now() < deadline) await wait(20);
        assert.equal(received.length, 2);
        for (const [index, receipt] of [cashReceipt, cardReceipt].entries()) {
          const text = received[index].toString("latin1");
          assert.ok(text.includes(receipt.amountPaid + " TL"));
          assert.ok(text.includes(receipt.paymentMethod === "CASH" ? "NAKIT" : "KART"));
          assert.ok(text.includes(receipt.receiptNumber));
          assert.equal(
            text.includes("999.00"),
            false,
            "print route must reject caller-supplied payment values"
          );
          assert.equal(text.includes("Spoofed receipt"), false);
        }
        assert.equal(
          expectStatus(
            await api(`/api/pos/payments?tableId=${tables[0].id}`, { cookie: owner }),
            200
          ).payments.length,
          2,
          "reprinting must not record payment"
        );
      } finally {
        await new Promise((resolve) => receiver.close(resolve));
        expectStatus(
          await api("/api/devices", { method: "PUT", cookie: owner, body: original }),
          200
        );
      }
    }
  );

  await check(
    "device settings, test printing and terminal probes report transport truth without changing payments",
    async () => {
      const original = expectStatus(await api("/api/devices", { cookie: owner }), 200).config;
      expectStatus(await api("/api/devices/printer/test", { method: "POST" }), 401);
      expectStatus(
        await api("/api/devices/printer/test", { method: "POST", cookie: credentials.WAITER }),
        403
      );
      expectStatus(
        await api("/api/devices/payment/status", { method: "POST", cookie: credentials.CASHIER }),
        403
      );
      const received = [];
      const receiver = net.createServer((socket) => {
        const chunks = [];
        socket.on("data", (chunk) => chunks.push(chunk));
        socket.on("end", () => {
          if (chunks.length) received.push(Buffer.concat(chunks));
        });
      });
      await new Promise((resolve, reject) => {
        receiver.once("error", reject);
        receiver.listen(0, "127.0.0.1", resolve);
      });
      const port = receiver.address().port;
      try {
        const config = {
          ...original,
          receiptPrinter: {
            enabled: true,
            adapter: "TCP_ESC_POS",
            host: "127.0.0.1",
            port,
            charsPerLine: 32,
            cutPaper: false,
            openCashDrawer: false,
          },
          paymentTerminal: { enabled: true, adapter: "NEXO_LOCAL", host: "127.0.0.1", port },
        };
        const saved = expectStatus(
          await api("/api/devices", { method: "PUT", cookie: owner, body: config }),
          200
        ).config;
        assert.equal(saved.receiptPrinter.charsPerLine, 32);
        assert.equal(saved.receiptPrinter.cutPaper, false);
        const tested = expectStatus(
          await api("/api/devices/printer/test", { method: "POST", cookie: owner }),
          200
        );
        assert.equal(tested.accepted, true);
        const deadline = Date.now() + 3000;
        while (!received.length && Date.now() < deadline) await wait(20);
        assert.equal(received.length, 1);
        assert.deepEqual([...received[0].subarray(0, 6)], [0x1b, 0x40, 0x1b, 0x74, 0x0d, 0x20]);
        assert.equal(received[0].subarray(-4).toString(), "\n\n\n\n");
        assert.equal(received[0].includes(Buffer.from([0x1d, 0x56, 0x01])), false);
        const reachable = expectStatus(
          await api("/api/devices/payment/status", { method: "POST", cookie: owner }),
          200
        ).status;
        assert.equal(reachable.connected, true);
        assert.equal(reachable.implemented, false);
        assert.equal(reachable.canInitiatePayment, false);
        const closedPort = await freePort();
        expectStatus(
          await api("/api/devices", {
            method: "PUT",
            cookie: owner,
            body: {
              ...config,
              receiptPrinter: { ...config.receiptPrinter, port: closedPort },
              paymentTerminal: { ...config.paymentTerminal, port: closedPort },
            },
          }),
          200
        );
        const failed = expectStatus(
          await api("/api/devices/printer/test", { method: "POST", cookie: owner }),
          503
        );
        assert.equal(failed.accepted, false);
        assert.equal(failed.code, "ECONNREFUSED");
        const offline = expectStatus(
          await api("/api/devices/payment/status", { cookie: owner }),
          200
        ).status;
        assert.equal(offline.connected, false);
        assert.equal(offline.canInitiatePayment, false);
        expectStatus(
          await api("/api/devices", {
            method: "PUT",
            cookie: owner,
            body: { ...original, receiptPrinter: { enabled: false, adapter: "BROWSER" } },
          }),
          200
        );
        const disabled = expectStatus(
          await api("/api/devices/printer/test", { method: "POST", cookie: owner }),
          409
        );
        assert.equal(disabled.accepted, false);
        assert.equal(disabled.code, "PRINTER_DISABLED");
        assert.equal(
          expectStatus(
            await api("/api/pos/payments?tableId=" + tables[0].id, { cookie: owner }),
            200
          ).payments.length,
          2
        );
      } finally {
        await new Promise((resolve) => receiver.close(resolve));
        expectStatus(
          await api("/api/devices", { method: "PUT", cookie: owner, body: original }),
          200
        );
      }
    }
  );

  await check(
    "TokenX configuration and missing credentials cannot create a payment or bypass roles",
    async () => {
      const original = expectStatus(await api("/api/devices", { cookie: owner }), 200).config;
      const paymentBody = {
        tableId: tables[0].id,
        paymentMethod: "CREDIT_CARD",
        idempotencyKey: "qa-tokenx-transfer",
      };
      expectStatus(await api("/api/pos/terminal", { method: "POST", body: paymentBody }), 401);
      for (const role of ["WAITER", "KITCHEN"])
        expectStatus(
          await api("/api/pos/terminal", {
            method: "POST",
            cookie: credentials[role],
            body: paymentBody,
          }),
          403
        );
      const beforeHistory = expectStatus(
        await api(`/api/pos/payments?tableId=${tables[0].id}`, { cookie: owner }),
        200
      );
      try {
        expectStatus(
          await api("/api/devices", {
            method: "PUT",
            cookie: owner,
            body: {
              ...original,
              paymentTerminal: {
                enabled: true,
                adapter: "TOKENX_CLOUD",
                terminalId: "AV0000000001",
                categorySections: [],
              },
            },
          }),
          200
        );
        const challenge = expectStatus(
          await api("/api/pos/payment", {
            method: "POST",
            cookie: credentials.CASHIER,
            body: paymentBody,
          }),
          409
        );
        assert.equal(challenge.terminalBasketTransferRequired, true);
        const transfer = expectStatus(
          await api("/api/pos/terminal", {
            method: "POST",
            cookie: credentials.CASHIER,
            body: paymentBody,
          }),
          503
        );
        assert.equal(transfer.code, "terminal-credentials-required");
        assert.equal(transfer.accepted, false);
        const confirmation = expectStatus(
          await api("/api/pos/payment", {
            method: "POST",
            cookie: credentials.CASHIER,
            body: { ...paymentBody, manualCardConfirmed: true },
          }),
          409
        );
        assert.equal(confirmation.code, "terminal-transfer-required");
        assert.equal(
          expectStatus(
            await api(`/api/pos/payments?tableId=${tables[0].id}`, { cookie: owner }),
            200
          ).payments.length,
          beforeHistory.payments.length
        );
      } finally {
        expectStatus(
          await api("/api/devices", { method: "PUT", cookie: owner, body: original }),
          200
        );
      }
    }
  );

  await check(
    "QR address saves independently, preserves device settings and enforces admin validation",
    async () => {
      const original = expectStatus(await api("/api/devices", { cookie: owner }), 200).config;
      expectStatus(
        await api("/api/network-info", {
          method: "PUT",
          body: { qrBaseUrl: "http://10.30.40.50:3000" },
        }),
        401
      );
      expectStatus(
        await api("/api/network-info", {
          method: "PUT",
          cookie: credentials.WAITER,
          body: { qrBaseUrl: "http://10.30.40.50:3000" },
        }),
        403
      );
      for (const qrBaseUrl of [
        null,
        {},
        "localhost:3000",
        "http://localhost:3000",
        "http://10.30.40.50:3000/menu/wrong",
      ]) {
        expectStatus(
          await api("/api/network-info", { method: "PUT", cookie: owner, body: { qrBaseUrl } }),
          400
        );
        assert.deepEqual(
          expectStatus(await api("/api/devices", { cookie: owner }), 200).config,
          original
        );
      }
      const result = expectStatus(
        await api("/api/network-info", {
          method: "PUT",
          cookie: owner,
          body: { qrBaseUrl: " http://10.30.40.50:3000/ " },
        }),
        200
      );
      assert.equal(result.baseUrl, "http://10.30.40.50:3000");
      const saved = expectStatus(await api("/api/devices", { cookie: owner }), 200).config;
      assert.deepEqual(saved.receiptPrinter, original.receiptPrinter);
      assert.deepEqual(saved.paymentTerminal, original.paymentTerminal);
      assert.equal(saved.network.qrBaseUrl, "http://10.30.40.50:3000");
      const automatic = expectStatus(
        await api("/api/network-info", { method: "PUT", cookie: owner, body: { qrBaseUrl: "" } }),
        200
      );
      assert.equal(automatic.qrBaseUrl, "");
      assert.equal(automatic.port, Number(new URL(base).port));
      expectStatus(
        await api("/api/devices", { method: "PUT", cookie: owner, body: original }),
        200
      );
    }
  );

  await check(
    "QR orders require enablement and approval, resist duplicate submissions and cross-table access",
    async () => {
      qrToken = expectStatus(
        await api("/api/tables/qr", {
          method: "POST",
          cookie: owner,
          body: { tableId: tables[1].id },
        }),
        200
      ).token;
      otherToken = expectStatus(
        await api("/api/tables/qr", {
          method: "POST",
          cookie: owner,
          body: { tableId: tables[2].id },
        }),
        200
      ).token;
      expectStatus(await api(`/api/public/menu?token=${qrToken}`), 200);
      const qrBody = {
        token: qrToken,
        idempotencyKey: "integration-public-order",
        tableId: tables[2].id,
        totalPrice: 0,
        items: [{ menuItemId: espresso.id, quantity: 2, unitPrice: 0 }],
      };
      expectStatus(await api("/api/public/orders", { method: "POST", body: qrBody }), 403);
      expectStatus(
        await api("/api/config", { method: "PUT", cookie: owner, body: { qrOrderEnabled: true } }),
        200
      );
      expectStatus(
        await api("/api/public/orders", {
          method: "POST",
          body: { ...qrBody, items: [{ menuItemId: espresso.id, quantity: 0 }] },
        }),
        400
      );
      const qrEvents = [];
      const onQrOrder = (order) => qrEvents.push(order.id);
      waiterSocket.on("qr:request", onQrOrder);
      const concurrent = await Promise.all(
        Array.from({ length: 3 }, () => api("/api/public/orders", { method: "POST", body: qrBody }))
      );
      const created = concurrent.map((response) => expectStatus(response, 202));
      qrOrder = created[0];
      assert.deepEqual(
        created.map((order) => order.orderId),
        [qrOrder.orderId, qrOrder.orderId, qrOrder.orderId]
      );
      assert.equal(qrOrder.status, "AWAITING_WAITER_APPROVAL");
      const replay = expectStatus(
        await api("/api/public/orders", { method: "POST", body: qrBody }),
        202
      );
      assert.equal(replay.orderId, qrOrder.orderId);
      expectStatus(
        await api("/api/public/orders", {
          method: "POST",
          body: { ...qrBody, items: [{ menuItemId: espresso.id, quantity: 3 }] },
        }),
        409
      );
      expectStatus(
        await api("/api/public/orders", {
          method: "POST",
          body: { ...qrBody, idempotencyKey: "integration-public-second" },
        }),
        429
      );
      const list = expectStatus(
        await api("/api/orders?activeOnly=true", { cookie: credentials.KITCHEN }),
        200
      );
      assert.ok(!list.some((order) => order.id === qrOrder.orderId));
      expectStatus(await api(`/api/orders/${qrOrder.orderId}`, { cookie: owner }), 404);
      expectStatus(
        await api(`/api/public/orders?token=${otherToken}&orderId=${qrOrder.orderId}`),
        404
      );
      expectStatus(
        await api("/api/public/orders", {
          method: "DELETE",
          body: { token: otherToken, orderId: qrOrder.orderId },
        }),
        409
      );
      assert.deepEqual(
        expectStatus(
          await api(`/api/public/orders?token=${qrToken}&orderId=${qrOrder.orderId}`),
          200
        ),
        { status: "AWAITING_WAITER_APPROVAL" }
      );
      const queue = expectStatus(
        await api("/api/qr-requests", { cookie: credentials.WAITER }),
        200
      );
      assert.equal(queue.filter((entry) => entry.id === qrOrder.orderId).length, 1);
      await wait(200);
      waiterSocket.off("qr:request", onQrOrder);
      assert.deepEqual(
        qrEvents,
        [qrOrder.orderId],
        "retries must not duplicate waiter notifications"
      );
      expectStatus(
        await api("/api/qr-requests", {
          method: "PATCH",
          cookie: credentials.WAITER,
          body: { id: qrOrder.orderId, action: "APPROVE" },
        }),
        200
      );
      expectStatus(
        await api("/api/qr-requests", {
          method: "PATCH",
          cookie: credentials.WAITER,
          body: { id: qrOrder.orderId, action: "APPROVE" },
        }),
        409
      );
      const approved = expectStatus(
        await api(`/api/orders/${qrOrder.orderId}`, { cookie: owner }),
        200
      );
      assert.equal(approved.tableId, tables[1].id);
      assert.equal(Number(approved.totalPrice), 85);
      assert.equal(Number(approved.items[0].unitPrice), 42.5);
      assert.equal(approved.items[0].quantity, 2);
      for (const status of ["PREPARING", "READY"]) {
        expectStatus(
          await api(`/api/orders/${qrOrder.orderId}`, {
            method: "PATCH",
            cookie: credentials.KITCHEN,
            body: { status },
          }),
          200
        );
        assert.deepEqual(
          expectStatus(
            await api(`/api/public/orders?token=${qrToken}&orderId=${qrOrder.orderId}`),
            200
          ),
          { status }
        );
      }
      expectStatus(
        await api("/api/public/orders", {
          method: "DELETE",
          body: { token: qrToken, orderId: qrOrder.orderId },
        }),
        409
      );
      expectStatus(
        await api(`/api/orders/${qrOrder.orderId}`, {
          method: "PATCH",
          cookie: credentials.WAITER,
          body: { status: "DELIVERED" },
        }),
        200
      );
    }
  );

  await check(
    "menu photo uploads validate actual bytes and roles and persist for staff and public menus",
    async () => {
      const previousImages = fs.readdirSync(env.TEPSY_MENU_IMAGE_DIR).sort();
      const png = await require("sharp")({
        create: { width: 32, height: 24, channels: 3, background: "#a04b24" },
      })
        .png()
        .toBuffer();
      const request = { method: "POST", rawBody: png, headers: { "Content-Type": "image/png" } };
      expectStatus(await api("/api/menu-images", request), 401);
      expectStatus(await api("/api/menu-images", { ...request, cookie: credentials.WAITER }), 403);
      expectStatus(await api("/api/menu-images", { ...request, cookie: credentials.CASHIER }), 403);
      expectStatus(
        await api("/api/menu-images", {
          ...request,
          cookie: owner,
          rawBody: Buffer.alloc(5 * 1024 * 1024 + 1),
        }),
        413
      );
      expectStatus(
        await api("/api/menu-images", {
          ...request,
          cookie: owner,
          headers: { "Content-Type": "image/svg+xml" },
          rawBody: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        }),
        415
      );
      expectStatus(
        await api("/api/menu-images", {
          ...request,
          cookie: owner,
          rawBody: Buffer.from("not an image"),
        }),
        400
      );
      expectStatus(
        await api("/api/menu-images", {
          ...request,
          cookie: owner,
          headers: { "Content-Type": "image/jpeg" },
        }),
        400
      );
      assert.deepEqual(
        fs.readdirSync(env.TEPSY_MENU_IMAGE_DIR).sort(),
        previousImages,
        "invalid uploads must leave image storage unchanged"
      );
      photoImage = expectStatus(await api("/api/menu-images", { ...request, cookie: owner }), 201);
      expectStatus(
        await api("/api/config", {
          method: "PUT",
          cookie: credentials.WAITER,
          body: { restaurantLogoUrl: photoImage.imageUrl },
        }),
        403
      );
      expectStatus(
        await api("/api/config", {
          method: "PUT",
          cookie: owner,
          body: { restaurantLogoUrl: "https://external.invalid/logo.png" },
        }),
        400
      );
      expectStatus(
        await api("/api/config", {
          method: "PUT",
          cookie: owner,
          body: { restaurantLogoUrl: photoImage.imageUrl },
        }),
        200
      );
      assert.equal(
        expectStatus(await api("/api/public/menu?token=" + qrToken), 200).restaurant.logoUrl,
        photoImage.imageUrl
      );
      expectStatus(
        await api("/api/config", {
          method: "PUT",
          cookie: owner,
          body: { restaurantLogoUrl: null },
        }),
        200
      );
      assert.equal(
        expectStatus(await api("/api/config", { cookie: owner }), 200).restaurantLogoUrl,
        null
      );
      assert.match(photoImage.imageUrl, /^\/api\/public\/menu-images\/[a-f0-9]{64}\.webp$/);
      assert.deepEqual([photoImage.width, photoImage.height], [32, 24]);
      assert.deepEqual(
        expectStatus(await api("/api/menu-images", { ...request, cookie: credentials.ADMIN }), 201),
        photoImage,
        "duplicate image upload should reuse the asset"
      );
      assert.equal(fs.readdirSync(env.TEPSY_MENU_IMAGE_DIR).length, previousImages.length + 1);
      expectStatus(
        await api("/api/menu-items", {
          method: "PUT",
          cookie: owner,
          body: { id: espresso.id, imageUrl: photoImage.imageUrl },
        }),
        200
      );
      const staffMenu = expectStatus(
        await api("/api/menu-items", { cookie: credentials.WAITER }),
        200
      );
      const publicMenu = expectStatus(await api(`/api/public/menu?token=${qrToken}`), 200);
      assert.equal(staffMenu.find((item) => item.id === espresso.id).imageUrl, photoImage.imageUrl);
      assert.equal(
        publicMenu.items.find((item) => item.id === espresso.id).imageUrl,
        photoImage.imageUrl
      );
      const served = await fetch(base + photoImage.imageUrl);
      assert.equal(served.status, 200);
      assert.match(served.headers.get("content-type"), /^image\/webp/);
      assert.match(served.headers.get("cache-control"), /immutable/);
      const bytes = Buffer.from(await served.arrayBuffer());
      assert.equal((await require("sharp")(bytes).metadata()).format, "webp");
      assert.deepEqual(
        bytes,
        fs.readFileSync(path.join(env.TEPSY_MENU_IMAGE_DIR, photoImage.imageUrl.split("/").pop()))
      );
      expectStatus(await api("/api/public/menu-images/not-an-asset.webp"), 401);
      expectStatus(await api("/api/public/menu-images/not-an-asset.webp", { cookie: owner }), 404);
      expectStatus(await api("/api/public/menu-images/" + "0".repeat(64) + ".webp"), 404);
      expectStatus(
        await api("/api/menu-items", {
          method: "PUT",
          cookie: owner,
          body: { id: espresso.id, imageUrl: "javascript:alert(1)" },
        }),
        400
      );
      assert.equal(
        expectStatus(await api("/api/menu-items", { cookie: owner }), 200).find(
          (item) => item.id === espresso.id
        ).imageUrl,
        photoImage.imageUrl
      );
      expectStatus(
        await api("/api/menu-items", {
          method: "PUT",
          cookie: owner,
          body: { id: espresso.id, imageUrl: null },
        }),
        200
      );
      assert.equal(
        expectStatus(await api(`/api/public/menu?token=${qrToken}`), 200).items.find(
          (item) => item.id === espresso.id
        ).imageUrl,
        null
      );
      expectStatus(
        await api("/api/menu-items", {
          method: "PUT",
          cookie: owner,
          body: { id: espresso.id, imageUrl: photoImage.imageUrl },
        }),
        200
      );
    }
  );

  await check(
    "menu edits retain original product names and prices on staff and QR orders",
    async () => {
      expectStatus(
        await api("/api/menu-items", {
          method: "PUT",
          cookie: owner,
          body: { id: espresso.id, name: "QA Espresso renamed", price: "99.00" },
        }),
        200
      );
      for (const id of [paidOrder.id, qrOrder.orderId]) {
        const historical = expectStatus(await api(`/api/orders/${id}`, { cookie: owner }), 200);
        assert.equal(historical.items[0].menuItemName, "QA Espresso");
        assert.equal(historical.items[0].menuItem.name, "QA Espresso renamed");
        assert.equal(Number(historical.items[0].unitPrice), 42.5);
        assert.equal(Number(historical.totalPrice), 85);
      }
      for (const receipt of [cashReceipt, cardReceipt]) {
        assert.deepEqual(
          expectStatus(
            await api("/api/pos/payments/" + receipt.id, { cookie: credentials.CASHIER }),
            200
          ).receipt,
          receipt,
          "historical payment receipts must retain all original values after a product rename or repricing"
        );
      }
      const laterCategory = expectStatus(
        await api("/api/categories", {
          method: "POST",
          cookie: owner,
          body: { name: "QA Later Category" },
        }),
        201
      );
      expectStatus(
        await api("/api/menu-items", {
          method: "PUT",
          cookie: owner,
          body: { id: espresso.id, categoryId: laterCategory.id },
        }),
        200
      );
      const report = expectStatus(
        await api("/api/reports/z-report?period=today", { cookie: owner }),
        200
      );
      assert.equal(
        report.categoryBreakdown.some((category) => category.categoryName === "QA Later Category"),
        false
      );
      assert.equal(
        report.categoryBreakdown.some((category) => category.categoryName === "QA Drinks"),
        true
      );
      expectStatus(
        await api("/api/menu-items", {
          method: "PUT",
          cookie: owner,
          body: { id: espresso.id, categoryId: espresso.categoryId },
        }),
        200
      );
      expectStatus(
        await api("/api/menu-items", {
          method: "PUT",
          cookie: owner,
          body: { id: espresso.id, name: "QA Espresso", price: "42.50" },
        }),
        200
      );
    }
  );

  await check(
    "catalog validation and historical delete conflicts preserve original orders",
    async () => {
      for (const body of [
        null,
        [],
        "invalid",
        { name: 1 },
        { name: "QA Invalid", sortOrder: "1" },
        { name: "QA Invalid", icon: null },
      ]) {
        expectStatus(await api("/api/categories", { method: "POST", cookie: owner, body }), 400);
      }
      expectStatus(
        await api("/api/categories", { method: "POST", cookie: owner, rawBody: "{broken" }),
        400
      );
      for (const body of [
        null,
        { id: 1, name: "QA Invalid" },
        { id: espresso.categoryId, name: false },
      ]) {
        expectStatus(await api("/api/categories", { method: "PUT", cookie: owner, body }), 400);
      }
      expectStatus(
        await api("/api/categories", {
          method: "POST",
          cookie: owner,
          body: { name: "QA Drinks" },
        }),
        409
      );
      expectStatus(
        await api("/api/categories", {
          method: "PUT",
          cookie: owner,
          body: { id: "missing-category", name: "QA Missing" },
        }),
        404
      );
      expectStatus(
        await api("/api/categories?id=missing-category", { method: "DELETE", cookie: owner }),
        404
      );
      expectStatus(
        await api("/api/menu-items?id=missing-product", { method: "DELETE", cookie: owner }),
        404
      );
      expectStatus(
        await api(`/api/menu-items?id=${espresso.id}`, { method: "DELETE", cookie: owner }),
        409
      );
      expectStatus(
        await api(`/api/categories?id=${espresso.categoryId}`, { method: "DELETE", cookie: owner }),
        409
      );
      const categories = expectStatus(await api("/api/categories", { cookie: owner }), 200);
      assert.ok(
        categories.some((category) => category.id === espresso.categoryId),
        "referenced category must survive a rejected delete"
      );
      assert.ok(
        expectStatus(await api("/api/menu-items", { cookie: owner }), 200).some(
          (item) => item.id === espresso.id
        ),
        "referenced product must survive a rejected delete"
      );
      for (const id of [paidOrder.id, qrOrder.orderId]) {
        const historical = expectStatus(await api(`/api/orders/${id}`, { cookie: owner }), 200);
        assert.equal(historical.items[0].menuItemName, "QA Espresso");
        assert.equal(historical.items[0].menuItem.id, espresso.id);
        assert.equal(Number(historical.items[0].unitPrice), 42.5);
        assert.equal(Number(historical.totalPrice), 85);
      }
    }
  );

  await check(
    "QR withdrawal, rejected orders, waiter service routing and old archived links",
    async () => {
      const cancelled = expectStatus(
        await api("/api/public/orders", {
          method: "POST",
          body: { token: otherToken, items: [{ menuItemId: espresso.id, quantity: 1 }] },
        }),
        202
      );
      assert.equal(
        expectStatus(
          await api("/api/public/orders", {
            method: "DELETE",
            body: { token: otherToken, orderId: cancelled.orderId },
          }),
          200
        ).status,
        "CANCELLED"
      );
      let leaked = false;
      kitchenSocket.on("service:request", () => {
        leaked = true;
      });
      const notified = socketEvent(waiterSocket, "service:request");
      const service = expectStatus(
        await api("/api/public/service-requests", {
          method: "POST",
          body: { token: otherToken, type: "WAITER" },
        }),
        202
      );
      assert.equal((await notified).id, service.id);
      expectStatus(
        await api("/api/public/service-requests", {
          method: "POST",
          body: { token: otherToken, type: "WAITER" },
        }),
        429
      );
      expectStatus(
        await api("/api/service-requests", {
          method: "PATCH",
          cookie: credentials.WAITER,
          body: { id: service.id, action: "RESOLVE" },
        }),
        200
      );
      assert.equal(
        expectStatus(await api("/api/tables", { cookie: owner }), 200).find(
          (table) => table.id === tables[2].id
        ).serviceRequests.length,
        0
      );
      const cashierSocket = await connect(credentials.CASHIER);
      const bill = expectStatus(
        await api("/api/public/service-requests", {
          method: "POST",
          body: { token: qrToken, type: "BILL" },
        }),
        202
      );
      const pending = expectStatus(await api("/api/tables", { cookie: owner }), 200).find(
        (table) => table.id === tables[1].id
      );
      assert.ok(pending.serviceRequests.some((call) => call.id === bill.id));
      const billNotice = socketEvent(cashierSocket, "table:bill_requested");
      expectStatus(
        await api("/api/service-requests", {
          method: "PATCH",
          cookie: credentials.WAITER,
          body: { id: bill.id, action: "RESOLVE" },
        }),
        200
      );
      assert.equal((await billNotice).id, tables[1].id);
      const cashierTables = expectStatus(
        await api("/api/tables", { cookie: credentials.CASHIER }),
        200
      );
      assert.equal(
        cashierTables.find((table) => table.id === tables[1].id).status,
        "BILL_REQUESTED"
      );
      assert.equal(
        cashierTables.find((table) => table.id === tables[1].id).serviceRequests.length,
        0
      );
      expectStatus(
        await api("/api/service-requests", {
          method: "PATCH",
          cookie: credentials.WAITER,
          body: { id: bill.id, action: "RESOLVE" },
        }),
        409
      );
      await wait(200);
      assert.equal(leaked, false, "kitchen must not receive waiter-only requests");
      const rejectedToken = expectStatus(
        await api("/api/tables/qr", {
          method: "POST",
          cookie: owner,
          body: { tableId: tables[3].id },
        }),
        200
      ).token;
      const rejected = expectStatus(
        await api("/api/public/orders", {
          method: "POST",
          body: { token: rejectedToken, items: [{ menuItemId: espresso.id, quantity: 1 }] },
        }),
        202
      );
      expectStatus(
        await api("/api/qr-requests", {
          method: "PATCH",
          cookie: credentials.WAITER,
          body: { id: rejected.orderId, action: "REJECT" },
        }),
        200
      );
      assert.deepEqual(
        expectStatus(
          await api(`/api/public/orders?token=${rejectedToken}&orderId=${rejected.orderId}`),
          200
        ),
        { status: "CANCELLED" }
      );
      const archiveToken = expectStatus(
        await api("/api/tables/qr", {
          method: "POST",
          cookie: owner,
          body: { tableId: tables[4].id },
        }),
        200
      ).token;
      expectStatus(
        await api(`/api/tables?id=${tables[4].id}`, { method: "DELETE", cookie: owner }),
        200
      );
      expectStatus(await api(`/api/public/menu?token=${archiveToken}`), 404);
      expectStatus(
        await api("/api/public/orders", {
          method: "POST",
          body: { token: archiveToken, items: [{ menuItemId: espresso.id, quantity: 1 }] },
        }),
        404
      );
    }
  );

  await check("cash shift totals and reports match recorded payments", async () => {
    const closed = expectStatus(
      await api("/api/pos/shift", {
        method: "PATCH",
        cookie: credentials.CASHIER,
        body: { shiftId: shift.id, closingCash: "120.00" },
      }),
      200
    );
    assert.equal(closed.cashPayments, "20.00");
    assert.equal(closed.cardPayments, "65.00");
    assert.equal(closed.expectedCash, "120.00");
    assert.equal(closed.cashDifference, "0.00");
    const report = expectStatus(
      await api("/api/reports/z-report?period=today", { cookie: credentials.CASHIER }),
      200
    );
    assert.equal(Number(report.summary.totalRevenue), 85);
  });

  await check(
    "concurrent checkout retries and distinct payment keys settle each account exactly once",
    async () => {
      const raceShift = expectStatus(
        await api("/api/pos/shift", {
          method: "POST",
          cookie: credentials.CASHIER,
          body: { openingCash: "0.00" },
        }),
        201
      ).shift;
      const raceOrders = [];
      for (const suffix of ["replay", "distinct", "close"]) {
        const table = expectStatus(
          await api("/api/tables", {
            method: "POST",
            cookie: owner,
            body: { tableNumber: `QA concurrency ${suffix}` },
          }),
          201
        );
        const order = expectStatus(
          await api("/api/orders", {
            method: "POST",
            cookie: credentials.WAITER,
            body: {
              tableId: table.id,
              idempotencyKey: `concurrent-order-${suffix}`,
              items: [{ menuItemId: espresso.id, quantity: 1 }],
            },
          }),
          201
        );
        assert.equal(Number(order.totalPrice), 42.5);
        raceOrders.push({ table, order });
      }
      const retryBody = {
        orderId: raceOrders[0].order.id,
        paymentMethod: "CASH",
        idempotencyKey: "concurrent-same-payment-key",
      };
      const retries = await Promise.all(
        Array.from({ length: 3 }, () =>
          api("/api/pos/payment", {
            method: "POST",
            cookie: credentials.CASHIER,
            body: retryBody,
          })
        )
      );
      const first = expectStatus(retries[0], 200);
      for (const retry of retries) assert.deepEqual(expectStatus(retry, 200), first);
      assert.equal(first.receipt.amountPaid, "42.50");

      const distinct = await Promise.all(
        Array.from({ length: 3 }, (_, index) =>
          api("/api/pos/payment", {
            method: "POST",
            cookie: credentials.CASHIER,
            body: {
              orderId: raceOrders[1].order.id,
              paymentMethod: "CASH",
              idempotencyKey: `concurrent-distinct-payment-${index}`,
            },
          })
        )
      );
      assert.deepEqual(distinct.map((response) => response.status).sort(), [200, 409, 409]);
      for (const { table, order } of raceOrders.slice(0, 2)) {
        const persisted = expectStatus(
          await api(`/api/orders/${order.id}`, { cookie: owner }),
          200
        );
        assert.equal(persisted.status, "PAID");
        assert.equal(
          persisted.payments.length,
          1,
          "concurrent requests must not duplicate ledger rows"
        );
        assert.equal(persisted.payments[0].cashShiftId, raceShift.id);
        assert.equal(Number(persisted.payments[0].amountPaid), 42.5);
        const history = expectStatus(
          await api(`/api/pos/payments?tableId=${table.id}`, { cookie: credentials.CASHIER }),
          200
        );
        assert.equal(history.payments.length, 1, "each account has one immutable payment receipt");
        assert.equal(history.totals.total, "42.50");
      }

      const [payment, closing] = await Promise.all([
        api("/api/pos/payment", {
          method: "POST",
          cookie: credentials.CASHIER,
          body: {
            orderId: raceOrders[2].order.id,
            paymentMethod: "CASH",
            idempotencyKey: "concurrent-payment-versus-close",
          },
        }),
        api("/api/pos/shift", {
          method: "PATCH",
          cookie: credentials.CASHIER,
          body: { shiftId: raceShift.id, closingCash: "0.00" },
        }),
      ]);
      const closed = expectStatus(closing, 200);
      assert.ok([200, 409].includes(payment.status), JSON.stringify(payment.data));
      if (payment.status === 409) assert.equal(payment.data.code, "shift-not-open");
      const persisted = expectStatus(
        await api(`/api/orders/${raceOrders[2].order.id}`, { cookie: owner }),
        200
      );
      const paidBeforeClose = payment.status === 200;
      assert.equal(persisted.status, paidBeforeClose ? "PAID" : "PENDING");
      assert.equal(persisted.payments.length, paidBeforeClose ? 1 : 0);
      assert.equal(closed.cashPayments, paidBeforeClose ? "127.50" : "85.00");
      assert.equal(closed.expectedCash, closed.cashPayments);
      assert.equal(closed.paymentCount, paidBeforeClose ? 3 : 2);
      assert.equal(closed.paymentsSnapshot.length, closed.paymentCount);
      assert.equal(
        closed.paymentsSnapshot.reduce(
          (sum, entry) => sum + Math.round(Number(entry.amountPaid) * 100),
          0
        ),
        Math.round(Number(closed.cashPayments) * 100),
        "the immutable closing snapshot includes exactly the committed payments"
      );
      assert.equal(
        closed.paymentsSnapshot.some((entry) => entry.orderId === raceOrders[2].order.id),
        paidBeforeClose,
        "a payment racing with close must either enter that shift snapshot or remain unrecorded"
      );
      assert.deepEqual(
        expectStatus(
          await api("/api/pos/shift", {
            method: "PATCH",
            cookie: credentials.CASHIER,
            body: { shiftId: raceShift.id, closingCash: "0.00" },
          }),
          200
        ),
        closed
      );
      if (!paidBeforeClose)
        expectStatus(
          await api(`/api/orders/${raceOrders[2].order.id}`, {
            method: "PATCH",
            cookie: credentials.WAITER,
            body: { status: "CANCELLED" },
          }),
          200
        );
      for (const { table } of raceOrders)
        expectStatus(
          await api(`/api/tables?id=${table.id}`, { method: "DELETE", cookie: owner }),
          200
        );
    }
  );

  await check("a second discounted table payment settles the remaining unpaid order", async () => {
    expectStatus(
      await api("/api/pos/shift", {
        method: "POST",
        cookie: credentials.CASHIER,
        body: { openingCash: "0.00" },
      }),
      201
    );
    const tableId = tables[9].id;
    for (const key of ["discount-order-one", "discount-order-two"]) {
      expectStatus(
        await api("/api/orders", {
          method: "POST",
          cookie: credentials.WAITER,
          body: { tableId, idempotencyKey: key, items: [{ menuItemId: espresso.id, quantity: 1 }] },
        }),
        201
      );
    }
    const payment = {
      tableId,
      paymentMethod: "CASH",
      discountPercent: "10",
      discountReason: "QA approved",
    };
    const first = expectStatus(
      await api("/api/pos/payment", {
        method: "POST",
        cookie: credentials.CASHIER,
        body: { ...payment, amountPaid: "38.25", idempotencyKey: "discount-payment-one" },
      }),
      200
    );
    assert.equal(Number(first.remainingBalance), 38.25);
    const second = expectStatus(
      await api("/api/pos/payment", {
        method: "POST",
        cookie: credentials.CASHIER,
        body: { ...payment, idempotencyKey: "discount-payment-two" },
      }),
      200
    );
    assert.equal(Number(second.amountPaid), 38.25);
    assert.equal(Number(second.remainingBalance), 0);
    assert.equal(
      expectStatus(await api("/api/orders?tableId=" + tableId, { cookie: owner }), 200).filter(
        (order) => order.status !== "PAID"
      ).length,
      0
    );
  });

  await check(
    "three mixed installments settle exact cents with immutable per-payment receipts and no replay duplication",
    async () => {
      const product = expectStatus(
        await api("/api/menu-items", {
          method: "POST",
          cookie: owner,
          body: {
            name: "QA Shared100",
            price: "100.00",
            categoryId: espresso.categoryId,
            isAvailable: true,
            imageUrl: photoImage.imageUrl,
          },
        }),
        201
      );
      assert.equal(
        product.imageUrl,
        photoImage.imageUrl,
        "new products must support the same uploaded image as edits"
      );
      const tableId = tables[10].id;
      const order = expectStatus(
        await api("/api/orders", {
          method: "POST",
          cookie: credentials.WAITER,
          body: {
            tableId,
            idempotencyKey: "split-rounding-order",
            items: [{ menuItemId: product.id, quantity: 1 }],
          },
        }),
        201
      );
      const responses = [];
      for (const [index, installment] of ["33.34", "33.33", "33.33"].entries()) {
        const paymentMethod = index === 1 ? "CREDIT_CARD" : "CASH";
        const body = {
          tableId,
          paymentMethod,
          amountPaid: installment,
          idempotencyKey: "split-rounding-" + index,
          ...(paymentMethod === "CREDIT_CARD" ? { manualCardConfirmed: true } : {}),
        };
        const paid = expectStatus(
          await api("/api/pos/payment", { method: "POST", cookie: credentials.CASHIER, body }),
          200
        );
        responses.push(paid);
        assert.equal(paid.amountPaid, installment);
        assert.equal(paid.remainingBalance, ["66.66", "33.33", "0.00"][index]);
        assert.equal(paid.receipt.amountPaid, installment);
        assert.equal(paid.receipt.paymentMethod, paymentMethod);
        assert.equal(paid.receipt.totalPaid, ["33.34", "66.67", "100.00"][index]);
        assert.deepEqual(
          expectStatus(
            await api("/api/pos/payment", { method: "POST", cookie: credentials.CASHIER, body }),
            200
          ),
          paid
        );
      }
      const history = expectStatus(
        await api("/api/pos/payments?tableId=" + tableId, { cookie: credentials.CASHIER }),
        200
      );
      assert.equal(history.payments.length, 3);
      assert.equal(new Set(history.payments.map((p) => p.id)).size, 3);
      assert.deepEqual(history.totals, {
        cash: "66.67",
        card: "33.33",
        other: "0.00",
        total: "100.00",
        paymentCount: 3,
      });
      assert.equal(
        expectStatus(await api("/api/tables", { cookie: owner }), 200).find((t) => t.id === tableId)
          .status,
        "AVAILABLE"
      );
      assert.equal(
        expectStatus(await api("/api/orders/" + order.id, { cookie: owner }), 200).status,
        "PAID"
      );
      // A later party at the same table must not inherit the completed party's ledger.
      const nextOrder = expectStatus(
        await api("/api/orders", {
          method: "POST",
          cookie: credentials.WAITER,
          body: {
            tableId,
            idempotencyKey: "split-next-party",
            items: [{ menuItemId: product.id, quantity: 1 }],
          },
        }),
        201
      );
      const current = expectStatus(
        await api(`/api/pos/payments?tableId=${tableId}&orderIds=${nextOrder.id}`, {
          cookie: credentials.CASHIER,
        }),
        200
      );
      assert.equal(current.payments.length, 0);
      assert.equal(current.totals.total, "0.00");
      expectStatus(
        await api("/api/orders/" + nextOrder.id, {
          method: "PATCH",
          cookie: owner,
          body: { status: "CANCELLED" },
        }),
        200
      );
      const multiTableId = tables[11].id;
      const multiOrders = [];
      for (let i = 0; i < 2; i++)
        multiOrders.push(
          expectStatus(
            await api("/api/orders", {
              method: "POST",
              cookie: credentials.WAITER,
              body: {
                tableId: multiTableId,
                idempotencyKey: "multi-allocation-order-" + i,
                items: [{ menuItemId: product.id, quantity: 1 }],
              },
            }),
            201
          )
        );
      const multiBody = {
        tableId: multiTableId,
        paymentMethod: "CASH",
        amountPaid: "150.00",
        idempotencyKey: "multi-allocation-payment",
      };
      const multi = expectStatus(
        await api("/api/pos/payment", {
          method: "POST",
          cookie: credentials.CASHIER,
          body: multiBody,
        }),
        200
      );
      assert.equal(
        multi.payments.length,
        2,
        "a single receipt can allocate one collection across two orders"
      );
      assert.equal(multi.receipt.amountPaid, "150.00");
      assert.equal(multi.receipt.remainingBalance, "50.00");
      const active = expectStatus(
        await api(`/api/orders?tableId=${multiTableId}`, { cookie: owner }),
        200
      ).filter((o) => o.status !== "PAID");
      assert.equal(active.length, 1);
      const linked = expectStatus(
        await api(`/api/pos/payments?tableId=${multiTableId}&orderIds=${active[0].id}`, {
          cookie: credentials.CASHIER,
        }),
        200
      );
      assert.equal(
        linked.payments.length,
        1,
        "multiple allocations must appear as a single150.00receipt"
      );
      assert.deepEqual(linked.totals, {
        cash: "150.00",
        card: "0.00",
        other: "0.00",
        total: "150.00",
        paymentCount: 1,
      });
      assert.equal(linked.account.grossTotal, "200.00");
      assert.equal(linked.account.totalPaid, "150.00");
      assert.equal(linked.account.remainingBalance, "50.00");
      for (const allocation of multi.payments)
        assert.deepEqual(
          expectStatus(
            await api("/api/pos/payments/" + allocation.id, { cookie: credentials.CASHIER }),
            200
          ).receipt,
          multi.receipt
        );
      const lastMultiPayment = expectStatus(
        await api("/api/pos/payment", {
          method: "POST",
          cookie: credentials.CASHIER,
          body: {
            tableId: multiTableId,
            paymentMethod: "CREDIT_CARD",
            amountPaid: "50.00",
            manualCardConfirmed: true,
            idempotencyKey: "multi-allocation-final",
          },
        }),
        200
      );
      assert.equal(lastMultiPayment.receipt.grossTotal, "200.00");
      assert.equal(lastMultiPayment.receipt.totalPaid, "200.00");
      assert.equal(lastMultiPayment.receipt.amountPaid, "50.00");
      assert.equal(lastMultiPayment.receipt.remainingBalance, "0.00");
      assert.deepEqual(
        new Set(lastMultiPayment.receipt.orderIds),
        new Set(multiOrders.map((order) => order.id))
      );
      assert.deepEqual(
        expectStatus(
          await api("/api/pos/payment", {
            method: "POST",
            cookie: credentials.CASHIER,
            body: multiBody,
          }),
          200
        ),
        multi
      );
      const all = expectStatus(
        await api(`/api/pos/payments?tableId=${multiTableId}`, { cookie: credentials.CASHIER }),
        200
      );
      assert.equal(all.payments.length, 2);
      assert.deepEqual(all.totals, {
        cash: "150.00",
        card: "50.00",
        other: "0.00",
        total: "200.00",
        paymentCount: 2,
      });
    }
  );

  await check(
    "bill requests survive new orders and cancelled items retain their history",
    async () => {
      const tableId = tables[8].id;
      expectStatus(
        await api("/api/tables", {
          method: "PUT",
          cookie: owner,
          body: { id: tableId, status: "BILL_REQUESTED" },
        }),
        200
      );
      const order = expectStatus(
        await api("/api/orders", {
          method: "POST",
          cookie: credentials.WAITER,
          body: {
            tableId,
            idempotencyKey: "release-history-order",
            items: [
              { menuItemId: espresso.id, quantity: 1 },
              { menuItemId: espresso.id, quantity: 1 },
            ],
          },
        }),
        201
      );
      assert.equal(
        expectStatus(await api("/api/tables", { cookie: owner }), 200).find(
          (table) => table.id === tableId
        ).status,
        "BILL_REQUESTED"
      );
      const cancelled = order.items[0];
      const updated = expectStatus(
        await api(`/api/orders/${order.id}`, {
          method: "PATCH",
          cookie: credentials.WAITER,
          body: { cancelItemId: cancelled.id },
        }),
        200
      );
      assert.equal(Number(updated.totalPrice), 42.5);
      assert.equal(updated.items.find((item) => item.id === cancelled.id).status, "CANCELLED");
      assert.equal(
        updated.items.find((item) => item.id === cancelled.id).menuItemName,
        "QA Espresso"
      );
      expectStatus(
        await api(`/api/orders/${order.id}`, {
          method: "PATCH",
          cookie: credentials.WAITER,
          body: { cancelItemId: cancelled.id },
        }),
        409
      );
      const active = expectStatus(
        await api("/api/orders?activeOnly=true", { cookie: credentials.KITCHEN }),
        200
      ).find((entry) => entry.id === order.id);
      assert.equal(active.items.length, 1);
      assert.equal(
        Number(
          expectStatus(await api(`/api/orders/${order.id}`, { cookie: owner }), 200).totalPrice
        ),
        42.5
      );
      const lastItem = updated.items.find((item) => item.status !== "CANCELLED");
      const closed = expectStatus(
        await api(`/api/orders/${order.id}`, {
          method: "PATCH",
          cookie: owner,
          body: { cancelItemId: lastItem.id },
        }),
        200
      );
      assert.equal(closed.status, "CANCELLED");
      assert.equal(closed.items.length, 2);
      assert.equal(Number(closed.totalPrice), 0);
      assert.equal(
        expectStatus(await api("/api/tables", { cookie: owner }), 200).find(
          (table) => table.id === tableId
        ).status,
        "AVAILABLE"
      );
    }
  );

  await check("real browser staff and mobile customer flows persist real orders", async () => {
    result.browser = await runBrowserChecks({
      base,
      directory,
      api,
      expectStatus,
      tables,
      espresso,
      code,
      password,
      owner,
      credentials,
    });
  });

  await check("extra tickets, refunds, audit history and full recovery", async () => {
    result.operations = await require("./operations.cjs").runOperationsChecks({
      api,
      expectStatus,
      owner,
      credentials,
      base,
      directory,
      root,
      env,
      startServer,
      stopServer,
    });
  });
  await check(
    browserGroups.length
      ? `fixture browser groups: ${browserGroups.join(", ")}`
      : "fixture browser regressions and 13 routes at nine viewport sizes",
    async () => {
      await runFixtureChecks(owner);
    }
  );

  await check("database and credentials persist across production server restart", async () => {
    for (const socket of sockets) socket.disconnect();
    await stopServer();
    await startServer();
    const order = expectStatus(await api(`/api/orders/${paidOrder.id}`, { cookie: owner }), 200);
    assert.equal(order.status, "PAID");
    assert.equal(order.payments.length, 2);
    assert.deepEqual(
      order.payments.map((payment) => [payment.paymentMethod, Number(payment.amountPaid)]).sort(),
      [
        ["CASH", 20],
        ["CREDIT_CARD", 65],
      ]
    );
    assert.equal(Number(order.totalPrice), 85);
    assert.equal(order.items[0].menuItemName, "QA Espresso");
    assert.deepEqual(
      expectStatus(
        await api("/api/pos/payments/" + cashReceipt.id, { cookie: credentials.CASHIER }),
        200
      ).receipt,
      cashReceipt
    );
    assert.deepEqual(
      expectStatus(
        await api("/api/pos/payments/" + cardReceipt.id, { cookie: credentials.CASHIER }),
        200
      ).receipt,
      cardReceipt
    );
    assert.equal(
      expectStatus(await api("/api/menu-items", { cookie: credentials.WAITER }), 200).find(
        (item) => item.id === espresso.id
      ).imageUrl,
      photoImage.imageUrl
    );
    assert.equal((await fetch(base + photoImage.imageUrl)).status, 200);
    assert.equal(
      expectStatus(await api("/api/config", { cookie: owner }), 200).qrOrderEnabled,
      true
    );
    assert.deepEqual(
      expectStatus(
        await api(`/api/public/orders?token=${qrToken}&orderId=${qrOrder.orderId}`),
        200
      ),
      { status: "DELIVERED" }
    );
    const disposableLogin = await api("/api/auth/login", {
      method: "POST",
      body: { restaurantCode: code, password },
    });
    expectStatus(disposableLogin, 200);
    const logoutSocket = await connect(disposableLogin.cookie);
    const logoutDisconnected = socketEvent(logoutSocket, "disconnect");
    const logout = await api("/api/auth/logout", {
      method: "POST",
      cookie: disposableLogin.cookie,
    });
    expectStatus(logout, 200);
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0/i);
    assert.match(logout.headers.get("set-cookie"), /restopos_session=/i);
    await logoutDisconnected;
    expectStatus(await api("/api/tables", { cookie: disposableLogin.cookie }), 401);
    await connect(disposableLogin.cookie, { rejected: true });
    expectStatus(await api("/api/tables", { cookie: owner }), 200);
    await stopServer();
    await startServer();
    expectStatus(await api("/api/tables", { cookie: disposableLogin.cookie }), 401);
    const tokenValue = disposableLogin.cookie.slice(disposableLogin.cookie.indexOf("=") + 1);
    const cookieName = disposableLogin.cookie.slice(0, disposableLogin.cookie.indexOf("="));
    expectStatus(await api("/api/tables", { cookie: `${cookieName}=${tokenValue}.ignored` }), 401);
    expectStatus(await api("/api/tables", { cookie: owner }), 200);
  });
  await check(
    "item-selected payments, tip snapshots, replay and QR tip intent preserve exact balances",
    async () => {
      const activeShift = expectStatus(
        await api("/api/pos/shift", { cookie: credentials.CASHIER }),
        200
      ).currentShift;
      if (!activeShift)
        expectStatus(
          await api("/api/pos/shift", {
            method: "POST",
            cookie: credentials.CASHIER,
            body: { openingCash: "0.00" },
          }),
          201
        );
      const table = expectStatus(
        await api("/api/tables", {
          method: "POST",
          cookie: owner,
          body: { tableNumber: "ITEM-TIP-QA", section: "Salon", capacity: 4 },
        }),
        201
      );
      const products = [];
      for (const [name, price] of [
        ["Club sandwich", 100],
        ["Limonata", 50],
        ["Espresso", 30],
      ])
        products.push(
          expectStatus(
            await api("/api/menu-items", {
              method: "POST",
              cookie: owner,
              body: {
                name: "QA " + name,
                price,
                categoryId: espresso.categoryId,
                isAvailable: true,
              },
            }),
            201
          )
        );
      const order = expectStatus(
        await api("/api/orders", {
          method: "POST",
          cookie: credentials.WAITER,
          body: {
            tableId: table.id,
            items: products.map((p) => ({ menuItemId: p.id, quantity: 1 })),
            idempotencyKey: "item-tip-order-1",
          },
        }),
        201
      );
      const choose = order.items
        .filter((i) => i.menuItemId !== products[2].id)
        .map((i) => ({ orderItemId: i.id, quantity: 1 }));
      const body = {
        tableId: table.id,
        paymentMethod: "CASH",
        idempotencyKey: "item-tip-pay-1",
        selectedItems: choose,
        tipAmount: "10",
      };
      const paid = expectStatus(
        await api("/api/pos/payment", { method: "POST", cookie: credentials.CASHIER, body }),
        200
      );
      assert.equal(paid.amountPaid, "150.00");
      assert.equal(paid.remainingBalance, "30.00");
      assert.equal(paid.receipt.tipAmount, "10.00");
      assert.equal(paid.receipt.collectedTotal, "160.00");
      assert.equal(paid.receipt.paymentItems.length, 2);
      const replay = expectStatus(
        await api("/api/pos/payment", { method: "POST", cookie: credentials.CASHIER, body }),
        200
      );
      assert.equal(replay.receipt.id, paid.receipt.id);
      expectStatus(
        await api("/api/pos/payment", {
          method: "POST",
          cookie: credentials.CASHIER,
          body: { ...body, idempotencyKey: "item-tip-duplicate" },
        }),
        409
      );
      expectStatus(
        await api("/api/pos/payment", {
          method: "POST",
          cookie: credentials.CASHIER,
          body: { ...body, tipAmount: "11" },
        }),
        409
      );
      const refreshed = expectStatus(await api("/api/tables", { cookie: owner }), 200).find(
        (t) => t.id === table.id
      );
      assert.equal(
        refreshed.orders[0].items.find((i) => i.id === choose[0].orderItemId).remainingQuantity,
        0
      );
      const last = expectStatus(
        await api("/api/pos/payment", {
          method: "POST",
          cookie: credentials.CASHIER,
          body: {
            tableId: table.id,
            paymentMethod: "OTHER",
            idempotencyKey: "item-tip-pay-2",
            selectedItems: [
              {
                orderItemId: order.items.find((i) => i.menuItemId === products[2].id).id,
                quantity: 1,
              },
            ],
          },
        }),
        200
      );
      assert.equal(last.amountPaid, "30.00");
      assert.equal(last.remainingBalance, "0.00");
      assert.equal(last.receipt.tipAmount, "0.00");
      const snapshot = expectStatus(
        await api("/api/pos/payments/" + paid.receipt.id, { cookie: owner }),
        200
      );
      assert.deepEqual(snapshot.receipt.paymentItems, paid.receipt.paymentItems);
      assert.equal(snapshot.receipt.tipAmount, "10.00");
      await api("/api/config", { method: "PUT", cookie: owner, body: { qrOrderEnabled: true } });
      const token = expectStatus(
        await api("/api/tables/qr", { method: "POST", cookie: owner, body: { tableId: table.id } }),
        200
      ).token;
      const qrBody = {
        token,
        items: [{ menuItemId: products[0].id, quantity: 1 }],
        tipAmount: "7.50",
        idempotencyKey: "qr-tip-test-order",
      };
      const qr = expectStatus(
        await api("/api/public/orders", { method: "POST", body: qrBody }),
        202
      );
      expectStatus(
        await api("/api/qr-requests", {
          method: "PATCH",
          cookie: credentials.WAITER,
          body: { id: qr.orderId, action: "APPROVE" },
        }),
        200
      );
      const saved = expectStatus(await api("/api/orders/" + qr.orderId, { cookie: owner }), 200);
      assert.equal(Number(saved.tipAmount), 7.5);
      assert.equal(Number(saved.totalPrice), 100);
      expectStatus(
        await api("/api/public/orders", {
          method: "POST",
          body: { ...qrBody, tipAmount: "-1", idempotencyKey: "qr-tip-invalid" },
        }),
        400
      );

      const reportBeforeRefund = expectStatus(
        await api("/api/reports/z-report?period=all&currency=%E2%82%BA", { cookie: owner }),
        200
      );
      const refundBody = {
        paymentId: paid.receipt.id,
        amount: "160.00",
        reason: "Return bill amount and tip",
        externallyConfirmed: true,
        idempotencyKey: "item-tip-refund-160",
      };
      const refund = expectStatus(
        await api("/api/pos/refunds", { method: "POST", cookie: owner, body: refundBody }),
        200
      );
      assert.equal(refund.amount, "160.00");
      assert.equal(refund.principalAmount, "150.00");
      assert.equal(refund.tipAmount, "10.00");
      assert.equal(refund.remainingRefundable, "0.00");
      assert.deepEqual(
        expectStatus(
          await api("/api/pos/refunds", {
            method: "POST",
            cookie: owner,
            body: refundBody,
          }),
          200
        ),
        refund
      );
      expectStatus(
        await api("/api/pos/refunds", {
          method: "POST",
          cookie: owner,
          body: {
            ...refundBody,
            amount: "0.01",
            idempotencyKey: "item-tip-refund-overflow",
          },
        }),
        409
      );
      const history = expectStatus(
        await api(
          `/api/pos/payments?tableId=${encodeURIComponent(table.id)}&orderIds=${encodeURIComponent(order.id)}`,
          { cookie: owner }
        ),
        200
      );
      const refundedEntry = history.payments.find((entry) => entry.id === paid.receipt.id);
      assert.equal(refundedEntry.refundedAmount, "160.00");
      assert.equal(refundedEntry.refundedTipAmount, "10.00");
      assert.equal(refundedEntry.refundablePrincipalAmount, "0.00");
      assert.equal(refundedEntry.refundableTipAmount, "0.00");
      assert.equal(refundedEntry.refundableAmount, "0.00");
      const reportAfterRefund = expectStatus(
        await api("/api/reports/z-report?period=all&currency=%E2%82%BA", { cookie: owner }),
        200
      );
      assert.equal(
        Number(reportBeforeRefund.summary.totalRevenue) -
          Number(reportAfterRefund.summary.totalRevenue),
        150
      );
      assert.equal(
        Number(reportBeforeRefund.summary.tipTotal) - Number(reportAfterRefund.summary.tipTotal),
        10
      );
      assert.equal(
        Number(reportBeforeRefund.summary.collectionsIncludingTips) -
          Number(reportAfterRefund.summary.collectionsIncludingTips),
        160
      );
      assert.equal(
        Number(reportAfterRefund.summary.refundTotal) -
          Number(reportBeforeRefund.summary.refundTotal),
        160
      );
    }
  );
  await check("connected account history subtracts tips collected on closed orders", async () => {
    const table = expectStatus(
      await api("/api/tables", {
        method: "POST",
        cookie: owner,
        body: { tableNumber: "TIP-ACCOUNT-ROLLUP-QA", section: "Salon", capacity: 4 },
      }),
      201
    );
    const firstOrder = expectStatus(
      await api("/api/orders", {
        method: "POST",
        cookie: credentials.WAITER,
        body: {
          tableId: table.id,
          items: [{ menuItemId: espresso.id, quantity: 1 }],
          idempotencyKey: "tip-account-rollup-first-order",
        },
      }),
      201
    );
    await api("/api/config", { method: "PUT", cookie: owner, body: { qrOrderEnabled: true } });
    const token = expectStatus(
      await api("/api/tables/qr", {
        method: "POST",
        cookie: owner,
        body: { tableId: table.id },
      }),
      200
    ).token;
    const qrOrder = expectStatus(
      await api("/api/public/orders", {
        method: "POST",
        body: {
          token,
          items: [{ menuItemId: espresso.id, quantity: 1 }],
          tipAmount: "10.00",
          idempotencyKey: "tip-account-rollup-qr-order",
        },
      }),
      202
    );
    expectStatus(
      await api("/api/qr-requests", {
        method: "PATCH",
        cookie: credentials.WAITER,
        body: { id: qrOrder.orderId, action: "APPROVE" },
      }),
      200
    );
    const firstPayment = expectStatus(
      await api("/api/pos/payment", {
        method: "POST",
        cookie: credentials.CASHIER,
        body: {
          tableId: table.id,
          paymentMethod: "OTHER",
          idempotencyKey: "tip-account-rollup-first-payment",
          selectedItems: [{ orderItemId: firstOrder.items[0].id, quantity: 1 }],
          tipAmount: "10.00",
        },
      }),
      200
    );
    assert.equal(firstPayment.receipt.tipAmount, "10.00");
    assert.equal(firstPayment.orders.find((order) => order.id === firstOrder.id).status, "PAID");
    assert.equal(
      firstPayment.orders.find((order) => order.id === qrOrder.orderId).status,
      "PENDING"
    );

    const history = expectStatus(
      await api(
        `/api/pos/payments?tableId=${encodeURIComponent(table.id)}&orderIds=${encodeURIComponent(qrOrder.orderId)}`,
        { cookie: owner }
      ),
      200
    );
    assert.equal(history.account.remainingTipAmount, "0.00");
    assert.ok(history.account.orderIds.includes(firstOrder.id));
    assert.ok(history.account.orderIds.includes(qrOrder.orderId));
  });
  await check("login and owner password changes share a trusted peer quota", async () => {
    for (let index = 0; index < 8; index++) {
      const response =
        index % 2
          ? await api("/api/auth/change-password", {
              method: "POST",
              body: { currentPassword: "wrong-owner-password", newPassword: "QAReplacement123!" },
            })
          : await api("/api/auth/login", {
              method: "POST",
              body: { restaurantCode: code, password: "wrong-owner-password" },
            });
      expectStatus(response, 401);
    }
    for (const route of ["/api/auth/login", "/api/auth/change-password"]) {
      const blocked = await api(route, {
        method: "POST",
        headers: { "x-tepsy-client-ip": "192.0.2.45", "x-restopos-client-ip": "192.0.2.46" },
        body: route.endsWith("login")
          ? { restaurantCode: code, password }
          : { currentPassword: password, newPassword: "QAReplacement123!" },
      });
      expectStatus(blocked, 429);
      assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    }
    expectStatus(await api("/api/config", { cookie: owner }), 200);
  });
  await check("confirmed local reset backs up and clears an established restaurant", async () => {
    expectStatus(
      await api("/api/reset", { method: "POST", cookie: owner, body: { mode: "CLEAN" } }),
      400
    );
    const reset = expectStatus(
      await api("/api/reset", {
        method: "POST",
        cookie: owner,
        body: { mode: "CLEAN", confirmation: "TEPSY" },
      }),
      200
    );
    assert.equal(reset.success, true);
    assert.match(reset.backupFile, /^tepsy-reset-\d{8}-\d{6}-\d+\.db$/);
    const backupPath = path.join(directory, "backups", reset.backupFile);
    assert.ok(fs.statSync(backupPath).size > 0);
    const { PrismaClient } = require("@prisma/client");
    const backup = new PrismaClient({
      datasources: { db: { url: `file:${backupPath.replaceAll("\\", "/")}` } },
    });
    try {
      assert.ok((await backup.order.count()) > 0);
      assert.ok((await backup.payment.count()) > 0);
    } finally {
      await backup.$disconnect();
    }
    const config = expectStatus(await api("/api/config"), 200);
    assert.equal(config.isSetupCompleted, false);
    assert.equal(config.authEnabled, false);
    assert.deepEqual(expectStatus(await api("/api/tables"), 200), []);
    assert.deepEqual(expectStatus(await api("/api/orders"), 200), []);
    assert.deepEqual(expectStatus(await api("/api/staff"), 200), []);
  });
  result.passed = true;
}

main()
  .catch((error) => {
    result.error = error.stack;
    console.error(error.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const socket of sockets) socket.disconnect();
    await stopServer();
    result.completedAt = new Date().toISOString();
    result.protectedFilesUnchanged = protectedPaths.every(
      (name) => before[name] === fingerprint(name)
    );
    if (!result.protectedFilesUnchanged) {
      result.passed = false;
      console.error("Protected restaurant files changed while the isolated suite ran.");
      process.exitCode = 1;
    }
    if (directory) {
      fs.writeFileSync(path.join(directory, "results.json"), JSON.stringify(result, null, 2));
      console.log(`Evidence: ${path.join(directory, "results.json")}`);
    }
    if (result.passed)
      console.log(
        `Production integration passed (${result.checks.length} groups); live database and device configuration unchanged.`
      );
  });
