const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomBytes, timingSafeEqual } = require("node:crypto");
const { resolveStateFile } = require("../../scripts/runtime-config.cjs");
const { isServerComputerRequest } = require("./trusted-client.cjs");

const CODE_LIFETIME_MS = 10 * 60 * 1000;
const digest = (purpose, value) =>
  createHash("sha256").update(purpose).update(String(value)).digest("hex");
const credentialVersion = (hash) => digest("tepsy-owner-recovery-credential-v1\0", hash);
function codeHash(code) {
  return digest("tepsy-owner-recovery-code-v1\0", code);
}
function validRecord(record, code, passwordHash, now) {
  if (
    !record ||
    record.version !== 1 ||
    !passwordHash ||
    !Number.isSafeInteger(record.expiresAt) ||
    record.expiresAt <= now ||
    record.expiresAt > now + CODE_LIFETIME_MS ||
    record.credentialVersion !== credentialVersion(passwordHash) ||
    !/^[a-f0-9]{64}$/.test(record.codeHash || "")
  )
    return false;
  return timingSafeEqual(Buffer.from(record.codeHash, "hex"), Buffer.from(codeHash(code), "hex"));
}
function readRecord(filename) {
  try {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2048) return null;
    return JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code) || error instanceof SyntaxError) return null;
    throw error;
  }
}
function issueRecoveryCode({ root = process.cwd(), passwordHash, now = Date.now() }) {
  if (!passwordHash)
    throw new Error("Owner password is not configured; use initial setup instead.");
  const filename = resolveStateFile("owner-recovery.json", root);
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const code = randomBytes(24).toString("base64url");
  const expiresAt = now + CODE_LIFETIME_MS;
  const temporary = filename + "." + randomBytes(16).toString("hex") + ".tmp";
  try {
    fs.writeFileSync(
      temporary,
      JSON.stringify({
        version: 1,
        expiresAt,
        codeHash: codeHash(code),
        credentialVersion: credentialVersion(passwordHash),
      }),
      { flag: "wx", mode: 0o600 }
    );
    fs.renameSync(temporary, filename);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return { code, expiresAt };
}
async function consumeRecoveryCode({
  root = process.cwd(),
  code,
  passwordHash,
  now = Date.now(),
  update,
}) {
  if (typeof code !== "string" || code.length > 128 || !passwordHash) return false;
  const filename = resolveStateFile("owner-recovery.json", root);
  if (!validRecord(readRecord(filename), code, passwordHash, now)) return false;
  // Rename claims the one existing challenge before any asynchronous database work.
  // A crash or failed CAS consumes it; the local owner may issue a fresh challenge.
  const claimed = filename + "." + randomBytes(16).toString("hex") + ".claimed";
  try {
    fs.renameSync(filename, claimed);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  try {
    if (!validRecord(readRecord(claimed), code, passwordHash, now)) return false;
    return (await update()) === true;
  } finally {
    fs.rmSync(claimed, { force: true });
  }
}
function isLocalRecoveryRequest(request) {
  return isServerComputerRequest(request);
}
function createRecoveryThrottle({ state = {}, now = Date.now } = {}) {
  return () => {
    const timestamp = now();
    if (!state.resetAt || state.resetAt <= timestamp) {
      state.count = 0;
      state.resetAt = timestamp + 15 * 60 * 1000;
    }
    if (state.count >= 8)
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((state.resetAt - timestamp) / 1000)),
      };
    state.count++;
    return { allowed: true };
  };
}
const sharedState =
  globalThis.__tepsyOwnerRecoveryAttempts || (globalThis.__tepsyOwnerRecoveryAttempts = {});
module.exports = {
  CODE_LIFETIME_MS,
  issueRecoveryCode,
  consumeRecoveryCode,
  isLocalRecoveryRequest,
  createRecoveryThrottle,
  reserveRecoveryAttempt: createRecoveryThrottle({ state: sharedState }),
};
