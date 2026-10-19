const { createFixture, base, output } = require("./fixture.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const fixture = await createFixture({ viewport: { width: 320, height: 400 } });
  const { browser, page } = fixture;
  let canRecoverOwner = true;
  let canCreateRestaurant = true;
  let recoveryRequests = 0;
  let recoveryUncertain = false;
  let creates = [];
  let jobReady = false;
  let disconnectCreate = true;
  let statusUnavailable = false;
  let unsafeJobUrl = false;
  await page.route("**/api/auth/status", (route) =>
    statusUnavailable
      ? route.fulfill({ status: 503, json: { error: "Fixture offline" } })
      : route.fulfill({
          json: {
            authEnabled: true,
            canSetup: false,
            canRecoverOwner,
            canCreateRestaurant,
            session: null,
          },
        })
  );
  await page.route("**/api/auth/recover", async (route) => {
    recoveryRequests += 1;
    const body = route.request().postDataJSON();
    assert.equal(body.code, "RECOVERY-TEST-ONLY");
    assert.equal(body.newPassword, "New-owner-password-42");
    await route.fulfill(
      recoveryUncertain
        ? { status: 500, json: { error: "Unknown completion" } }
        : { json: { success: true, redirectTo: "/login" } }
    );
  });
  await page.route("**/api/auth/restaurants*", async (route) => {
    if (route.request().method() === "POST") {
      creates.push(route.request().postDataJSON());
      if (disconnectCreate) {
        disconnectCreate = false;
        await route.abort("connectionreset");
      } else
        await route.fulfill({
          status: 202,
          json: { id: "opaque-fixture-job", status: "STARTING" },
        });
    } else
      await route.fulfill({
        json: {
          id: "opaque-fixture-job",
          status: jobReady ? "READY" : "STARTING",
          ...(jobReady
            ? { url: unsafeJobUrl ? "javascript:alert('unsafe')" : "http://127.0.0.1:43210/setup" }
            : {}),
        },
      });
  });
  try {
    await page.goto(base + "/login");
    await page.getByRole("link", { name: "Şifremi unuttum", exact: true }).waitFor();
    await page.getByRole("link", { name: "Yeni restoran oluştur", exact: true }).waitFor();
    await page.getByRole("button", { name: "Personel", exact: true }).click();
    await page.getByRole("link", { name: "Şifremi unuttum", exact: true }).click();
    await page.getByText(/PIN.*işletme sahib/).waitFor();
    await page.getByLabel("Kurtarma kodu", { exact: true }).fill("RECOVERY-TEST-ONLY");
    await page.getByLabel("Yeni şifre", { exact: true }).fill("New-owner-password-42");
    await page.getByLabel("Yeni şifre tekrar", { exact: true }).fill("Wrong-confirmation");
    await page
      .getByRole("button", { name: "Şifreyi yenile", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, "login-help-recovery-320x400.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator(".login-page").evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({ path: path.join(output, "login-help-recovery-desktop.png") });
    await page.setViewportSize({ width: 320, height: 400 });
    await page.getByRole("button", { name: "Şifreyi yenile", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Şifreler eşleşmiyor" }).waitFor();
    assert.equal(recoveryRequests, 0);
    await page.getByLabel("Yeni şifre tekrar", { exact: true }).fill("New-owner-password-42");
    await page.getByRole("button", { name: "Şifreyi yenile", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Şifreniz yenilendi" }).waitFor();
    assert.equal(recoveryRequests, 1);
    recoveryUncertain = true;
    await page.goto(base + "/account-help?action=recover");
    await page.getByLabel("Kurtarma kodu", { exact: true }).fill("RECOVERY-TEST-ONLY");
    await page.getByLabel("Yeni şifre", { exact: true }).fill("New-owner-password-42");
    await page.getByLabel("Yeni şifre tekrar", { exact: true }).fill("New-owner-password-42");
    await page.getByRole("button", { name: "Şifreyi yenile", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Önce yeni şifrenizle giriş" }).waitFor();
    await page.getByRole("link", { name: "Giriş yapmayı dene", exact: true }).waitFor();
    await page.goto(base + "/account-help?action=new");
    await page
      .getByLabel("Mevcut işletme sahibi şifresi", { exact: true })
      .fill("Current-owner-secret");
    await page
      .getByRole("button", { name: "Ayrı restoran kurulumu oluştur", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, "login-help-new-320x400.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator(".login-page").evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({ path: path.join(output, "login-help-new-desktop.png") });
    await page.setViewportSize({ width: 320, height: 400 });
    await page.getByRole("button", { name: "Ayrı restoran kurulumu oluştur", exact: true }).click();
    await page.locator(".account-help-page").getByRole("alert").waitFor();
    await page.getByRole("button", { name: "Ayrı restoran kurulumu oluştur", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Hazırlanıyor" }).waitFor();
    assert.equal(creates.length, 2);
    assert.equal(creates[0].idempotencyKey, creates[1].idempotencyKey);
    await page.reload();
    await page.getByRole("status").filter({ hasText: "Hazırlanıyor" }).waitFor();
    jobReady = true;
    const open = page.getByRole("link", { name: "Yeni restoranı kur", exact: true });
    await open.waitFor({ timeout: 10000 });
    assert.equal(await open.getAttribute("href"), "http://127.0.0.1:43210/setup");
    assert.equal(creates.length, 2);
    unsafeJobUrl = true;
    await page.reload();
    await page.getByRole("alert").filter({ hasText: "Kurulum durumu alınamadı" }).waitFor();
    assert.equal(
      await page.getByRole("link", { name: "Yeni restoranı kur", exact: true }).count(),
      0
    );
    unsafeJobUrl = false;
    await page.getByRole("button", { name: "Durumu tekrar kontrol et", exact: true }).click();
    await page.getByRole("link", { name: "Yeni restoranı kur", exact: true }).waitFor();
    assert.equal(creates.length, 2);
    const storage = await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })
    );
    assert.ok(
      !storage.includes("Current-owner-secret") &&
        !storage.includes("New-owner-password-42") &&
        !storage.includes("RECOVERY-TEST-ONLY")
    );
    canRecoverOwner = false;
    canCreateRestaurant = false;
    statusUnavailable = true;
    await page.goto(base + "/account-help?action=recover");
    await page.getByRole("alert").filter({ hasText: "Sunucuya bağlanılamadı" }).waitFor();
    statusUnavailable = false;
    await page.getByRole("button", { name: "Yeniden dene", exact: true }).click();
    await page
      .getByText("Bu işlemi TEPSY sunucu bilgisayarında, localhost adresinden açın.", {
        exact: false,
      })
      .waitFor();
    assert.equal(await page.getByLabel("Kurtarma kodu", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "English", exact: true }).click();
    await page.getByRole("heading", { name: "Recover owner access", exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, "login-help-320x400.png") });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false
    );
    assert.deepEqual(fixture.failures, []);
    fs.writeFileSync(
      path.join(output, "login-help-results.json"),
      JSON.stringify(
        {
          passed: true,
          recoveryRequests,
          createAttempts: creates.length,
          pageErrors: fixture.failures,
        },
        null,
        2
      )
    );
    console.log(
      "Login help: recovery confirmation, safe retry, reload resume, remote guidance and 320px layout passed."
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
