import test from "node:test";
import assert from "node:assert/strict";
import { authorizePaymentAccess } from "../src/lib/payment-access.mjs";
import { createSessionToken, credentialSessionVersion } from "../src/lib/auth-local.js";

test("payment and receipt access validates cashier role and current staff credentials independently", async (t) => {
  const previousSecret = process.env.TEPSY_SESSION_SECRET;
  process.env.TEPSY_SESSION_SECRET = "payment-test-session-secret-isolated-at-least-32-characters";
  t.after(() => {
    if (previousSecret === undefined) delete process.env.TEPSY_SESSION_SECRET;
    else process.env.TEPSY_SESSION_SECRET = previousSecret;
  });
  let role = "CASHIER";
  let active = true;
  const client = {
    restaurantConfig: {
      findFirst: async () => ({ authEnabled: true, accessPasswordHash: "owner-credential-hash" }),
    },
    staffUser: {
      findUnique: async () => ({ id: "staff1", role, isActive: active, updatedAt: new Date(0) }),
    },
  };
  const request = (data) => ({ cookies: { get: () => ({ value: createSessionToken(data) }) } });
  assert.equal(
    (await authorizePaymentAccess(request({ userId: "staff1", name: "Cashier", role }), client))
      .role,
    "CASHIER"
  );
  role = "WAITER";
  await assert.rejects(
    authorizePaymentAccess(request({ userId: "staff1", role }), client),
    (error) => error.status === 403
  );
  role = "CASHIER";
  active = false;
  await assert.rejects(
    authorizePaymentAccess(request({ userId: "staff1", role }), client),
    (error) => error.status === 401
  );
  await assert.rejects(
    authorizePaymentAccess({ cookies: { get: () => null } }, client),
    (error) => error.status === 401
  );
  assert.equal(
    (
      await authorizePaymentAccess(
        request({
          userId: "owner",
          role: "ADMIN",
          credentialVersion: credentialSessionVersion("owner-credential-hash"),
        }),
        client
      )
    ).userId,
    "owner"
  );
  await assert.rejects(
    authorizePaymentAccess(
      request({
        userId: "owner",
        role: "ADMIN",
        credentialVersion: credentialSessionVersion("old-password"),
      }),
      client
    ),
    (error) => error.status === 401
  );
});

test("local bootstrap without configured authentication keeps existing cashier behavior", async () => {
  assert.equal(
    await authorizePaymentAccess(
      {},
      { restaurantConfig: { findFirst: async () => ({ authEnabled: false }) } }
    ),
    null
  );
});
