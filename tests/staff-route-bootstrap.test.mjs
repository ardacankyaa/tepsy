import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { currentStaffSession } from "../src/lib/security-policy.cjs";
import { normalizeStaffCreate, normalizeStaffUpdate } from "../src/lib/staff-input.cjs";

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

function staffRoutes(actor, targetRole = "ADMIN") {
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
    () => {}
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
