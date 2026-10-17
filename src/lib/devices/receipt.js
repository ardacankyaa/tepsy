const CP857_TURKISH = new Map([
  ["Ç", 0x80],
  ["ü", 0x81],
  ["ç", 0x87],
  ["ı", 0x8d],
  ["İ", 0x98],
  ["Ö", 0x99],
  ["Ü", 0x9a],
  ["Ş", 0x9e],
  ["ş", 0x9f],
  ["ö", 0x94],
  ["Ğ", 0xa6],
  ["ğ", 0xa7],
]);

function encodeCp857(text) {
  const bytes = [];
  for (const character of String(text)) {
    if (CP857_TURKISH.has(character)) {
      bytes.push(CP857_TURKISH.get(character));
      continue;
    }
    const code = character.codePointAt(0);
    bytes.push(code === 10 || code === 13 || (code >= 32 && code <= 126) ? code : 0x3f);
  }
  return Buffer.from(bytes);
}

function crop(text, width) {
  const value = String(text);
  return value.length <= width ? value : `${value.slice(0, Math.max(1, width - 1))}…`;
}

function wrap(text, width) {
  const characters = Array.from(String(text));
  const lines = [];
  while (characters.length) lines.push(characters.splice(0, width).join(""));
  return lines.length ? lines : [""];
}

function center(text, width) {
  const value = crop(text, width);
  return `${" ".repeat(Math.max(0, Math.floor((width - value.length) / 2)))}${value}`;
}

function columns(left, right, width, preserveRight = false) {
  const safeRight = preserveRight
    ? String(right)
    : crop(right, Math.max(8, Math.floor(width * 0.4)));
  if (preserveRight && String(left).length + safeRight.length + 1 > width) {
    const amountLines = safeRight.match(new RegExp(`.{1,${width}}`, "g")) || [""];
    return [left ? crop(left, width) : null, ...amountLines.map((amount) => amount.padStart(width))]
      .filter((value) => value !== null)
      .join("\n");
  }
  const leftWidth = Math.max(1, width - safeRight.length - 1);
  return `${crop(left, leftWidth).padEnd(leftWidth)} ${safeRight}`;
}

function money(value, currency) {
  const code =
    {
      "₺": "TL",
      TRY: "TL",
      "€": "EUR",
      EUR: "EUR",
      $: "USD",
      USD: "USD",
      "£": "GBP",
      GBP: "GBP",
      UNKNOWN: "?",
    }[currency] || "TL";
  return `${Number(value || 0).toFixed(2)} ${code}`;
}

export function buildReceiptEscPos(receipt, options = {}) {
  const width = options.charsPerLine || 42;
  const line = "-".repeat(width);
  const amountLine = (label, amount) =>
    columns(label, money(amount, receipt.currency), width, true);
  const parsedDate = new Date(receipt.timestamp);
  const date = !Number.isNaN(parsedDate.valueOf()) ? parsedDate : new Date();
  const lines = [
    center(receipt.restaurantName || "TEPSY", width),
    center(
      receipt.kind === "BILL"
        ? "HESAP DOKUMU"
        : receipt.kind === "PAYMENT"
          ? "TAHSILAT FISI"
          : "MÜŞTERİ FİŞİ",
      width
    ),
    center(date.toLocaleString("tr-TR"), width),
    line,
    columns(`Masa: ${receipt.tableNumber || "-"}`, receipt.section || "", width),
    receipt.receiptNumber ? columns("Fiş", receipt.receiptNumber, width, true) : "",
    receipt.orderId
      ? columns("Sipariş", `#${String(receipt.orderId).slice(-8).toUpperCase()}`, width)
      : "",
    line,
    ...receipt.items.flatMap((item) => [
      ...wrap(`${item.quantity}x ${item.name}`, width),
      amountLine("", item.unitPrice * item.quantity),
    ]),
    line,
    ...(receipt.grossTotal != null
      ? [
          amountLine("BRUT", receipt.grossTotal),
          amountLine("INDIRIM", receipt.discountAmount),
          amountLine("NET", receipt.netTotal),
          amountLine("ODENEN", receipt.amountPaid),
          ...(receipt.totalPaid != null ? [amountLine("TOPLAM TAHSIL", receipt.totalPaid)] : []),
          amountLine("KALAN", receipt.remainingBalance),
        ]
      : [amountLine("TOPLAM", receipt.totalAmount)]),
    ...(receipt.kind === "BILL"
      ? []
      : [
          columns(
            "Ödeme",
            { CASH: "NAKIT", CREDIT_CARD: "KART", OTHER: "DIGER" }[receipt.paymentMethod] ||
              receipt.paymentMethod ||
              "MANUAL",
            width
          ),
        ]),
    ...(receipt.snapshotKind?.startsWith("LEGACY")
      ? [crop("Eski kayit: para birimi saklanmadi", width)]
      : []),
    line,
    center("Teşekkür ederiz", width),
  ].filter((entry) => entry !== "");

  const commands = [
    Buffer.from([0x1b, 0x40]),
    Buffer.from([0x1b, 0x74, 0x0d]),
    encodeCp857(`${lines.join("\n")}\n\n\n\n`),
  ];

  if (options.openCashDrawer) commands.push(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]));
  if (options.cutPaper) commands.push(Buffer.from([0x1d, 0x56, 0x01]));
  return Buffer.concat(commands);
}

export function buildPrinterTestReceipt() {
  return {
    restaurantName: "TEPSY",
    tableNumber: "TEST",
    section: "Cihaz Ayarları",
    orderId: "TEST",
    paymentMethod: "TEST",
    timestamp: new Date(),
    totalAmount: 1,
    items: [{ name: "Türkçe test: çğıöşü ÇĞİÖŞÜ", quantity: 1, unitPrice: 1 }],
  };
}
