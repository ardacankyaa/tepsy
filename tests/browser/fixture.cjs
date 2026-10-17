const { chromium } = require("playwright");
const fs = require("fs");
const categories = [
  { id: "c1", name: "Kahveler", icon: "Coffee" },
  { id: "c2", name: "Yemekler", icon: "Utensils" },
];
const items = Array.from({ length: 300 }, (_, i) => ({
  id: "m" + i,
  name: "Ürün " + String(i + 1).padStart(3, "0"),
  price: 50 + i,
  categoryId: i % 2 ? "c2" : "c1",
  category: categories[i % 2],
  description: i === 0 ? "Uzun ürün açıklaması, içerik ve servis bilgisi." : "Özenle hazırlanır.",
  isAvailable: true,
}));
const tables = Array.from({ length: 150 }, (_, i) => ({
  id: "t" + i,
  tableNumber: "Masa " + String(i + 1).padStart(3, "0"),
  section: i < 100 ? "Salon" : "Teras",
  status: i % 3 === 0 ? "OCCUPIED" : i % 3 === 1 ? "AVAILABLE" : "BILL_REQUESTED",
  capacity: 4,
  posX: 5 + (i % 10) * 9,
  posY: 5 + Math.floor((i % 100) / 10) * 9,
  width: 96,
  height: 96,
  shape: "SQUARE",
  orders: [],
}));
const orders = Array.from({ length: 30 }, (_, i) => ({
  id: "o" + i,
  tableId: "t" + i,
  table: tables[i],
  status: ["PENDING", "PREPARING", "READY"][i % 3],
  source: "STAFF",
  createdAt: new Date(Date.now() - i * 60000).toISOString(),
  totalPrice: 100,
  discountAmount: 0,
  discountPercent: 0,
  items: [{ id: "i" + i, quantity: 2, unitPrice: 50, status: "PENDING", menuItem: items[0] }],
  payments: [],
}));
tables[0].orders = [{ ...orders[0], table: undefined, status: "DELIVERED" }];
const report = {
  summary: {
    totalRevenue: 12000,
    cashRevenue: 7000,
    cardRevenue: 5000,
    totalOrdersCount: 60,
    averageOrderValue: 200,
  },
  topProducts: items.map((x) => ({
    name: x.name,
    categoryName: x.category.name,
    quantity: 3,
    totalRevenue: x.price * 3,
  })),
  categoryBreakdown: [
    { categoryName: "Kahveler", totalRevenue: 7000 },
    { categoryName: "Yemekler", totalRevenue: 5000 },
  ],
};
const path = require("node:path");
const qaRoot = path.resolve(__dirname, "../../.tepsy/qa");
const output =
  process.env.TEPSY_UI_OUTPUT || process.env.RESTOPOS_UI_OUTPUT
    ? path.resolve(process.env.TEPSY_UI_OUTPUT || process.env.RESTOPOS_UI_OUTPUT)
    : qaRoot;
if (output !== qaRoot && !output.startsWith(qaRoot + path.sep))
  throw new Error("UI evidence must stay within .tepsy/qa");
const base = process.env.TEPSY_UI_URL || process.env.RESTOPOS_UI_URL || "http://127.0.0.1:3000";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
  throw new Error("UI tests require a local server URL");
async function createFixture(options = {}) {
  fs.mkdirSync(output, { recursive: true });
  let browser;
  browser = await chromium.launch({
    headless: true,
    channel: process.env.TEPSY_BROWSER || process.env.RESTOPOS_BROWSER || "chrome",
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const uiCookie = process.env.TEPSY_UI_COOKIE || process.env.RESTOPOS_UI_COOKIE;
  if (uiCookie) {
    const cookie = uiCookie;
    const separator = cookie.indexOf("=");
    if (separator < 1) throw new Error("UI session cookie is invalid");
    await context.addCookies([
      {
        name: cookie.slice(0, separator),
        value: cookie.slice(separator + 1),
        url: base,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  }
  const page = await context.newPage();
  const failures = [];
  const shots = [];
  page.on("pageerror", (e) => {
    const failure = `JS [${page.url()}]: ${e.message}`;
    failures.push(failure);
    fs.appendFileSync(
      path.join(output, "page-errors.jsonl"),
      JSON.stringify({ url: page.url(), message: e.message, stack: e.stack }) + "\n"
    );
  });
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url()),
      path = u.pathname;
    let data = [];
    if (route.request().method() !== "GET") {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "Sentetik test: değişiklik kaydedilmedi." }),
      });
      return;
    }
    if (path === "/api/auth/status")
      data = {
        authEnabled: false,
        restaurantName: "Test Restoranı",
        restaurantCode: "TEST",
        session: { role: "ADMIN", name: "Test Yöneticisi" },
      };
    else if (path === "/api/config")
      data = {
        restaurantName: "Test Restoranı",
        currency: "₺",
        defaultLanguage: "tr",
        restaurantCode: "TEST",
        isSetupCompleted: true,
        qrOrderEnabled: true,
      };
    else if (path === "/api/tables") data = tables;
    else if (path === "/api/categories") data = categories;
    else if (path === "/api/menu-items") data = items;
    else if (path === "/api/orders")
      data = u.searchParams.has("tableId") ? tables[0].orders : orders;
    else if (path === "/api/reports/z-report") data = report;
    else if (path === "/api/floor-plan/canvas")
      data = [
        { section: "Salon", width: 2400, height: 1800 },
        { section: "Teras", width: 1600, height: 1200 },
      ];
    else if (path === "/api/pos/payments")
      data = {
        payments: [],
        totals: { cash: "0.00", card: "0.00", other: "0.00", total: "0.00", paymentCount: 0 },
        nextCursor: null,
      };
    else if (path === "/api/pos/shift")
      data = {
        currentShift: {
          id: "shift",
          status: "OPEN",
          openingCash: 1000,
          openedAt: new Date().toISOString(),
        },
      };
    else if (path === "/api/devices")
      data = { printer: { type: "BROWSER" }, paymentTerminal: { type: "MANUAL" }, network: {} };
    else if (path === "/api/network-info") data = { baseUrl: "http://192.168.1.20:3000" };
    else if (path === "/api/public/menu")
      data = {
        restaurant: { name: "Test Restoranı", currency: "₺", defaultLanguage: "tr" },
        table: { label: "Masa 001" },
        categories,
        items,
        orderingEnabled: true,
      };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  return { browser, context, page, failures, shots, report };
}
module.exports = { createFixture, base, output };
