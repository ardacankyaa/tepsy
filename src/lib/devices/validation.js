const SECRET_KEY_PATTERN =
  /(password|passwd|passphrase|secret|token|credential|api[_-]?key|private[_-]?key|pin)/i;

export const PRINTER_ADAPTERS = ["BROWSER", "TCP_ESC_POS", "WINDOWS_SPOOLER"];
export const PAYMENT_ADAPTERS = ["MANUAL", "NEXO_LOCAL", "TOKENX_CLOUD"];

export function containsSecretField(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, child]) => SECRET_KEY_PATTERN.test(key) || containsSecretField(child)
  );
}

export function removeSecretFields(value) {
  if (Array.isArray(value)) return value.map(removeSecretFields);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SECRET_KEY_PATTERN.test(key))
      .map(([key, child]) => [key, removeSecretFields(child)])
  );
}

function cleanBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function cleanPort(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("Port 1 ile 65535 arasında bir tam sayı olmalıdır.");
  }
  return parsed;
}

function cleanHost(value, { required = false } = {}) {
  const host = String(value || "").trim();
  if (!host && !required) return "";
  if (!host) throw new Error("Cihaz adresi zorunludur.");
  if (
    host.length > 253 ||
    !/^[a-zA-Z0-9.-]+$/.test(host) ||
    host.startsWith(".") ||
    host.endsWith(".")
  ) {
    throw new Error(
      "Cihaz adresi yalnızca geçerli bir IPv4 adresi veya yerel ağ ana makine adı olabilir."
    );
  }
  return host;
}

function cleanPrinterName(value, { required = false } = {}) {
  const name = String(value || "").trim();
  if (!name && !required) return "";
  if (!name) throw new Error("Windows yazıcı adı zorunludur.");
  if (name.length > 180 || /[\0\r\n"<>|]/.test(name)) {
    throw new Error("Windows yazıcı adı geçersiz karakter içeriyor.");
  }
  return name;
}

function cleanQrBaseUrl(value) {
  const input = String(value ?? "").trim();
  if (!input) return "";
  if (input.length > 255) throw new Error("QR adresi geçersiz veya çok uzun.");

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("QR adresi geçerli bir HTTP(S) adresi olmalıdır.");
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("QR adresi HTTP veya HTTPS kullanmalıdır.");
  if (!url.hostname || url.username || url.password)
    throw new Error("QR adresinde kullanıcı bilgisi kullanılamaz.");
  if (url.pathname !== "/" || url.search || url.hash)
    throw new Error("QR adresinde yol, sorgu veya parça bulunamaz.");

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const loopbackIPv4 = /^127(?:\.\d{1,3}){3}$/.test(hostname);
  const loopbackIPv4MappedIPv6 = /^\[::ffff:7f[0-9a-f]{2}:/i.test(hostname);
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    hostname === "[::]" ||
    loopbackIPv4 ||
    loopbackIPv4MappedIPv6
  ) {
    throw new Error("QR adresi sunucuya ait bir localhost adresi olamaz.");
  }
  return url.origin;
}

export function preserveNetworkSettings(input, existingConfig) {
  return input.network === undefined ? { ...input, network: existingConfig?.network } : input;
}

export function validateDeviceConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Cihaz yapılandırması bir nesne olmalıdır.");
  }
  if (containsSecretField(input)) {
    throw new Error("Parola, PIN, token ve API anahtarı cihaz yapılandırmasında saklanamaz.");
  }

  if (
    input.network !== undefined &&
    (!input.network || typeof input.network !== "object" || Array.isArray(input.network))
  ) {
    throw new Error("Ağ yapılandırması bir nesne olmalıdır.");
  }
  const network = { qrBaseUrl: cleanQrBaseUrl(input.network?.qrBaseUrl) };

  const printerInput = input.receiptPrinter || {};
  const printerAdapter = String(printerInput.adapter || "BROWSER").toUpperCase();
  if (!PRINTER_ADAPTERS.includes(printerAdapter)) {
    throw new Error("Desteklenmeyen yazıcı adaptörü.");
  }

  const receiptPrinter = {
    enabled: cleanBoolean(printerInput.enabled, printerAdapter !== "BROWSER"),
    adapter: printerAdapter,
    charsPerLine: Number(printerInput.charsPerLine ?? 42),
    cutPaper: cleanBoolean(printerInput.cutPaper, true),
    openCashDrawer: cleanBoolean(printerInput.openCashDrawer, false),
  };
  if (
    !Number.isInteger(receiptPrinter.charsPerLine) ||
    receiptPrinter.charsPerLine < 24 ||
    receiptPrinter.charsPerLine > 64
  ) {
    throw new Error("Satır genişliği 24 ile 64 karakter arasında olmalıdır.");
  }

  if (printerAdapter === "TCP_ESC_POS") {
    receiptPrinter.host = cleanHost(printerInput.host, { required: true });
    receiptPrinter.port = cleanPort(printerInput.port, 9100);
  } else if (printerAdapter === "WINDOWS_SPOOLER") {
    receiptPrinter.printerName = cleanPrinterName(printerInput.printerName, { required: true });
  }

  const paymentInput = input.paymentTerminal || {};
  const paymentAdapter = String(paymentInput.adapter || "MANUAL").toUpperCase();
  if (!PAYMENT_ADAPTERS.includes(paymentAdapter)) {
    throw new Error("Desteklenmeyen ödeme terminali adaptörü.");
  }

  const paymentTerminal = {
    enabled: cleanBoolean(paymentInput.enabled, false),
    adapter: paymentAdapter,
  };
  if (paymentAdapter === "NEXO_LOCAL") {
    paymentTerminal.host = cleanHost(paymentInput.host, { required: true });
    paymentTerminal.port = cleanPort(paymentInput.port, 20007);
  } else if (paymentAdapter === "TOKENX_CLOUD") {
    const terminalId = String(paymentInput.terminalId || "").trim();
    if (!/^(AV|AT)[A-Za-z0-9]{6,30}$/.test(terminalId))
      throw new Error("TokenX cihaz mali numarası AV veya AT ile başlamalıdır.");
    const mappings = paymentInput.categorySections || [];
    if (!Array.isArray(mappings) || mappings.length > 250)
      throw new Error("Cihaz kısım eşlemeleri geçersiz.");
    paymentTerminal.terminalId = terminalId;
    const categories = new Set();
    paymentTerminal.categorySections = mappings.map((entry) => {
      const category = entry?.category;
      const value = entry?.sectionNo;
      if (
        typeof category !== "string" ||
        !category.trim() ||
        category.length > 100 ||
        categories.has(category) ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 999
      )
        throw new Error("Her kategori geçerli bir cihaz kısım numarasıyla eşleştirilmelidir.");
      categories.add(category);
      return { category, sectionNo: value };
    });
  }

  return { version: 1, network, receiptPrinter, paymentTerminal };
}

