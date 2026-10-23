import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth-local.js";
import { requireStaffRole } from "../src/lib/route-access.mjs";
import trusted from "../src/lib/trusted-client.cjs";

function useSessionEnvironment(t) {
  const qa = path.resolve(".tepsy/qa");
  fs.mkdirSync(qa, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(qa, "route-access-"));
  const previousSecret = process.env.TEPSY_SESSION_SECRET;
  const previousStore = process.env.TEPSY_SESSION_REVOCATION_PATH;
  process.env.TEPSY_SESSION_SECRET = "route-access-test-session-secret-at-least-32-chars";
  process.env.TEPSY_SESSION_REVOCATION_PATH = path.join(temporary, "revoked.db");
  t.after(() => {
    if (previousSecret === undefined) delete process.env.TEPSY_SESSION_SECRET;
    else process.env.TEPSY_SESSION_SECRET = previousSecret;
    if (previousStore === undefined) delete process.env.TEPSY_SESSION_REVOCATION_PATH;
    else process.env.TEPSY_SESSION_REVOCATION_PATH = previousStore;
    assert.ok(temporary.startsWith(qa + path.sep));
    fs.rmSync(temporary, { recursive: true, force: true });
  });
}

function client({ protectedLogin = true, staff = {} } = {}) {
  return {
    restaurantConfig: {
      findFirst: async () =>
        protectedLogin ? { authEnabled: true, accessPasswordHash: "owner-hash" } : null,
    },
    staffUser: { findUnique: async ({ where }) => staff[where.id] || null },
  };
}

function request({ token, peer } = {}) {
  const headers = new Headers();
  if (peer) {
    headers.set(trusted.CLIENT_ADDRESS_HEADER, peer);
    headers.set(trusted.PROOF_HEADER, trusted.installTrustedClientProof());
  }
  return {
    headers,
    cookies: { get: (name) => (name === SESSION_COOKIE && token ? { value: token } : undefined) },
  };
}

const staffRow = (id, role) => ({ id, role, isActive: true, updatedAt: new Date(0) });

test("every staff role is admitted only to the roles a handler allows", async (t) => {
  useSessionEnvironment(t);
  const staff = {
    "admin-1": staffRow("admin-1", "ADMIN"),
    "waiter-1": staffRow("waiter-1", "WAITER"),
    "kitchen-1": staffRow("kitchen-1", "KITCHEN"),
    "cashier-1": staffRow("cashier-1", "CASHIER"),
  };
  const db = client({ staff });
  const allowedSets = [["ADMIN"], ["ADMIN", "CASHIER"], ["ADMIN", "WAITER"]];
  for (const [id, row] of Object.entries(staff)) {
    const token = createSessionToken({ userId: id, name: id, role: row.role });
    for (const roles of allowedSets) {
      const result = await requireStaffRole(request({ token, peer: "192.168.1.40" }), db, roles);
      if (roles.includes(row.role)) {
        assert.equal(result.session.role, row.role);
        assert.equal(result.denied, undefined);
      } else {
        assert.equal(result.denied.status, 403, `${row.role} for ${roles}`);
        assert.equal(result.session, undefined);
      }
    }
  }
});

test("missing, forged and stale sessions are refused before handler work", async (t) => {
  useSessionEnvironment(t);
  const db = client({ staff: { "kitchen-1": staffRow("kitchen-1", "KITCHEN") } });
  assert.equal((await requireStaffRole(request(), db, ["ADMIN"])).denied.status, 401);
  const forged = createSessionToken({ userId: "kitchen-1", role: "ADMIN" });
  assert.equal(
    (await requireStaffRole(request({ token: forged }), db, ["ADMIN"])).denied.status,
    401,
    "a role that no longer matches the staff record is refused"
  );
  const owner = createSessionToken({
    userId: "owner",
    role: "ADMIN",
    credentialVersion: "outdated",
  });
  assert.equal(
    (await requireStaffRole(request({ token: owner }), db, ["ADMIN"])).denied.status,
    401
  );
  const denied = (await requireStaffRole(request(), db, ["ADMIN"])).denied;
  assert.equal(denied.headers.get("cache-control"), "no-store");
  assert.deepEqual(await denied.json(), { error: "Authentication required." });
});

test("without staff sign-in only the stamped server computer is admitted", async () => {
  const db = client({ protectedLogin: false });
  for (const peer of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    const result = await requireStaffRole(request({ peer }), db, ["ADMIN"]);
    assert.equal(result.session.role, "ADMIN");
  }
  assert.equal(
    (await requireStaffRole(request({ peer: "192.168.1.40" }), db, ["ADMIN"])).denied.status,
    403
  );
  const spoofed = { headers: new Headers({ [trusted.CLIENT_ADDRESS_HEADER]: "127.0.0.1" }) };
  assert.equal((await requireStaffRole(spoofed, db, ["ADMIN"])).denied.status, 403);
});
