const { createFixture, base } = require("./fixture.cjs");
const assert = require("node:assert/strict");
let browser;
(async () => {
  const fixture = await createFixture();
  browser = fixture.browser;
  const { page, failures } = fixture;
  await page.goto(base + "/order");
  await require("./payment-check.cjs")(page);
  assert.deepEqual(failures, []);
  console.log("PASS: payment and printer error boundaries");
  await browser.close();
})().catch(async (e) => {
  console.error(e);
  if (browser) await browser.close();
  process.exitCode = 1;
});
