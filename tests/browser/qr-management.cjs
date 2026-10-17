const { createFixture, base, output } = require("./fixture.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
let browser, page;
(async () => {
  const fixture = await createFixture();
  browser = fixture.browser;
  page = fixture.page;
  page.setDefaultTimeout(8000);
  await fixture.context.addCookies([{ name: "tepsy_theme", value: "dark", url: base }]);
  const token = "b".repeat(48);
  let network = "http://192.168.1.20:3000",
    unavailable = false,
    failQr = false;
  const saves = [];
  await page.route("**/api/network-info", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      saves.push(body);
      if (body.qrBaseUrl.includes("localhost"))
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: "QR adresi sunucuya ait bir localhost adresi olamaz." }),
        });
      network = body.qrBaseUrl.trim().replace(/\/+$/, "") || "http://192.168.1.20:3000";
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ baseUrl: network, qrBaseUrl: body.qrBaseUrl ? network : "" }),
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ baseUrl: unavailable ? "http://localhost:3000" : network }),
    });
  });
  await page.route("**/api/tables/qr", (route) =>
    route.fulfill({
      status: failQr ? 404 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        failQr ? { error: "Masa bulunamadı." } : { token, path: "/menu/" + token }
      ),
    })
  );
  await page.goto(base + "/admin/tables");
  await page.getByRole("button", { name: /QR.*Masa 001/i }).click();
  const dialog = page.getByRole("dialog").filter({ visible: true });
  await dialog.waitFor();
  assert.ok(
    (
      await dialog
        .getByRole("img", { name: "Masa 001 masası QR menü kodu", exact: true })
        .getAttribute("src")
    ).startsWith("data:image/png;base64,")
  );
  const preview = dialog.getByRole("link", { name: "Bağlantıyı aç", exact: true });
  assert.equal(
    await preview.getAttribute("href"),
    "/menu/" + token,
    "management preview must use the current app origin and theme"
  );
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.screenshot({
    path: path.join(output, "qr-management-desktop.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "QR adresini ayarla", exact: true }).click();
  await page.getByRole("heading", { name: "Masa QR menü adresi", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "QR ve cihazlar", exact: true })
      .getAttribute("aria-pressed"),
    "true"
  );
  const input = page.getByRole("textbox", { name: "İsteğe bağlı adres", exact: true });
  await page.getByRole("combobox", { name: "Entegrasyon", exact: true }).selectOption("NEXO_LOCAL");
  await input.fill("http://10.30.40.50:3000/");
  await page.getByRole("button", { name: "QR adresini kaydet", exact: true }).click();
  await page
    .getByText("QR adresi kaydedildi. Masalar bölümünden QR kodunu açabilirsiniz.", { exact: true })
    .waitFor();
  assert.deepEqual(
    saves[0],
    { qrBaseUrl: "http://10.30.40.50:3000/" },
    "QR save must be independent of unsaved device edits"
  );
  assert.equal(await input.inputValue(), "http://10.30.40.50:3000");
  await input.fill("http://localhost:3000");
  await page.getByRole("button", { name: "QR adresini kaydet", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "QR adresi sunucuya ait bir localhost adresi olamaz." })
    .waitFor();
  await page.getByRole("button", { name: "Otomatik adresi kullan", exact: true }).click();
  await page
    .getByText("QR adresi kaydedildi. Masalar bölümünden QR kodunu açabilirsiniz.", { exact: true })
    .waitFor();
  assert.equal(await input.inputValue(), "");
  await page.setViewportSize({ width: 320, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const controls = await page
    .locator("#device-settings button, #device-settings input, #device-settings select")
    .evaluateAll((elements) =>
      elements
        .map((element) => {
          const box = element.getBoundingClientRect();
          return {
            label: element.innerText || element.getAttribute("aria-label") || element.tagName,
            left: box.left,
            right: box.right,
            width: box.width,
          };
        })
        .filter((box) => box.width > 0)
    );
  for (const control of controls)
    assert.ok(
      control.left >= 0 && control.right <= 321,
      `QR settings control is clipped: ${JSON.stringify(control)}`
    );
  await page.screenshot({
    path: path.join(output, "qr-address-settings-mobile.png"),
    animations: "disabled",
  });
  await page.getByRole("link", { name: "Masalar ve QR", exact: true }).click();
  network = "http://10.30.40.51:3001";
  await page.getByRole("button", { name: /QR.*Masa 001/i }).click();
  await dialog.getByRole("img", { name: "Masa 001 masası QR menü kodu", exact: true }).waitFor();
  assert.ok(
    (await dialog.locator("code").innerText()).startsWith(network + "/menu/"),
    "QR must refresh the address when opened"
  );
  await page.keyboard.press("Escape");
  unavailable = true;
  await page.reload();
  const qrButton = page.getByRole("button", { name: /QR.*Masa 001/i });
  assert.equal(
    await qrButton.isDisabled(),
    false,
    "missing LAN address must not block management preview"
  );
  await qrButton.click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "Telefonlar için ağ adresi bulunamadı." })
    .waitFor();
  assert.equal(
    await dialog.getByRole("link", { name: "Bağlantıyı aç", exact: true }).getAttribute("href"),
    "/menu/" + token
  );
  assert.equal(
    await dialog.getByRole("button", { name: "QR kodunu A4 yazdır", exact: true }).isDisabled(),
    true
  );
  await page.keyboard.press("Escape");
  failQr = true;
  await qrButton.click();
  await dialog.getByRole("alert").filter({ hasText: "Masa bulunamadı." }).waitFor();
  assert.equal(
    await dialog.getByRole("link", { name: "Bağlantıyı aç", exact: true }).count(),
    0,
    "a rejected table must not retain the previous QR link"
  );
  assert.deepEqual(fixture.failures, []);
  console.log(
    "PASS: real QR canvas generation, current-origin preview, always available address settings and correct settings section"
  );
})()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
    if (page)
      await page
        .screenshot({ path: path.join(output, "qr-management-failure.png"), fullPage: true })
        .catch(() => {});
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
