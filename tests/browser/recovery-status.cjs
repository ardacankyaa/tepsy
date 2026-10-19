const { createFixture, base, output } = require("./fixture.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
let browser;
(async () => {
  const fixture = await createFixture({ viewport: { width: 320, height: 640 } });
  browser = fixture.browser;
  const { page, failures } = fixture;
  const savedPlan = { enabled: false, intervalHours: 24, copyDirectory: "" };
  let mode = "503",
    pending,
    gets = 0,
    writes = 0;
  await page.route("**/api/backup/recovery**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      writes++;
      mode = "503";
      if (new URL(request.url()).searchParams.get("action") === "create")
        return route.fulfill({
          contentType: "application/zip",
          headers: { "content-disposition": 'attachment; filename="test-recovery.zip"' },
          body: Buffer.from("disposable test archive"),
        });
      Object.assign(savedPlan, request.postDataJSON());
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ plan: savedPlan }),
      });
    }
    gets++;
    if (pending) await pending;
    if (mode === "offline") return route.abort("failed");
    if (mode === "json")
      return route.fulfill({ contentType: "application/json", body: "{invalid-json" });
    if (["503", "403", "401"].includes(mode))
      return route.fulfill({
        status: Number(mode),
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic status error" }),
      });
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        mode === "invalid"
          ? []
          : { plan: savedPlan, status: { filename: "prior-recovery.zip" }, running: false }
      ),
    });
  });
  let release;
  pending = new Promise((resolve) => (release = resolve));
  await page.goto(base + "/admin/settings#recovery-history");
  const panel = page.getByRole("region", { name: "Tam yedek ve kurtarma", exact: true });
  await panel.getByText("Yedek durumu yükleniyor…", { exact: true }).waitFor();
  assert.equal(await panel.getByText(/işletme sahibi olarak giriş yapın/).count(), 0);
  release();
  pending = undefined;
  const retry = () => panel.getByRole("button", { name: "Yeniden dene", exact: true });
  await panel.getByRole("alert").filter({ hasText: "Yedek durumu alınamadı" }).waitFor();
  assert.equal(await panel.getByText(/işletme sahibi olarak giriş yapın/).count(), 0);
  for (const failureMode of ["invalid", "json", "offline"]) {
    mode = failureMode;
    const previousGets = gets;
    await retry().click();
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === "Yeniden dene"
      );
      return button && !button.disabled;
    });
    assert.ok(gets > previousGets, "Status retry sends another GET");
    await panel.getByRole("alert").waitFor();
  }
  mode = "success";
  await retry().click();
  const interval = panel.getByLabel("Yedek aralığı (saat)", { exact: true });
  await interval.waitFor();
  await interval.fill("12");
  await panel.getByRole("button", { name: "Yedek planını kaydet", exact: true }).click();
  await panel.getByRole("status").filter({ hasText: "Yedek planı kaydedildi." }).waitFor();
  await panel.getByRole("alert").waitFor();
  assert.equal(
    await panel.getByText("prior-recovery.zip", { exact: true }).isVisible(),
    true,
    "Failed refresh preserves the last valid backup status"
  );
  assert.equal(await interval.inputValue(), "12", "Failed refresh preserves the saved plan");
  await interval.fill("18");
  mode = "success";
  await retry().click();
  await panel.getByRole("alert").waitFor({ state: "hidden" });
  assert.equal(await interval.inputValue(), "18", "Status refresh preserves an unsaved draft");
  assert.equal(writes, 1, "Status retry never repeats the plan POST");
  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Tam yedek oluştur ve indir", exact: true }).click();
  assert.equal((await download).suggestedFilename(), "test-recovery.zip");
  await panel.getByRole("status").filter({ hasText: "Doğrulanmış tam yedek indirildi." }).waitFor();
  await panel.getByRole("alert").waitFor();
  mode = "success";
  await retry().click();
  await panel.getByRole("alert").waitFor({ state: "hidden" });
  assert.equal(writes, 2, "Status retry never creates a second archive");
  for (const status of ["403", "401"]) {
    mode = status;
    await page.reload();
    await panel.getByText(/işletme sahibi olarak giriş yapın/).waitFor();
    assert.equal(await interval.count(), 0, "Denied access hides owner controls");
    assert.equal(await panel.getByRole("alert").count(), 0, "Denial is distinct from a load error");
  }
  mode = "503";
  await page.evaluate(() => {
    localStorage.setItem("tepsy_lang", "en");
    localStorage.setItem("restopos_lang", "en");
  });
  await page.reload();
  const english = page.getByRole("region", { name: "Full backup and recovery", exact: true });
  await english
    .getByRole("alert")
    .filter({ hasText: "Backup status could not be loaded" })
    .waitFor();
  await english.getByRole("button", { name: "Try again", exact: true }).waitFor();
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "Localized status errors and retry fit a narrow phone"
  );
  await page.screenshot({ path: path.join(output, "recovery-status-mobile.png"), fullPage: true });
  assert.deepEqual(failures, []);
  fs.writeFileSync(
    path.join(output, "recovery-status-results.json"),
    JSON.stringify(
      {
        passed: true,
        checks: [
          "loading, denied and unavailable status are distinct",
          "503, malformed and offline responses can retry status",
          "successful plan and archive retain success after a failed refresh",
          "status retries preserve drafts and never repeat mutations",
          "Turkish and English errors fit 320px",
        ],
      },
      null,
      2
    )
  );
  console.log(
    "PASS: recovery status errors retry safely without losing saved operations or drafts"
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
