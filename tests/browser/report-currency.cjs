const { createFixture, base, output } = require("./fixture.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
let browser;

(async () => {
  const { selectReportCurrency } = await import("../../src/lib/report-currency.mjs");
  const fixture = await createFixture({ viewport: { width: 320, height: 640 } });
  browser = fixture.browser;
  const { page, failures } = fixture;
  let holdNext = false,
    releaseHeld,
    heldStarted,
    failUnknownToday = false;
  const requests = [];
  await page.route("**/api/reports/z-report?*", async (route) => {
    const url = new URL(route.request().url());
    const period = url.searchParams.get("period");
    const requested = url.searchParams.get("currency");
    requests.push({ period, requested });
    if (holdNext) {
      holdNext = false;
      heldStarted();
      await new Promise((resolve) => (releaseHeld = resolve));
    }
    if (failUnknownToday && period === "today" && requested === "unknown")
      return route.fulfill({ status: 503, body: "Temporary report failure" });
    const payments = [{ id: "tl", idempotencyKey: "tl", amountPaid: 100 }];
    if (period === "all")
      payments.push(
        { id: "eur", idempotencyKey: "eur", amountPaid: 200 },
        { id: "legacy", amountPaid: 40 }
      );
    const selected = selectReportCurrency({
      payments,
      orders: [],
      refunds: [],
      attempts: [
        { idempotencyKey: "tl", responseJson: '{"receipt":{"currency":"₺"}}' },
        { idempotencyKey: "eur", responseJson: '{"receipt":{"currency":"€"}}' },
      ],
      currentCurrency: "₺",
      requested,
    });
    const total = selected.payments.reduce((sum, payment) => sum + payment.amountPaid, 0);
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        currency: selected.currency,
        availableCurrencies: selected.availableCurrencies,
        summary: {
          totalRevenue: total,
          cashRevenue: total,
          cardRevenue: 0,
          totalOrdersCount: selected.payments.length,
          averageOrderValue: total,
        },
        topProducts: [],
        categoryBreakdown: [],
      }),
    });
  });
  const select = page.locator(".reports-experience .admin-page-header select");
  for (const lang of ["tr", "en"]) {
    if (page.url() !== "about:blank")
      await page.evaluate((language) => localStorage.setItem("tepsy_lang", language), lang);
    await page.goto(base + "/admin/reports");
    const all = page.getByRole("button", {
      name: lang === "tr" ? "Tüm Zamanlar" : "All Time",
      exact: true,
    });
    const today = page.getByRole("button", {
      name: lang === "tr" ? "Bugün" : "Today",
      exact: true,
    });
    const yesterday = page.getByRole("button", {
      name: lang === "tr" ? "Dün" : "Yesterday",
      exact: true,
    });
    const price = (value, unit) => `${value}${lang === "tr" ? "," : "."}00 ${unit}`;
    const waitPrice = (value, unit) =>
      page.getByText(price(value, unit), { exact: true }).first().waitFor();
    await waitPrice(100, "₺");
    await all.click();
    await select.waitFor();
    await select.selectOption("€");
    await waitPrice(200, "€");
    await today.click();
    await waitPrice(0, "€");
    assert.equal(
      await select.isVisible(),
      true,
      "A historical selection cannot hide the currency control on a TL-only day"
    );
    assert.deepEqual(
      await select
        .locator("option")
        .evaluateAll((options) => options.map((option) => option.value)),
      ["₺", "€"]
    );
    await select.selectOption("₺");
    await waitPrice(100, "₺");

    await all.click();
    await select.selectOption("€");
    await waitPrice(200, "€");
    const started = new Promise((resolve) => (heldStarted = resolve));
    holdNext = true;
    await yesterday.click();
    await started;
    assert.equal(
      await select.isVisible(),
      true,
      "Currency recovery remains available during loading"
    );
    await select.selectOption("₺");
    await waitPrice(100, "₺");
    releaseHeld();

    await all.click();
    await select.selectOption("unknown");
    await waitPrice(40, "?");
    const controlBounds = await select.boundingBox();
    assert.ok(
      controlBounds && controlBounds.x >= 0 && controlBounds.x + controlBounds.width <= 320,
      "Historical currency controls stay within the narrow viewport"
    );
    await page.screenshot({ path: path.join(output, `report-currency-${lang}-320.png`) });
    failUnknownToday = true;
    await today.click();
    await page
      .getByRole("alert")
      .filter({
        hasText: lang === "tr" ? "Rapor verileri alınamadı" : "Report data could not be loaded",
      })
      .waitFor();
    assert.equal(
      await select.isVisible(),
      true,
      "An unavailable unknown-currency report still offers the current currency"
    );
    assert.equal(await select.inputValue(), "unknown");
    await select.selectOption("₺");
    await waitPrice(100, "₺");
    failUnknownToday = false;
    assert.deepEqual(
      requests.at(-1),
      { period: "today", requested: "₺" },
      "Returning to the current currency requests its collections even when it is the only option"
    );
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "Report controls fit a 320px phone"
    );
  }
  assert.ok(requests.some((request) => request.period === "today" && request.requested === "€"));
  assert.ok(requests.some((request) => request.period === "today" && request.requested === "₺"));
  assert.deepEqual(failures, []);
  fs.writeFileSync(
    path.join(output, "report-currency-results.json"),
    JSON.stringify(
      {
        passed: true,
        checks: [
          "historical and current currencies remain reachable after period changes",
          "selection survives loading and server errors",
          "currency segregation preserved",
          "TR and EN at 320px",
        ],
      },
      null,
      2
    )
  );
  console.log(
    "PASS: report currency controls recover across periods, loading and errors in TR/EN at 320px"
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
