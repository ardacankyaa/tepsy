const { createHmac } = require("crypto");

const VERSION_PURPOSE = "tepsy-owner-password-session-v1\0";

function credentialSessionVersion(
  passwordHash,
  secret = process.env.TEPSY_SESSION_SECRET || process.env.RESTOPOS_SESSION_SECRET
) {
  if (!passwordHash) return null;
  if (!secret || secret.length < 32) throw new Error("TEPSY_SESSION_SECRET is not initialized");
  return createHmac("sha256", secret)
    .update(VERSION_PURPOSE)
    .update(String(passwordHash))
    .digest("base64url");
}

module.exports = { credentialSessionVersion };
