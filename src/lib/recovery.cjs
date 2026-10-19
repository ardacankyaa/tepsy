const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const crypto = require("node:crypto");
const runtime = require("../../scripts/runtime-config.cjs");
const run = promisify(execFile);
const state = () => path.join(runtime.resolveBackupDirectory(), "backup-status.json");
const settingsPath = () => path.join(runtime.resolveBackupDirectory(), "backup-plan.json");
const defaults = { enabled: false, intervalHours: 24, copyDirectory: "" };
async function json(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}
async function write(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.rename(temp, file);
}
async function python(args) {
  for (const executable of process.platform === "win32"
    ? ["py", "python3", "python"]
    : ["python3", "python"]) {
    try {
      await run(executable, ["-c", "import sys; assert sys.version_info >= (3,8)"], {
        windowsHide: true,
        timeout: 10000,
      });
    } catch {
      continue;
    }
    const { stdout } = await run(
      executable,
      [path.join(process.cwd(), "scripts/recovery-bundle.py"), ...args],
      { windowsHide: true, timeout: 120000, maxBuffer: 5 * 1024 * 1024 }
    );
    return JSON.parse(stdout);
  }

  throw new Error("Python 3.8+ gerekli.");
}
async function digest(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of require("node:fs").createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function backupStatus() {
  return {
    plan: { ...defaults, ...(await json(settingsPath(), {})) },
    status: await json(state(), null),
    running: Boolean(globalThis.__tepsyRecoveryRunning),
  };
}
async function saveBackupPlan(input) {
  if (
    !input ||
    typeof input.enabled !== "boolean" ||
    !Number.isInteger(input.intervalHours) ||
    input.intervalHours < 1 ||
    input.intervalHours > 168 ||
    typeof input.copyDirectory !== "string" ||
    input.copyDirectory.length > 500 ||
    (input.copyDirectory && !path.isAbsolute(input.copyDirectory))
  )
    throw new Error("Yedek planı veya kopya klasörü geçersiz.");
  const backupDir = runtime.resolveBackupDirectory();
  if (input.copyDirectory && path.resolve(input.copyDirectory) === path.resolve(backupDir))
    throw new Error("İkinci kopya için farklı bir klasör seçin.");
  await write(settingsPath(), {
    enabled: input.enabled,
    intervalHours: input.intervalHours,
    copyDirectory: input.copyDirectory,
  });
  return backupStatus();
}
async function createRecoveryBackup() {
  if (globalThis.__tepsyRecoveryRunning) throw new Error("Yedekleme zaten sürüyor.");
  globalThis.__tepsyRecoveryRunning = true;
  const startedAt = new Date().toISOString();
  let current = {};
  try {
    current = await json(state(), {});
    const deadline = Date.now() + 30000;
    while (globalThis.__tepsyActiveWrites > 0) {
      if (Date.now() > deadline)
        throw new Error("Devam eden işlemler tamamlanamadı; yedeği yeniden deneyin.");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const directory = runtime.resolveBackupDirectory();
    await fs.mkdir(directory, { recursive: true });
    const filename = `tepsy-recovery-${startedAt.replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}.zip`;
    const archive = path.join(directory, filename);
    const devices = path.resolve(
      process.env.TEPSY_DEVICES_CONFIG_PATH ||
        process.env.RESTOPOS_DEVICES_CONFIG_PATH ||
        runtime.resolveStateFile("devices.json")
    );
    await python([
      "create",
      "--database",
      runtime.resolveRuntimeConfig().databasePath,
      "--output",
      archive,
      "--images",
      path.resolve(process.env.TEPSY_MENU_IMAGE_DIR || runtime.resolveStateFile("menu-images")),
      "--devices",
      devices,
      "--transfers",
      path.join(path.dirname(devices), "terminal-transfers.db"),
      "--revocations",
      process.env.TEPSY_SESSION_REVOCATION_PATH ||
        process.env.RESTOPOS_SESSION_REVOCATION_PATH ||
        runtime.resolveStateFile("revoked-sessions.db"),
    ]);
    const sha256 = await digest(archive);
    current = {
      ...current,
      startedAt,
      lastAttemptAt: startedAt,
      lastSuccessAt: new Date().toISOString(),
      filename,
      sha256,
      error: null,
      copyError: null,
      copiedTo: null,
    };
    const plan = (await backupStatus()).plan;
    if (plan.copyDirectory) {
      try {
        await fs.mkdir(plan.copyDirectory, { recursive: true });
        const destination = path.join(plan.copyDirectory, filename);
        await fs.copyFile(archive, destination, require("node:fs").constants.COPYFILE_EXCL);
        const copyHash = await digest(destination);
        if (copyHash !== sha256) throw new Error("İkinci kopya doğrulanamadı.");
        current.copiedTo = destination;
      } catch (error) {
        current.copyError = error.message;
      }
    }
    await write(state(), current);
    const old = (await fs.readdir(directory))
      .filter((name) => /^tepsy-recovery-[\dTZ-]+-[a-f0-9]{8}\.zip$/.test(name))
      .sort()
      .reverse();
    for (const name of old.slice(30)) await fs.unlink(path.join(directory, name));
    return { archive, filename, ...current };
  } catch (error) {
    await write(state(), { ...current, lastAttemptAt: startedAt, error: error.message });
    throw error;
  } finally {
    globalThis.__tepsyRecoveryRunning = false;
  }
}
async function verifyRecoveryArchive(file) {
  return python(["verify", "--archive", file]);
}
function startRecoveryScheduler() {
  let checking = false;
  const tick = async () => {
    if (checking || globalThis.__tepsyRecoveryRunning) return;
    checking = true;
    try {
      const { plan, status } = await backupStatus();
      const due =
        !status?.lastSuccessAt ||
        Date.now() - Date.parse(status.lastSuccessAt) >= plan.intervalHours * 3600000;
      const cooled =
        !status?.lastAttemptAt || Date.now() - Date.parse(status.lastAttemptAt) >= 15 * 60000;
      if (plan.enabled && due && cooled) await createRecoveryBackup();
    } catch (error) {
      console.error("Automatic backup failed:", error.message);
    } finally {
      checking = false;
    }
  };
  void tick();
  const timer = setInterval(tick, 60000);
  timer.unref();
  return () => clearInterval(timer);
}
module.exports = {
  backupStatus,
  saveBackupPlan,
  createRecoveryBackup,
  verifyRecoveryArchive,
  startRecoveryScheduler,
};
