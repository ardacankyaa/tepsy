const { createFixture, base, output } = require("./fixture.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let browser;
let page;
(async () => {
  const fixture = await createFixture();
  browser = fixture.browser;
  page = fixture.page;
  page.setDefaultTimeout(10000);
  const items = [
    { id: "m0", name: "Kahve", price: 50, categoryId: "c1", isAvailable: true },
    {
      id: "m1",
      name: "Özel hazırlanan uzun isimli yemek ve servis seçenekleri",
      price: 1234567.89,
      categoryId: "c1",
      isAvailable: true,
    },
  ];
  const tables = ["SQUARE", "ROUND"].map((shape, index) => ({
    id: `t${index}`,
    tableNumber: index ? "Yuvarlak 1" : "Kare 1",
    section: "Salon",
    status: "AVAILABLE",
    shape,
    width: 90,
    height: 90,
    capacity: 4,
    posX: 15 + index * 40,
    posY: 35,
    orders: [],
  }));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body;
    if (url.pathname === "/api/tables") body = tables;
    else if (url.pathname === "/api/menu-items") body = items;
    else if (url.pathname === "/api/orders") body = [];
    else if (url.pathname === "/api/floor-plan/canvas")
      body = [{ section: "Salon", width: 400, height: 300 }];
    else if (url.pathname === "/api/public/menu")
      body = {
        restaurant: { name: "Test Restoranı", currency: "₺", defaultLanguage: "tr" },
        table: { label: "Kare 1" },
        categories: [{ id: "c1", name: "Menü" }],
        items,
        orderingEnabled: true,
      };
    else {
      await route.fallback();
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });

  async function checkCart(container, label, expectedPrice = "100,00 ₺") {
    const measurements = await container.locator(".service-draft-line").evaluateAll((lines) =>
      lines.map((line) => {
        const bounds = (el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        };
        return {
          row: bounds(line),
          price: bounds(line.querySelector(".service-line-price")),
          controls: bounds(line.querySelector(".service-quantity-controls")),
          name: bounds(line.querySelector(".service-line-name")),
        };
      })
    );
    assert.equal(measurements.length, 2);
    const overlaps = (a, b) =>
      a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    for (const row of measurements) {
      assert.equal(
        overlaps(row.price, row.controls),
        false,
        `${label}: price overlaps quantity controls: ${JSON.stringify(row)}`
      );
      assert.equal(overlaps(row.name, row.price), false, `${label}: name overlaps price`);
      for (const element of [row.price, row.controls]) {
        assert.ok(
          element.left >= row.row.left - 1 && element.right <= row.row.right + 1,
          `${label}: cart content overflows its row`
        );
        assert.ok(
          element.top >= row.row.top - 1 && element.bottom <= row.row.bottom + 1,
          `${label}: cart content overflows vertically`
        );
      }
    }
    const controls = container
      .locator(".service-draft-line")
      .first()
      .locator(".service-quantity-controls");
    await controls.getByRole("button").last().click();
    assert.equal(await controls.locator("span").innerText(), "2");
    assert.equal(
      await container
        .locator(".service-draft-line")
        .first()
        .locator(".service-line-price")
        .innerText(),
      expectedPrice
    );
    await controls.getByRole("button").first().click();
    assert.equal(await controls.locator("span").innerText(), "1");
    await page.screenshot({ path: path.join(output, `${label}.png`), animations: "disabled" });
  }

  await page.goto(base + "/order/t0");
  await page.getByRole("button", { name: /^Kahve,/ }).click();
  await page
    .getByRole("button", { name: /^Özel hazırlanan uzun isimli yemek ve servis seçenekleri,/ })
    .click();
  await checkCart(page.locator("aside.service-order-dock"), "staff-cart-desktop");
  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    if (width >= 960) {
      await checkCart(page.locator("aside.service-order-dock"), `staff-cart-${width}`);
      continue;
    }
    await page.getByRole("button", { name: /Adisyonu aç/ }).click();
    const cart = page.getByRole("dialog", { name: /Sepet/ });
    await cart.waitFor();
    await checkCart(cart, `staff-cart-${width}`);
    await page.keyboard.press("Escape");
  }

  await page.goto(base + "/menu/" + "a".repeat(48));
  await page.getByRole("button", { name: "Kahve Ekle", exact: true }).click();
  await page.getByRole("button", { name: `${items[1].name} Ekle`, exact: true }).click();
  await page.getByRole("button", { name: /Sepet/ }).first().click();
  const guestCart = page.getByRole("dialog").filter({ visible: true });
  await checkCart(guestCart, "guest-cart-320", "₺100,00");
  await page.setViewportSize({ width: 390, height: 844 });
  await checkCart(guestCart, "guest-cart-390", "₺100,00");
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + "/");
  await page.locator(".table-node-name").first().waitFor();
  const centers = await page.locator(".table-node-name").evaluateAll((names) =>
    names.map((el) => {
      const table = el.closest(".table-node").getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      const text = range.getBoundingClientRect();
      return {
        name: el.textContent,
        offsetX: (text.left + text.right - table.left - table.right) / 2,
      };
    })
  );
  assert.equal(centers.length, 2);
  for (const center of centers)
    assert.ok(
      Math.abs(center.offsetX) <= 1.5,
      `table name is not centered: ${JSON.stringify(center)}`
    );
  await page.screenshot({
    path: path.join(output, "centered-square-and-round.png"),
    animations: "disabled",
  });
  assert.deepEqual(fixture.failures, []);
  console.log(
    "PASS: staff and QR cart prices do not overlap quantity controls at 320–1440px; quantity actions work; square and round names are centered"
  );
})()
  .catch(async (error) => {
    console.error(error);
    if (page && !page.isClosed()) {
      await page
        .screenshot({ path: path.join(output, "cart-layout-failure.png"), animations: "disabled" })
        .catch(() => {});
      fs.writeFileSync(path.join(output, "cart-layout-failure.html"), await page.content());
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
