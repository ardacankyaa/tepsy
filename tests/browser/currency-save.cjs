const { createFixture, base, output } = require("./fixture.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
let browser;
(async () => {
  const fixture = await createFixture();
  browser = fixture.browser;
  const { page, failures } = fixture;
  let mode = "reject",
    currency = "₺";
  await page.route("**/api/config", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          restaurantName: "Test Restoranı",
          currency,
          defaultLanguage: "tr",
          isSetupCompleted: true,
        }),
      });
    if (mode === "reject")
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Temporary failure" }),
      });
    if (mode === "offline") return route.abort("failed");
    if (mode === "invalid")
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ currency: "invalid" }),
      });
    await new Promise((resolve) => setTimeout(resolve, 400));
    currency = route.request().postDataJSON().currency;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ currency }) });
  });
  await page.goto(base + "/admin");
  const lira = page.getByRole("button", { name: "₺", exact: true });
  const dollar = page.getByRole("button", { name: "$", exact: true });
  await lira.waitFor();
  const failure = page.waitForResponse(
    (r) => r.url().endsWith("/api/config") && r.request().method() === "PUT"
  );
  await dollar.click();
  await failure;
  await page.waitForTimeout(100);
  assert.equal(
    await lira.getAttribute("aria-pressed"),
    "true",
    "Rejected currency save must retain the authoritative currency"
  );
  assert.equal(await page.evaluate(() => localStorage.getItem("tepsy_curr")), "₺");
  await page.getByRole("alert").filter({ hasText: "Para birimi kaydedilemedi" }).waitFor();
  mode = "offline";
  const offlineFailure = page.waitForEvent("requestfailed", {
    predicate: (request) => request.url().endsWith("/api/config") && request.method() === "PUT",
  });
  await dollar.click();
  await offlineFailure;
  await page.getByRole("alert").filter({ hasText: "Para birimi kaydedilemedi" }).waitFor();
  assert.equal(await lira.getAttribute("aria-pressed"), "true");
  mode = "invalid";
  const invalid = page.waitForResponse(
    (r) => r.url().endsWith("/api/config") && r.request().method() === "PUT"
  );
  await dollar.click();
  await invalid;
  await page.waitForTimeout(100);
  assert.equal(await lira.getAttribute("aria-pressed"), "true");
  mode = "success";
  await dollar.click();
  assert.equal(await dollar.isDisabled(), true);
  assert.equal(await lira.isDisabled(), true);
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      (button) =>
        button.textContent.trim() === "$" &&
        button.getAttribute("aria-pressed") === "true" &&
        !button.disabled
    )
  );
  assert.equal(await page.evaluate(() => localStorage.getItem("tepsy_curr")), "$");
  assert.equal(await page.evaluate(() => localStorage.getItem("restopos_curr")), "$");
  await page.reload();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      (button) =>
        button.textContent.trim() === "$" && button.getAttribute("aria-pressed") === "true"
    )
  );
  assert.equal(await dollar.getAttribute("aria-pressed"), "true");
  await page.setViewportSize({ width: 320, height: 640 });
  mode = "reject";
  const mobileFailure = page.waitForResponse(
    (r) => r.url().endsWith("/api/config") && r.request().method() === "PUT"
  );
  await lira.click();
  await mobileFailure;
  await page.getByRole("alert").filter({ hasText: "Para birimi kaydedilemedi" }).waitFor();
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "Currency error controls fit a narrow phone"
  );
  const settings = page.getByRole("link", { name: "İşletme ayarları", exact: true });
  assert.equal(await settings.getAttribute("href"), "/admin/settings#business");
  assert.deepEqual(failures, []);
  fs.writeFileSync(
    path.join(output, "currency-save-results.json"),
    JSON.stringify(
      {
        passed: true,
        checks: [
          "rejected/offline/invalid saves retain actual currency",
          "pending save locks controls",
          "successful save persists after reload",
        ],
      },
      null,
      2
    )
  );
  console.log(
    "PASS: currency saves retain server state on errors, lock while pending and persist on confirmed success"
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
