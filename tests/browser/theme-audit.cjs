const { createFixture, base, output } = require("./fixture.cjs");
const fs = require("fs");
const assert = require("node:assert/strict");
let browser;
(async () => {
  const { browser: b, page, failures } = await createFixture();
  browser = b;
  await page.emulateMedia({ reducedMotion: "reduce" });
  const findings = [],
    scenes = [];
  await page.goto(base + "/login");
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
    "/login",
    "/setup",
    "/menu/" + "a".repeat(48),
  ])
    for (const width of [390, 1440])
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 900 });
        await page.context().addCookies([{ name: "tepsy_theme", value: theme, url: base }]);
        await page.evaluate((t) => {
          localStorage.setItem("tepsy_theme", t);
          localStorage.setItem("restopos_theme", t);
        }, theme);
        await page.goto(base + route);
        await page.locator("main h1:visible,main h2:visible").first().waitFor();
        await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
        await page.waitForTimeout(400);
        if (route === "/kitchen") {
          await page.locator(".kds-ticket-card").filter({ hasText: "Masa 002" }).first().click();
          await page.locator(".kds-ready-action").waitFor();
        }
        const low = await page.evaluate(() => {
          function rgb(c) {
            const v = c.match(/[\d.]+/g)?.map(Number);
            return v?.length >= 3 ? [v[0], v[1], v[2], v[3] ?? 1] : [0, 0, 0, 0];
          }
          function blend(a, b) {
            return a
              .slice(0, 3)
              .map((v, i) => v * a[3] + b[i] * (1 - a[3]))
              .concat(1);
          }
          function lum(c) {
            return c
              .slice(0, 3)
              .map((v) => {
                v /= 255;
                return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
              })
              .reduce((x, v, i) => x + v * [0.2126, 0.7152, 0.0722][i], 0);
          }
          const out = [];
          const walker = document.createTreeWalker(
            document.querySelector("main"),
            NodeFilter.SHOW_TEXT
          );
          let n;
          while ((n = walker.nextNode())) {
            const text = n.textContent.trim(),
              el = n.parentElement;
            if (
              !/[\p{L}\p{N}]/u.test(text) ||
              text.length < 3 ||
              !el ||
              el.closest('svg,canvas,[disabled],[aria-disabled="true"],option,script,style')
            )
              continue;
            const r = el.getBoundingClientRect();
            if (
              r.width <= 0 ||
              r.height <= 0 ||
              r.bottom < 0 ||
              r.top > innerHeight ||
              r.right < 0 ||
              r.left > innerWidth
            )
              continue;
            const cs = getComputedStyle(el);
            if (cs.visibility !== "visible") continue;
            const chain = [];
            let a = el,
              skip = false;
            while (a) {
              const s = getComputedStyle(a);
              if (Number(s.opacity) < 0.99) {
                skip = true;
                break;
              }
              chain.push(rgb(s.backgroundColor));
              a = a.parentElement;
            }
            if (skip) continue;
            let bg = [255, 255, 255, 1];
            for (let i = chain.length - 1; i >= 0; i--) bg = blend(chain[i], bg);
            const fg = blend(rgb(cs.color), bg),
              l1 = lum(fg),
              l2 = lum(bg),
              ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05),
              size = parseFloat(cs.fontSize),
              large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
            if (ratio < (large ? 3 : 4.5) - 0.05)
              out.push({
                text: text.slice(0, 65),
                selector: el.className || el.tagName,
                ratio: Math.round(ratio * 100) / 100,
                color: cs.color,
                bg,
              });
          }
          return out;
        });
        findings.push(...low.map((x) => ({ route, width, theme, ...x })));
        scenes.push({ route, width, theme });
      }
  fs.writeFileSync(
    output + "/theme-audit-results.json",
    JSON.stringify({ scenes, findings, pageErrors: failures }, null, 2)
  );
  console.log(
    JSON.stringify({
      scenes: scenes.length,
      findings: findings.slice(0, 30),
      total: findings.length,
    })
  );
  await browser.close();
  assert.deepEqual(findings, [], "Unreadable theme text");
  assert.deepEqual(failures, []);
})().catch(async (e) => {
  console.error(e);
  if (browser) await browser.close();
  process.exitCode = 1;
});
