const { createFixture, base, output } = require("./fixture.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
let browser;
(async () => {
  const fixture = await createFixture({ hasTouch: true });
  browser = fixture.browser;
  const { page, failures } = fixture;
  let config = {
    receiptPrinter: { enabled: false, adapter: "BROWSER", charsPerLine: 42 },
    paymentTerminal: { enabled: false, adapter: "MANUAL" },
    network: {},
  };
  let transferFails = true,
    transfers = 0,
    confirmed = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    let data,
      status = 200;
    if (url.pathname === "/api/devices") {
      if (request.method() === "PUT") config = request.postDataJSON();
      data = { config };
    } else if (url.pathname === "/api/devices/payment/status") {
      data = {
        success: true,
        status: {
          implemented: true,
          canTransferBasket: true,
          canInitiatePayment: false,
          connected: false,
          sections: [
            { sectionNo: 1, name: "İçecek", taxPercent: 1000 },
            { sectionNo: 2, name: "Yiyecek", taxPercent: 1000 },
          ],
          message: "QA fiscal parameters read",
        },
      };
    } else if (url.pathname === "/api/pos/terminal") {
      transfers++;
      const transferRequest = request.postDataJSON();
      assert.equal(typeof transferRequest.tableId, "string");
      assert.equal(transferRequest.paymentMethod, "CREDIT_CARD");
      for (const field of ["items", "totalPrice", "unitPrice", "totalAmount"])
        assert.equal(
          Object.hasOwn(transferRequest, field),
          false,
          "Item prices must come from the server"
        );
      status = transferFails ? 503 : 200;
      data = transferFails
        ? { accepted: false, error: "QA aktarım başarısız" }
        : {
            accepted: true,
            basketID: "qa-basket",
            isReplay: transfers > 1,
            paymentApproved: false,
          };
    } else if (url.pathname === "/api/pos/payment") {
      const body = request.postDataJSON();
      if (!body.manualCardConfirmed) {
        status = 409;
        data = { code: "manual-card-confirmation-required", terminalBasketTransferRequired: true };
      } else {
        confirmed++;
        data = {
          success: true,
          cardVerification: "MANUAL",
          orders: [],
          table: { id: body.tableId, status: "AVAILABLE" },
          receipt: {
            id: "qa-payment",
            receiptNumber: "TPS-QA",
            kind: "PAYMENT",
            snapshotKind: "PAYMENT_SNAPSHOT",
            restaurantName: "Test Restoranı",
            currency: "₺",
            items: [{ name: "Çay", quantity: 2, unitPrice: "50.00" }],
            amountPaid: "100.00",
            totalAmount: "100.00",
            grossTotal: "100.00",
            discountAmount: "0.00",
            netTotal: "100.00",
            remainingBalance: "0.00",
            paymentMethod: "CREDIT_CARD",
            timestamp: new Date().toISOString(),
          },
        };
      }
    } else {
      await route.fallback();
      return;
    }
    await route.fulfill({ status, json: data });
  });
  await page.goto(base + "/login");
  await page.evaluate(() => localStorage.setItem("tepsy_lang", "tr"));
  await page.goto(base + "/admin/settings");
  await page.getByRole("button", { name: "QR ve cihazlar", exact: true }).click();
  const panel = page.locator("#device-settings");
  await panel
    .getByRole("combobox", { name: "Entegrasyon", exact: true })
    .selectOption("TOKENX_CLOUD");
  await panel.getByRole("textbox", { name: /Cihaz mali numarası/ }).fill("AV0000000001");
  await panel.getByRole("button", { name: "Cihaz kısımlarını al", exact: true }).click();
  await panel.getByText("Adisyon aktarımı hazır", { exact: true }).waitFor();
  await panel.getByRole("combobox", { name: "Kahveler", exact: true }).selectOption("1");
  await panel.getByRole("combobox", { name: "Yemekler", exact: true }).selectOption("2");
  await panel.locator("header").getByRole("button", { name: "Kaydet", exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector("#device-settings header button:disabled")
  );
  assert.deepEqual(config.paymentTerminal.categorySections, [
    { category: "Kahveler", sectionNo: 1 },
    { category: "Yemekler", sectionNo: 2 },
  ]);
  await page.reload();
  await page.getByRole("button", { name: "QR ve cihazlar", exact: true }).click();
  assert.equal(
    await panel.getByRole("combobox", { name: "Kahveler", exact: true }).inputValue(),
    "1"
  );
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await panel.getByRole("textbox", { name: /Cihaz mali numarası/ }).scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false
    );
    await page.screenshot({
      path: path.join(output, `tokenx-settings-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(base + "/pos");
  await page.getByRole("button", { name: "Liste", exact: true }).click();
  await page.locator(".pos-table-card").filter({ hasText: "Masa 001" }).first().click();
  const card = page.getByRole("button", { name: "KREDİ KARTI", exact: true });
  const dialog = page.getByRole("dialog", { name: "Manuel kart kaydını onayla", exact: true });
  await card.click();
  await page.getByRole("alert").filter({ hasText: "QA aktarım başarısız" }).waitFor();
  assert.equal(await dialog.count(), 0);
  assert.equal(confirmed, 0);
  transferFails = false;
  await card.click();
  await dialog.waitFor();
  assert.equal(confirmed, 0, "Sending a basket must not record a payment");
  await dialog.getByRole("button", { name: "Vazgeç", exact: true }).click();
  assert.equal(confirmed, 0);
  await card.click();
  await dialog.waitFor();
  const beforeConfirm = transfers;
  await dialog.getByRole("button", { name: "Harici terminalde tahsil ettim", exact: true }).click();
  await page.locator("#printable-receipt").waitFor();
  assert.equal(confirmed, 1);
  assert.equal(transfers, beforeConfirm, "Confirmation must not dispatch another basket");
  assert.deepEqual(failures, []);
  fs.writeFileSync(
    path.join(output, "tokenx-results.json"),
    JSON.stringify({ passed: true, transfers, confirmed, pageErrors: failures }, null, 2)
  );
  console.log(
    "PASS: TokenX settings persist, mobile layout fits, transfer failure blocks confirmation, successful export never auto-approves payment"
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  if (browser) await browser.close();
  process.exitCode = 1;
});
