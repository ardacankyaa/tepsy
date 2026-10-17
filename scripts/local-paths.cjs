const path = require("node:path"),
  os = require("node:os");
function managedPaths(env = process.env, platform = process.platform, home = os.homedir()) {
  const dataHome =
    env.TEPSY_LOCAL_DATA_HOME ||
    env.RESTOPOS_LOCAL_DATA_HOME ||
    (platform === "win32"
      ? path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "TEPSY")
      : platform === "darwin"
        ? path.join(home, "Library", "Application Support", "TEPSY")
        : path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "tepsy"));
  return {
    dataHome: path.resolve(dataHome),
    app: path.resolve(dataHome, "app"),
    demo: path.resolve(dataHome, "demo"),
  };
}
function managedEnvironment(input, app, mode, port) {
  const env = { ...input, PYTHONUTF8: "1", NEXT_TELEMETRY_DISABLED: "1", npm_config_fund: "false" };
  if (mode === "demo") {
    for (const key of Object.keys(env)) if (/^(TEPSY_|RESTOPOS_)/.test(key)) delete env[key];
    env.TEPSY_DEMO_MODE = "1";
    env.TEPSY_BIND_HOST = "127.0.0.1";
    env.TEPSY_DATABASE_URL =
      "file:" + path.join(app, ".tepsy", "qa", "demo.db").replaceAll("\\", "/");
    env.TEPSY_DEVICES_CONFIG_PATH = path.join(app, ".tepsy", "devices.json");
    env.TEPSY_MENU_IMAGE_DIR = path.join(app, ".tepsy", "menu-images");
    env.TEPSY_BACKUP_DIR = path.join(app, ".tepsy", "backups");
  } else {
    env.TEPSY_DEMO_MODE = "0";
  }
  env.PORT = String(port ?? (mode === "demo" ? 3001 : input.PORT || 3000));
  const numeric = Number(env.PORT);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535)
    throw new Error("Port must be between 1 and 65535.");
  return env;
}
module.exports = { managedPaths, managedEnvironment };
