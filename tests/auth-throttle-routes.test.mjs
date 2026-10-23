import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import trusted from "../src/lib/trusted-client.cjs";
import throttle from "../src/lib/auth-throttle.cjs";

const proof = trusted.installTrustedClientProof();

async function route(name, dependencies) {
  const source = (
    await readFile(new URL(`../src/app/api/auth/${name}/route.js`, import.meta.url), "utf8")
  )
    .replace(/^import[\s\S]*?from "[^"]+";\r?$/gm, "")
    .replace(/export /g, "");
  return new Function(...Object.keys(dependencies), `${source}\nreturn POST;`)(
    ...Object.values(dependencies)
  );
}

function request(body, ip = "192.168.20.44") {
  return {
    json: async () => body,
    cookies: { get: () => null },
    headers: new Headers({ "x-tepsy-client-ip": ip, [trusted.PROOF_HEADER]: proof }),
  };
}

async function routes(quota, { staff = [], now = () => 100000 } = {}) {
  let verifications = 0;
  let unknown = 0;
  let updates = 0;
  const config = {
    id: "restaurant",
    restaurantCode: "TEST",
    authEnabled: true,
    accessPasswordHash: "owner-hash",
  };
  const dependencies = {
    NextResponse: {
      json: (body, options = {}) => ({
        body,
        status: options.status || 200,
        headers: options.headers || {},
        cookies: { set: () => {} },
      }),
    },
    prisma: {
      restaurantConfig: {
        findFirst: async () => config,
        update: async () => {
          updates++;
          return config;
        },
        updateMany: async () => {
          updates++;
          return { count: 1 };
        },
      },
      staffUser: { findMany: async () => staff },
    },
    SESSION_COOKIE: "tepsy_session",
    SESSION_MAX_AGE_SECONDS: 43200,
    REMEMBERED_SESSION_MAX_AGE_SECONDS: 2592000,
    createSessionToken: () => "signed",
    credentialSessionVersion: () => "version",
    hashCredential: () => "new-hash",
    normalizeRestaurantCode: (value) => value,
    roleHome: () => "/",
    sessionFromRequest: () => null,
    verifyCredential: (value, hash) => {
      verifications++;
      return value === "correct" || (hash?.startsWith("pin:") && value === hash.slice(4));
    },
    rejectUnknownCredential: () => {
      verifications++;
      unknown++;
      return false;
    },
    loginAccountKey: throttle.loginAccountKey,
    reserveAccountAttempt: throttle.createAccountLockout({ now }),
    canBootstrapPasswordChange: () => !config.accessPasswordHash,
    canChangeOwnerPassword: ({ canBootstrap, knowsCurrent }) => canBootstrap || knowsCurrent,
    currentStaffSession: async () => null,
    disconnectAllSockets: () => {},
    invalidateAuthConfigCache: () => {},
    reserveAuthenticationAttempt: quota,
    readAuthenticationBody: (req) => req.json(),
    trustedClientAddress: trusted.trustedClientAddress,
    globalThis: {},
  };
  return {
    login: await route("login", dependencies),
    change: await route("change-password", dependencies),
    counts: () => ({ verifications, updates }),
    unknownChecks: () => unknown,
    config,
    dependencies,
  };
}

// Both public credential-verification routes must consume the same quota before hashing a guess.
test("alternating login and owner password guesses exhaust a shared quota before further verification", async () => {
  let count = 0;
  const app = await routes(() =>
    count >= 8
      ? { allowed: false, retryAfter: 900 }
      : (count++, { allowed: true, complete: () => {} })
  );
  for (let index = 0; index < 8; index++) {
    const result =
      index % 2
        ? await app.change(request({ currentPassword: "wrong", newPassword: "Replacement123!" }))
        : await app.login(request({ restaurantCode: "TEST", password: "wrong" }));
    assert.equal(result.status, 401);
  }
  const blocked = await app.change(
    request({ currentPassword: "correct", newPassword: "Replacement123!" })
  );
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers["Retry-After"], "900");
  assert.deepEqual(app.counts(), { verifications: 8, updates: 0 });
});

test("successful credential verification completes the attempt and local owner bootstrap needs no quota", async () => {
  let successes = 0;
  const app = await routes(() => ({
    allowed: true,
    complete: (success) => {
      if (success) successes++;
    },
  }));
  assert.equal(
    (await app.login(request({ restaurantCode: "TEST", password: "correct" }))).status,
    200
  );
  assert.equal(
    (await app.change(request({ currentPassword: "correct", newPassword: "Replacement123!" })))
      .status,
    200
  );
  assert.equal(successes, 2);
  app.config.accessPasswordHash = null;
  assert.equal(
    (await app.change(request({ newPassword: "Replacement123!" }, "127.0.0.1"))).status,
    200
  );
  assert.equal(successes, 2);
});

