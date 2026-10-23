const { randomBytes, timingSafeEqual } = require("node:crypto");

// server.js records the TCP peer in these headers before Next.js handles a request.
// Route code trusts them only alongside a per-process proof that clients cannot know,
// so a handler reached without server.js (or a forwarded copy) fails closed.
const CLIENT_ADDRESS_HEADER = "x-tepsy-client-ip";
const LEGACY_CLIENT_ADDRESS_HEADER = "x-restopos-client-ip";
const PROOF_HEADER = "x-tepsy-internal-proof";
const INTERNAL_HEADERS = [CLIENT_ADDRESS_HEADER, LEGACY_CLIENT_ADDRESS_HEADER, PROOF_HEADER];
const PROOF_KEY = Symbol.for("tepsy.trustedClientProof");

function installTrustedClientProof() {
  if (typeof globalThis[PROOF_KEY] !== "string")
    globalThis[PROOF_KEY] = randomBytes(32).toString("base64url");
  return globalThis[PROOF_KEY];
}

// Replace any client-supplied copies with the actual peer address.
function stampTrustedClientAddress(headers, remoteAddress) {
  for (const name of Object.keys(headers)) {
    if (INTERNAL_HEADERS.includes(name.toLowerCase())) delete headers[name];
  }
  const proof = globalThis[PROOF_KEY];
  if (typeof proof !== "string") return;
  const address = String(remoteAddress || "");
  headers[CLIENT_ADDRESS_HEADER] = address;
  headers[LEGACY_CLIENT_ADDRESS_HEADER] = address;
  headers[PROOF_HEADER] = proof;
}

function readHeader(request, name) {
  const headers = request?.headers;
  if (typeof headers?.get === "function") return headers.get(name);
  return headers?.[name];
}

function trustedClientAddress(request) {
  const proof = globalThis[PROOF_KEY];
  const supplied = readHeader(request, PROOF_HEADER);
  if (typeof proof !== "string" || typeof supplied !== "string") return "";
  const expected = Buffer.from(proof);
  const actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return "";
  return String(
    readHeader(request, CLIENT_ADDRESS_HEADER) ||
      readHeader(request, LEGACY_CLIENT_ADDRESS_HEADER) ||
      ""
  );
}

module.exports = {
  CLIENT_ADDRESS_HEADER,
  LEGACY_CLIENT_ADDRESS_HEADER,
  PROOF_HEADER,
  installTrustedClientProof,
  stampTrustedClientAddress,
  trustedClientAddress,
};
