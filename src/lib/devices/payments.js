import net from "net";
import { createTokenXClient } from "./tokenx.mjs";

function probeTcp(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (reachable) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(3000);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

class ManualPaymentAdapter {
  async getStatus(config) {
    return {
      adapter: "MANUAL",
      enabled: config?.enabled === true,
      implemented: true,
      connected: false,
      canInitiatePayment: false,
      message: "Ödeme terminalden bağımsız, görevli tarafından manuel olarak doğrulanmalıdır.",
    };
  }

  async requestPayment() {
    const error = new Error("Manuel ödeme adaptörü terminal onayı üretemez.");
    error.code = "MANUAL_CONFIRMATION_REQUIRED";
    throw error;
  }
}

class NexoLocalPaymentAdapter {
  async getStatus(config) {
    const connected =
      config?.enabled === true && config?.host && config?.port
        ? await probeTcp(config.host, config.port)
        : false;
    return {
      adapter: "NEXO_LOCAL",
      enabled: config?.enabled === true,
      implemented: false,
      connected,
      canInitiatePayment: false,
      host: config?.host || null,
      port: config?.port || null,
      message: connected
        ? "Terminal yerel ağda erişilebilir; ödeme başlatma için bankanın onaylı Nexo/üretici modülü gerekir."
        : "Terminalin yerel ağ portuna erişilemedi. IP, port ve cihaz ayarlarını kontrol edin.",
    };
  }

  async requestPayment() {
    const error = new Error("NEXO yerel terminal işlemleri henüz uygulanmadı; ödeme onaylanmadı.");
    error.code = "ADAPTER_NOT_IMPLEMENTED";
    throw error;
  }
}

export function createPaymentAdapter(config) {
  if (config?.adapter === "NEXO_LOCAL") return new NexoLocalPaymentAdapter();
  return new ManualPaymentAdapter();
}

export async function getPaymentTerminalStatus(config) {
  if (config?.adapter === "TOKENX_CLOUD") {
    const fiscal = await createTokenXClient().getFiscal(config.terminalId);
    if (fiscal?.terminal !== config.terminalId || !Array.isArray(fiscal.sections))
      throw new Error("TokenX mali kısım bilgileri cihazla eşleşmiyor.");
    return {
      adapter: "TOKENX_CLOUD",
      enabled: config.enabled === true,
      implemented: true,
      connected: false,
      canInitiatePayment: false,
      canTransferBasket: config.enabled === true,
      sections: fiscal.sections.map(({ sectionNo, name, taxPercent }) => ({
        sectionNo,
        name,
        taxPercent,
      })),
      message:
        "TokenX mali kısım bilgileri okundu. Adisyon aktarımı destekleniyor; banka tahsilatı cihazda tamamlanıp personelce doğrulanmalıdır.",
    };
  }
  return createPaymentAdapter(config).getStatus(config);
}

export async function requestTerminalPayment(config, payment) {
  return createPaymentAdapter(config).requestPayment(payment);
}
