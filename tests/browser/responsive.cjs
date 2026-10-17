const { createFixture, base, output } = require("./fixture.cjs");
const fs = require("node:fs");
let browser;
(async () => {
  const fixture = await createFixture();
  browser = fixture.browser;
  const { page, failures, shots } = fixture;
  for (const [route, name] of [
    ["/", "salon"],
    ["/order", "masalar"],
    ["/order/t0", "siparis"],
    ["/kitchen", "mutfak"],
    ["/pos", "kasa"],
    ["/admin", "yonetim"],
    ["/admin/menu", "menu"],
    ["/admin/tables", "masa-yonetimi"],
    ["/admin/floorplan", "yerlesim"],
    ["/admin/settings", "ayarlar"],
    ["/admin/reports", "raporlar"],
    ["/privacy", "gizlilik"],
    ["/menu/" + "a".repeat(48), "qr"],
  ]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + route, { waitUntil: "domcontentloaded" });
    await page.locator("main h1:visible,main h2:visible").first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(350);
    for (const [width, height] of [
      [1440, 900],
      [1366, 768],
      [1280, 720],
      [1024, 768],
      [768, 1024],
      [430, 932],
      [390, 844],
      [375, 812],
      [320, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(80);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1
      );
      if (overflow) failures.push(name + " horizontal overflow " + width);
      if (width === 1440 || width === 390) {
        const file = output + "/" + name + "-" + width + ".png";
        await page.screenshot({ path: file });
        shots.push(file);
      }
    }
  }
  fs.writeFileSync(output + "/redesign-results.json", JSON.stringify({ failures, shots }, null, 2));
  console.log(JSON.stringify({ failures, shots: shots.length }));
  await browser.close();
  if (failures.length) process.exitCode = 1;
})().catch(async (e) => {
  console.error(e);
  if (browser) await browser.close();
  process.exitCode = 1;
});