export function validateReceipt(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Fiş verisi geçersiz.");
  }
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length > 250) throw new Error("Bir fişte en fazla 250 kalem olabilir.");

  const cleanText = (value, maxLength, fallback = "") => {
    const text = String(value ?? fallback)
      .replace(/[\0\r]/g, " ")
      .trim();
    return text.slice(0, maxLength);
  };
  const cleanAmount = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 ? amount : 0;
  };

  const timestamp = input.timestamp ? new Date(input.timestamp) : new Date();
  if (Number.isNaN(timestamp.valueOf())) throw new Error("Fiş tarihi geçersiz.");

  return {
    kind: ["BILL", "PAYMENT"].includes(input.kind) ? input.kind : "RECEIPT",
    restaurantName: cleanText(input.restaurantName, 80, "TEPSY"),
    tableNumber: cleanText(input.tableNumber, 30, "-"),
    section: cleanText(input.section, 50, ""),
    orderId: cleanText(input.orderId, 80, ""),
    receiptNumber: cleanText(input.receiptNumber, 150, ""),
    snapshotKind: cleanText(input.snapshotKind, 30, ""),
    paymentMethod: cleanText(input.paymentMethod, 30, "MANUAL"),
    currency: ["₺", "€", "$", "£", "TRY", "EUR", "USD", "GBP", "UNKNOWN"].includes(input.currency)
      ? input.currency
      : "₺",
    timestamp,
    totalAmount: cleanAmount(input.totalAmount),
    ...(Array.isArray(input.paymentItems)
      ? {
          paymentItems: input.paymentItems.slice(0, 250).map((i) => ({
            quantity: Math.max(0, Math.min(999, Number(i.quantity) || 0)),
            name: cleanText(i.name, 100, "Ürün"),
          })),
        }
      : {}),
    ...(input.tipAmount != null
      ? {
          tipAmount: cleanAmount(input.tipAmount),
          collectedTotal: cleanAmount(input.collectedTotal),
        }
      : {}),
    ...(input.grossTotal != null
      ? {
          grossTotal: cleanAmount(input.grossTotal),
          discountAmount: cleanAmount(input.discountAmount),
          netTotal: cleanAmount(input.netTotal),
          amountPaid: cleanAmount(input.amountPaid),
          ...(input.totalPaid != null ? { totalPaid: cleanAmount(input.totalPaid) } : {}),
          remainingBalance: cleanAmount(input.remainingBalance),
        }
      : {}),
    items: items.map((item) => ({
      name: cleanText(item?.menuItemName ?? item?.menuItem?.name ?? item?.name, 100, "Ürün"),
      quantity: Math.max(0, Math.min(999, Number(item?.quantity) || 0)),
      unitPrice: cleanAmount(item?.unitPrice),
    })),
  };
}
