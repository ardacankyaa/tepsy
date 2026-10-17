const { createFixture, base, output } = require("./fixture.cjs");
const fs = require("node:fs");
const assert = require("node:assert/strict");
let browser;
(async () => {
  const fixture = await createFixture();
  browser = fixture.browser;
  const { page, failures, shots } = fixture;

  await page.goto(base + "/admin/menu");
  await page.getByText("Ürün 001", { exact: true }).waitFor();
  await page.getByRole("combobox", { name: "Sayfaya git" }).selectOption("38");
  await page.getByText("Ürün 300", { exact: true }).waitFor();
  await page.getByRole("searchbox").fill("Ürün 299");
  await page.getByText("Ürün 299", { exact: true }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 1);
  const opener = page.getByRole("button", { name: /Yeni Kategori/ });
  await opener.click();
  await page.getByRole("dialog", { name: /Kategori/ }).waitFor();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => !!document.activeElement.closest("dialog[open]")), true);
  }
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await opener.evaluate((el) => el === document.activeElement), true);
  await page.goto(base + "/admin/settings");
  await page.getByRole("button", { name: "QR ve cihazlar", exact: true }).click();
  await page.locator("#device-settings:visible").waitFor();
  assert.equal(await page.locator("#business-identity:visible").count(), 0);
  await page.goto(base + "/order/t0");
  const orderBodies = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/orders" && request.method() === "POST")
      orderBodies.push(request.postData());
  });
  const dock = page.locator("aside.service-order-dock");
  const retryNotice =
    "Sipariş sonucu doğrulanamadı. Aynı taslağı yeniden gönderin; içeriği kilitli.";
  async function assertLockedDraft(container) {
    await container.getByRole("status").filter({ hasText: retryNotice }).waitFor();
    await container.locator(".service-submit-order:enabled").waitFor();
    const note = container.getByPlaceholder("Mutfağa iletilecek not");
    assert.equal(await note.inputValue(), "Test servis notu");
    assert.equal(await note.isDisabled(), true, "uncertain order note must remain locked");
    assert.equal(await container.locator(".service-draft-line").count(), 2);
    assert.deepEqual(
      await container.locator(".service-draft-line .service-line-quantity").allTextContents(),
      ["1", "1"]
    );
    assert.equal(
      await container.locator(".service-quantity-controls button:enabled").count(),
      0,
      "uncertain order quantities must remain locked"
    );
    assert.equal(
      await container.locator(".service-cart-heading button").isDisabled(),
      true,
      "uncertain draft cannot be cleared"
    );
    assert.equal(
      await page.locator(".service-product-tile").filter({ hasText: "Ürün 003" }).isDisabled(),
      true,
      "uncertain order cannot accept extra products"
    );
    assert.equal(
      await container
        .getByRole("button", { name: "Siparişi yeniden dene", exact: true })
        .isEnabled(),
      true
    );
  }
  async function retrySameOrder(container) {
    const response = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/orders" && response.request().method() === "POST"
    );
    await container.getByRole("button", { name: "Siparişi yeniden dene", exact: true }).click();
    assert.equal((await response).status(), 409);
    await assertLockedDraft(container);
    assert.equal(
      orderBodies.at(-1),
      orderBodies[0],
      "retry must send the identical body and idempotency key"
    );
  }
  await page.getByRole("button", { name: /^Ürün 001,/ }).click();
  await page.getByRole("button", { name: /^Ürün 002,/ }).click();
  await page
    .getByPlaceholder("Mutfağa iletilecek not")
    .filter({ visible: true })
    .fill("Test servis notu");
  const firstResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/orders" && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: /SİPARİŞİ MUTFAĞA GÖNDER/i }).click();
  assert.equal((await firstResponse).status(), 409);
  await assertLockedDraft(dock);
  assert.ok(JSON.parse(orderBodies[0]).idempotencyKey, "order attempt must include a retry key");
  await retrySameOrder(dock);
  await page.reload({ waitUntil: "networkidle" });
  await assertLockedDraft(dock);
  await retrySameOrder(dock);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /Adisyonu aç/ }).click();
  const cart = page.getByRole("dialog", { name: /Sepet/ });
  await cart.waitFor();
  await assertLockedDraft(cart);
  await retrySameOrder(cart);
  assert.equal(orderBodies.length, 4, "initial send and three retries expected");
  await page.waitForTimeout(300);
  await page.screenshot({ path: output + "/cart-open-mobile.png" });
  shots.push("cart-open-mobile.png");
  const rect = await cart
    .getByRole("button", { name: "Siparişi yeniden dene", exact: true })
    .boundingBox();
  console.log("retry rect", rect);
  assert.ok(rect.y >= 0 && rect.y + rect.height <= 844, "retry button out of viewport");
  await page.keyboard.press("Escape");
  await page.goto(base + "/privacy");
  await page.getByRole("button", { name: "Switch to English" }).click();
  await page.getByRole("heading", { name: "Privacy and data use" }).waitFor();
  console.log(
    "PASS: last item, global search, dialog focus trap/restore, settings sections, uncertain order locks draft/note, identical retries after refresh and on mobile, bilingual privacy"
  );
  fs.writeFileSync(
    output + "/interaction-results.json",
    JSON.stringify(
      {
        failures,
        shots,
        orderAttempts: orderBodies.length,
        identicalRetryBodies: orderBodies.every((body) => body === orderBodies[0]),
      },
      null,
      2
    )
  );
  console.log(JSON.stringify({ failures, shots: shots.length }));
  await browser.close();
  if (failures.length) process.exitCode = 1;
})().catch(async (e) => {
  console.error(e);
  if (browser) await browser.close();
  process.exitCode = 1;
});
