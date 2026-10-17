const { createFixture, base, output } = require("./fixture.cjs");
const fs = require("node:fs");
const assert = require("node:assert/strict");
let browser;
(async () => {
  const fixture = await createFixture();
  browser = fixture.browser;
  const { page, failures, shots, report } = fixture;

  page.setDefaultTimeout(10000);
  await page.route("**/api/reports/z-report?*", async (route) => {
    const period = new URL(route.request().url()).searchParams.get("period");
    await new Promise((r) => setTimeout(r, period === "this_week" ? 450 : 10));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...report,
        summary: {
          ...report.summary,
          totalRevenue: period === "this_month" ? 700 : period === "this_week" ? 100 : 12000,
        },
      }),
    });
  });
  await page.goto(base + "/admin/reports");
  await page.getByRole("button", { name: "Bu Hafta", exact: true }).click();
  await page.waitForTimeout(30);
  await page.getByRole("button", { name: "Bu Ay", exact: true }).click();
  await page.waitForTimeout(600);
  assert.ok((await page.locator(".metric-card").first().innerText()).includes("700,00"));
  await page.emulateMedia({ media: "print" });
  assert.equal(await page.locator("#printable-receipt tbody tr").count(), 300);
  assert.equal(await page.locator("#printable-receipt").isVisible(), true);
  await page.emulateMedia({ media: "screen" });
  let deviceTests = 0;
  page.on("request", (req) => {
    if (req.url().includes("/api/devices/payment/status")) deviceTests++;
  });
  await page.goto(base + "/admin/settings");
  await page.getByRole("button", { name: "QR ve cihazlar", exact: true }).click();
  await page.getByRole("combobox", { name: /Entegrasyon/ }).selectOption("NEXO_LOCAL");
  await page.getByRole("button", { name: "Bağlantıyı test et", exact: true }).click();
  await page
    .getByRole("status")
    .getByText("Sentetik test: değişiklik kaydedilmedi.", { exact: true })
    .waitFor();
  assert.equal(deviceTests, 0, "failed config must not test the previous device");
  await page.route("**/api/auth/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        authEnabled: true,
        session: { role: "KITCHEN", name: "Test mutfak" },
      }),
    })
  );
  await page.goto(base + "/kitchen");
  await page.getByRole("tab", { name: /HAZIR/ }).click();
  await page
    .getByText("Sipariş hazır. Garson tarafından teslim alınabilir.", { exact: true })
    .waitFor();
  assert.equal(await page.locator(".kds-delivered-action:visible").count(), 0);
  await page.route("**/api/orders?activeOnly=true", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "delivered-ticket",
          status: "DELIVERED",
          createdAt: new Date().toISOString(),
          table: { tableNumber: "Masa 001", section: "Salon" },
          items: [
            {
              id: "delivered-item",
              quantity: 1,
              status: "DELIVERED",
              menuItemName: "Çay",
              unitPrice: 50,
            },
          ],
        },
      ]),
    })
  );
  await page.goto(base + "/kitchen");
  await page.locator("#kds-tab-ALL").click();
  await page.locator(".kds-ticket-card").first().click();
  assert.equal(
    await page.locator(".kds-item-row").first().isDisabled(),
    true,
    "delivered items cannot be toggled"
  );
  await page.route("**/api/auth/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ authEnabled: true, session: null }),
    })
  );
  await page.goto(base + "/login");
  await page.getByRole("button", { name: "Giriş yap", exact: true }).waitFor();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  await page.getByRole("button", { name: "Türkçe", exact: true }).click();
  // Owner/device choices are sent explicitly; rejected credentials stay on sign-in.
  const loginPayloads = [];
  await page.route("**/api/auth/login", async (route) => {
    loginPayloads.push(route.request().postDataJSON());
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Sentetik giriş reddedildi." }),
    });
  });
  await page.locator('input[autocomplete="organization"]').fill("QA01");
  await page.locator('input[type="password"]').fill("QaSetupPassword123");
  const remember = page.getByRole("checkbox", { name: /Bu cihazı 30 gün hatırla/ });
  assert.equal(await remember.isChecked(), true);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Sentetik giriş reddedildi." }).waitFor();
  assert.equal(loginPayloads[0].restaurantCode, "QA01");
  assert.equal(loginPayloads[0].rememberDevice, true);
  await remember.uncheck();
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("button.primary-action")?.disabled);
  assert.equal(loginPayloads[1].rememberDevice, false);
  await page.getByRole("button", { name: "Personel", exact: true }).click();
  assert.equal(await page.getByRole("checkbox").count(), 0);
  await page.locator('input[autocomplete="username"]').fill("Test garson");
  await page.locator('input[type="password"]').fill("1234");
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("button.primary-action")?.disabled);
  assert.equal(loginPayloads[2].username, "Test garson");
  assert.equal(loginPayloads[2].rememberDevice, false);
  // Existing data leads to secure access settings, never to a fresh setup.
  await page.route("**/api/auth/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        authEnabled: false,
        canSetup: false,
        isSetupCompleted: true,
        session: null,
      }),
    })
  );
  await page.goto(base + "/login");
  await page.getByRole("button", { name: "Güvenli girişi ayarla", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "İşletmeni kur", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Güvenli girişi ayarla", exact: true }).click();
  await page.waitForURL("**/admin/settings#local-access");
  // A genuinely empty installation offers the setup wizard from the login page.
  await page.route("**/api/auth/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        authEnabled: false,
        canSetup: true,
        isSetupCompleted: false,
        session: null,
      }),
    })
  );
  await page.goto(base + "/login");
  await page.getByRole("button", { name: "İşletmeni kur", exact: true }).click();
  await page.waitForURL("**/setup");
  assert.equal(
    await page.getByRole("button", { name: "Güvenli girişi ayarla", exact: true }).count(),
    0
  );
  await page.goto(base + "/setup");
  await page.locator('input[name="restaurantCode"]').fill("QA01");
  await page.locator('input[name="ownerPassword"]').fill("QaSetupPassword123");
  await page.locator('input[name="ownerPasswordConfirm"]').fill("QaSetupPassword123");
  await page.getByRole("button", { name: "İleri", exact: true }).click();
  const count = page.getByRole("spinbutton").first();
  await count.fill("21");
  await page.getByRole("button", { name: "İleri", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Her bölümde 1 ile 20" }).waitFor();
  await count.fill("20");
  await page.getByRole("button", { name: "İleri", exact: true }).click();
  await page.getByRole("button", { name: /Kurulumu Tamamla/i }).waitFor();
  const token = "a".repeat(48);
  let pending = false;
  await page.route("**/api/public/orders*", async (route) => {
    const method = route.request().method();
    pending = method === "POST" ? true : method === "DELETE" ? false : pending;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        orderId: "public-test",
        status: pending ? "AWAITING_WAITER_APPROVAL" : "CANCELLED",
      }),
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/menu/" + token);
  await page.getByRole("button", { name: "Ürün 001 Ekle", exact: true }).click();
  await page.getByRole("button", { name: /Sepet/ }).first().click();
  const cart = page.getByRole("dialog").filter({ visible: true });
  await cart.getByRole("button", { name: "Siparişi gönder", exact: true }).click();
  await page.getByText("Garson onayı bekleniyor", { exact: true }).waitFor();
  await page.getByRole("button", { name: "İsteği geri çek", exact: true }).click();
  await page.getByText("Sipariş isteği geri çekildi.", { exact: true }).waitFor();
  assert.equal(pending, false);
  console.log(
    "PASS: report response ordering/full print, failed device config gate, kitchen role, login languages/remember device/fresh and legacy access, setup credentials/20-table bound, QR submit/withdraw"
  );
  fs.writeFileSync(
    output + "/supplement-results.json",
    JSON.stringify({ failures, shots }, null, 2)
  );
  console.log(JSON.stringify({ failures, shots: shots.length }));
  await browser.close();
  if (failures.length) process.exitCode = 1;
})().catch(async (e) => {
  console.error(e);
  if (browser) await browser.close();
  process.exitCode = 1;
});
