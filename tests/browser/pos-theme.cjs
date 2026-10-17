const { createFixture, base } = require("./fixture.cjs");
const assert = require("node:assert/strict");

let browser;
(async () => {
  const fixture = await createFixture();
  browser = fixture.browser;
  const { page, failures } = fixture;

  await page.goto(base + "/pos");
  await page.locator(".operations-pos").waitFor();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });

  const colors = await page.evaluate(() => {
    const style = (selector) => getComputedStyle(document.querySelector(selector));
    return {
      rootBackground: style(".operations-pos").backgroundColor,
      commandBackground: style(".pos-command-bar").backgroundColor,
      panelBackground: style(".pos-table-selector").backgroundColor,
      headingColor: style(".pos-section-heading h2").color,
      colorScheme: style(".operations-pos").colorScheme,
    };
  });

  assert.notEqual(colors.rootBackground, "rgb(245, 245, 247)");
  assert.notEqual(colors.commandBackground, "rgba(255, 255, 255, 0.95)");
  assert.notEqual(colors.panelBackground, "rgb(255, 255, 255)");
  assert.notEqual(colors.headingColor, "rgb(29, 29, 31)");
  assert.equal(colors.colorScheme, "dark");
  assert.deepEqual(failures, []);
  console.log("PASS: cashier surfaces follow dark theme colors");
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
