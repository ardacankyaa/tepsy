import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  createSessionToken,
  verifySessionToken,
  SESSION_COOKIE,
  LEGACY_SESSION_COOKIE,
} from "../src/lib/auth-local.js";
import revocations from "../src/lib/session-revocation.cjs";
import security from "../src/lib/security-policy.cjs";

test("logout revokes the actual signed cookie, disconnects its socket and preserves another device session", async (t) => {
  const qa = path.resolve(".tepsy/qa");
  fs.mkdirSync(qa, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(qa, "logout-"));
  const previousSecret = process.env.TEPSY_SESSION_SECRET;
  const previousStore = process.env.TEPSY_SESSION_REVOCATION_PATH;
  process.env.TEPSY_SESSION_SECRET = "logout-test-session-secret-at-least-32-characters";
  process.env.TEPSY_SESSION_REVOCATION_PATH = path.join(temporary, "revoked.db");
  t.after(() => {
    if (previousSecret === undefined) delete process.env.TEPSY_SESSION_SECRET;
    else process.env.TEPSY_SESSION_SECRET = previousSecret;
    if (previousStore === undefined) delete process.env.TEPSY_SESSION_REVOCATION_PATH;
    else process.env.TEPSY_SESSION_REVOCATION_PATH = previousStore;
    assert.ok(temporary.startsWith(qa + path.sep));
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const token = createSessionToken({ userId: "cashier", name: "Cashier", role: "CASHIER" });
  const otherToken = createSessionToken({ userId: "other-cashier", role: "CASHIER" });
  let disconnected = false,
    otherDisconnected = false;
  const sockets = new Map([
    [
      "this",
      {
        data: { sessionKey: revocations.sessionTokenKey(token) },
        disconnect: () => {
          disconnected = true;
        },
      },
    ],
    [
      "other",
      {
        data: { sessionKey: revocations.sessionTokenKey(otherToken) },
        disconnect: () => {
          otherDisconnected = true;
        },
      },
    ],
  ]);
  const source = (
    await readFile(new URL("../src/app/api/auth/logout/route.js", import.meta.url), "utf8")
  )
    .replace(/^import[\s\S]*?from "[^"]+";\r?$/gm, "")
    .replace(/export /g, "");
  const cleared = [];
  const dependencies = {
    SESSION_COOKIE,
    LEGACY_SESSION_COOKIE,
    verifySessionToken,
    revokeSessionToken: revocations.revokeSessionToken,
    sessionTokenKey: revocations.sessionTokenKey,
    disconnectSessionSockets: security.disconnectSessionSockets,
    NextResponse: {
      json: (body, options = {}) => ({
        body,
        status: options.status || 200,
        cookies: { set: (...args) => cleared.push(args) },
      }),
    },
    global: { io: { sockets: { sockets } } },
  };
  const logout = new Function(...Object.keys(dependencies), `${source}\nreturn POST;`)(
    ...Object.values(dependencies)
  );
  const response = await logout({
    cookies: { get: (key) => (key === SESSION_COOKIE ? { value: token } : null) },
  });
  assert.equal(response.status, 200);
  assert.equal(
    verifySessionToken(token),
    null,
    "A copied logout cookie must be rejected server-side"
  );
  assert.equal(
    verifySessionToken(token + ".ignored"),
    null,
    "Extra token segments cannot bypass logout revocation"
  );
  assert.equal(
    verifySessionToken(token + "="),
    null,
    "Alternate signature encodings cannot bypass logout revocation"
  );
  assert.ok(verifySessionToken(otherToken));
  assert.equal(disconnected, true);
  assert.equal(otherDisconnected, false);
  assert.equal(cleared.length, 2);
  assert.equal(
    fs.readFileSync(process.env.TEPSY_SESSION_REVOCATION_PATH).includes(Buffer.from(token)),
    false
  );
  // The socket handshake can finish its async staff lookup after logout has
  // already disconnected the sockets that were connected at that time.
  const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
  const connectionBody = serverSource.match(
    /io\.on\("connection", \(socket\) => \{([\s\S]*?)\n {2}\}\);/
  )[1];
  let joined = false;
  disconnected = false;
  const lateSocket = {
    data: {
      session: { userId: "cashier", role: "CASHIER" },
      authorizationRevision: security.getSocketAuthorizationRevision(),
    },
    handshake: { headers: { cookie: `${SESSION_COOKIE}=${token}` } },
    disconnect: () => {
      disconnected = true;
    },
    join: () => {
      joined = true;
    },
  };
  const onConnection = new Function(
    "socket",
    "readCookie",
    "cookieNames",
    "verifyLocalSession",
    "scheduleSessionExpiryDisconnect",
    "getSocketAuthorizationRevision",
    connectionBody
  );
  onConnection(
    lateSocket,
    () => token,
    { current: SESSION_COOKIE, legacy: LEGACY_SESSION_COOKIE },
    verifySessionToken,
    () => {},
    security.getSocketAuthorizationRevision
  );
  assert.equal(disconnected, true, "A connection completing after logout must be rejected too");
  assert.equal(joined, false);
});

test("independent logins in the same millisecond receive distinct session cookies", (t) => {
  const previousSecret = process.env.TEPSY_SESSION_SECRET;
  const previousNow = Date.now;
  process.env.TEPSY_SESSION_SECRET = "unique-session-cookie-test-secret-at-least-32-characters";
  Date.now = () => 1900000000000;
  t.after(() => {
    Date.now = previousNow;
    if (previousSecret === undefined) delete process.env.TEPSY_SESSION_SECRET;
    else process.env.TEPSY_SESSION_SECRET = previousSecret;
  });
  const identity = { userId: "owner", role: "ADMIN" };
  assert.notEqual(createSessionToken(identity), createSessionToken(identity));
});
