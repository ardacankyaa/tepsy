const { createFixture, base, output } = require("./fixture.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

let browser;
let failurePage;
(async () => {
  const fixture = await createFixture();
  browser = fixture.browser;
  const { page, failures } = fixture;
  failurePage = page;
  let config = {
    restaurantName: "Test Restoranı",
    currency: "₺",
    defaultLanguage: "tr",
    isSetupCompleted: true,
  };
  const order = {
    id: "order-1",
    status: "DELIVERED",
    totalPrice: 1234567.89,
    payments: [],
    items: [
      {
        id: "item-1",
        quantity: 1,
        unitPrice: 1234567.89,
        menuItemName: "Uzun ürün adı ve özel hazırlama seçenekleri",
        menuItem: {
          id: "m0",
          name: "Uzun ürün adı ve özel hazırlama seçenekleri",
          price: 1234567.89,
        },
      },
    ],
  };
  const table = {
    id: "table-1",
    tableNumber: "Bahçe Yuvarlak Çok Uzun Masa İsmi",
    section: "Salon",
    shape: "ROUND",
    width: 90,
    height: 90,
    capacity: 4,
    posX: 25,
    posY: 30,
    status: "OCCUPIED",
    orders: [order],
    serviceRequests: [{ id: "call-1", type: "WAITER" }],
  };
  let calls = [{ id: "call-1", type: "WAITER", tableId: table.id, tableLabel: table.tableNumber }];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    let body;
    if (url.pathname === "/api/config") {
      if (method === "PUT") config = { ...config, ...route.request().postDataJSON() };
      body = config;
    } else if (url.pathname === "/api/auth/status")
      body = {
        authEnabled: true,
        session: { userId: "staff-admin", name: "Personel Yönetici", role: "ADMIN" },
      };
    else if (url.pathname === "/api/staff")
      body = [
        { id: "admin-2", name: "Diğer Yönetici", role: "ADMIN", isActive: true },
        { id: "waiter-2", name: "Garson", role: "WAITER", isActive: true },
      ];
    else if (url.pathname === "/api/tables") body = [table];
    else if (url.pathname === "/api/orders") body = [order];
    else if (url.pathname === "/api/floor-plan/canvas")
      body = [{ section: "Salon", width: 600, height: 400 }];
    else if (url.pathname === "/api/service-requests") {
      if (method === "PATCH") {
        calls = [];
        table.serviceRequests = [];
      }
      body = method === "PATCH" ? { status: "RESOLVED" } : calls;
    } else {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  await page.goto(base + "/admin/settings");
  await page
    .locator("#business-identity select")
    .filter({ has: page.locator("option[value=en]") })
    .selectOption("en");
  await page.getByRole("button", { name: "Genel ayarları kaydet" }).click();
  await page.getByRole("button", { name: "Save general settings" }).waitFor();
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.equal(await page.evaluate(() => localStorage.getItem("tepsy_lang")), "en");
  await page.reload();
  await page
    .locator("#business-identity select")
    .filter({ has: page.locator("option[value=en]") })
    .waitFor();
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  await page.getByRole("button", { name: "Team", exact: true }).click();
  assert.equal(await page.getByRole("combobox", { name: /Diğer Yönetici/ }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: /Diğer Yönetici/ }).isDisabled(), true);
  assert.equal(await page.getByRole("combobox", { name: /^Garson/ }).isEnabled(), true);
  assert.equal(
    await page
      .getByRole("combobox", { name: /^Garson/ })
      .locator("option[value=ADMIN]")
      .isDisabled(),
    true
  );

  await page.goto(base + "/");
  const notice = page.getByRole("button", { name: "Pending requests: 1" });
  await notice.waitFor();
  await page.locator(".table-call-badge").waitFor();
  const name = page.locator(".table-node-name");
  await name.waitFor();
  const layout = await name.evaluate((el) => {
    const bounds = el.getBoundingClientRect();
    const table = el.closest(".table-node").getBoundingClientRect();
    return {
      left: bounds.left - table.left,
      right: table.right - bounds.right,
      clipped: el.scrollWidth > el.clientWidth,
      ellipsis: getComputedStyle(el).textOverflow,
    };
  });
  assert.ok(layout.left >= 0 && layout.right >= 0, JSON.stringify(layout));
  assert.equal(layout.ellipsis, "ellipsis");
  assert.equal(layout.clipped, true);
  await notice.click();
  const callsDialog = page.getByRole("dialog", { name: "Pending requests", exact: true });
  await callsDialog.getByText("Waiter call", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileName = await name.evaluate((el) => {
    const bounds = el.getBoundingClientRect();
    const content = el.closest(".table-node-content").getBoundingClientRect();
    return {
      top: bounds.top,
      bottom: bounds.bottom,
      contentTop: content.top,
      contentBottom: content.bottom,
    };
  });
  assert.ok(
    mobileName.top >= mobileName.contentTop - 1 &&
      mobileName.bottom <= mobileName.contentBottom + 1,
    `mobile name clipped: ${JSON.stringify(mobileName)}`
  );
  await page.screenshot({
    path: path.join(output, "service-calls-mobile.png"),
    animations: "disabled",
  });
  await callsDialog.getByRole("button", { name: "Resolved", exact: true }).click();
  await callsDialog.getByText("No pending requests.", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".service-notification-trigger").count(), 0);

  await page.goto(base + "/pos");
  await page.locator(".pos-table-card").click();
  await page.getByRole("button", { name: "Print bill preview" }).click();
  await page.locator("#printable-receipt").waitFor();
  for (const media of ["screen", "print"]) {
    await page.emulateMedia({ media });
    const dimensions = await page.locator(".receipt-paper-items strong").evaluate((el) => {
      const price = el.getBoundingClientRect();
      const paper = el.closest(".receipt-paper").getBoundingClientRect();
      return {
        text: el.textContent,
        right: price.right,
        limit: paper.right,
        scroll: el.closest(".receipt-paper-items").scrollWidth,
        width: el.closest(".receipt-paper-items").clientWidth,
      };
    });
    assert.equal(dimensions.text, "1,234,567.89 ₺");
    assert.ok(dimensions.right <= dimensions.limit + 1, `${media}: ${JSON.stringify(dimensions)}`);
    assert.ok(dimensions.scroll <= dimensions.width + 1, `${media}: price container overflows`);
  }
  await page.emulateMedia({ media: "screen" });
  await page.screenshot({
    path: path.join(output, "receipt-price-mobile.png"),
    animations: "disabled",
  });
  assert.deepEqual(failures, []);
  console.log(
    "PASS: settings language applies and persists; admin role controls; round table name; service notice and resolution; wide receipt price on mobile and print"
  );
})()
  .catch(async (error) => {
    console.error(error);
    if (failurePage && !failurePage.isClosed()) {
      await failurePage
        .screenshot({ path: path.join(output, "workflow-failure.png") })
        .catch(() => {});
      fs.writeFileSync(path.join(output, "workflow-failure.html"), await failurePage.content());
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
