const { createFixture, base, output } = require("./fixture.cjs");
const { measureLayout } = require("./layout-measure.cjs");
const assert = require("node:assert/strict");
const fs = require("fs");
let browser;
(async () => {
  const f = await createFixture();
  browser = f.browser;
  const { page, failures } = f;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/auth/status", (r) =>
    r.fulfill({ json: { authEnabled: true, session: null } })
  );
  const scenes = [];
  async function check(lang, route, width) {
    await page.locator("main h1:visible,main h2:visible").first().waitFor();
    await page.waitForFunction((v) => document.documentElement.lang === v, lang);
    assert.equal(
      await page.locator(".skip-link").innerText(),
      lang === "en" ? "Skip to content" : "İçeriğe geç"
    );
    if (!["/privacy", "/terms", "/cookies"].includes(route))
      assert.equal(
        await page.title(),
        lang === "en" ? "TEPSY | Restaurant management" : "TEPSY | Restoran yönetimi"
      );
    await page.waitForTimeout(250);
    assert.deepEqual(await page.evaluate(measureLayout), [], route + " " + lang + " " + width);
    scenes.push({ route, lang, width });
  }
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + "/");
    for (const lang of ["en", "tr"]) {
      if (width < 960)
        await page.getByRole("button", { name: /Gezinmeyi aç|Open navigation/ }).click();
      await page
        .getByRole("button", {
          name: /Görünüm ve tercihler|Appearance and preferences/,
          exact: true,
        })
        .filter({ visible: true })
        .click();
      await page.locator(".nav-language button").filter({ hasText: lang.toUpperCase() }).click();
      await page.keyboard.press("Escape");
      await check(lang, "/", width);
      await page.reload();
      await check(lang, "/", width);
      assert.equal(await page.evaluate(() => localStorage.getItem("tepsy_lang")), lang);
      assert(
        (await page.context().cookies()).some((c) => c.name === "tepsy_lang" && c.value === lang)
      );
    }
  }
  for (const lang of ["en", "tr"]) {
    await page.goto(base + "/login");
    await page
      .getByRole("button", { name: lang === "en" ? "English" : "Türkçe", exact: true })
      .click();
    for (const route of [
      "/",
      "/order",
      "/order/t0",
      "/kitchen",
      "/pos",
      "/admin",
      "/admin/menu",
      "/admin/tables",
      "/admin/floorplan",
      "/admin/settings",
      "/admin/reports",
      "/privacy",
      "/terms",
      "/cookies",
      "/setup",
    ])
      for (const width of [320, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(base + route);
        await check(lang, route, width);
      }
  }
  await page.goto(base + "/menu/" + "a".repeat(48));
  for (const lang of ["en", "tr"]) {
    await page.getByRole("button", { name: lang.toUpperCase(), exact: true }).click();
    await check(lang, "/menu/token", 1440);
    await page.reload();
    await check(lang, "/menu/token", 1440);
  }
  await page.goto(base + "/login");
  const icons = await page
    .locator('link[rel="icon"],link[rel="shortcut icon"]')
    .evaluateAll((xs) => xs.map((x) => ({ url: x.href, type: x.type })));
  assert(icons.length);
  assert(await page.locator('link[rel="icon"][type="image/png"]').count());
  const fallback = await fetch(base + "/favicon.ico");
  assert.equal(fallback.status, 200);
  assert(fallback.headers.get("content-type").includes("image/png"));
  assert.equal(
    (await require("sharp")(Buffer.from(await fallback.arrayBuffer())).metadata()).format,
    "png"
  );
  for (const icon of icons) {
    assert.equal(icon.type, "image/png");
    assert(new URL(icon.url).pathname.endsWith(".png"));
    const response = await fetch(icon.url);
    assert.equal(response.status, 200);
    assert(response.headers.get("content-type").includes("image/png"));
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal((await require("sharp")(bytes).metadata()).format, "png");
    const raw = await require("sharp")(bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = raw.info.width,
      h = raw.info.height;
    for (const index of [0, w - 1, w * (h - 1), w * h - 1])
      assert.equal(raw.data[index * 4 + 3], 0, "tab icon background must be transparent");
  }
  assert.deepEqual(failures, []);
  fs.writeFileSync(
    output + "/locale-icon-results.json",
    JSON.stringify({ passed: true, scenes, icons, failures }, null, 2)
  );
  console.log(
    "PASS PNG tab icons and " + scenes.length + " TR/EN switch/reload/route/layout scenes"
  );
  await browser.close();
})().catch(async (e) => {
  console.error(e);
  if (browser) await browser.close();
  process.exitCode = 1;
});
