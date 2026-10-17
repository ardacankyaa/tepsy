const fs = require("node:fs"),
  path = require("node:path"),
  { fileURLToPath } = require("node:url");
const { resolveRuntimeConfig } = require("../../scripts/runtime-config.cjs");
function resolveSeedDatabaseUrl(env = process.env, root = process.cwd()) {
  const url = env.TEPSY_SEED_DATABASE_URL || env.RESTOPOS_SEED_DATABASE_URL;
  if (!url)
    throw new Error(
      "TEPSY_SEED_DATABASE_URL must explicitly select an initialized disposable database inside .tepsy/qa/."
    );
  if (!url.startsWith("file:") || /[?#]/.test(url))
    throw new Error("Seed database must use a plain local SQLite file: URL.");
  const input = url.startsWith("file://") ? fileURLToPath(url) : decodeURIComponent(url.slice(5));
  const target = path.resolve(root, "prisma", input);
  const allowed = path.join(root, ".tepsy", "qa");
  const relative = path.relative(allowed, target);
  if (
    !relative ||
    relative.startsWith(".." + path.sep) ||
    relative === ".." ||
    path.isAbsolute(relative)
  )
    throw new Error("Seed database must stay inside .tepsy/qa/.");
  const configured = resolveRuntimeConfig(env, root).databasePath;
  if (!path.relative(target, configured))
    throw new Error("Seed cannot target the configured restaurant database.");
  if (!fs.existsSync(target))
    throw new Error("Initialize the disposable database schema before seeding.");
  const realRoot = fs.realpathSync(root),
    realTarget = fs.realpathSync(target),
    realAllowed = path.join(realRoot, ".tepsy", "qa");
  const realConfigured = fs.existsSync(configured) ? fs.realpathSync(configured) : configured;
  if (!path.relative(realTarget, realConfigured))
    throw new Error("Seed cannot target the configured restaurant database.");
  const realRelative = path.relative(realAllowed, realTarget);
  if (
    !realRelative ||
    realRelative.startsWith(".." + path.sep) ||
    realRelative === ".." ||
    path.isAbsolute(realRelative)
  )
    throw new Error("Seed database symlinks cannot escape .tepsy/qa/.");
  return "file:" + realTarget.replaceAll("\\", "/");
}
module.exports = { resolveSeedDatabaseUrl };
