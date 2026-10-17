const { createFixture, base, output } = require("./fixture.cjs");
const assert = require("node:assert/strict");
let browser;
(async () => {
  const fixture = await createFixture();
  browser = fixture.browser;
  const { page, failures } = fixture;

  page.setDefaultTimeout(5000);
  await page.goto(base + "/");
  await page.locator(".table-node").first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Krokiyi düzenle", exact: true }).count(), 0);
  assert.equal(await page.locator('a[href="/?layout=1"]').count(), 0);
  await page.locator("#owner-section").selectOption("ALL");
  assert.equal(await page.locator(".floorplan-viewport").count(), 1);
  await page.getByRole("button", { name: "Bölümler Sonraki sayfa" }).click();
  await page.getByRole("heading", { name: "Salon", exact: true, level: 3 }).waitFor();
  await page.goto(base + "/admin/floorplan");
  await page.getByRole("heading", { name: "Kroki düzenleyici", exact: true }).waitFor();
  let box = await page.locator(".floorplan-viewport").boundingBox();
  assert.ok(box.height > 480, JSON.stringify(box));
  await page.getByText("Salon ölçüleri", { exact: true }).click();
  await page.getByRole("spinbutton", { name: "Salon genişliği", exact: true }).waitFor();
  await page.getByText("Salon ölçüleri", { exact: true }).click();
  await page.getByText("Masa ve dekor ekle", { exact: true }).click();
  await page.getByRole("button", { name: "Masa ekle", exact: true }).waitFor();
  await page.getByText("Masa ve dekor ekle", { exact: true }).click();

  await page.locator(".table-node").first().press("ArrowRight");
  await page.waitForFunction(
    () => document.querySelector("#owner-section")?.disabled === true,
    null,
    { timeout: 5000 }
  );
  assert.equal(
    await page.locator("#owner-section").isDisabled(),
    true,
    "dirty section change must be blocked"
  );
  await page.getByRole("button", { name: "Sıfırla", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#owner-section")?.disabled === false,
    null,
    { timeout: 5000 }
  );
  assert.equal(await page.locator("#owner-section").isDisabled(), false);
  await page.locator(".table-node").first().press("Enter");
  await page.locator(".floor-table-properties").waitFor();
  box = await page.locator(".floorplan-viewport").boundingBox();
  assert.ok(box.height > 480, "properties must not shrink canvas");
  await page
    .locator(".floor-table-properties")
    .getByRole("button", { name: "Kapat", exact: true })
    .click();
  await page.screenshot({ path: output + "/editor-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: output + "/editor-mobile.png" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  box = await page.locator(".floorplan-viewport").boundingBox();
  assert.ok(box.height > 250, JSON.stringify(box));
  assert.deepEqual(failures, []);
  console.log(
    "PASS: management-only editor, roomy section paging, editor canvas, expandable tools, mobile overflow"
  );
  await browser.close();
})().catch(async (e) => {
  console.error(e);
  if (browser) await browser.close();
  process.exitCode = 1;
});
