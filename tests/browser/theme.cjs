const { createFixture, base, output } = require("./fixture.cjs");
const assert = require("node:assert/strict");
let browser;
(async () => {
  const fixture = await createFixture();
  browser = fixture.browser;
  const { page, failures } = fixture;

  page.setDefaultTimeout(5000);
  await page.goto(base + "/");
  await page
    .getByRole("button", { name: "Görünüm ve tercihler", exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole("button", { name: "Koyu", exact: true }).click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("heading", { name: "Günün salonu" }).waitFor();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  assert.equal(
    await page
      .locator(".workspace-topbar .nav-connection, .workspace-topbar .transparency-toggle")
      .count(),
    0
  );
  assert.equal(await page.locator("#owner-section").inputValue(), "Salon");
  const floor = await page.locator(".floorplan-viewport").boundingBox();
  assert.ok(floor.width > 700 && floor.height > 430, JSON.stringify(floor));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: output + "/theme-" + width + ".png" });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false
    );
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  for (const route of [
    "/order",
    "/order/t0",
    "/pos",
    "/admin/settings",
    "/admin/menu",
    "/privacy",
  ]) {
    await page.goto(base + route);
    await page.waitForTimeout(150);
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
      "rgb(23, 24, 28)"
    );
  }
  await page.goto(base + "/");
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole("button", { name: "Gezinmeyi aç" }).click();
  await page
    .getByRole("button", { name: "Görünüm ve tercihler", exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole("button", { name: "Açık", exact: true }).click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".service-plan-canvas")
      .evaluate((el) => getComputedStyle(el).animationDuration),
    "1e-05s"
  );
  assert.deepEqual(failures, []);
  console.log(
    "PASS: theme persistence, uncluttered header, larger floor plan, mobile preferences, reduced motion"
  );
  await browser.close();
})().catch(async (e) => {
  console.error(e);
  if (browser) await browser.close();
  process.exitCode = 1;
});
