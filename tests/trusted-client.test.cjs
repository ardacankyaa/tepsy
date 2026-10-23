const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const trusted = require("../src/lib/trusted-client.cjs");
const { createAuthenticationThrottle } = require("../src/lib/auth-throttle.cjs");
const recovery = require("../src/lib/owner-recovery.cjs");

const PROOF_KEY = Symbol.for("tepsy.trustedClientProof");

function withoutInstalledProof(work) {
  const previous = globalThis[PROOF_KEY];
  delete globalThis[PROOF_KEY];
  try {
    return work();
  } finally {
    if (previous !== undefined) globalThis[PROOF_KEY] = previous;
  }
}

const request = (headers) => ({ headers: new Headers(headers) });

test("client address headers are ignored until server.js installs its proof", () => {
  withoutInstalledProof(() => {
    for (const headers of [
      { "x-tepsy-client-ip": "127.0.0.1" },
      { "x-restopos-client-ip": "127.0.0.1" },
      { "x-tepsy-client-ip": "127.0.0.1", [trusted.PROOF_HEADER]: "" },
      { "x-tepsy-client-ip": "127.0.0.1", [trusted.PROOF_HEADER]: "undefined" },
    ]) {
      assert.equal(trusted.trustedClientAddress(request(headers)), "");
      assert.equal(recovery.isLocalRecoveryRequest(request(headers)), false);
    }
    const headers = { "x-tepsy-client-ip": "forged" };
    trusted.stampTrustedClientAddress(headers, "127.0.0.1");
    assert.deepEqual(headers, {}, "without a proof nothing is stamped");
  });
});

test("only the per-process proof makes the stamped peer address trusted", () => {
  const proof = trusted.installTrustedClientProof();
  assert.equal(trusted.installTrustedClientProof(), proof, "the proof is stable per process");
  assert.ok(proof.length >= 43);
  const peer = (value, headerProof) =>
    trusted.trustedClientAddress(
      request({ "x-tepsy-client-ip": value, [trusted.PROOF_HEADER]: headerProof })
    );
  assert.equal(peer("192.168.1.20", proof), "192.168.1.20");
  assert.equal(peer("127.0.0.1", proof.slice(1)), "");
  assert.equal(peer("127.0.0.1", proof.slice(0, -1) + (proof.endsWith("A") ? "B" : "A")), "");
  assert.equal(
    trusted.trustedClientAddress(
      request({ "x-restopos-client-ip": "::1", [trusted.PROOF_HEADER]: proof })
    ),
    "::1",
    "legacy address header remains readable when stamped"
  );
});

test("stamping replaces every client-supplied copy of the internal headers", () => {
  const proof = trusted.installTrustedClientProof();
  const headers = {
    "x-tepsy-client-ip": "127.0.0.1",
    "X-Restopos-Client-Ip": "127.0.0.1",
    "x-tepsy-internal-proof": "guess",
    "X-TEPSY-INTERNAL-PROOF": "guess",
    host: "localhost:3000",
  };
  trusted.stampTrustedClientAddress(headers, "192.168.1.44");
  assert.deepEqual(headers, {
    host: "localhost:3000",
    "x-tepsy-client-ip": "192.168.1.44",
    "x-restopos-client-ip": "192.168.1.44",
    "x-tepsy-internal-proof": proof,
  });
  assert.equal(trusted.trustedClientAddress(request(headers)), "192.168.1.44");
  const missing = { "x-tepsy-client-ip": "127.0.0.1" };
  trusted.stampTrustedClientAddress(missing, undefined);
  assert.equal(trusted.trustedClientAddress(request(missing)), "");
});

test("forged client addresses share one login quota instead of receiving fresh ones", () => {
  trusted.installTrustedClientProof();
  const reserve = createAuthenticationThrottle({ now: () => 100000 });
  for (let index = 0; index < 8; index++) {
    const forged = `10.0.0.${index}`;
    assert.equal(
      reserve(request({ "x-tepsy-client-ip": forged, "x-restopos-client-ip": forged })).allowed,
      true
    );
  }
  assert.equal(reserve(request({ "x-tepsy-client-ip": "10.0.0.99" })).allowed, false);
});

test("server.js stamps the peer address before any route code runs", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
  const install = source.indexOf("installTrustedClientProof();");
  const stamp = source.indexOf("stampTrustedClientAddress(req.headers, req.socket.remoteAddress);");
  const handle = source.indexOf("await handle(req, res);");
  assert.ok(install > 0 && stamp > install && handle > stamp);
  assert.equal(source.includes('req.headers["x-tepsy-client-ip"] ='), false);
});
