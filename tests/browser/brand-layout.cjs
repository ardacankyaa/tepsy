const { createFixture, base, output } = require("./fixture.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
let browser;
const workspaceRoutes = ["/", "/order", "/kitchen", "/pos"];
const qrRoute = "/menu/" + "a".repeat(48);
const headingSelector = ".service-heading-copy h1, .kds-brand h1, .pos-command-brand h1";
const customLogoUrl = "/api/public/menu-images/" + "b".repeat(64) + ".webp";

async function checkIdentity(page, route, width, hasLogo) {
  const identity = page.locator(".restaurant-identity:visible").first();
  await identity.waitFor();
  if (hasLogo) {
    const image = identity.locator("img.restaurant-identity-logo");
    await image.waitFor();
    await image.evaluate((i) => i.decode());
    const style = await image.evaluate((i) => ({
      filter: getComputedStyle(i).filter,
      fit: getComputedStyle(i).objectFit,
      loaded: i.naturalWidth > 0,
    }));
    assert.deepEqual(
      style,
      { filter: "none", fit: "contain", loaded: true },
      route + " restaurant logo preserves its colors"
    );
  } else {
    assert.equal((await identity.innerText()).trim(), "T", route + " restaurant initial");
    assert.equal(await identity.locator("img").count(), 0);
  }
  assert.equal(await page.locator("main .tepsy-logo").count(), 0, route + " workspace identity");
  const frame = await identity.evaluate((i) => {
    const p = i.parentElement,
      s = getComputedStyle(p),
      r = p.getBoundingClientRect();
    return {
      width: r.width,
      height: r.height,
      borderWidth: s.borderTopWidth,
      borderStyle: s.borderTopStyle,
      background: s.backgroundColor,
    };
  });
  assert.equal(frame.borderWidth, "1px", route + " outlined identity");
  assert.equal(frame.borderStyle, "solid");
  assert.equal(frame.background, "rgba(0, 0, 0, 0)", route + " neutral identity background");
  assert.equal(frame.width, frame.height, route + " square identity");
  assert.equal(frame.width, width <= 600 ? 38 : 42);
  if (workspaceRoutes.includes(route)) {
    const heading = await page
      .locator(headingSelector)
      .first()
      .evaluate((h) => {
        const s = getComputedStyle(h);
        return { size: s.fontSize, weight: s.fontWeight, line: s.lineHeight, family: s.fontFamily };
      });
    assert.equal(heading.size, width <= 600 ? "16px" : "18px", route + " heading size");
    assert.equal(heading.weight, "650", route + " heading weight");
    assert.equal(heading.line, width <= 600 ? "22px" : "24px", route + " heading line height");
    assert(heading.family.startsWith("system-ui"), route + " shared heading font");
  }
}

(async () => {
  const fixture = await createFixture();
  browser = fixture.browser;
  const { page, failures } = fixture;
  const scenes = [],
    customLogoScenes = [];
  for (const route of [...workspaceRoutes, "/admin", "/login", "/privacy", qrRoute]) {
    for (const width of [320, 768, 1440])
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(base + route);
        await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
        await page.locator("main h1:visible,main h2:visible").first().waitFor();
        await page.waitForTimeout(200);
        const identity = page.locator(".restaurant-identity:visible").first();
        if (await identity.count()) await checkIdentity(page, route, width, false);
        if (
          !(await page.locator(".tepsy-logo:visible").count()) &&
          (await page.getByRole("button", { name: "Gezinmeyi aç" }).count())
        )
          await page.getByRole("button", { name: "Gezinmeyi aç" }).click();
        const logos = page.locator(".tepsy-logo:visible");
        assert(
          (await logos.count()) > 0 || (await identity.count()) > 0,
          route + " identity missing"
        );
        for (const logo of await logos.all()) {
          await logo.scrollIntoViewIfNeeded();
          await logo.evaluate((i) => i.decode());
          const result = await logo.evaluate((i) => ({
            src: new URL(i.src).pathname,
            filter: getComputedStyle(i).filter,
            background: getComputedStyle(i).backgroundColor,
          }));
          assert(result.src.endsWith(".png"));
          assert.equal(result.background, "rgba(0, 0, 0, 0)");
          assert.equal(
            result.filter === "none",
            theme === "light",
            route + " " + theme + " application logo color"
          );
        }
        const brand = page.locator(".nav-brand:visible").first();
        if (await brand.count()) {
          assert.equal(await brand.locator("img").getAttribute("src"), "/brand/logo.png");
          assert.equal(await brand.locator("strong,.nav-brand-mark").count(), 0);
          const logo = await brand.locator("img").boundingBox(),
            name = await brand.locator(".nav-brand-restaurant").boundingBox();
          assert(name.y >= logo.y + logo.height - 1, "restaurant must be below logo");
        }
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          route + " overflow"
        );
        if (route === "/kitchen" || route === "/")
          await page.screenshot({
            path:
              output + "/brand-" + route.replace(/\W/g, "") + "-" + width + "-" + theme + ".png",
          });
        scenes.push({ route, width, theme });
      }
  }
  await page.route("**" + customLogoUrl, (r) =>
    r.fulfill({
      status: 200,
      contentType: "image/png",
      headers: { "Cache-Control": "no-store" },
      body: fs.readFileSync(path.join(__dirname, "../../public/brand/mark.png")),
    })
  );
  await page.route("**/api/config", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        restaurantName: "Test Restoranı",
        restaurantLogoUrl: customLogoUrl,
        currency: "₺",
        defaultLanguage: "tr",
        restaurantCode: "TEST",
        isSetupCompleted: true,
        qrOrderEnabled: true,
      }),
    })
  );
  await page.route("**/api/public/menu?**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        restaurant: {
          name: "Test Restoranı",
          logoUrl: customLogoUrl,
          currency: "₺",
          defaultLanguage: "tr",
        },
        table: { label: "Masa 001" },
        categories: [],
        items: [],
        orderingEnabled: true,
      }),
    })
  );
  for (const route of [...workspaceRoutes, qrRoute])
    for (const width of [320, 1440])
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(base + route);
        await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
        await checkIdentity(page, route, width, true);
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          route + " custom logo overflow"
        );
        customLogoScenes.push({ route, width, theme });
      }
  await page.route("**" + customLogoUrl, (r) => r.fulfill({ status: 404, body: "" }));
  const failedImage = page.waitForResponse(
    (r) => r.url().endsWith(customLogoUrl) && r.status() === 404
  );
  await page.goto(base + "/order");
  await failedImage;
  await page
    .locator(".restaurant-identity:visible")
    .first()
    .getByText("T", { exact: true })
    .waitFor();
  await checkIdentity(page, "/order", 1440, false);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(base + "/order");
  await page.getByRole("button", { name: "Gezinmeyi aç" }).click();
  const mobile = page.locator(".navigation-dialog .nav-brand");
  await mobile.waitFor();
  assert.equal(await mobile.locator("img").getAttribute("src"), "/brand/logo.png");
  assert(await mobile.locator(".nav-brand-restaurant").innerText());
  assert.deepEqual(failures, []);
  fs.writeFileSync(
    output + "/brand-layout-results.json",
    JSON.stringify(
      { passed: true, scenes, customLogoScenes, brokenLogoFallback: true, failures },
      null,
      2
    )
  );
  await browser.close();
  console.log(
    "PASS 48 brand scenes, 20 custom restaurant logo scenes, shared outlined frames and heading typography, missing-image fallback, mobile navigation"
  );
})().catch(async (e) => {
  console.error(e);
  if (browser) await browser.close();
  process.exitCode = 1;
});
