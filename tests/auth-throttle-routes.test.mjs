import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import trusted from "../src/lib/trusted-client.cjs";

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

async function routes(quota) {
  let verifications = 0;
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
      staffUser: { findMany: async () => [] },
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
    verifyCredential: (value) => {
      verifications++;
      return value === "correct";
    },
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
