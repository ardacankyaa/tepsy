const { createFixture, base, output } = require("./fixture.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
let browser, page;
(async () => {
  const fixture = await createFixture();
  browser = fixture.browser;
  page = fixture.page;
  const token = "a".repeat(48);
  const items = [
    {
      id: "coffee",
      name: "Türk Kahvesi",
      description: "İsteğe göre şekerli, sade veya orta. Bakır cezvede hazırlanır.",
      price: 125,
      categoryId: "coffee",
      isAvailable: true,
    },
    {
      id: "dessert",
      name: "Çikolatalı pasta",
      description: "Günlük hazırlanır.",
      price: 200,
      categoryId: "dessert",
      isAvailable: true,
    },
    ...Array.from({ length: 26 }, (_, i) => ({
      id: `other${i}`,
      name: `Diğer ${i}`,
      price: 10,
      categoryId: "dessert",
      isAvailable: true,
    })),
  ];
  let menuFailure = false,
    orderingEnabled = true,
    status = "AWAITING_WAITER_APPROVAL",
    attempts = [],
    serviceCalls = 0,
    withdrawals = 0;
  await page.route("**/api/public/menu?*", (route) =>
    route.fulfill({
      status: menuFailure ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        menuFailure
          ? { error: "offline" }
          : {
              restaurant: { name: "TEPSY Mutfak", currency: "₺", defaultLanguage: "tr" },
              table: { label: "Teras 12" },
              categories: [
                { id: "coffee", name: "Kahveler" },
                { id: "dessert", name: "Tatlılar" },
              ],
              items,
              orderingEnabled,
            }
      ),
    })
  );
  await page.route("**/api/public/orders*", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      attempts.push(request.postData());
      await route.fulfill({
        status: attempts.length === 1 ? 503 : 201,
        contentType: "application/json",
        body: JSON.stringify(
          attempts.length === 1 ? { error: "offline" } : { orderId: "test-order", status }
        ),
      });
    } else if (request.method() === "DELETE") {
      status = "PREPARING";
      withdrawals++;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "already accepted" }),
      });
    } else
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ orderId: "test-order", status }),
      });
  });
  await page.route("**/api/public/service-requests", (route) => {
    serviceCalls++;
    return route.fulfill({
      status: serviceCalls === 1 ? 429 : serviceCalls === 2 ? 202 : 503,
      contentType: "application/json",
      body: JSON.stringify({ retryAfterSeconds: 60 }),
    });
  });
  await page.clock.install();
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/menu/" + token);
  const search = page.getByRole("searchbox", { name: "Menüde ara", exact: true });
  await search.fill("turk kahvesi");
  assert.equal(
    await page.locator(".service-qr-product").count(),
    1,
    "Turkish letters must be searchable with a standard keyboard"
  );
  await page.getByRole("button", { name: "Türk Kahvesi detayları", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Türk Kahvesi", exact: true })
    .getByText(items[0].description, { exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await search.fill("olmayan ürün");
  await page.getByText("Aramanıza uygun ürün bulunamadı.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Filtreleri temizle", exact: true }).click();
  await page.getByRole("button", { name: "Kahveler", exact: true }).click();
  assert.equal(await page.locator(".service-qr-product").count(), 1);
  const add = page.getByRole("button", { name: "Türk Kahvesi Ekle", exact: true });
  for (let i = 0; i < 20; i++) await add.click();
  assert.equal(
    await add.isDisabled(),
    true,
    "server quantity limit should prevent unusable orders"
  );
  await page.locator(".service-qr-mobile-action").getByRole("button", { name: /Sepet/ }).click();
  const cart = page.getByRole("dialog").filter({ visible: true });
  assert.equal(
    await cart.getByRole("button", { name: "Türk Kahvesi artır", exact: true }).isDisabled(),
    true
  );
  assert.ok((await cart.locator(".service-line-price").innerText()).includes("2.500,00"));
  await cart.getByLabel("Sipariş notu (isteğe bağlı)", { exact: false }).fill("Sade olsun");
  assert.equal(await cart.getByLabel("Bahşiş (isteğe bağlı)", { exact: true }).isVisible(), false);
  await cart.locator(".tip-disclosure > summary").click();
  await cart.getByLabel("Bahşiş (isteğe bağlı)", { exact: true }).fill("10,50");
  await cart.locator(".tip-disclosure > summary").click();
  assert.match(await cart.locator(".tip-disclosure > summary").innerText(), /10,50/);
  await cart.getByRole("button", { name: "Siparişi gönder", exact: true }).click();
  await cart.getByRole("button", { name: "Aynı siparişi yeniden dene", exact: true }).waitFor();
  assert.equal(
    await cart.getByRole("button", { name: "Türk Kahvesi azalt", exact: true }).isDisabled(),
    true
  );
  await cart.getByRole("button", { name: "Aynı siparişi yeniden dene", exact: true }).click();
  await page.getByTestId("qr-order-pending").waitFor();
  assert.equal(attempts.length, 2);
  assert.equal(JSON.parse(attempts[0]).tipAmount, "10.50");
  assert.equal(JSON.parse(attempts[1]).tipAmount, "10.50");
  assert.equal(
    attempts[0],
    attempts[1],
    "ambiguous retry must retain the exact order and idempotency key"
  );
  await page.getByRole("button", { name: "İsteği geri çek", exact: true }).click();
  await page
    .getByTestId("qr-order-pending")
    .getByText("Siparişiniz hazırlanıyor.", { exact: true })
    .waitFor();
  assert.equal(withdrawals, 1, "acceptance race must include the actual withdrawal request");
  await page.getByRole("button", { name: "Garson çağır", exact: true }).click();
  await page
    .getByText("İsteğiniz zaten iletildi. Görevli sizinle ilgilenecek.", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Garson çağır", exact: true }).isDisabled(),
    true
  );
  assert.equal(serviceCalls, 1);
  await page.clock.fastForward(61000);
  assert.equal(
    await page.getByRole("button", { name: "Garson çağır", exact: true }).isDisabled(),
    false
  );
  await page.getByRole("button", { name: "Hesap iste", exact: true }).click();
  await page.getByText("Hesap isteği gönderildi.", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Hesap iste", exact: true }).isDisabled(),
    true
  );
  await page.getByRole("button", { name: "Garson çağır", exact: true }).click();
  await page.getByText("İstek gönderilemedi. Lütfen tekrar deneyin.", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Garson çağır", exact: true }).isDisabled(),
    false
  );
  assert.equal(serviceCalls, 3);
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search menu", exact: true }).waitFor();
  await page.getByRole("button", { name: "TR", exact: true }).click();
  await page.getByRole("button", { name: "Tatlılar", exact: true }).click();
  for (let i = 0; i < 25; i++) {
    await search.fill(`Diğer ${i}`);
    await page.getByRole("button", { name: `Diğer ${i} Ekle`, exact: true }).click();
  }
  await search.fill("Diğer 25");
  assert.equal(
    await page.getByRole("button", { name: "Diğer 25 Ekle", exact: true }).isDisabled(),
    true,
    "a 26th distinct product must not produce a rejected order"
  );
  await search.fill("");
  await page.getByRole("button", { name: "Tümü", exact: true }).click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
      `${width}px: page overflows`
    );
    const panel = await page.locator(".service-qr-products-panel").boundingBox();
    const searchBox = await page.locator(".qr-search").boundingBox();
    assert.ok(
      searchBox.width >= panel.width - 44,
      "search should fill the menu panel at every viewport"
    );
    await page.locator(".service-qr-root").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({
      path: path.join(output, `qr-menu-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.locator(".service-qr-root").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({
    path: path.join(output, "qr-menu-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  menuFailure = true;
  await page.reload();
  await page.getByText("Menü şu anda açılamadı.", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Garson çağır", exact: true }).isDisabled(),
    true
  );
  menuFailure = false;
  orderingEnabled = false;
  await page.getByRole("button", { name: "Yeniden dene", exact: true }).click();
  await page.getByText("QR siparişi şu anda kapalı.", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Türk Kahvesi Ekle", exact: true }).isDisabled(),
    true
  );
  assert.deepEqual(fixture.failures, []);
  fs.writeFileSync(
    path.join(output, "qr-menu-results.json"),
    JSON.stringify(
      {
        passed: true,
        failures: fixture.failures,
        viewports: [320, 390, 768, 1440],
        orderAttempts: attempts.length,
        serviceCalls,
      },
      null,
      2
    )
  );
  console.log(
    "PASS: QR search/categories/details, quantity bound, exact retry, acceptance race, service cooldown, languages, error recovery, closed ordering and responsive layout"
  );
})()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
    if (page && !page.isClosed())
      await page
        .screenshot({ path: path.join(output, "qr-menu-failure.png"), fullPage: true })
        .catch(() => {});
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
