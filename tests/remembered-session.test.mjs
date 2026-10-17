import test from "node:test";
import assert from "node:assert/strict";
import {
  createSessionToken,
  verifySessionToken,
  credentialSessionVersion,
  SESSION_MAX_AGE_SECONDS,
  REMEMBERED_SESSION_MAX_AGE_SECONDS,
} from "../src/lib/auth-local.js";
import securityPolicy from "../src/lib/security-policy.cjs";

test("remembered owner sessions are signed, bounded to 30 days, and password changes revoke them", async (t) => {
  const prior = process.env.TEPSY_SESSION_SECRET;
  process.env.TEPSY_SESSION_SECRET = "remember-device-test-session-secret-at-least-32-characters";
  t.after(() => {
    if (prior === undefined) delete process.env.TEPSY_SESSION_SECRET;
    else process.env.TEPSY_SESSION_SECRET = prior;
  });
  const version = credentialSessionVersion("original-owner-password-hash");
  const token = createSessionToken({
    userId: "owner",
    role: "ADMIN",
    credentialVersion: version,
    rememberDevice: true,
  });
  const session = verifySessionToken(token);
  assert.ok(
    Math.abs(session.expiresAt - session.issuedAt - REMEMBERED_SESSION_MAX_AGE_SECONDS * 1000) < 10
  );
  assert.equal(verifySessionToken(token.slice(0, -3) + "xyz"), null);
  assert.equal(
    (await securityPolicy.currentStaffSession(session, () => null, version)).userId,
    "owner"
  );
  assert.equal(
    await securityPolicy.currentStaffSession(
      session,
      () => null,
      credentialSessionVersion("new-owner-password-hash")
    ),
    null
  );
  for (const identity of [
    { userId: "owner", role: "ADMIN", rememberDevice: false },
    { userId: "staff", role: "CASHIER", rememberDevice: true },
    { userId: "owner", role: "ADMIN", rememberDevice: "true" },
  ]) {
    const ordinary = verifySessionToken(createSessionToken(identity));
    assert.ok(
      Math.abs(ordinary.expiresAt - ordinary.issuedAt - SESSION_MAX_AGE_SECONDS * 1000) < 10
    );
  }
});
