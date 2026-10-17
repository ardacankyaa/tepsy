import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import ownerAuthVersion from "./owner-auth-version.cjs";
import sessionToken from "./session-token.cjs";

import cookiePolicy from "./session-cookies.cjs";
const cookieNames = cookiePolicy.sessionCookieNames();
export const SESSION_COOKIE = cookieNames.current;
export const LEGACY_SESSION_COOKIE = cookieNames.legacy;
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
export const REMEMBERED_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const STAFF_ROLES = sessionToken.STAFF_ROLES;
export const credentialSessionVersion = ownerAuthVersion.credentialSessionVersion;

const encode = (value) => Buffer.from(value).toString("base64url");

const getSessionSecret = () => {
  const secret = process.env.TEPSY_SESSION_SECRET || process.env.RESTOPOS_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("TEPSY_SESSION_SECRET is not initialized");
  }
  return secret;
};

export function normalizeRestaurantCode(value) {
  return String(value || "")
    .trim()
    .toLocaleUpperCase("tr-TR")
    .replace(/[^A-Z0-9ÇĞİÖŞÜ_-]/g, "")
    .slice(0, 32);
}

export function hashCredential(value) {
  const normalized = String(value || "");
  if (normalized.length < 4) throw new Error("credential-too-short");
  const salt = randomBytes(16);
  const derived = scryptSync(normalized, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyCredential(value, storedHash) {
  try {
    const [algorithm, saltPart, hashPart] = String(storedHash || "").split("$");
    if (algorithm !== "scrypt" || !saltPart || !hashPart) return false;
    const expected = Buffer.from(hashPart, "base64url");
    const actual = scryptSync(
      String(value || ""),
      Buffer.from(saltPart, "base64url"),
      expected.length
    );
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createSessionToken({
  userId,
  name,
  role,
  credentialVersion,
  rememberDevice = false,
}) {
  const maxAge =
    userId === "owner" && rememberDevice === true
      ? REMEMBERED_SESSION_MAX_AGE_SECONDS
      : SESSION_MAX_AGE_SECONDS;
  const payload = encode(
    JSON.stringify({
      userId,
      name,
      role,
      issuedAt: Date.now(),
      sessionId: randomBytes(24).toString("base64url"),
      expiresAt: Date.now() + maxAge * 1000,
      ...(credentialVersion ? { credentialVersion } : {}),
    })
  );
  const signature = createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySessionToken(token) {
  return sessionToken.verifySessionToken(token);
}

export function roleHome(role) {
  return (
    {
      ADMIN: "/",
      WAITER: "/order",
      KITCHEN: "/kitchen",
      CASHIER: "/pos",
    }[role] || "/login"
  );
}

export function sessionFromRequest(request) {
  const token =
    request.cookies?.get?.(SESSION_COOKIE)?.value ||
    request.cookies?.get?.(LEGACY_SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}
