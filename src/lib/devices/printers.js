import net from "net";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { buildReceiptEscPos } from "./receipt.js";

class BrowserPrinterAdapter {
  async print() {
    const error = new Error("Sunucu yazıcısı ayarlanmamış. Tarayıcı yazdırmasını açıkça seçin.");
    error.code = "BROWSER_FALLBACK_REQUIRED";
    throw error;
  }
}

class TcpEscPosPrinterAdapter {
  constructor(config) {
    this.config = config;
  }

  async print(payload) {
    const { host, port } = this.config;
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = net.createConnection({ host, port });
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        error ? reject(error) : resolve(result);
      };

      socket.setTimeout(5000);
      socket.once("connect", () => {
        socket.end(payload, () =>
          finish(null, {
            accepted: true,
            adapter: "TCP_ESC_POS",
            message:
              "Fiş verisi yazıcının ağ bağlantısına gönderildi. Fiziksel çıktı cihaz tarafından doğrulanamaz.",
          })
        );
      });
      socket.once("timeout", () => {
        const error = new Error("Yazıcı bağlantısı zaman aşımına uğradı.");
        error.code = "PRINTER_TIMEOUT";
        finish(error);
      });
      socket.once("error", (error) => {
        error.code = error.code || "PRINTER_OFFLINE";
        finish(error);
      });
    });
  }
}

function spawnPrintProcess(printerName, filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.resolve("scripts/windows-raw-print.ps1"),
      ],
      {
        env: { ...process.env, TEPSY_PRINT_QUEUE: printerName, TEPSY_PRINT_FILE: filePath },
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let stderr = "";
    let stdout = "";
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      const error = new Error(
        "Windows yazdırma kuyruğu zaman aşımına uğradı. Yeniden göndermeden önce yazıcı kuyruğunu kontrol edin; iş kabul edilmiş olabilir."
      );
      error.code = "PRINTER_TIMEOUT";
      finish(error);
    }, 15000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      error.code = error.code || "SPOOLER_UNAVAILABLE";
      finish(error);
    });
    child.once("close", (code) => {
      if (code !== 0) {
        let failure;
        try {
          failure = JSON.parse(stderr.trim());
        } catch {
          /* Startup/compile failures may be plain text. */
        }
        const error = new Error(
          failure?.error ||
            stderr.trim() ||
            stdout.trim() ||
            `Windows yazdırma işlemi ${code} koduyla kapandı.`
        );
        if (Number.isInteger(failure?.win32Code)) error.win32Code = failure.win32Code;
        error.code = "SPOOLER_REJECTED";
        finish(error);
        return;
      }
      let receipt;
      try {
        receipt = JSON.parse(stdout.trim());
      } catch {
        /* Missing spooler acknowledgement is a failure. */
      }
      if (receipt?.accepted !== true || !Number.isInteger(receipt.jobId) || receipt.jobId < 1) {
        const error = new Error("Windows yazdırma kuyruğu işi doğrulamadı.");
        error.code = "SPOOLER_REJECTED";
        finish(error);
        return;
      }
      finish(null, {
        accepted: true,
        jobId: receipt.jobId,
        adapter: "WINDOWS_SPOOLER",
        message:
          "Fiş Windows yazdırma kuyruğuna kabul edildi. Fiziksel çıktı cihaz tarafından doğrulanamaz.",
      });
    });
  });
}

class WindowsSpoolerPrinterAdapter {
  constructor(config) {
    this.config = config;
  }

  async print(payload) {
    if (process.platform !== "win32") {
      const error = new Error("Windows spooler adaptörü yalnızca Windows üzerinde kullanılabilir.");
      error.code = "UNSUPPORTED_PLATFORM";
      throw error;
    }

    const filePath = path.join(os.tmpdir(), `tepsy-${process.pid}-${randomUUID()}.bin`);
    await fs.writeFile(filePath, payload, { flag: "wx", mode: 0o600 });
    try {
      return await spawnPrintProcess(this.config.printerName, filePath);
    } finally {
      await fs.unlink(filePath).catch(() => {});
    }
  }
}

export function createPrinterAdapter(config) {
  if (!config?.enabled) {
    const error = new Error("Sunucu yazıcısı devre dışı.");
    error.code = "PRINTER_DISABLED";
    throw error;
  }
  if (config.adapter === "TCP_ESC_POS") return new TcpEscPosPrinterAdapter(config);
  if (config.adapter === "WINDOWS_SPOOLER") return new WindowsSpoolerPrinterAdapter(config);
  return new BrowserPrinterAdapter();
}

export async function printReceipt(receipt, printerConfig) {
  const adapter = createPrinterAdapter(printerConfig);
  const payload = buildReceiptEscPos(receipt, printerConfig);
  return adapter.print(payload);
}
