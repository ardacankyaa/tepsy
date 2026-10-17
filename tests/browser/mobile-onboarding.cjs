const { createFixture, base, output } = require("./fixture.cjs");
const { measureLayout } = require("./layout-measure.cjs");
const fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict");
let browser, page;
const reportOnly = process.env.TEPSY_UX_REPORT_ONLY === "1";
(async () => {
  const f = await createFixture({ hasTouch: true });
  browser = f.browser;
  page = f.page;
  await page.emulateMedia({ reducedMotion: "reduce" });
  const findings = [],
    scenes = [];
  let canSetup = false;
  const restaurantName = "Gurme" + "X".repeat(75);
  await page.route("**/api/auth/status", (r) =>
    r.fulfill({
      json: {
        authEnabled: !canSetup,
        canSetup,
        restaurantName,
        restaurantCode: "QA01",
        session: null,
      },
    })
  );
  await page.goto(base + "/login");
  const viewports = [
    { width: 320, height: 568 },
    { width: 390, height: 300 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ];
  async function scan(name, viewport, targets = []) {
    await page.waitForTimeout(150);
    const issues = await page.evaluate(measureLayout);
    const textIssues = await page.evaluate(() => {
      const out = [];
      for (const e of document.querySelectorAll(
        ".login-access-heading h2,.login-kicker,.login-role-list"
      )) {
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (e.scrollWidth > e.clientWidth + 2 || r.right > innerWidth + 1 || r.left < -1)
          out.push({
            type: "login-content-overflow",
            className: e.className,
            label: e.innerText.slice(0, 40),
            availableWidth: e.clientWidth,
            contentWidth: e.scrollWidth,
          });
      }
      return out;
    });
    issues.push(...textIssues);
    for (const [label, target] of targets) {
      try {
        await target.scrollIntoViewIfNeeded();
        await target.click({ trial: true, timeout: 3000 });
        const r = await target.boundingBox();
        if (!r || r.y < 0 || r.y + r.height > viewport.height + 1)
          issues.push({ type: "unreachable-action", label });
      } catch (e) {
        issues.push({ type: "unreachable-action", label, message: e.message.split("\n")[0] });
      }
    }
    if (name.startsWith("setup")) {
      const c = page.locator(".scroll-panel-content").first();
      const r = await c.boundingBox();
      const natural = await c.evaluate((e) => getComputedStyle(e).overflowY === "visible");
      if (!r || (!natural && r.height < 120))
        issues.push({ type: "collapsed-setup-form", contentHeight: r?.height ?? 0 });
    }
    findings.push(...issues.map((x) => ({ name, ...viewport, ...x })));
    scenes.push({ name, ...viewport, issues: issues.length });
    if (issues.length || viewport.height === 300)
      await page.screenshot({
        path: path.join(
          output,
          "onboarding-" + name + "-" + viewport.width + "x" + viewport.height + ".png"
        ),
      });
    fs.writeFileSync(
      path.join(output, "mobile-onboarding-results.json"),
      JSON.stringify(
        {
          passed: findings.length === 0 && !f.failures.length,
          scenes,
          findings,
          pageErrors: f.failures,
          reportOnly,
        },
        null,
        2
      )
    );
  }
  for (const lang of ["tr", "en"])
    for (const viewport of viewports) {
      await f.context.addCookies([
        { name: "tepsy_lang", value: lang, url: base },
        { name: "tepsy_theme", value: lang === "en" ? "dark" : "light", url: base },
      ]);
      await page.evaluate((lang) => {
        localStorage.setItem("tepsy_lang", lang);
        localStorage.setItem("tepsy_theme", lang === "en" ? "dark" : "light");
      }, lang);
      await page.setViewportSize(viewport);
      canSetup = false;
      await page.goto(base + "/login");
      await page.locator("form").waitFor();
      await page.getByRole("heading", { name: restaurantName, exact: true }).waitFor();
      await scan("login-owner-" + lang, viewport, [
        ["Sign in", page.locator('form button[type="submit"],form button:not([type])').last()],
      ]);
      await page
        .getByRole("button", { name: lang === "tr" ? "Personel" : "Staff", exact: true })
        .click();
      await scan("login-staff-" + lang, viewport, [
        ["Password", page.locator('form input[type="password"]')],
      ]);
      canSetup = true;
      await page.goto(base + "/login");
      await page.getByRole("heading", { name: restaurantName, exact: true }).waitFor();
      await scan("login-fresh-" + lang, viewport, [
        [
          "Set up",
          page.getByRole("button", {
            name: lang === "tr" ? "İşletmeni kur" : "Set up your restaurant",
            exact: true,
          }),
        ],
      ]);
      await page.goto(base + "/setup");
      await page
        .getByRole("button", { name: lang === "tr" ? "İleri" : "Next", exact: true })
        .click();
      await page.locator('main > div > section > [role="alert"]').waitFor();
      await scan("setup-error-" + lang, viewport, [
        ["Password", page.locator('input[name="ownerPassword"]')],
        ["Confirm", page.locator('input[name="ownerPasswordConfirm"]')],
        ["Next", page.getByRole("button", { name: lang === "tr" ? "İleri" : "Next", exact: true })],
      ]);
    }
  console.log(JSON.stringify({ scenes: scenes.length, findings, pageErrors: f.failures }));
  await browser.close();
  if (!reportOnly) {
    assert.deepEqual(findings, []);
    assert.deepEqual(f.failures, []);
  }
})().catch(async (e) => {
  console.error(e);
  if (browser) await browser.close();
  process.exitCode = 1;
});
