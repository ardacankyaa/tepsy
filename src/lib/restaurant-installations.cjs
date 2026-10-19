const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomBytes, timingSafeEqual } = require("node:crypto");
const { spawn } = require("node:child_process");

const MAX_STARTING_MS = 45 * 60 * 1000;
const ID = /^[a-f0-9]{32}$/;
function installationRoot(source) {
  return path.join(path.resolve(source), ".tepsy", "restaurants");
}
function installationPaths(source, id) {
  if (!ID.test(id)) throw new Error("Invalid restaurant identifier.");
  const home = path.join(installationRoot(source), id);
  return { home, app: path.join(home, "app"), record: path.join(home, "job.json") };
}
function isolatedEnvironment(input, home, id, port) {
  if (!ID.test(id) || !Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid isolated restaurant configuration.");
  const env = {};
  // Allow only operating-system/runtime discovery variables; payment providers and all parent
  // Application settings, database URLs, NODE_OPTIONS and secrets must stay in the parent.
  const allowed =
    /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA|SYSTEMDRIVE|LANG|LC_ALL|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|npm_execpath)$/i;
  for (const [key, value] of Object.entries(input)) if (allowed.test(key)) env[key] = value;
  const app = path.join(path.resolve(home), "app");
  Object.assign(env, {
    TEPSY_LOCAL_DATA_HOME: path.resolve(home),
    TEPSY_INSTANCE_ID: id,
    TEPSY_DEMO_MODE: "0",
    TEPSY_BIND_HOST: "0.0.0.0",
    TEPSY_DATABASE_URL: "file:" + path.join(app, "prisma", "dev.db").replaceAll("\\", "/"),
    TEPSY_DEVICES_CONFIG_PATH: path.join(app, ".tepsy", "devices.json"),
    TEPSY_MENU_IMAGE_DIR: path.join(app, ".tepsy", "menu-images"),
    TEPSY_BACKUP_DIR: path.join(app, ".tepsy", "backups"),
    TEPSY_SESSION_REVOCATION_PATH: path.join(app, ".tepsy", "revoked-sessions.db"),
    PORT: String(port),
    PYTHONUTF8: "1",
    NEXT_TELEMETRY_DISABLED: "1",
  });
  return env;
}
function hasOwnerProof(config, password, session, { ownerVersion, verifyPassword }) {
  if (!config?.isSetupCompleted || !config.authEnabled || !config.accessPasswordHash) return false;
  if (
    session?.userId === "owner" &&
    session.role === "ADMIN" &&
    typeof session.credentialVersion === "string" &&
    typeof ownerVersion === "string"
  ) {
    const actual = Buffer.from(session.credentialVersion),
      expected = Buffer.from(ownerVersion);
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) return true;
  }
  return (
    typeof password === "string" &&
    password.length > 0 &&
    password.length <= 128 &&
    verifyPassword(password, config.accessPasswordHash)
  );
}
function readRecord(source, id) {
  const paths = installationPaths(source, id);
  try {
    return JSON.parse(fs.readFileSync(paths.record, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function updateInstallation(source, id, changes) {
  const paths = installationPaths(source, id),
    current = readRecord(source, id);
  if (!current) throw new Error("Restaurant installation not found.");
  const next = { ...current, ...changes, id, updatedAt: Date.now() };
  const temporary = paths.record + "." + randomBytes(8).toString("hex") + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(next), { flag: "wx", mode: 0o600 });
  fs.renameSync(temporary, paths.record);
  return next;
}
function publicRecord(record) {
  const result = { id: record.id, status: record.status };
  if (
    record.status === "READY" &&
    Number.isInteger(record.port) &&
    record.port >= 1024 &&
    record.port <= 65535
  )
    result.url = `http://127.0.0.1:${record.port}/setup`;
  if (record.status === "FAILED")
    result.error =
      "Ayrı restoran kurulumu tamamlanamadı. Mevcut restoranınız korunuyor; sunucu bilgisayarındaki kurulum günlüğünü kontrol edin.";
  return result;
}
function installationStatus(source, id) {
  if (!ID.test(id || "")) return null;
  let record = readRecord(source, id);
  if (!record) return null;
  if (
    record.status === "STARTING" &&
    Date.now() - (record.startedAt || record.createdAt) > MAX_STARTING_MS
  )
    record = updateInstallation(source, id, { status: "FAILED", error: "Installation timed out." });
  return publicRecord(record);
}
function launchWorker(source, id) {
  const child = spawn(
    process.execPath,
    [path.join(source, "scripts", "new-restaurant.cjs"), "create", id],
    {
      cwd: source,
      env: isolatedEnvironment(process.env, installationPaths(source, id).home, id, 3000),
      windowsHide: true,
      detached: true,
      stdio: "ignore",
    }
  );
  child.once("error", () =>
    updateInstallation(source, id, { status: "FAILED", error: "Worker could not be launched." })
  );
  child.unref();
}
function reserveInstallation(source, key, ownerVersion, { launch = launchWorker } = {}) {
  if (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
    throw new Error("Invalid idempotency key.");
  if (typeof ownerVersion !== "string" || !ownerVersion)
    throw new Error("Owner credential proof is required.");
  const root = installationRoot(source),
    requests = path.join(root, "requests");
  fs.mkdirSync(requests, { recursive: true, mode: 0o700 });
  const keyHash = createHash("sha256").update(key).digest("hex");
  const requestDirectory = path.join(requests, keyHash),
    requestRecord = path.join(requestDirectory, "request.json");
  try {
    fs.mkdirSync(requestDirectory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let request;
    try {
      request = JSON.parse(fs.readFileSync(requestRecord, "utf8"));
    } catch (readError) {
      throw new Error("Restaurant request is being reserved; retry the same key.", {
        cause: readError,
      });
    }
    if (request.ownerVersion !== ownerVersion)
      throw new Error("Owner credential changed; create a new request after authentication.", {
        cause: error,
      });
    const existing = installationStatus(source, request.id);
    if (!existing) throw new Error("Restaurant request could not be recovered.", { cause: error });
    return existing;
  }
  const id = randomBytes(16).toString("hex"),
    paths = installationPaths(source, id);
  fs.mkdirSync(paths.home, { mode: 0o700 });
  fs.writeFileSync(
    paths.record,
    JSON.stringify({ id, status: "STARTING", keyHash, ownerVersion, createdAt: Date.now() }),
    { flag: "wx", mode: 0o600 }
  );
  fs.writeFileSync(requestRecord, JSON.stringify({ id, ownerVersion }), {
    flag: "wx",
    mode: 0o600,
  });
  try {
    launch(path.resolve(source), id);
  } catch (error) {
    updateInstallation(source, id, { status: "FAILED", error: String(error.message) });
  }
  return installationStatus(source, id);
}
module.exports = {
  MAX_STARTING_MS,
  installationPaths,
  isolatedEnvironment,
  hasOwnerProof,
  readRecord,
  updateInstallation,
  installationStatus,
  reserveInstallation,
};
