const { createFixture, base, output } = require("./fixture.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGElEQVQokWNY4K1CEmIY1eA9GkoLsIUBANhzy0HbhIwZAAAAAElFTkSuQmCC",
  "base64"
);
let browser, page;
async function assertPhotoLayout(scope, label) {
  const errors = await scope.evaluate((root) => {
    const errors = [];
    for (const image of root.querySelectorAll(".menu-photo")) {
      const box = image.getBoundingClientRect(),
        parent = image.closest("button,article")?.getBoundingClientRect();
      if (
        parent &&
        (box.left < parent.left - 1 ||
          box.right > parent.right + 1 ||
          box.top < parent.top - 1 ||
          box.bottom > parent.bottom + 1)
      )
        errors.push("image outside product");
      if (box.left < -1 || box.right > innerWidth + 1) errors.push("image outside viewport");
    }
    for (const button of root.querySelectorAll("button")) {
      const box = button.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (
          !node.textContent.trim() ||
          getComputedStyle(node.parentElement).textOverflow === "ellipsis"
        )
          continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const text of range.getClientRects())
          if (
            text.left < box.left - 2 ||
            text.right > box.right + 2 ||
            text.top < box.top - 2 ||
            text.bottom > box.bottom + 2
          )
            errors.push("product control clips: " + node.textContent);
      }
    }
    return errors;
  });
  assert.deepEqual(errors, [], label);
}
(async () => {
  const fixture = await createFixture();
  browser = fixture.browser;
  page = fixture.page;
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.setDefaultTimeout(10000);
  const imageUrl = "/api/public/menu-images/" + "a".repeat(64) + ".webp";
  const categories = [{ id: "c1", name: "Kahveler", icon: "Coffee" }];
  const item = {
    id: "m0",
    name: "Fotoğraflı Türk Kahvesi",
    price: 125,
    categoryId: "c1",
    category: categories[0],
    isAvailable: true,
    imageUrl: null,
  };
  let uploads = 0,
    saves = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === imageUrl) {
      await route.fulfill({ contentType: "image/png", body: png });
      return;
    }
    let data,
      status = 200;
    if (url.pathname === "/api/menu-images") {
      uploads++;
      const body = route.request().postDataBuffer();
      if (!body?.equals(png)) {
        status = 400;
        data = { error: "Fotoğraf okunamadı. PNG, JPEG veya WebP seçin." };
      } else {
        status = 201;
        data = { imageUrl, width: 1, height: 1 };
      }
    } else if (url.pathname === "/api/menu-items") {
      if (method === "PUT") {
        Object.assign(item, route.request().postDataJSON());
        saves++;
        data = item;
      } else data = [item];
    } else if (url.pathname === "/api/categories") data = categories;
    else if (url.pathname === "/api/public/menu")
      data = {
        restaurant: { name: "Fotoğraf Restoranı", currency: "₺", defaultLanguage: "tr" },
        table: { label: "Masa 001" },
        categories,
        items: [item],
        orderingEnabled: true,
      };
    else {
      await route.fallback();
      return;
    }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.goto(base + "/admin/menu");
  await page.getByRole("button", { name: item.name + " · Düzenle", exact: true }).click();
  const edit = page.getByRole("dialog").filter({ visible: true });
  await edit
    .getByLabel("Ürün fotoğrafı", { exact: true })
    .setInputFiles({ name: "coffee.png", mimeType: "image/png", buffer: png });
  await edit.locator(".menu-photo img").waitFor();
  await edit.getByRole("button", { name: "Değişiklikleri Kaydet", exact: false }).click();
  await edit.waitFor({ state: "hidden" });
  assert.equal(item.imageUrl, imageUrl);
  assert.equal(uploads, 1);
  assert.equal(saves, 1);
  await page.reload();
  await page.locator(".menu-photo-admin img").waitFor();
  assert.equal(
    await page.locator(".menu-photo-admin img").getAttribute("src"),
    imageUrl,
    "uploaded photo must survive menu reload"
  );

  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + "/pos");
    if (width >= 1024) await page.getByRole("button", { name: "Liste", exact: true }).click();
    await page.locator(".pos-table-card").first().click();
    await page.getByRole("button", { name: "Ürün ekle", exact: true }).click();
    const picker = page.locator(".pos-menu-dialog");
    const photo = picker.locator(".menu-photo-pos img");
    await photo.waitFor();
    await photo.evaluate((el) => el.decode());
    assert.equal(await photo.getAttribute("src"), imageUrl);
    const photoBox = await photo.boundingBox();
    assert.ok(photoBox.width >= 90 && photoBox.height >= 90, "cashier photos must be recognizable");
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (theme) => document.documentElement.setAttribute("data-theme", theme),
        theme
      );
      await assertPhotoLayout(picker, `POS picker ${width}px ${theme}`);
      await page.screenshot({
        path: path.join(output, `menu-photo-pos-${width}-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.keyboard.press("Escape");
  }

  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + "/order/t0");
    const waiterImage = page.locator(".menu-photo-waiter img");
    await waiterImage.waitFor();
    await waiterImage.evaluate((el) => el.decode());
    assert.equal(await waiterImage.getAttribute("alt"), item.name);
    assert.equal(await waiterImage.getAttribute("src"), imageUrl);
    assert.ok(
      (await waiterImage.boundingBox()).height >= 140,
      "waiter photos must use a large image area"
    );
    await assertPhotoLayout(page.locator(".service-products-panel"), `waiter ${width}px`);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false,
      `waiter ${width}px overflow`
    );
    await page.getByRole("button", { name: new RegExp("^" + item.name + ",") }).click();
    if (width < 1024)
      await page
        .locator(".service-mobile-action-bar")
        .getByRole("button", { name: /Adisyonu aç/ })
        .click();
    const draft = page.locator(".service-draft-line").filter({ visible: true });
    await draft.locator(".service-line-name").filter({ hasText: item.name }).waitFor();
    assert.ok(
      (await draft.locator(".service-line-price").innerText()).includes("125"),
      "adding a photo must preserve ordering"
    );
    await page.goto(base + "/menu/" + "a".repeat(48));
    const qrImage = page.locator(".menu-photo-qr img");
    await qrImage.waitFor();
    await qrImage.evaluate((el) => el.decode());
    assert.equal(await qrImage.getAttribute("src"), imageUrl);
    await assertPhotoLayout(page.locator(".service-qr-products-panel"), `QR ${width}px`);
    await page.getByRole("button", { name: item.name + " detayları", exact: true }).click();
    const details = page.getByRole("dialog", { name: item.name, exact: true });
    await details.locator(".menu-photo-detail img").waitFor();
    assert.equal(await details.locator(".menu-photo-detail img").getAttribute("alt"), item.name);
    await page.keyboard.press("Escape");
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (theme) => document.documentElement.setAttribute("data-theme", theme),
        theme
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
        `QR ${width}px overflow`
      );
      await page.screenshot({
        path: path.join(output, `menu-photo-${width}-${theme}.png`),
        animations: "disabled",
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 320, height: 900 });
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByRole("button", { name: item.name + " details", exact: true }).click();
  const englishDetails = page.getByRole("dialog", { name: item.name, exact: true });
  await englishDetails.locator(".menu-photo-detail img").waitFor();
  await assertPhotoLayout(englishDetails, "English photo details320px");
  await page.screenshot({
    path: path.join(output, "menu-photo-details-en-320.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "TR", exact: true }).click();
  item.imageUrl = "/api/public/menu-images/" + "b".repeat(64) + ".webp";
  await page.route("**/api/public/menu-images/" + "b".repeat(64) + ".webp", (route) =>
    route.fulfill({ status: 404, body: "" })
  );
  await page.reload();
  await page.locator(".menu-photo-qr .menu-photo-placeholder").waitFor();
  assert.equal(
    await page.getByRole("button", { name: item.name + " Ekle", exact: true }).isEnabled(),
    true,
    "missing photo must not disable food ordering"
  );
  await page.goto(base + "/admin/menu");
  await page.getByRole("button", { name: item.name + " · Düzenle", exact: true }).click();
  await edit.getByLabel("Ürün fotoğrafı", { exact: true }).setInputFiles({
    name: "too-large.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await edit.getByRole("alert").waitFor();
  assert.equal(uploads, 1, "oversize files should be rejected before upload");
  await edit.getByLabel("Ürün fotoğrafı", { exact: true }).setInputFiles({
    name: "unsafe.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg></svg>"),
  });
  await edit.getByRole("alert").waitFor();
  assert.equal(uploads, 1, "unsupported formats should be rejected before upload");
  await edit.getByLabel("Ürün fotoğrafı", { exact: true }).setInputFiles({
    name: "invalid.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await edit.getByRole("alert").waitFor();
  assert.equal(saves, 1, "upload rejection must not mutate the catalog");
  assert.equal(
    item.imageUrl,
    "/api/public/menu-images/" + "b".repeat(64) + ".webp",
    "rejected upload must preserve the previously saved photo"
  );
  await edit.getByRole("button", { name: "Fotoğrafı kaldır", exact: true }).click();
  await edit.getByRole("button", { name: "Değişiklikleri Kaydet", exact: false }).click();
  await edit.waitFor({ state: "hidden" });
  assert.equal(item.imageUrl, null, "removing a photo must persist an empty image");
  await page.goto(base + "/menu/" + "a".repeat(48));
  await page.getByRole("button", { name: item.name + " Ekle", exact: true }).waitFor();
  assert.equal(await page.locator(".menu-photo-qr").count(), 0);
  assert.deepEqual(fixture.failures, []);
  fs.writeFileSync(
    path.join(output, "menu-photos-results.json"),
    JSON.stringify(
      { passed: true, uploads, saves, viewports: [320, 390, 1440], failures: fixture.failures },
      null,
      2
    )
  );
  console.log(
    "PASS: photo upload/save/reload, waiter ordering, QR details, dark/mobile layout, broken-image fallback, invalid-upload protection and photo removal"
  );
})()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
    if (page)
      await page
        .screenshot({ path: path.join(output, "menu-photos-failure.png"), fullPage: true })
        .catch(() => {});
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
