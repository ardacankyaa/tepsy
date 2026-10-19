const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const installations = require("../src/lib/restaurant-installations.cjs");
const { withInstallationLock } = require("./installation-lifecycle.cjs");

function availablePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const port = listener.address().port;
      listener.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}
function writePrivateEnvironment(app, env) {
  // This is a brand-new reserved app directory. Never import a parent .env or rewrite one.
  fs.mkdirSync(app, { mode: 0o700 });
  const settings = Object.entries(env).filter(
    ([key]) => key.startsWith("TEPSY_") || key === "PORT"
  );
  const text =
    settings
      .map(([key, value]) => `${key}=${JSON.stringify(String(value).replaceAll("\\", "/"))}`)
      .join("\n") + "\n";
  fs.writeFileSync(path.join(app, ".env"), text, { flag: "wx", mode: 0o600 });
}
function startInstaller(source, id, env, port, log, trackChild) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(source, "scripts", "local-app.cjs"), "start", "--port", String(port), "--no-open"],
      {
        cwd: source,
        env,
        windowsHide: true,
        stdio: ["ignore", log, log],
      }
    );
    const untrack = trackChild(child.pid);
    child.once("close", untrack);
    const timer = setTimeout(
      () => {
        child.kill();
        reject(new Error("Independent restaurant installer timed out."));
      },
      35 * 60 * 1000
    );
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`Installer exited with code ${code}.`));
    });
    installations.updateInstallation(source, id, { installerPid: child.pid });
  });
}
async function runInstallation(
  source,
  command,
  id,
  { launch = startInstaller, portFor = availablePort } = {}
) {
  if (!["create", "start"].includes(command))
    throw new Error("Choose create or start and a restaurant identifier.");
  const paths = installations.installationPaths(source, id);
  let record = installations.readRecord(source, id);
  if (!record) throw new Error("Restaurant installation not found.");
  if (command === "create" && record.status !== "STARTING") return;
  return withInstallationLock(
    paths.home,
    async (trackChild) => {
      record = installations.readRecord(source, id);
      if (command === "create" && record.status !== "STARTING") return;
      const log = fs.openSync(path.join(paths.home, "installation.log"), "a", 0o600);
      try {
        const port = command === "start" && record.port ? record.port : await portFor();
        const env = installations.isolatedEnvironment(process.env, paths.home, id, port);
        if (command === "create") {
          env.TEPSY_SESSION_SECRET = randomBytes(48).toString("base64url");
          writePrivateEnvironment(paths.app, env);
        } else if (!fs.existsSync(path.join(paths.app, ".env"))) {
          throw new Error(
            "The restaurant environment is missing; refusing to reuse parent configuration."
          );
        }
        installations.updateInstallation(source, id, {
          status: "STARTING",
          startedAt: Date.now(),
          port,
          workerPid: process.pid,
        });
        await launch(source, id, env, port, log, trackChild);
        record = installations.updateInstallation(source, id, { status: "READY", port });
        console.log(`TEPSY restaurant ready: http://127.0.0.1:${record.port}`);
      } catch (error) {
        fs.writeSync(log, `\n${new Date().toISOString()} ${error.stack || error}\n`);
        installations.updateInstallation(source, id, {
          status: "FAILED",
          error: String(error.message),
        });
        throw new Error("Ayrı restoran kurulumu tamamlanamadı. Mevcut restoranınız korunuyor.", {
          cause: error,
        });
      } finally {
        fs.closeSync(log);
      }
    },
    { timeoutMs: 1000 }
  );
}
if (require.main === module)
  runInstallation(path.resolve(__dirname, ".."), ...process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { availablePort, writePrivateEnvironment, runInstallation };
