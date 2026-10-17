const { createFixture, base } = require("./fixture.cjs");
const assert = require("node:assert/strict");

let browser;
(async () => {
  const fixture = await createFixture();
  browser = fixture.browser;
  const { page, failures } = fixture;
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "confirm") await dialog.accept();
    else if (dialog.type() === "prompt") await dialog.accept("TEPSY");
  });
  await page.goto(base + "/admin");
  const resetRequest = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/reset" && request.method() === "POST"
  );
  await page.getByRole("button", { name: "Sıfırla", exact: true }).click();
  const body = JSON.parse((await resetRequest).postData());
  assert.deepEqual(body, { mode: "CLEAN", confirmation: "TEPSY" });
  await page
    .getByRole("alert")
    .filter({ hasText: "Sentetik test: değişiklik kaydedilmedi." })
    .waitFor();
  assert.deepEqual(failures, []);
  console.log("PASS: reset requires typed confirmation and reports the server failure");
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
