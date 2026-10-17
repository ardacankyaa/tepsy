import fs from "fs/promises";
import path from "path";
import { preserveNetworkSettings, removeSecretFields, validateDeviceConfig } from "./validation.js";
import runtimeConfig from "../../../scripts/runtime-config.cjs";

function resolveConfigPath() {
  if (process.env.TEPSY_DEVICES_CONFIG_PATH)
    return path.resolve(process.env.TEPSY_DEVICES_CONFIG_PATH);
  if (process.env.RESTOPOS_DEVICES_CONFIG_PATH)
    return path.resolve(process.env.RESTOPOS_DEVICES_CONFIG_PATH);
  return runtimeConfig.resolveStateFile("devices.json");
}

export const DEFAULT_DEVICE_CONFIG = Object.freeze({
  version: 1,
  network: {
    qrBaseUrl: "",
  },
  receiptPrinter: {
    enabled: false,
    adapter: "BROWSER",
    charsPerLine: 42,
    cutPaper: true,
    openCashDrawer: false,
  },
  paymentTerminal: {
    enabled: false,
    adapter: "MANUAL",
  },
});

export function getDeviceConfigPath() {
  return resolveConfigPath();
}

export async function readDeviceConfig() {
  const configPath = resolveConfigPath();
  try {
    const raw = await fs.readFile(configPath, "utf8");
    return removeSecretFields(validateDeviceConfig(JSON.parse(raw)));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return structuredClone(DEFAULT_DEVICE_CONFIG);
    }
    throw error;
  }
}

export async function writeDeviceConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) validateDeviceConfig(input);
  const existing = await readDeviceConfig();
  const config = validateDeviceConfig(preserveNetworkSettings(input, existing));
  const configPath = resolveConfigPath();
  const configDir = path.dirname(configPath);
  await fs.mkdir(configDir, { recursive: true });

  const temporaryPath = path.join(configDir, `devices-${process.pid}-${Date.now()}.tmp`);
  await fs.writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await fs.rename(temporaryPath, configPath);
  return removeSecretFields(config);
}
