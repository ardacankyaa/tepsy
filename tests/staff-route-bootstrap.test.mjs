import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { currentStaffSession } from "../src/lib/security-policy.cjs";
import { normalizeStaffCreate, normalizeStaffUpdate } from "../src/lib/staff-input.cjs";
import throttle from "../src/lib/auth-throttle.cjs";
import trusted from "../src/lib/trusted-client.cjs";
// Request doubles expose json(); real-stream size limits are covered in request-body tests.
const readRequestJson = async (request) => {
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error("Invalid JSON request body."), {
      code: "invalid-json-body",
      status: 400,
    });
  }
};

const source = (await readFile(new URL("../src/app/api/staff/route.js", import.meta.url), "utf8"))
  .replace(/^import[^\r\n]*;?\r?\n/gm, "")
  .replace(/export /g, "");

function staffGet(config) {
  const prisma = {
    restaurantConfig: { findFirst: async () => config },
    staffUser: { findMany: async () => [] },
  };
  const NextResponse = { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) };
  return new Function("NextResponse", "prisma", "sessionFromRequest", `${source}\nreturn GET;`)(
    NextResponse,
    prisma,
    () => null
  );
}

test("staff settings load during local bootstrap when auth flag has no password", async () => {
  const response = await staffGet({ authEnabled: true, accessPasswordHash: null })({});
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, []);
});

test("staff settings still require admin when password protection is configured", async () => {
  const response = await staffGet({ authEnabled: true, accessPasswordHash: "stored-hash" })({});
  assert.equal(response.status, 403);
});

function staffRoutes(actor, targetRole = "ADMIN", lockout = throttle.createAccountLockout()) {
  let writes = 0;
  const session = {
    userId: actor,
    role: "ADMIN",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60000,
    credentialVersion: "owner-version",
  };
  const prisma = {
    $transaction: async (work) => work(prisma),
    restaurantConfig: {
      findFirst: async () => ({ authEnabled: true, accessPasswordHash: "stored-hash" }),
    },
    staffUser: {
      findUnique: async ({ where }) => ({
        id: where.id,
        name: where.id === actor ? "Admin" : "Ali",
        role: where.id === actor ? "ADMIN" : targetRole,
        isActive: true,
      }),
      create: async ({ data }) => {
        writes++;
        return { id: "new", ...data };
      },
      update: async ({ data }) => {
        writes++;
        return { id: "target", ...data };
      },
      delete: async () => {
        writes++;
      },
    },
  };
  const NextResponse = { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) };
  const routes = new Function(
    "NextResponse",
    "prisma",
    "sessionFromRequest",
    "currentStaffSession",
    "credentialSessionVersion",
    "normalizeStaffCreate",
    "normalizeStaffUpdate",
    "hashCredential",
    "disconnectStaffSockets",
    "readRequestJson",
    "clearAccountLockout",
    "loginAccountKey",
    `${source}\nreturn {POST, PUT, DELETE};`
  )(
    NextResponse,
    prisma,
    () => session,
    currentStaffSession,
    () => "owner-version",
    normalizeStaffCreate,
    normalizeStaffUpdate,
    () => "hashed-pin",
    () => {},
    readRequestJson,
    lockout.clear,
    throttle.loginAccountKey
  );
  return { routes, writes: () => writes };
}

for (const [method, body] of [
  ["PUT", { id: "target", role: "WAITER" }],
  ["PUT", { id: "target", isActive: false }],
  ["PUT", { id: "target", pin: "1234" }],
  ["DELETE", {}],
  ["POST", { name: "Another admin", role: "ADMIN", pin: "1234" }],
]) {
  test(`staff admin cannot manage another administrator: ${method} ${JSON.stringify(body)}`, async () => {
    const fixture = staffRoutes("staff-admin");
    const response = await fixture.routes[method]({
      url: "http://localhost/api/staff?id=target",
      json: async () => body,
    });
    assert.equal(response.status, 403);
    assert.equal(fixture.writes(), 0);
  });
}

test("staff admin cannot promote a waiter to administrator", async () => {
  const fixture = staffRoutes("staff-admin", "WAITER");
  assert.equal(
    (await fixture.routes.PUT({ json: async () => ({ id: "target", role: "ADMIN" }) })).status,
    403
  );
  assert.equal(fixture.writes(), 0);
});

test("owner can demote an administrator; staff admin can manage ordinary staff", async () => {
  for (const [actor, target] of [
    ["owner", "ADMIN"],
    ["staff-admin", "WAITER"],
  ]) {
    const fixture = staffRoutes(actor, target);
    assert.equal(
      (await fixture.routes.PUT({ json: async () => ({ id: "target", role: "CASHIER" }) })).status,
      200
    );
    assert.equal(fixture.writes(), 1);
  }
});

test("an administrator PIN reset lifts that staff member's sign-in lockout", async () => {
  const lockout = throttle.createAccountLockout();
  const peer = {
    headers: new Headers({
      "x-tepsy-client-ip": "192.168.5.21",
      [trusted.PROOF_HEADER]: trusted.installTrustedClientProof(),
    }),
  };
  const lock = (name) => {
    for (let index = 0; index < 10; index++) lockout(throttle.loginAccountKey(name), peer);
    assert.equal(lockout(throttle.loginAccountKey(name), peer).allowed, false);
  };
  lock("Ali");
  lock("Ayşe");
  const fixture = staffRoutes("owner", "WAITER", lockout);
  assert.equal(
    (await fixture.routes.PUT({ json: async () => ({ id: "target", role: "CASHIER" }) })).status,
    200
  );
  assert.equal(lockout("staff:ali", peer).allowed, false, "other changes keep the lockout");
  assert.equal(
    (await fixture.routes.PUT({ json: async () => ({ id: "target", pin: "4821" }) })).status,
    200
  );
  assert.equal(lockout("staff:ali", peer).allowed, true);
  assert.equal(lockout(throttle.loginAccountKey("Ayşe"), peer).allowed, false);
});
