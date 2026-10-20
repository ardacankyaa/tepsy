const { createFixture, base, output } = require("./fixture.cjs");
const assert = require("node:assert/strict");
(async () => {
  const f = await createFixture();
  const { page, browser, failures } = f;
  let elements = [
    {
      id: "floor-qa-wall",
      section: "Salon",
      type: "WALL",
      label: "QA wall",
      posX: 15,
      posY: 15,
      width: 180,
      height: 14,
      rotation: 0,
    },
  ];
  let table = {
    id: "tip-table",
    tableNumber: "TIP-1",
    section: "Salon",
    status: "OCCUPIED",
    capacity: 4,
    orders: [
      {
        id: "o1",
        status: "DELIVERED",
        totalPrice: 180,
        discountAmount: 0,
        tipAmount: 10,
        payments: [],
        itemPaymentsAvailable: true,
        items: [
          {
            id: "sandwich",
            orderId: "o1",
            quantity: 1,
            remainingQuantity: 1,
            unitPrice: 100,
            menuItemName: "Club sandwich",
          },
          {
            id: "lemonade",
            orderId: "o1",
            quantity: 1,
            remainingQuantity: 1,
            unitPrice: 50,
            menuItemName: "Limonata",
          },
          {
            id: "espresso",
            orderId: "o1",
            quantity: 1,
            remainingQuantity: 1,
            unitPrice: 30,
            menuItemName: "Espresso",
          },
        ],
      },
    ],
  };
  let posted;
  await page.route("**/api/floor-elements", async (r) => {
    if (r.request().method() === "PUT") elements = r.request().postDataJSON().elements;
    await r.fulfill({ json: elements });
  });
  await page.route("**/api/tables/layout", (r) => r.fulfill({ json: { success: true } }));
  await page.route("**/api/floor-plan/canvas", (r) =>
    r.fulfill({ json: [{ section: "Salon", width: 1440, height: 900 }] })
  );
  try {
    await page.goto(base + "/admin/floorplan");
    const wall = page.getByRole("button", { name: "QA wall, kroki öğesi", exact: true });
    await wall.click();
    for (let i = 0; i < 6; i++)
      await page.getByRole("button", { name: "Sağa 15 derece döndür", exact: true }).click();
    const angle = () =>
      wall.evaluate((e) => ({ transform: e.style.transform, rotate: getComputedStyle(e).rotate }));
    let a = await angle();
    assert.ok(a.transform.includes("90deg") || a.rotate === "90deg", JSON.stringify(a));
    await page.getByRole("spinbutton", { name: "Öğe açısı", exact: true }).fill("135");
    a = await angle();
    assert.equal(a.rotate, "135deg");
    await page.getByRole("spinbutton", { name: "Öğe açısı", exact: true }).fill("90");
    const before = await wall.boundingBox();
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 + 35, before.y + before.height / 2 + 20, {
      steps: 4,
    });
    await page.mouse.up();
    const after = await wall.boundingBox();
    assert.ok(
      Math.abs(after.x - before.x - 35) < 2 && Math.abs(after.y - before.y - 20) < 2,
      JSON.stringify({ before, after })
    );
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/floor-elements") && r.request().method() === "GET"
      ),
      page.getByRole("button", { name: "Krokiyi Kaydet", exact: true }).click(),
    ]);
    assert.equal(elements[0].rotation, 90);
    await page.reload();
    await wall.waitFor();
    a = await angle();
    assert.ok(a.transform.includes("90deg") || a.rotate === "90deg", JSON.stringify(a));
    await page.screenshot({ path: output + "/rotation-90.png", fullPage: true });
    await page.route("**/api/tables", (r) => r.fulfill({ json: [table] }));
    await page.route("**/api/pos/payments?*", (r) =>
      r.fulfill({
        json: {
          payments: [],
          totals: { cash: "0.00", card: "0.00", other: "0.00", total: "0.00", paymentCount: 0 },
          account: {
            grossTotal: "180.00",
            discountAmount: "0.00",
            totalPaid: table.orders[0].payments.length ? "150.00" : "0.00",
            remainingBalance: table.orders[0].payments.length ? "30.00" : "180.00",
            remainingTipAmount: table.orders[0].payments.length ? "0.00" : "10.00",
          },
        },
      })
    );
    await page.route("**/api/pos/payment", async (r) => {
      posted = r.request().postDataJSON();
      for (const i of table.orders[0].items)
        if (posted.selectedItems.some((s) => s.orderItemId === i.id)) i.remainingQuantity = 0;
      table.orders[0].payments = [{ amountPaid: 150, tipAmount: 10 }];
      await r.fulfill({
        json: {
          amountPaid: "150.00",
          remainingBalance: "30.00",
          receipt: {
            id: "paid-1",
            kind: "PAYMENT",
            tableId: table.id,
            items: [],
            amountPaid: "150.00",
            tipAmount: "10.00",
            collectedTotal: "160.00",
            remainingBalance: "30.00",
          },
        },
      });
    });
    await page.goto(base + "/pos");
    await page
      .getByRole("button", { name: "Masa listesi", exact: true })
      .click()
      .catch(() => {});
    await page.getByRole("button", { name: /TIP-1/ }).first().click();
    const tip = page.getByLabel("Bahşiş (isteğe bağlı)", { exact: true });
    assert.equal(await tip.isVisible(), false, "tip editor starts collapsed");
    const tipDisclosure = page.locator(".pos-payment-panel .tip-disclosure");
    assert.match(await tipDisclosure.locator("summary").innerText(), /10,00/);
    await tipDisclosure.locator("summary").click();
    assert.equal(Number(await tip.inputValue()), 10);
    await tipDisclosure.locator("summary").click();
    const optionsButton = page.getByRole("button", {
      name: "Hesabı böl / özel ödeme",
      exact: true,
    });
    await optionsButton.click();
    const options = page.getByRole("dialog", { name: "Ödemeyi düzenle", exact: true });
    await options.waitFor();
    for (const name of ["Hesabı eşit böl", "Özel ödeme", "Ürün seçerek öde"])
      assert.equal(await options.getByRole("radio", { name, exact: true }).isVisible(), true);
    await options.getByRole("radio", { name: "Özel ödeme", exact: true }).check();
    await options.getByRole("textbox", { name: "Kısmi ödeme tutarı", exact: true }).fill("20");
    await options.getByRole("radio", { name: "Ürün seçerek öde", exact: true }).check();
    await page.getByRole("combobox", { name: "Ödenecek adet: Club sandwich" }).selectOption("1");
    await page.getByRole("combobox", { name: "Ödenecek adet: Limonata" }).selectOption("1");
    await options.getByRole("button", { name: "Tamam", exact: true }).click();
    await optionsButton.click();
    assert.equal(
      await options.getByRole("combobox", { name: "Ödenecek adet: Club sandwich" }).inputValue(),
      "1"
    );
    await page.screenshot({
      path: output + "/selected-items-desktop.png",
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 320, height: 740 });
    await page
      .getByRole("combobox", { name: "Ödenecek adet: Club sandwich" })
      .scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false
    );
    const doneBounds = await options
      .getByRole("button", { name: "Tamam", exact: true })
      .boundingBox();
    assert.ok(
      doneBounds.y >= 0 && doneBounds.y + doneBounds.height <= 740,
      "payment actions stay visible on mobile"
    );
    await page.screenshot({
      path: output + "/selected-items-mobile.png",
      fullPage: true,
      animations: "disabled",
    });
    await options.getByRole("button", { name: "Tamam", exact: true }).click();
    await page.locator(".pos-method-cash").click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await tip.inputValue(), "0");
    assert.deepEqual(posted.selectedItems, [
      { orderItemId: "sandwich", quantity: 1 },
      { orderItemId: "lemonade", quantity: 1 },
    ]);
    assert.equal(posted.tipAmount, "10.00");
    assert.equal(posted.amountPaid, undefined);
    assert.deepEqual(failures, []);
    console.log(
      "PASS rotation save/reload, item selection, tip prefill, mobile layout and payment payload"
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
