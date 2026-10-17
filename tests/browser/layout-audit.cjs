const { createFixture, base, output } = require("./fixture.cjs");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const reportOnly = process.argv.includes("--report-only");
let browser, page;
const { measureLayout } = require("./layout-measure.cjs");
(async () => {
  const fixture = await createFixture();
  browser = fixture.browser;
  page = fixture.page;
  page.setDefaultTimeout(10000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  async function waitForWorkspace(route) {
    await page.waitForLoadState("load");
    if (route.startsWith("/menu/")) await page.locator(".service-qr-product").first().waitFor();
    else if (!["/setup", "/login", "/privacy", "/terms", "/cookies"].includes(route.split("#")[0]))
      await page.locator(".nav-links .nav-link").first().waitFor({ state: "attached" });
  }

  const categories = [
    { id: "c1", name: "Geleneksel Türk kahveleri ve sıcak içecekler" },
    { id: "c2", name: "Mevsimlik yemekler ve özel servisler" },
  ];
  const items = Array.from({ length: 300 }, (_, i) => ({
    id: "m" + i,
    name:
      i === 2
        ? "Közlenmiş sebzeler ve fesleğenli sos ile servis edilen özel ev yapımı makarna"
        : "Ürün " + String(i + 1).padStart(3, "0"),
    price: i === 2 ? 125000 : 50 + i,
    categoryId: i % 2 ? "c2" : "c1",
    category: categories[i % 2],
    description: "Özenle hazırlanır.",
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
    table: { tableNumber: tables[i].tableNumber, section: tables[i].section },
    status: ["PENDING", "PREPARING", "READY"][i % 3],
    source: "STAFF",
    createdAt: new Date(Date.now() - i * 60000).toISOString(),
    totalPrice: 2500050,
    discountAmount: 0,
    discountPercent: 0,
    items: [
      {
        id: "i" + i,
        quantity: 20,
        unitPrice: 125000,
        status: "PENDING",
        menuItemName: items[2].name,
        menuItem: items[2],
      },
      { id: "j" + i, quantity: 1, unitPrice: 50, status: "PENDING", menuItem: items[0] },
    ],
    payments: [],
  }));
  tables[0].orders = [{ ...orders[0], table: undefined, status: "DELIVERED" }];
  await page.route("**/api/menu-items*", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ contentType: "application/json", body: JSON.stringify(items) })
      : route.fallback()
  );
  await page.route("**/api/categories*", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ contentType: "application/json", body: JSON.stringify(categories) })
      : route.fallback()
  );
  await page.route(
    (url) => url.pathname === "/api/tables",
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ contentType: "application/json", body: JSON.stringify(tables) })
        : route.fallback()
  );
  await page.route("**/api/orders?*", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(
            new URL(route.request().url()).searchParams.has("tableId") ? tables[0].orders : orders
          ),
        })
      : route.fallback()
  );
  await page.route("**/api/public/menu?*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        restaurant: { name: "Test Restoranı", currency: "₺", defaultLanguage: "tr" },
        table: { label: "Masa 001" },
        items,
        categories,
        orderingEnabled: true,
      }),
    })
  );
  await page.route("**/api/staff", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          contentType: "application/json",
          body: JSON.stringify([
            { id: "s1", name: "Uzun isimli restoran yöneticisi", role: "ADMIN", isActive: true },
            { id: "s2", name: "Uzun isimli servis görevlisi", role: "WAITER", isActive: true },
          ]),
        })
      : route.fallback()
  );
  await page.route("**/api/tables/qr", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ token: "a".repeat(48), path: "/menu/" + "a".repeat(48) }),
    })
  );
  const findings = [],
    scenes = [];
  async function scan(name, width) {
    await page.setViewportSize({ width, height: width === 768 ? 1024 : 900 });
    await page.waitForTimeout(65);
    const issues = await page.evaluate(measureLayout);
    scenes.push({ name, width, issues: issues.length });
    if (
      !issues.length &&
      ((name === "tables" && [1440, 390].includes(width)) ||
        (name === "pos-checkout" && width === 320) ||
        (name === "kitchen-ready" && width === 320))
    )
      await page.screenshot({
        path: path.join(output, `layout-fixed-${name}-${width}.png`),
        caret: "initial",
      });
    if (issues.length) {
      findings.push(...issues.map((issue) => ({ scene: name, width, ...issue })));
      if (width === 390 || width === 1440)
        await page.screenshot({
          path: path.join(output, `layout-${name.replace(/[^a-z0-9-]/gi, "-")}-${width}.png`),
          caret: "initial",
        });
    }
  }
  async function visit(route, name, action = null, widths = [1440, 1024, 768, 390, 320]) {
    await fixture.context.addCookies([
      { name: "tepsy_lang", value: "tr", url: base },
      { name: "tepsy_theme", value: "light", url: base },
    ]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + route, { waitUntil: "domcontentloaded" });
    await page.locator("main h1:visible,main h2:visible").first().waitFor();
    await waitForWorkspace(route);
    if (action) await action();
    for (const width of widths) await scan(name, width);
    fs.writeFileSync(
      path.join(output, "layout-audit-results.json"),
      JSON.stringify({ scenes, findings, pageErrors: fixture.failures }, null, 2)
    );
    console.log(`Layout: ${name}`);
  }
  const routes = [
    ["/", "floor"],
    ["/order", "waiter"],
    ["/order/t0", "order"],
    ["/kitchen", "kitchen"],
    ["/pos", "pos"],
    ["/admin", "admin"],
    ["/admin/menu", "menu"],
    ["/admin/tables", "tables"],
    ["/admin/floorplan", "floor-editor"],
    ["/admin/settings", "settings"],
    ["/admin/reports", "reports"],
    ["/privacy", "privacy"],
    ["/terms", "terms"],
    ["/cookies", "cookies"],
    ["/menu/" + "a".repeat(48), "qr"],
    ["/setup", "setup"],
  ];
  for (const [route, name] of process.argv.includes("--extended-only") ? [] : routes) {
    await visit(route, name);
    await fixture.context.addCookies([
      { name: "tepsy_lang", value: "en", url: base },
      { name: "tepsy_theme", value: "dark", url: base },
    ]);
    await page.evaluate(() => {
      localStorage.setItem("tepsy_lang", "en");
      localStorage.setItem("tepsy_theme", "dark");
    });
    await page.reload();
    await waitForWorkspace(route);
    for (const width of [1440, 390, 320]) await scan(name + "-en-dark", width);
    await page.evaluate(() => {
      localStorage.setItem("tepsy_lang", "tr");
      localStorage.setItem("tepsy_theme", "light");
    });
  }
  for (const [id, name] of [
    ["local-access", "settings-access"],
    ["staff-roles", "settings-team"],
    ["device-settings", "settings-devices"],
  ])
    await visit("/admin/settings#" + id, name);
  await visit("/admin/settings#staff-roles", "settings-add-staff", async () => {
    await page.getByRole("button", { name: "Personel", exact: true }).click();
  });
  await visit("/admin/tables", "tables-list", async () => {
    await page.getByRole("button", { name: "Liste", exact: true }).click();
  });
  await visit("/admin/tables", "tables-add", async () => {
    await page.getByRole("button", { name: /Yeni Masa/ }).click();
  });
  await visit("/admin/tables", "tables-edit", async () => {
    await page.getByRole("button", { name: /Düzenle: Masa 001/ }).click();
  });
  await visit("/admin/tables", "tables-qr", async () => {
    await page.getByRole("button", { name: /QR.*Masa 001/i }).click();
    await page.getByRole("img", { name: "Masa 001 masası QR menü kodu" }).waitFor();
  });
  await visit("/admin/menu", "menu-edit", async () => {
    await page.getByRole("button", { name: /Ürün 001 · Düzenle/ }).click();
  });
  await visit("/admin/menu", "menu-category", async () => {
    await page.getByRole("button", { name: /Yeni Kategori/ }).click();
  });
  await visit(
    "/order/t0",
    "order-cart",
    async () => {
      await page.getByRole("button", { name: /^Ürün 001,/ }).click();
      await page.getByRole("button", { name: /^Közlenmiş sebzeler/ }).click();
    },
    [1440, 1024]
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole("button", { name: /Adisyonu aç/ }).click();
  for (const width of [768, 390, 320]) await scan("order-mobile-cart", width);
  await visit(
    "/menu/" + "a".repeat(48),
    "qr-cart",
    async () => {
      await page.getByRole("button", { name: "Ürün 001 Ekle", exact: true }).click();
      await page.getByRole("button", { name: /^Közlenmiş sebzeler.*Ekle$/ }).click();
      await page.setViewportSize({ width: 390, height: 900 });
      await page.getByRole("button", { name: /Sepet/ }).first().click();
    },
    [390, 320]
  );
  await visit("/menu/" + "a".repeat(48), "qr-details", async () => {
    await page.getByRole("button", { name: "Ürün 001 detayları", exact: true }).click();
  });
  await visit("/pos", "pos-checkout", async () => {
    await page
      .locator(".pos-table-view-toggle")
      .getByRole("button", { name: "Liste", exact: true })
      .click();
    await page.locator(".pos-table-card").first().click();
  });
  await visit("/pos", "pos-menu-picker", async () => {
    await page
      .locator(".pos-table-view-toggle")
      .getByRole("button", { name: "Liste", exact: true })
      .click();
    await page.locator(".pos-table-card").first().click();
    await page.locator(".pos-add-item-button").click();
  });
  await visit("/kitchen", "kitchen-ready", async () => {
    await page.locator("#kds-tab-READY").click();
  });
  await visit("/kitchen", "kitchen-all", async () => {
    await page.locator("#kds-tab-ALL").click();
  });
  await visit("/kitchen", "kitchen-ticket", async () => {
    await page.locator(".kds-ticket-card").first().click();
  });
  await visit("/admin/floorplan", "floor-properties", async () => {
    await page.locator(".table-node").first().press("Enter");
  });
  await visit("/admin/reports", "reports-week", async () => {
    await page.getByRole("button", { name: "Bu Hafta", exact: true }).click();
  });
  await visit("/admin/reports", "reports-month", async () => {
    await page.getByRole("button", { name: "Bu Ay", exact: true }).click();
  });
  await visit(
    "/",
    "navigation-mobile",
    async () => {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.getByRole("button", { name: "Gezinmeyi aç", exact: true }).click();
    },
    [390, 320]
  );
  await visit("/", "preferences", async () => {
    await page
      .getByRole("button", { name: "Görünüm ve tercihler", exact: true })
      .filter({ visible: true })
      .click();
  });
  await visit("/setup", "setup-tables", async () => {
    await page.locator('input[name="restaurantCode"]').fill("QA01");
    await page.locator('input[name="ownerPassword"]').fill("QaSetupPassword123");
    await page.locator('input[name="ownerPasswordConfirm"]').fill("QaSetupPassword123");
    await page.getByRole("button", { name: "İleri", exact: true }).click();
  });
  await visit("/setup", "setup-menu", async () => {
    await page.locator('input[name="restaurantCode"]').fill("QA01");
    await page.locator('input[name="ownerPassword"]').fill("QaSetupPassword123");
    await page.locator('input[name="ownerPasswordConfirm"]').fill("QaSetupPassword123");
    await page.getByRole("button", { name: "İleri", exact: true }).click();
    await page.getByRole("button", { name: "İleri", exact: true }).click();
  });
  await page.route("**/api/auth/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ authEnabled: true, session: null }),
    })
  );
  await visit("/login", "login");
  await page.getByRole("button", { name: "Personel", exact: true }).click();
  for (const width of [1440, 390, 320]) await scan("login-staff", width);
  const result = { scenes, findings, pageErrors: fixture.failures };
  fs.writeFileSync(path.join(output, "layout-audit-results.json"), JSON.stringify(result, null, 2));
  const grouped = Object.values(
    findings.reduce((groups, item) => {
      const key = item.scene + "|" + item.type + "|" + item.label;
      groups[key] ??= { scene: item.scene, type: item.type, label: item.label, widths: [] };
      groups[key].widths.push(item.width);
      return groups;
    }, {})
  );
  console.log(
    JSON.stringify(
      { scenes: scenes.length, findings: grouped, pageErrors: fixture.failures },
      null,
      2
    )
  );
  if (!reportOnly) {
    assert.deepEqual(findings, [], "layout collisions or clipping");
    assert.deepEqual(fixture.failures, []);
  }
})()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
    if (page && !page.isClosed())
      await page
        .screenshot({ path: path.join(output, "layout-audit-failure.png"), caret: "initial" })
        .catch(() => {});
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
