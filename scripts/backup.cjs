const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { resolveRuntimeConfig, resolveBackupDirectory } = require("./runtime-config.cjs");

function backupArguments(args, env, root) {
  if (args.includes("--help") || args.includes("-h")) return args;
  const has = (flag) => args.some((arg) => arg === flag || arg.startsWith(flag + "="));
  return [
    ...(!has("--source") ? ["--source", resolveRuntimeConfig(env, root).databasePath] : []),
    ...(!has("--dest-dir") ? ["--dest-dir", resolveBackupDirectory(env, root)] : []),
    ...args,
  ];
}

if (require.main === module) {
  try {
    const root = process.cwd();
    if (fs.existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
    const args = backupArguments(process.argv.slice(2), process.env, root);
    const candidates =
      process.platform === "win32" ? ["py", "python3", "python"] : ["python3", "python"];
    const python = candidates.find(
      (executable) =>
        spawnSync(executable, ["-c", "import sys; assert sys.version_info >= (3,8)"], {
          stdio: "ignore",
          windowsHide: true,
        }).status === 0
    );
    if (!python) throw new Error("Python 3.8+ is required for SQLite backups.");
    const result = spawnSync(python, [path.join(__dirname, "sqlite-backup.py"), ...args], {
      cwd: root,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { backupArguments };
