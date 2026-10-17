// Device checks complement width-only layout tests: short screens, touch and action reachability.
const { createFixture, base, output } = require("./fixture.cjs");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const reportOnly = process.argv.includes("--report-only");
const viewports = [
  { width: 320, height: 568 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1024, height: 600 },
];
let browser, page;
function measureDeviceLayout() {
  const findings = [],
    activeDialog = document.querySelector("dialog[open]"),
    scope = activeDialog || document;
  const visible = (el) => {
    const r = el.getBoundingClientRect(),
      s = getComputedStyle(el);
    return (
      r.width > 1 &&
      r.height > 1 &&
      s.display !== "none" &&
      s.visibility !== "hidden" &&
      !el.closest('[aria-hidden="true"]')
    );
  };
  const label = (el) =>
    (
      el.getAttribute("aria-label") ||
      el.innerText ||
      el.getAttribute("placeholder") ||
      el.id ||
      el.tagName
    )
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 90);
  if (document.documentElement.scrollWidth > innerWidth + 1)
    findings.push({ type: "page-overflow", width: document.documentElement.scrollWidth });
  for (const el of document.querySelectorAll("dialog[open]")) {
    const r = el.getBoundingClientRect();
    if (r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1)
      findings.push({
        type: "dialog-outside-screen",
        label: label(el),
        box: { x: r.x, y: r.y, width: r.width, height: r.height },
      });
  }
  // These are frequent operation controls, not decorative icons or dense drawing tools.
  const controls =
    ".primary-action,.secondary-action,.service-button,.service-category-strip button,.service-quantity-controls button,.qr-quantity-controls button,.service-qr-add,.qr-language-button,.kds-tabs button,.kds-ticket-actions button,.pos-payment-methods button,.pos-mobile-switch button,.pos-command-button,.pos-back-to-tables,.pos-add-item-button,.workspace-dialog .dialog-heading button";
  for (const el of scope.querySelectorAll(controls)) {
    if (
      !visible(el) ||
      !el.matches("button,a,input,[role=button]") ||
      el.closest(".floorplan-viewport,.floorplan-stage,.floorplan-toolbar,.service-plan-toolbar")
    )
      continue;
    const r = el.getBoundingClientRect();
    if (r.width < 43.5 || r.height < 43.5)
      findings.push({
        type: "small-touch-control",
        label: label(el),
        controlWidth: r.width,
        controlHeight: r.height,
      });
  }
  for (const el of scope.querySelectorAll(
    ".kds-ticket-grid,.kds-detail-scroll,.service-product-scroll,.pos-checkout-layout"
  )) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 64)
      findings.push({
        type: "collapsed-workspace",
        label: label(el),
        className: el.className,
        contentHeight: r.height,
      });
  }
  // Mobile inputs smaller than 16px trigger automatic zoom on iOS and can obscure controls.
  if (innerWidth <= 767)
    for (const el of scope.querySelectorAll(
      "main input:not([type=checkbox]):not([type=radio]):not([type=file]),main select,main textarea,dialog[open] input:not([type=checkbox]):not([type=radio]):not([type=file]),dialog[open] select,dialog[open] textarea"
    )) {
      if (!visible(el) || el.closest(".floorplan-toolbar,.floorplan-properties")) continue;
      const fontSize = parseFloat(getComputedStyle(el).fontSize);
      if (fontSize < 16) findings.push({ type: "mobile-input-zoom", label: label(el), fontSize });
    }
  return findings;
}
(async () => {
  const fixture = await createFixture({ hasTouch: true, deviceScaleFactor: 2 });
  browser = fixture.browser;
  page = fixture.page;
  page.setDefaultTimeout(10000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Adverse content is isolated in browser routes: long names, high prices and photos.
  const categories = [
    { id: "c1", name: "Kahveler" },
    { id: "c2", name: "Yemekler" },
  ];
  const items = Array.from({ length: 300 }, (_, index) => ({
    id: "m" + index,
    name:
      index === 2
        ? "Közlenmiş sebzeler, geleneksel sos ve fesleğen ile hazırlanan özel ev yapımı makarna"
        : "Ürün " + String(index + 1).padStart(3, "0"),
    price: index === 2 ? 999999 : 50 + index,
    categoryId: index % 2 ? "c2" : "c1",
    category: categories[index % 2],
    description: "Uzun ürün açıklaması, içerik ve servis bilgisi. ".repeat(4),
    isAvailable: true,
    imageUrl: index === 2 ? "/device-test-photo.png" : null,
  }));
  await page.route("**/api/menu-items*", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ contentType: "application/json", body: JSON.stringify(items) })
      : route.fallback()
  );
  await page.route("**/api/public/menu?*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        restaurant: { name: "Test Restoranı", currency: "₺", defaultLanguage: "tr" },
        table: { label: "Masa 001" },
        categories,
        items,
        orderingEnabled: true,
      }),
    })
  );
  await page.route("**/device-test-photo.png", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl6IAAAAASUVORK5CYII=",
        "base64"
      ),
    })
  );
  const findings = [],
    scenes = [];
  async function ready(route) {
    await page.waitForLoadState("load");
    if (route.startsWith("/menu/")) await page.locator(".service-qr-product").first().waitFor();
    else if (!["/setup", "/login", "/privacy", "/terms", "/cookies"].includes(route.split("#")[0]))
      await page.locator(".nav-links .nav-link").first().waitFor({ state: "attached" });
  }
  async function scan(name, viewport, targets = []) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(80);
    const issues = await page.evaluate(measureDeviceLayout);
    const contentSelectors =
      name === "menu"
        ? [".menu-management-layout > section .scroll-panel-content"]
        : name === "reports"
          ? [
              ".report-details .surface-panel:first-child .scroll-panel-content",
              ".report-details .surface-panel:last-child .scroll-panel-content",
            ]
          : name === "order"
            ? [".service-product-scroll .scroll-panel-content"]
            : name === "kitchen-detail"
              ? [".kds-detail-scroll .scroll-panel-content"]
              : [];
    for (const selector of contentSelectors) {
      const content = page.locator(selector).first(),
        box = await content.boundingBox();
      if (!box || box.height < 120)
        issues.push({
          type: "collapsed-content",
          label: selector,
          contentHeight: box?.height ?? 0,
        });
    }
    if (name === "order") {
      const longTile = page
        .locator(".service-product-tile")
        .filter({ hasText: items[2].name })
        .first();
      await longTile.scrollIntoViewIfNeeded();
      const collisions = await longTile.evaluate((tile) => {
        const box = (el) => el.getBoundingClientRect(),
          inside = (a, b) =>
            a.left >= b.left - 1 &&
            a.right <= b.right + 1 &&
            a.top >= b.top - 1 &&
            a.bottom <= b.bottom + 1;
        const parts = [
          ...tile.querySelectorAll(
            ".service-product-copy,.service-product-price,.service-product-add,.menu-photo-waiter"
          ),
        ].filter((el) => box(el).width > 0);
        const issues = [];
        for (const part of parts)
          if (!inside(box(part), box(tile))) issues.push(part.className + " outside tile");
        for (let i = 0; i < parts.length; i++)
          for (let j = i + 1; j < parts.length; j++) {
            const a = box(parts[i]),
              b = box(parts[j]);
            if (
              Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
              Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2
            )
              issues.push(parts[i].className + " overlaps " + parts[j].className);
          }
        return issues;
      });
      issues.push(...collisions.map((label) => ({ type: "product-content-collision", label })));
    }
    for (const [label, target] of targets) {
      if (!(await target.isVisible())) {
        issues.push({ type: "hidden-action", label });
        continue;
      }
      try {
        await target.scrollIntoViewIfNeeded();
        await target.click({ trial: true, timeout: 2500 });
        const box = await target.boundingBox();
        if (
          !box ||
          box.x < -1 ||
          box.x + box.width > viewport.width + 1 ||
          box.y < -1 ||
          box.y + box.height > viewport.height + 1
        )
          issues.push({ type: "unreachable-action", label, box });
      } catch (error) {
        issues.push({ type: "unreachable-action", label, error: error.message.split("\n")[0] });
      }
    }
    scenes.push({ name, ...viewport, issues: issues.length });
    findings.push(...issues.map((issue) => ({ scene: name, ...viewport, ...issue })));
    if (
      issues.length ||
      (["waiter-cart", "pos-checkout", "kitchen-detail"].includes(name) && viewport.height === 390)
    )
      await page.screenshot({
        path: path.join(output, `device-${name}-${viewport.width}x${viewport.height}.png`),
        caret: "initial",
      });
    fs.writeFileSync(
      path.join(output, "device-ux-results.json"),
      JSON.stringify({ scenes, findings, pageErrors: fixture.failures }, null, 2)
    );
  }
  async function visit(route, name, action, targets, selected = viewports) {
    await fixture.context.addCookies([
      { name: "tepsy_lang", value: "tr", url: base },
      { name: "tepsy_theme", value: "light", url: base },
    ]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + route, { waitUntil: "domcontentloaded" });
    await page.locator("main h1:visible,main h2:visible").first().waitFor();
    await ready(route);
    if (action) await action();
    for (const viewport of selected) await scan(name, viewport, targets ? targets() : []);
    console.log(`Device UX: ${name}`);
  }
  const token = "a".repeat(48);
  for (const [route, name] of [
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
    ["/menu/" + token, "qr"],
    ["/setup", "setup"],
  ])
    await visit(
      route,
      name,
      null,
      name === "menu"
        ? () => [["Edit first product", page.getByRole("button", { name: /Ürün 001 · Düzenle/ })]]
        : name === "reports"
          ? () => [["Read first sale", page.locator(".report-sales-table tbody tr").first()]]
          : null
    );
  await visit(
    "/admin/menu",
    "menu-edit",
    async () => {
      await page.getByRole("button", { name: /Ürün 001 · Düzenle/ }).click();
    },
    () => [
      ["Save product", page.getByRole("button", { name: /Değişiklikleri Kaydet/ })],
      ["Close", page.locator("dialog[open] .dialog-heading button")],
    ]
  );
  await visit(
    "/admin/tables",
    "table-add",
    async () => {
      await page.getByRole("button", { name: /Yeni Masa/ }).click();
    },
    () => [
      ["Add table", page.locator("dialog[open] .primary-action").last()],
      ["Close", page.locator("dialog[open] .dialog-heading button")],
    ]
  );
  await visit(
    "/order/t0",
    "waiter-cart",
    async () => {
      for (let index = 0; index < 6; index++)
        await page.locator(".service-product-tile").nth(index).click();
      await page.setViewportSize({ width: 320, height: 568 });
      await page.getByRole("button", { name: /Adisyonu aç/ }).click();
    },
    () => [
      ["Last quantity", page.locator("dialog[open] .service-quantity-controls button").last()],
      ["Submit order", page.locator("dialog[open] .service-submit-order")],
      ["Close", page.locator("dialog[open] .dialog-heading button")],
    ]
  );
  await visit(
    "/menu/" + token,
    "qr-cart",
    async () => {
      for (let index = 0; index < 6; index++)
        await page
          .locator(".service-qr-product")
          .nth(index)
          .locator(".service-qr-product-action button")
          .click();
      await page.setViewportSize({ width: 320, height: 568 });
      await page
        .locator(".service-qr-mobile-action")
        .getByRole("button", { name: /Sepet/ })
        .click();
    },
    () => [
      ["Last quantity", page.locator("dialog[open] .service-quantity-controls button").last()],
      [
        "Submit QR order",
        page.locator("dialog[open]").getByRole("button", { name: "Siparişi gönder", exact: true }),
      ],
      ["Close", page.locator("dialog[open] .dialog-heading button")],
    ]
  );
  await visit(
    "/menu/" + token,
    "qr-details",
    async () => {
      await page.getByRole("button", { name: "Ürün 001 detayları", exact: true }).click();
    },
    () => [
      ["Return to menu", page.locator("dialog[open] .service-button-quiet")],
      ["Close", page.locator("dialog[open] .dialog-heading button")],
    ]
  );
  await visit(
    "/pos",
    "pos-checkout",
    async () => {
      await page
        .locator(".pos-table-view-toggle")
        .getByRole("button", { name: "Liste", exact: true })
        .click();
      await page.locator(".pos-table-card").first().click();
    },
    () => [
      ["Cash", page.locator(".pos-payment-methods button").first()],
      ["Card", page.locator(".pos-payment-methods button").nth(1)],
      ["Add item", page.locator(".pos-add-item-button")],
    ]
  );
  await visit(
    "/pos",
    "pos-preview",
    async () => {
      await page
        .locator(".pos-table-view-toggle")
        .getByRole("button", { name: "Liste", exact: true })
        .click();
      await page.locator(".pos-table-card").first().click();
      await page.locator(".pos-preview-button").click();
    },
    () => [
      ["Print receipt", page.locator("dialog[open] .receipt-browser-print")],
      ["Close", page.locator("dialog[open] .dialog-heading button")],
    ]
  );
  await visit(
    "/kitchen",
    "kitchen-detail",
    async () => {
      await page.locator(".kds-ticket-card").first().click();
    },
    () => [
      ["Prepare ticket", page.locator(".kds-ticket-actions button").first()],
      ["First item", page.locator(".kds-item-row").first()],
    ]
  );
  await visit(
    "/",
    "navigation",
    async () => {
      await page.setViewportSize({ width: 320, height: 568 });
      await page.getByRole("button", { name: "Gezinmeyi aç", exact: true }).click();
    },
    () => [
      ["Last navigation item", page.locator("dialog[open] .nav-links a").last()],
      ["Close", page.locator("dialog[open] .dialog-heading button")],
    ],
    viewports.filter((viewport) => viewport.width === 320)
  );
  // English dark mode stresses longer control labels in the same short landscape screen.
  await fixture.context.addCookies([
    { name: "tepsy_lang", value: "en", url: base },
    { name: "tepsy_theme", value: "dark", url: base },
  ]);
  await page.evaluate(() => {
    localStorage.setItem("tepsy_lang", "en");
    localStorage.setItem("tepsy_theme", "dark");
  });
  for (const [route, name] of [
    ["/kitchen", "kitchen-en-dark"],
    ["/pos", "pos-en-dark"],
    ["/admin/settings", "settings-en-dark"],
    ["/order/t0", "order-en-dark"],
    ["/menu/" + token, "qr-en-dark"],
  ]) {
    await page.goto(base + route, { waitUntil: "domcontentloaded" });
    await ready(route);
    for (const viewport of viewports.slice(0, 2)) await scan(name, viewport);
  }
  fs.writeFileSync(
    path.join(output, "device-ux-results.json"),
    JSON.stringify({ scenes, findings, pageErrors: fixture.failures }, null, 2)
  );
  console.log(
    JSON.stringify({ scenes: scenes.length, findings, pageErrors: fixture.failures }, null, 2)
  );
  if (!reportOnly) {
    assert.deepEqual(
      findings,
      [],
      "Device UX: clipped actions, tiny touch targets or collapsed workspaces"
    );
    assert.deepEqual(fixture.failures, []);
  }
})()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
    if (page && !page.isClosed())
      await page
        .screenshot({ path: path.join(output, "device-ux-failure.png"), caret: "initial" })
        .catch(() => {});
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
