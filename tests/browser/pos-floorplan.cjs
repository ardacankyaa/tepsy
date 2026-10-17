const { createFixture, base } = require("./fixture.cjs");
const assert = require("node:assert/strict");

let browser;
(async () => {
  const fixture = await createFixture();
  browser = fixture.browser;
  const { page, failures } = fixture;
  await page.goto(base + "/pos");
  await page.locator(".pos-floorplan-panel .floorplan-viewport").waitFor();
  const desktop = await page.evaluate(() => ({
    main: document.querySelector(".pos-main").getBoundingClientRect().width,
    plan: document.querySelector(".pos-table-selector").getBoundingClientRect().width,
  }));
  assert.ok(
    desktop.plan >= desktop.main * 0.45,
    `floor plan is cramped: ${desktop.plan}/${desktop.main}`
  );
  const fullscreen = page.getByRole("button", { name: "Krokiyi tam ekranda göster" });
  await fullscreen.click();
  assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), true);
  await page.getByRole("button", { name: "Tam ekrandan çık" }).click();
  assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), false);

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole("button", { name: "Kroki", exact: true }).waitFor();
  assert.equal(await page.locator(".pos-floorplan-panel").isVisible(), true);
  await page.getByRole("button", { name: "Liste", exact: true }).click();
  assert.equal(await page.locator(".pos-mobile-table-list").isVisible(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator(".pos-mobile-table-list").isVisible(), true);
  assert.deepEqual(failures, []);
  console.log("PASS: cashier floor plan has usable width, fullscreen, and tablet/list fallbacks");
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
