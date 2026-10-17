const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runWithCleanup(operation, cleanup) {
  let value;
  let operationError;
  let failed = false;
  try {
    value = await operation();
  } catch (error) {
    failed = true;
    operationError = error;
  }
  try {
    cleanup();
  } catch (cleanupError) {
    if (!failed) throw cleanupError;
    if (operationError && typeof operationError === "object" && Object.isExtensible(operationError))
      operationError.cleanupError = cleanupError;
  }
  if (failed) throw operationError;
  return value;
}
async function stageFreshDatabase(target, populate) {
  if (fs.existsSync(target)) throw new Error("Cannot initialize an existing restaurant database.");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const stage = path.join(path.dirname(target), ".tepsy-init-" + randomUUID() + ".db");
  return runWithCleanup(
    async () => {
      await populate(stage);
      // A hard link publishes the complete file atomically and refuses an existing target.
      fs.linkSync(stage, target);
    },
    () => {
      for (const suffix of ["", "-wal", "-shm", "-journal"])
        fs.rmSync(stage + suffix, { force: true });
    }
  );
}
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}
function reclaimLock(lock) {
  let files;
  try {
    files = fs.readdirSync(lock);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const name of files) {
    if (!/^(owner|child)-[a-zA-Z0-9-]+\.json$/.test(name)) return;
    const file = path.join(lock, name);
    try {
      const { pid } = JSON.parse(fs.readFileSync(file, "utf8"));
      // Remove only the dead owner's uniquely named lease, never a replacement owner.
      if (!isAlive(pid)) fs.rmSync(file, { force: true });
    } catch (error) {
      if (error.code !== "ENOENT") return;
    }
  }
  try {
    // An empty directory can be left by an interrupted creator; give it time to publish its lease.
    if (!files.length && Date.now() - fs.statSync(lock).mtimeMs < 5000) return;
    fs.rmdirSync(lock);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
  }
}
async function withInstallationLock(app, operation, { timeoutMs = 600000 } = {}) {
  const state = path.join(app, ".tepsy");
  const lock = path.join(state, "installation.lock");
  fs.mkdirSync(state, { recursive: true });
  const token = randomUUID();
  const owner = path.join(lock, "owner-" + token + ".json");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    reclaimLock(lock);
    if (Date.now() >= deadline)
      throw new Error("Another TEPSY installation operation is busy. Retry after it finishes.");
    await pause(50);
  }
  fs.writeFileSync(owner, JSON.stringify({ pid: process.pid }), { flag: "wx" });
  const childCleanupErrors = [];
  const trackChild = (pid) => {
    if (!Number.isInteger(pid)) return () => {};
    const lease = path.join(lock, "child-" + token + "-" + pid + ".json");
    fs.writeFileSync(lease, JSON.stringify({ pid }), { flag: "wx" });
    return () => {
      try {
        fs.rmSync(lease, { force: true });
      } catch (error) {
        childCleanupErrors.push(error);
      }
    };
  };
  return runWithCleanup(
    () => operation(trackChild),
    () => {
      fs.rmSync(owner, { force: true });
      try {
        fs.rmdirSync(lock);
      } catch (error) {
        if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
        reclaimLock(lock);
      }
      if (childCleanupErrors.length) throw childCleanupErrors[0];
    }
  );
}
function serverUrl({ host, port }) {
  const address = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
  return "http://" + (address.includes(":") ? "[" + address + "]" : address) + ":" + port;
}
function runtimeMatches(app, pid, runtime) {
  try {
    const record = JSON.parse(
      fs.readFileSync(path.join(app, ".tepsy", "production-runtime.json"), "utf8")
    );
    return (
      Number.isInteger(pid) &&
      pid > 0 &&
      record?.pid === pid &&
      record.host === runtime.host &&
      record.port === runtime.port
    );
  } catch {
    return false;
  }
}
function clearRuntimeRecord(app, pid) {
  const record = path.join(app, ".tepsy", "production-runtime.json");
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(record, "utf8"));
  } catch {
    return;
  }
  if (saved?.pid === pid) fs.rmSync(record, { force: true });
}
module.exports = {
  stageFreshDatabase,
  withInstallationLock,
  serverUrl,
  runtimeMatches,
  clearRuntimeRecord,
};
