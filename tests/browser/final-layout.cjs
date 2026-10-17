const { createFixture, base, output } = require("./fixture.cjs");
const { measureLayout } = require("./layout-measure.cjs");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
let browser, page;
(async () => {
  const fixture = await createFixture({ hasTouch: true });
  browser = fixture.browser;
  page = fixture.page;
  page.setDefaultTimeout(12000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const name = "Bahçe Özel Davet ve Aile Bölümü Masa 001 " + "X".repeat(30),
    section = "Bahçe ve Restoran Özel Davet Alanı " + "Y".repeat(30);
  const item = {
    id: "m0",
    name: "Geleneksel özel soslu ev yapımı makarna ve közlenmiş sebze garnitürü " + "Z".repeat(45),
    price: 999999.99,
    categoryId: "c1",
    description: "Uzun açıklama ".repeat(30),
    isAvailable: true,
    category: { id: "c1", name: "Geleneksel Türk mutfağından özel yemekler" },
  };
  const order = {
    id: "o0",
    tableId: "t0",
    status: "PENDING",
    createdAt: new Date().toISOString(),
    totalPrice: 1999999.98,
    discountAmount: 0,
    payments: [],
    items: [
      { id: "i0", quantity: 2, unitPrice: item.price, menuItemName: item.name, menuItem: item },
    ],
  };
  const table = {
    id: "t0",
    tableNumber: name,
    section,
    status: "OCCUPIED",
    shape: "SQUARE",
    width: 96,
    height: 96,
    capacity: 4,
    posX: 10,
    posY: 10,
    orders: [order],
  };
  order.table = { tableNumber: name, section };
  await page.route(
    (url) => url.pathname === "/api/tables",
    (r) => r.fulfill({ json: [table] })
  );
  await page.route("**/api/menu-items*", (r) => r.fulfill({ json: [item] }));
  await page.route("**/api/categories*", (r) => r.fulfill({ json: [item.category] }));
  await page.route("**/api/orders*", (r) => r.fulfill({ json: [order] }));
  await page.route("**/api/public/menu?*", (r) =>
    r.fulfill({
      json: {
        restaurant: { name: "Restoran " + "Ö".repeat(55), currency: "₺", defaultLanguage: "tr" },
        table: { label: name },
        categories: [item.category],
        items: [item],
        orderingEnabled: true,
      },
    })
  );
  const scenes = [],
    findings = [];
  const viewports = [
    { width: 360, height: 640 },
    { width: 600, height: 800 },
    { width: 601, height: 800 },
    { width: 760, height: 768 },
    { width: 761, height: 768 },
    { width: 900, height: 768 },
    { width: 959, height: 768 },
    { width: 960, height: 768 },
    { width: 1200, height: 800 },
    { width: 1320, height: 800 },
    { width: 1920, height: 1080 },
    { width: 640, height: 360 },
  ];
  async function scan(name, viewport) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(100);
    const issues = await page.evaluate(measureLayout);
    const textIssues = await page.evaluate(() => {
      const findings = [];
      for (const panel of document.querySelectorAll(
        ".kds-panel-heading,.kds-detail-summary,.pos-checkout-header,.pos-command-bar,.service-panel-heading,.service-qr-heading,.metric-card,.pos-payment-entry"
      )) {
        const p = panel.getBoundingClientRect();
        if (!p.width || !p.height) continue;
        const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (!node.textContent.trim() || node.parentElement.closest("svg,.sr-only")) continue;
          let truncate = false;
          for (let e = node.parentElement; e && e !== panel; e = e.parentElement) {
            if (
              getComputedStyle(e).textOverflow === "ellipsis" ||
              parseInt(getComputedStyle(e).webkitLineClamp) > 0
            )
              truncate = true;
          }
          if (truncate) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects())
            if (
              rect.width &&
              rect.height &&
              (rect.left < p.left - 2 ||
                rect.right > p.right + 2 ||
                rect.top < p.top - 2 ||
                rect.bottom > p.bottom + 2)
            ) {
              findings.push({
                type: "panel-text-overflow",
                panel: panel.className,
                label: node.textContent.trim().slice(0, 90),
              });
              break;
            }
        }
      }
      return findings;
    });
    issues.push(...textIssues);
    scenes.push({ name, ...viewport, issues: issues.length });
    findings.push(...issues.map((issue) => ({ scene: name, ...viewport, ...issue })));
    if (issues.length)
      await page.screenshot({ path: path.join(output, `final-${name}-${viewport.width}.png`) });
    fs.writeFileSync(
      path.join(output, "final-layout-results.json"),
      JSON.stringify({ scenes, findings, pageErrors: fixture.failures }, null, 2)
    );
  }
  await page.goto(base + "/privacy");
  for (const [route, name] of [
    ["/", "floor"],
    ["/order/t0", "order"],
    ["/kitchen", "kitchen"],
    ["/pos", "pos"],
    ["/admin/menu", "menu"],
    ["/admin/reports", "reports"],
    ["/admin/settings", "settings"],
    ["/admin/tables", "tables"],
    ["/menu/" + "a".repeat(48), "qr"],
  ]) {
    for (const lang of ["tr", "en"]) {
      await fixture.context.addCookies([
        { name: "tepsy_lang", value: lang, url: base },
        { name: "tepsy_theme", value: lang === "en" ? "dark" : "light", url: base },
      ]);
      await page.evaluate((lang) => {
        localStorage.setItem("tepsy_lang", lang);
      }, lang);
      await page.goto(base + route);
      await page.locator("main h1:visible,main h2:visible").first().waitFor();
      if (route.startsWith("/menu/")) await page.locator(".service-qr-product").first().waitFor();
      else await page.locator(".nav-links a").first().waitFor({ state: "attached" });
      await page.evaluate((lang) => {
        localStorage.setItem("tepsy_lang", lang);
      }, lang);
      if (route === "/pos") {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.locator(".pos-table-view-toggle button").last().click();
        await page.locator(".pos-table-card").first().click();
      }
      if (route === "/kitchen") await page.locator(".kds-ticket-card").first().click();
      for (const viewport of viewports) await scan(name + "-" + lang, viewport);
      console.log("Final layout: " + name + " " + lang);
    }
  }
  console.log(
    JSON.stringify(
      {
        scenes: scenes.length,
        findings: [
          ...new Set(findings.map((x) => x.scene + " " + x.width + " " + x.type + " " + x.label)),
        ],
        pageErrors: fixture.failures,
      },
      null,
      2
    )
  );
  if (!process.argv.includes("--report-only")) {
    assert.deepEqual(findings, []);
    assert.deepEqual(fixture.failures, []);
  }
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
