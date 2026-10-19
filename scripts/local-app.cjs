const fs = require("node:fs"),
  path = require("node:path"),
  net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const {
  managedPathsForSource,
  managedEnvironment,
  isManagedInstallation,
} = require("./local-paths.cjs");
const { releaseFiles, sourceHash } = require("./release-files.cjs");
const { resolveRuntimeConfig } = require("./runtime-config.cjs");
const {
  stageFreshDatabase,
  withInstallationLock,
  serverUrl,
  runtimeMatches,
  clearRuntimeRecord,
} = require("./installation-lifecycle.cjs");
let trackInstallerChild = () => () => {};
const source = path.resolve(__dirname, "..");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(executable, args, { cwd, env, capture = false }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: capture ? ["pipe", "pipe", "pipe"] : "inherit",
    });
    const untrack = trackInstallerChild(child.pid);
    child.once("close", untrack);
    let stdout = "",
      stderr = "";
    if (capture) {
      child.stdout.on("data", (data) => (stdout += data.toString()));
      child.stderr.on("data", (data) => (stderr += data.toString()));
    }
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(stderr || executable + " exited with code " + code))
    );
  });
}
function pythonCommand() {
  const candidates =
    process.platform === "win32" ? ["py", "python3", "python"] : ["python3", "python"];
  for (const executable of candidates) {
    const check = spawnSync(executable, ["-c", "import sys; assert sys.version_info >= (3,8)"], {
      windowsHide: true,
      stdio: "ignore",
    });
    if (check.status === 0) return executable;
  }
  throw new Error(
    "Python 3 is required. Install it, then retry; Windows supports the py launcher."
  );
}
function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  const cli = candidates.find((file) => fs.existsSync(file));
  if (!cli)
    throw new Error("npm is required. Run this command through npm run setup/start:local/demo.");
  return cli;
}
function syncSource(app) {
  const relative = path.relative(source, app);
  if (!relative && isManagedInstallation(app)) return;
  if (
    !relative ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative) &&
      !relative.startsWith(".tepsy" + path.sep + "qa" + path.sep) &&
      !/^\.tepsy\/restaurants\/[a-f0-9]{32}\/app$/.test(relative.replaceAll(path.sep, "/")))
  )
    throw new Error("The local application must be outside the source folder.");
  fs.mkdirSync(app, { recursive: true });
  const files = releaseFiles(source);
  const current = new Set(files);
  for (const old of readMarker(app).files || []) {
    if (typeof old !== "string" || current.has(old)) continue;
    const target = path.resolve(app, old);
    const relativeTarget = path.relative(app, target);
    const inSourceDirectory = /^(src|public|prisma|scripts|tests|docs|\.github)\//.test(old);
    const safeExtension =
      /\.(js|jsx|cjs|mjs|css|sql|prisma|toml|ps1|bat|json|md|svg|png|jpg|jpeg|webp|ico|yml|yaml|py)$/.test(
        old
      );
    if (
      !inSourceDirectory ||
      !safeExtension ||
      relativeTarget.startsWith("..") ||
      path.isAbsolute(relativeTarget) ||
      old
        .split("/")
        .some(
          (part) =>
            part.startsWith(".env") ||
            [".tepsy", ".restopos", "node_modules", ".next", ".git"].includes(part)
        )
    )
      continue;
    fs.rmSync(target, { force: true });
  }
  for (const file of files) {
    const input = path.join(source, file),
      target = path.join(app, file),
      bytes = fs.readFileSync(input);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target) || !fs.readFileSync(target).equals(bytes))
      fs.writeFileSync(target, bytes);
  }
}
function readMarker(app) {
  try {
    return JSON.parse(fs.readFileSync(path.join(app, ".managed-install.json"), "utf8"));
  } catch {
    return {};
  }
}
function commandLine(pid) {
  if (process.platform === "win32") {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "(Get-CimInstance Win32_Process -Filter ('ProcessId=' + $env:TEPSY_CHECK_PID)).CommandLine",
      ],
      { env: { ...process.env, TEPSY_CHECK_PID: String(pid) }, encoding: "utf8", windowsHide: true }
    );
    return result.status === 0 ? result.stdout.trim() : "";
  }
  if (process.platform === "linux") {
    try {
      return fs.readFileSync("/proc/" + pid + "/cmdline", "utf8").replaceAll("\0", " ");
    } catch {
      return "";
    }
  }
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  return result.stdout?.trim() || "";
}
function ownedPid(app) {
  const marker = path.join(app, ".tepsy", "production.pid");
  if (!fs.existsSync(marker)) return null;
  const pid = Number(fs.readFileSync(marker, "utf8").trim());
  if (!Number.isInteger(pid) || pid < 1) return null;
  try {
    process.kill(pid, 0);
  } catch {
    return null;
  }
  const actual = commandLine(pid),
    expected = path.join(app, "server.js");
  if (!actual.toLowerCase().includes(expected.toLowerCase()))
    throw new Error(
      "The saved process cannot be verified as this TEPSY installation. Refusing to stop another process."
    );
  return pid;
}
async function stop(app) {
  const pid = ownedPid(app);
  if (!pid) {
    console.log("TEPSY is already stopped.");
    return;
  }
  process.kill(pid, "SIGTERM");
  for (let attempt = 0; attempt < 50; attempt++) {
    await pause(100);
    try {
      process.kill(pid, 0);
    } catch {
      fs.rmSync(path.join(app, ".tepsy", "production.pid"), { force: true });
      clearRuntimeRecord(app, pid);
      console.log("TEPSY stopped.");
      return;
    }
  }
  throw new Error("The owned server did not stop. Check its process before updating.");
}
async function setup(app, mode, env) {
  const hash = sourceHash(source),
    marker = readMarker(app);
  const dependencies =
    !fs.existsSync(path.join(app, "node_modules", "prisma", "build", "index.js")) ||
    marker.lockHash !==
      require("node:crypto")
        .createHash("sha256")
        .update(fs.readFileSync(path.join(source, "package-lock.json")))
        .digest("hex");
  const build = !fs.existsSync(path.join(app, ".next", "BUILD_ID")) || marker.sourceHash !== hash;
  if (ownedPid(app)) {
    if (dependencies || build) {
      console.log("Updated project files detected. Updating and restarting TEPSY...");
      await stop(app);
    } else {
      syncSource(app);
      return;
    }
  }
  syncSource(app);
  const python = pythonCommand(),
    options = { cwd: app, env };
  if (dependencies) await run(process.execPath, [npmCli(), "ci"], options);
  const prisma = path.join(app, "node_modules", "prisma", "build", "index.js");
  await run(process.execPath, [prisma, "generate", "--no-hints"], options);
  const runtime = resolveRuntimeConfig(env, app);
  const fresh = !fs.existsSync(runtime.databasePath);
  if (fresh) {
    await stageFreshDatabase(runtime.databasePath, async (stage) => {
      const stageUrl = "file:" + stage.replaceAll("\\", "/");
      await run(python, ["scripts/initialize-sqlite.py", "--database", stage], options);
      const sql = await run(
        process.execPath,
        [
          prisma,
          "migrate",
          "diff",
          "--from-empty",
          "--to-schema-datamodel",
          "prisma/schema.prisma",
          "--script",
        ],
        { ...options, capture: true }
      );
      await new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [prisma, "db", "execute", "--url", stageUrl, "--stdin"],
          {
            ...options,
            windowsHide: true,
            stdio: ["pipe", "inherit", "inherit"],
          }
        );
        const untrack = trackInstallerChild(child.pid);
        child.once("close", untrack);
        child.once("error", reject);
        child.once("close", (code) =>
          code === 0 ? resolve() : reject(new Error("Database schema initialization failed."))
        );
        child.stdin.on("error", reject);
        child.stdin.end(sql);
      });
      if (mode === "demo") {
        const seedEnv = { ...env, TEPSY_SEED_DATABASE_URL: stageUrl };
        delete seedEnv.TEPSY_DATABASE_URL;
        delete seedEnv.RESTOPOS_DATABASE_URL;
        await run(process.execPath, ["prisma/seed.js"], { cwd: app, env: seedEnv });
      }
      // Verify and checkpoint any WAL contents before atomically publishing the SQLite file.
      const verification = [
        "import sqlite3,sys",
        "from contextlib import closing",
        "with closing(sqlite3.connect(sys.argv[1])) as c:",
        "    if c.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or c.execute('PRAGMA foreign_key_check').fetchall():",
        "        raise RuntimeError('Fresh database failed integrity verification.')",
        "    if c.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()[0] != 0:",
        "        raise RuntimeError('Fresh database WAL checkpoint is busy.')",
      ].join("\n");
      await run(python, ["-c", verification, stage], options);
    });
  } else {
    await run(python, ["scripts/migrate-tepsy.py", "--database", runtime.databasePath], options);
  }
  if (build) await run(process.execPath, [npmCli(), "run", "build"], options);
  fs.writeFileSync(
    path.join(app, ".managed-install.json"),
    JSON.stringify(
      {
        sourceHash: hash,
        lockHash: require("node:crypto")
          .createHash("sha256")
          .update(fs.readFileSync(path.join(source, "package-lock.json")))
          .digest("hex"),
        mode,
        files: releaseFiles(source),
      },
      null,
      2
    )
  );
  console.log("Local installation ready: " + app);
}
async function ready(url) {
  try {
    const response = await fetch(url + "/api/auth/status", { signal: AbortSignal.timeout(2000) });
    const body = await response.json();
    return response.ok && body.service === "tepsy";
  } catch {
    return false;
  }
}
async function start(app, env, open) {
  const runtime = resolveRuntimeConfig(env, app),
    port = runtime.port,
    url = serverUrl(runtime);
  const existing = ownedPid(app);
  if (existing && runtimeMatches(app, existing, runtime) && (await ready(url))) {
    console.log("TEPSY already running: " + url);
    if (open) openBrowser(url);
    return;
  }
  if (existing) await stop(app);
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () =>
      reject(new Error("Port " + port + " is in use. Choose --port <number>."))
    );
    probe.listen(port, env.TEPSY_BIND_HOST || env.RESTOPOS_BIND_HOST || "0.0.0.0", () =>
      probe.close(resolve)
    );
  });
  fs.mkdirSync(path.join(app, ".tepsy"), { recursive: true });
  const output = fs.openSync(path.join(app, ".tepsy", "startup.log"), "a"),
    error = fs.openSync(path.join(app, ".tepsy", "startup-error.log"), "a");
  let child;
  try {
    child = spawn(process.execPath, [path.join(app, "server.js"), "--production"], {
      cwd: app,
      env,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", output, error],
    });
  } finally {
    fs.closeSync(output);
    fs.closeSync(error);
  }
  fs.writeFileSync(path.join(app, ".tepsy", "production.pid"), String(child.pid));
  let failure;
  child.once("error", (e) => (failure = e));
  child.unref();
  for (let attempt = 0; attempt < 120; attempt++) {
    if (failure) throw failure;
    if (await ready(url)) {
      fs.writeFileSync(path.join(app, ".tepsy", "production.pid"), String(child.pid));
      fs.writeFileSync(
        path.join(app, ".tepsy", "production-runtime.json"),
        JSON.stringify({ pid: child.pid, host: runtime.host, port: runtime.port })
      );
      console.log("TEPSY ready: " + url);
      if (open) openBrowser(url);
      return;
    }
    if (child.exitCode !== null) break;
    await pause(500);
  }
  try {
    child.kill();
  } catch {
    /* The owned child has already exited. */
  }
  const marker = path.join(app, ".tepsy", "production.pid");
  if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8").trim() === String(child.pid))
    fs.rmSync(marker, { force: true });
  clearRuntimeRecord(app, child.pid);
  throw new Error("TEPSY did not start. See local .tepsy/startup-error.log.");
}
function openBrowser(url) {
  const [executable, args] =
    process.platform === "win32"
      ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(executable, args, { windowsHide: true, detached: true, stdio: "ignore" });
  child.once("error", () => console.log("Open this address manually: " + url));
  child.unref();
}
async function main() {
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node.js 24+ is required.");
  const [command, ...args] = process.argv.slice(2),
    known = ["setup", "start", "stop", "demo", "demo-stop", "paths"];
  if (!known.includes(command))
    throw new Error("Choose setup, start, stop, demo, demo-stop or paths.");
  const paths = managedPathsForSource(source),
    mode = command.startsWith("demo") ? "demo" : "app",
    app = paths[mode];
  if (command === "paths") {
    console.log(JSON.stringify(paths, null, 2));
    return;
  }
  await withInstallationLock(app, async (trackChild) => {
    trackInstallerChild = trackChild;
    if (command === "stop" || command === "demo-stop") {
      await stop(app);
      return;
    }
    if (fs.existsSync(path.join(app, ".env"))) process.loadEnvFile(path.join(app, ".env"));
    const index = args.indexOf("--port");
    if (index >= 0 && args[index + 1] === undefined)
      throw new Error("--port requires a port number.");
    const env = managedEnvironment(
      process.env,
      app,
      mode,
      index >= 0 ? args[index + 1] : undefined
    );
    await setup(app, mode, env);
    if (command !== "setup") {
      await start(app, env, !args.includes("--no-open") && !args.includes("-NoBrowser"));
      if (mode === "demo")
        console.log(
          "Demo login: DEMO01 / TepsyDemo123!  |  Staff: Garson, Mutfak, Kasa / PIN 1234"
        );
    }
  });
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { ownedPid, commandLine, syncSource };