test("login and password change reject malformed credential types without password hashing", async () => {
  const app = await routes(() => ({ allowed: true, complete: () => {} }));
  for (const body of [
    null,
    [],
    { restaurantCode: "TEST", password: { value: "correct" } },
    { restaurantCode: "TEST", password: "x".repeat(129) },
  ]) {
    assert.equal((await app.login(request(body))).status, 400);
  }
  for (const body of [null, [], { newPassword: "Replacement123!", currentPassword: {} }])
    assert.equal((await app.change(request(body))).status, 400);
  assert.deepEqual(app.counts(), { verifications: 0, updates: 0 });
});

test("simultaneous owner password changes cannot both accept the same old password", async () => {
  const app = await routes(() => ({ allowed: true, complete: () => {} }));
  const persistence = app.dependencies.prisma.restaurantConfig;
  persistence.findFirst = async () => ({ ...app.config });
  persistence.update = async ({ data }) => {
    Object.assign(app.config, data);
    return { ...app.config };
  };
  persistence.updateMany = async ({ where, data }) => {
    if (where.accessPasswordHash !== app.config.accessPasswordHash) return { count: 0 };
    Object.assign(app.config, data);
    return { count: 1 };
  };
  const results = await Promise.all([
    app.change(request({ currentPassword: "correct", newPassword: "FirstReplacement123!" })),
    app.change(request({ currentPassword: "correct", newPassword: "SecondReplacement123!" })),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
});

const openQuota = () => ({ allowed: true, complete: () => {} });
const staffMembers = [
  { id: "ali", name: "Ali", role: "WAITER", pinHash: "pin:4821", isActive: true },
  { id: "ayse", name: "Ayşe", role: "CASHIER", pinHash: "pin:1357", isActive: true },
];

// Each check counts credential hashes: unknown names, wrong codes and real accounts
// must all cost exactly one full verification.
test("login spends one credential hash whether or not the staff name or code exists", async () => {
  const app = await routes(openQuota, { staff: staffMembers });
  const cases = [
    [{ restaurantCode: "TEST", username: "Ali", pin: "0000" }, 401, 0],
    [{ restaurantCode: "TEST", username: "nobody", pin: "0000" }, 401, 1],
    [{ restaurantCode: "WRONG", username: "Ali", pin: "4821" }, 401, 1],
    [{ restaurantCode: "WRONG", password: "correct" }, 401, 1],
    [{ restaurantCode: "TEST", password: "wrong" }, 401, 0],
    [{ restaurantCode: "TEST", username: "ALİ".toLocaleLowerCase("tr-TR"), pin: "4821" }, 200, 0],
    [{ restaurantCode: "TEST", username: "ayşe", pin: "1357" }, 200, 0],
  ];
  for (const [body, status, unknownChecks] of cases) {
    const before = { ...app.counts(), unknown: app.unknownChecks() };
    const result = await app.login(request(body));
    assert.equal(result.status, status, JSON.stringify(body));
    assert.equal(app.counts().verifications - before.verifications, 1, JSON.stringify(body));
    assert.equal(app.unknownChecks() - before.unknown, unknownChecks, JSON.stringify(body));
  }
});

test("guesses against one account from many addresses lock it with backoff", async () => {
  let time = 100000;
  const app = await routes(openQuota, { staff: staffMembers, now: () => time });
  const guess = (pin, ip, username = "Ali") =>
    app.login(request({ restaurantCode: "TEST", username, pin }, ip));
  for (let index = 0; index < 10; index++)
    assert.equal((await guess(String(index).padStart(4, "0"), `10.0.0.${index}`)).status, 401);
  const before = app.counts().verifications;
  const locked = await guess("4821", "10.0.1.1");
  assert.equal(locked.status, 429, "the correct PIN is refused while the account is locked");
  assert.equal(locked.headers["Retry-After"], "60");
  assert.equal(app.counts().verifications, before, "no hash is spent on a locked account");
  // Another account and an unknown name with the same history are independent but equal.
  assert.equal((await guess("1357", "10.0.1.2", "Ayşe")).status, 200);
  time += 60_000;
  assert.equal((await guess("9999", "10.0.1.3")).status, 401);
  const longer = await guess("4821", "10.0.1.4");
  assert.equal(longer.status, 429);
  assert.equal(longer.headers["Retry-After"], "120");
  time += 120_000;
  assert.equal((await guess("4821", "10.0.1.5")).status, 200, "a correct PIN clears the lock");
  assert.equal((await guess("0000", "10.0.1.6")).status, 401);
});

test("owner password guesses through login and password change share one lockout", async () => {
  const app = await routes(openQuota);
  for (let index = 0; index < 10; index++) {
    const ip = `10.1.0.${index}`;
    const result =
      index % 2
        ? await app.change(
            request({ currentPassword: "wrong", newPassword: "Replacement123!" }, ip)
          )
        : await app.login(request({ restaurantCode: "TEST", password: "wrong" }, ip));
    assert.equal(result.status, 401);
  }
  assert.equal(
    (await app.login(request({ restaurantCode: "TEST", password: "correct" }, "10.1.1.1"))).status,
    429
  );
  assert.equal(
    (
      await app.change(
        request({ currentPassword: "correct", newPassword: "Replacement123!" }, "10.1.1.2")
      )
    ).status,
    429
  );
});
