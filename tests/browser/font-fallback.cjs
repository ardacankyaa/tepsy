const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createFixture, base, output } = require("./fixture.cjs");
const { measureLayout } = require("./layout-measure.cjs");

(async () => {
  const fixture = await createFixture();
  const { page, context, browser } = fixture;
  const findings = [];
  try {
    for (const lang of ["tr", "en"]) {
      await context.addCookies([{ name: "tepsy_lang", value: lang, url: base }]);
      await page.goto(base, { waitUntil: "load" });
      await page.evaluate((value) => localStorage.setItem("tepsy_lang", value), lang);
      for (const route of ["/kitchen", "/admin/floorplan", "/admin/menu"]) {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(base + route, { waitUntil: "load" });
        assert.equal(await page.locator("html").getAttribute("lang"), lang);
        await page.locator(".nav-links .nav-link").first().waitFor({ state: "attached" });
        if (route === "/admin/menu")
          await page
            .getByRole("button", { name: /Ürün 001/ })
            .first()
            .click();
        else if (route === "/kitchen") await page.locator(".kds-ticket-card").first().waitFor();
        // A wider generic font exposes assumptions hidden by the developer's system font.
        await page.addStyleTag({
          content: `
            .kds-toolbar, .kds-toolbar button,
            .floor-editor-page .service-toolbar, .floor-editor-page .service-toolbar a,
            .form-actions button { font-family: monospace; letter-spacing: 0.12em; }
          `,
        });
        for (const width of [320, 390, 768, 1024]) {
          await page.setViewportSize({ width, height: 1024 });
          await page.waitForTimeout(100);
          const issues = await page.evaluate(measureLayout);
          findings.push(...issues.map((issue) => ({ route, lang, width, ...issue })));
          if (issues.length || width === 320 || (route === "/kitchen" && width === 768))
            await page.screenshot({
              path: path.join(
                output,
                `font-fallback-${route.split("/").pop()}-${lang}-${width}.png`
              ),
            });
        }
      }
    }
    fs.writeFileSync(
      path.join(output, "font-fallback-results.json"),
      JSON.stringify({ findings, pageErrors: fixture.failures }, null, 2)
    );
    assert.deepEqual(findings, [], "controls must fit with wider fallback fonts");
    assert.deepEqual(fixture.failures, []);
    console.log("PASS: kitchen, floor editor and menu actions fit with fallback fonts in TR/EN");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
