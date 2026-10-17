const { createHmac, timingSafeEqual } = require("node:crypto");
const { isSessionRevoked } = require("./session-revocation.cjs");
const STAFF_ROLES = ["ADMIN", "WAITER", "KITCHEN", "CASHIER"];

// HTTP, API routes and Socket.IO must use the same cookie verification rules.
function verifySessionToken(token) {
  try {
    if (
      typeof token !== "string" ||
      token.length > 4096 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)
    )
      return null;
    const [payload, signature] = token.split(".");
    const secret = process.env.TEPSY_SESSION_SECRET || process.env.RESTOPOS_SESSION_SECRET;
    if (!secret || secret.length < 32) return null;
    const actual = Buffer.from(signature, "base64url");
    if (actual.toString("base64url") !== signature) return null;
    const expected = createHmac("sha256", secret).update(payload).digest();
    if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) return null;
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (
      !Number.isSafeInteger(session.expiresAt) ||
      session.expiresAt <= Date.now() ||
      !STAFF_ROLES.includes(session.role)
    )
      return null;
    if (isSessionRevoked(token)) return null;
    return session;
  } catch {
    return null;
  }
}
module.exports = { verifySessionToken, STAFF_ROLES };
