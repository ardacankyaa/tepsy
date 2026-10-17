const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

function resolveRuntimeConfig(env = process.env, root = process.cwd()) {
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer between 1 and 65535.");
  const url = env.TEPSY_DATABASE_URL || env.RESTOPOS_DATABASE_URL || "file:./dev.db";
  if (!url.startsWith("file:"))
    throw new Error("TEPSY requires a local SQLite file: database URL.");
  const databasePath = url.startsWith("file://")
    ? fileURLToPath(url)
    : path.resolve(root, "prisma", decodeURIComponent(url.slice(5).split("?")[0]));
  const host = env.TEPSY_BIND_HOST || env.RESTOPOS_BIND_HOST || "0.0.0.0";
  if (!require("node:net").isIP(host))
    throw new Error("TEPSY_BIND_HOST must be a literal IP address.");
  return { port, databasePath, host };
}

function validateSessionSecret(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("TEPSY_SESSION_SECRET must be at least 32 characters.");
  }
  return secret;
}

function resolveStateFile(filename, root = process.cwd()) {
  const modern = path.join(root, ".tepsy", filename);
  const legacy = path.join(root, ".restopos", filename);
  return fs.existsSync(modern) || !fs.existsSync(legacy) ? modern : legacy;
}

if (require.main === module) {
  if (fs.existsSync(".env")) process.loadEnvFile(".env");
  process.stdout.write(JSON.stringify(resolveRuntimeConfig()));
}

module.exports = { resolveRuntimeConfig, validateSessionSecret, resolveStateFile };
