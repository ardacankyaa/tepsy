const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { resolveRuntimeConfig, validateSessionSecret } = require("../scripts/runtime-config.cjs");
const { resolveStateFile, resolveBackupDirectory } = require("../scripts/runtime-config.cjs");
const fs = require("node:fs");

test("legacy secret and device files are reused until modern state exists", () => {
  const qaRoot = path.resolve(".tepsy/qa");
  fs.mkdirSync(qaRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(qaRoot, "state-path-"));
  assert.ok(root.startsWith(qaRoot + path.sep), "Invalid test cleanup path");
  try {
    fs.mkdirSync(path.join(root, ".restopos"));
    fs.writeFileSync(path.join(root, ".restopos", "session-secret"), "test-only-secret");
    assert.equal(
      resolveStateFile("session-secret", root),
      path.join(root, ".restopos", "session-secret")
    );
    assert.equal(resolveStateFile("devices.json", root), path.join(root, ".tepsy", "devices.json"));
    fs.mkdirSync(path.join(root, ".tepsy"));
    fs.writeFileSync(path.join(root, ".tepsy", "session-secret"), "modern-test-secret");
    assert.equal(
      resolveStateFile("session-secret", root),
      path.join(root, ".tepsy", "session-secret")
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("launcher resolves the same default and custom SQLite file as the server", () => {
  const root = path.resolve("fixture-project");
  assert.equal(resolveRuntimeConfig({}, root).databasePath, path.join(root, "prisma", "dev.db"));
  assert.equal(
    resolveRuntimeConfig({ TEPSY_DATABASE_URL: "file:./tepsy-custom.db" }, root).databasePath,
    path.join(root, "prisma", "tepsy-custom.db")
  );
  assert.equal(
    resolveRuntimeConfig({ RESTOPOS_DATABASE_URL: "file:./custom.db" }, root).databasePath,
    path.join(root, "prisma", "custom.db")
  );
  const custom = path.join(root, "data", "cafe #1.db");
  assert.equal(
    resolveRuntimeConfig({ RESTOPOS_DATABASE_URL: pathToFileURL(custom).href, PORT: "3100" }, root)
      .databasePath,
    custom
  );
  assert.equal(resolveRuntimeConfig({ PORT: "3100" }, root).port, 3100);
});

test("launcher rejects invalid ports and unsupported database schemes before startup", () => {
  for (const PORT of ["invalid", "0", "-1", "65536"])
    assert.throws(() => resolveRuntimeConfig({ PORT }));
  assert.throws(() => resolveRuntimeConfig({ RESTOPOS_DATABASE_URL: "https://invalid.local/db" }));
});

test("startup rejects a configured session secret shorter than 32 characters", () => {
  assert.throws(() => validateSessionSecret("short-secret"), /at least 32 characters/);
  const validSecret = "s".repeat(32);
  assert.equal(validateSessionSecret(validSecret), validSecret);
});

test("backup defaults and legacy configuration use the same runtime paths as the application", () => {
  const { backupArguments } = require("../scripts/backup.cjs");
  const root = path.resolve("fixture-project");
  assert.equal(
    resolveBackupDirectory({ RESTOPOS_BACKUP_DIR: "old backups" }, root),
    path.join(root, "old backups")
  );
  assert.equal(
    resolveBackupDirectory({ TEPSY_BACKUP_DIR: "new", RESTOPOS_BACKUP_DIR: "old" }, root),
    path.join(root, "new")
  );
  assert.deepEqual(
    backupArguments(
      [],
      { RESTOPOS_DATABASE_URL: "file:./custom.db", RESTOPOS_BACKUP_DIR: "old backups" },
      root
    ),
    ["--source", path.join(root, "prisma/custom.db"), "--dest-dir", path.join(root, "old backups")]
  );
  assert.deepEqual(backupArguments(["--source=chosen.db", "--dest-dir=chosen"], {}, root), [
    "--source=chosen.db",
    "--dest-dir=chosen",
  ]);
  assert.deepEqual(backupArguments(["--help"], { TEPSY_DATABASE_URL: "invalid" }, root), [
    "--help",
  ]);
});
