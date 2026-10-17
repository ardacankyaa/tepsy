const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { resolveStateFile } = require("../../scripts/runtime-config.cjs");

function filename() {
  return (
    process.env.TEPSY_SESSION_REVOCATION_PATH ||
    process.env.RESTOPOS_SESSION_REVOCATION_PATH ||
    resolveStateFile("revoked-sessions.db")
  );
}
function sessionTokenKey(token) {
  return createHash("sha256").update(token).digest("hex");
}
function isSessionRevoked(token) {
  const file = filename();
  if (!fs.existsSync(file)) return false;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return Boolean(
      db
        .prepare("SELECT 1 FROM RevokedSession WHERE tokenKey=? AND expiresAt>?")
        .get(sessionTokenKey(token), Date.now())
    );
  } finally {
    db.close();
  }
}
function revokeSessionToken(token, expiresAt) {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return;
  const file = filename();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec(
      "PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS RevokedSession (tokenKey TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL)"
    );
    db.prepare(
      "INSERT INTO RevokedSession VALUES (?,?) ON CONFLICT(tokenKey) DO UPDATE SET expiresAt=excluded.expiresAt"
    ).run(sessionTokenKey(token), expiresAt);
    db.prepare("DELETE FROM RevokedSession WHERE expiresAt<=?").run(Date.now());
  } finally {
    db.close();
  }
}
module.exports = { sessionTokenKey, isSessionRevoked, revokeSessionToken };
