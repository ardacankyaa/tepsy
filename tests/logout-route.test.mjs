import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (
  await readFile(new URL("../src/app/api/auth/logout/route.js", import.meta.url), "utf8")
)
  .replace(/^import[^\r\n]*;?\r?\n/gm, "")
  .replace(/export /g, "");

test("logout expires both current and legacy session cookies", async () => {
  const cookies = [];
  const NextResponse = { json: () => ({ cookies: { set: (...args) => cookies.push(args) } }) };
  const post = new Function(
    "NextResponse",
    "SESSION_COOKIE",
    "LEGACY_SESSION_COOKIE",
    "disconnectSessionSockets",
    `${source}\nreturn POST;`
  )(NextResponse, "tepsy_session", "restopos_session", () => {});

  await post({ cookies: { get: () => null } });
  assert.deepEqual(cookies, [
    ["tepsy_session", "", { path: "/", maxAge: 0 }],
    ["restopos_session", "", { path: "/", maxAge: 0 }],
  ]);
});
