const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright");
async function runOperationsChecks({
  api,
  expectStatus,
  owner,
  credentials,
  base,
  directory,
  root,
  env,
  startServer,
  stopServer,
}) {
  const evidence = { checks: [], pageErrors: [] };
  const category = expectStatus(
    await api("/api/categories", {
      method: "POST",
      cookie: owner,
      body: { name: "Recovery regression" },
    }),
    201
  );
  const item = expectStatus(
    await api("/api/menu-items", {
      method: "POST",
      cookie: owner,
      body: { name: "Recovery coffee", categoryId: category.id, price: "100.00" },
    }),
    201
  );
  const table = expectStatus(
    await api("/api/tables", {
      method: "POST",
      cookie: owner,
      body: { tableNumber: "Recovery 01", section: "Recovery", capacity: 4 },
    }),
    201
  );
  const orderBody = {
    tableId: table.id,
    items: [{ menuItemId: item.id, quantity: 1 }],
    idempotencyKey: crypto.randomUUID(),
  };
  const old = expectStatus(
    await api("/api/orders", { method: "POST", cookie: owner, body: orderBody }),
    201
  );
  expectStatus(
    await api(`/api/orders/${old.id}`, {
      method: "PATCH",
      cookie: owner,
      body: { status: "DELIVERED" },
    }),
    200
  );
  const extraBody = { ...orderBody, idempotencyKey: crypto.randomUUID() };
  const extra = expectStatus(
    await api("/api/orders", { method: "POST", cookie: owner, body: extraBody }),
    201
  );
  const repeated = expectStatus(
    await api("/api/orders", { method: "POST", cookie: owner, body: extraBody }),
    201
  );
  assert.equal(extra.id, repeated.id);
  assert.equal(extra.status, "PENDING");
  assert.equal(
    expectStatus(await api(`/api/orders/${old.id}`, { cookie: owner }), 200).status,
    "DELIVERED"
  );
  expectStatus(
    await api(`/api/orders/${old.id}`, {
      method: "PATCH",
      cookie: owner,
      body: { addItems: [{ menuItemId: item.id, quantity: 1 }] },
    }),
    409
  );
  const config = expectStatus(await api("/api/config", { cookie: owner }), 200);
  assert.equal(config.currencyLocked, true);
  expectStatus(
    await api("/api/config", { method: "PUT", cookie: owner, body: { currency: "€" } }),
    409
  );
  assert.equal(expectStatus(await api("/api/config", { cookie: owner }), 200).currency, "₺");
  evidence.checks.push(
    "new extra tickets preserve delivered items, replay once and lock financial currency"
  );
  let shift = expectStatus(await api("/api/pos/shift", { cookie: owner }), 200).currentShift;
  if (!shift)
    shift = expectStatus(
      await api("/api/pos/shift", { method: "POST", cookie: owner, body: { openingCash: "0" } }),
      201
    ).shift;
  const payment = expectStatus(
    await api("/api/pos/payment", {
      method: "POST",
      cookie: owner,
      body: { orderId: extra.id, paymentMethod: "CASH", idempotencyKey: crypto.randomUUID() },
    }),
    200
  );
  const original = JSON.stringify(payment.receipt);
  const refund = {
    paymentId: payment.receipt.id,
    amount: "20.00",
    reason: "Duplicate collection correction",
    externallyConfirmed: true,
    idempotencyKey: crypto.randomUUID(),
  };
  for (const cookie of [undefined, credentials.WAITER, credentials.CASHIER])
    expectStatus(
      await api("/api/pos/refunds", { method: "POST", cookie, body: refund }),
      cookie ? 403 : 401
    );
  expectStatus(
    await api("/api/pos/refunds", {
      method: "POST",
      cookie: owner,
      body: { ...refund, externallyConfirmed: false },
    }),
    400
  );
  expectStatus(
    await api("/api/pos/refunds", {
      method: "POST",
      cookie: owner,
      body: { ...refund, amount: "101" },
    }),
    409
  );
  const first = expectStatus(
    await api("/api/pos/refunds", { method: "POST", cookie: owner, body: refund }),
    200
  );
  assert.deepEqual(
    expectStatus(
      await api("/api/pos/refunds", { method: "POST", cookie: owner, body: refund }),
      200
    ),
    first
  );
  const concurrentBody = { ...refund, amount: "30.00", idempotencyKey: crypto.randomUUID() };
  const concurrent = await Promise.all(
    [1, 2].map(() =>
      api("/api/pos/refunds", { method: "POST", cookie: owner, body: concurrentBody })
    )
  );
  for (const response of concurrent)
    assert.ok([200, 409].includes(response.status), JSON.stringify(response));
  const second = expectStatus(
    await api("/api/pos/refunds", { method: "POST", cookie: owner, body: concurrentBody }),
    200
  );
  assert.equal(second.remainingRefundable, "50.00");
  const report = expectStatus(
    await api("/api/reports/z-report?period=all", { cookie: owner }),
    200
  );
  assert.equal(report.summary.refundTotal, 50);
  const history = expectStatus(
    await api(`/api/pos/payments?tableId=${table.id}`, { cookie: owner }),
    200
  );
  assert.equal(history.payments.find((p) => p.id === first.paymentId).refundedAmount, "50.00");
  assert.equal(
    JSON.stringify(
      expectStatus(await api(`/api/pos/payments/${first.paymentId}`, { cookie: owner }), 200)
        .receipt
    ),
    original
  );
  const events = expectStatus(await api("/api/audit", { cookie: owner }), 200).events;
  assert.equal(
    events.filter((e) => e.action === "PAYMENT_REFUND" && e.entityId === first.paymentId).length,
    2
  );
  assert.ok(events.some((e) => e.action === "PAYMENT_RECORDED" && e.actorId === "owner"));
  expectStatus(await api("/api/audit", { cookie: credentials.WAITER }), 403);
  evidence.checks.push(
    "authorized refunds are bounded, replay-safe, concurrent-safe, audited and preserve original receipts"
  );

  const browser = await chromium.launch({
    headless: true,
    channel: process.env.TEPSY_BROWSER || "chrome",
  });
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const split = owner.indexOf("=");
    await context.addCookies([
      { name: owner.slice(0, split), value: owner.slice(split + 1), url: base },
    ]);
    page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", (e) => evidence.pageErrors.push(e.message));
    await page.goto(base + "/pos", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Liste", exact: true }).waitFor();
    const names = await page.getByRole("button").allTextContents();
    assert.ok(names.length > 0);
    // Inspect the hydrated DOM before selecting the live table and add controls.
    await page.getByLabel("Salon bölümü", { exact: true }).selectOption("Recovery");
    await page.getByRole("button", { name: "Liste", exact: true }).click();
    await page.getByRole("button").filter({ hasText: "Recovery 01" }).first().click();
    const productButtons = await page.getByRole("button").allTextContents();
    const addButton = page.getByRole("button", { name: /ürün ekle/i }).first();
    assert.ok(productButtons.length > 0);
    await addButton.click();
    await page.getByRole("searchbox").fill("Recovery coffee");
    const product = page.getByRole("button").filter({ hasText: "Recovery coffee" }).last();
    await product.waitFor();
    let captured;
    // The write reaches the real server, but its first HTTP response is lost.
    await page.route("**/api/orders", async (route) => {
      if (route.request().method() !== "POST" || captured) return route.continue();
      captured = route.request().postDataJSON();
      const real = await route.fetch();
      assert.equal(real.status(), 201);
      await route.abort("failed");
    });
    const lostResponse = page.waitForEvent("requestfailed", {
      predicate: (r) => r.url().endsWith("/api/orders") && r.method() === "POST",
    });
    await product.click();
    await lostResponse;
    await page.getByText(/Sipariş sonucu doğrulanamadı. Başka ürün/).waitFor();
    assert.ok(captured.idempotencyKey);
    const beforeRetry = expectStatus(
      await api(`/api/orders?tableId=${table.id}`, { cookie: owner }),
      200
    ).length;
    const retry = page
      .getByRole("button", { name: /yeniden dene/i })
      .filter({ hasText: /iste|ürün|yeniden/i })
      .last();
    await retry.click();
    await page.waitForTimeout(400);
    assert.equal(
      expectStatus(await api(`/api/orders?tableId=${table.id}`, { cookie: owner }), 200).length,
      beforeRetry
    );
    await page.unroute("**/api/orders");
    await page.getByRole("button", { name: "Tahsilat geçmişi", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Tahsilat geçmişi", exact: true })
      .getByRole("combobox")
      .selectOption(table.id);
    const paymentRow = page
      .locator("article.pos-payment-entry")
      .filter({ hasText: payment.receipt.receiptNumber });
    await paymentRow.getByRole("button", { name: "İade / düzeltme", exact: true }).click();
    const refundDialog = page.getByRole("dialog", { name: "İade / düzeltme kaydı", exact: true });
    await refundDialog.getByLabel("İade tutarı", { exact: true }).fill("10.00");
    await refundDialog
      .getByLabel("İade / düzeltme nedeni", { exact: true })
      .fill("Browser correction test");
    await refundDialog.getByRole("checkbox").check();
    const saved = page.waitForResponse(
      (r) => r.url().endsWith("/api/pos/refunds") && r.request().method() === "POST"
    );
    await refundDialog
      .getByRole("button", { name: "Tamamlanan iadeyi kaydet", exact: true })
      .click();
    assert.equal((await saved).status(), 200);
    await refundDialog.waitFor({ state: "hidden" });
    await paymentRow.getByText(/60[,.]00/).waitFor();
    await page.setViewportSize({ width: 320, height: 700 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({
      path: path.join(directory, "refund-history-mobile.png"),
      fullPage: true,
    });
    await page.goto(base + "/admin/settings#recovery-history", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Tam yedek ve kurtarma", exact: true }).waitFor();
    const savePlan = page.getByRole("button", { name: "Yedek planını kaydet", exact: true });
    await savePlan.waitFor();
    await savePlan.scrollIntoViewIfNeeded();
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await savePlan.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({
        path: path.join(directory, `recovery-settings-${width}.png`),
        fullPage: true,
      });
    }
    assert.deepEqual(evidence.pageErrors, []);
    evidence.checks.push(
      "real POS lost-response retry creates one kitchen ticket; recovery controls fit desktop and phone"
    );
  } catch (error) {
    if (page) {
      fs.writeFileSync(path.join(directory, "operations-failure.html"), await page.content());
      fs.writeFileSync(
        path.join(directory, "operations-failure.txt"),
        await page.locator("body").innerText()
      );
      await page.screenshot({
        path: path.join(directory, "operations-failure.png"),
        fullPage: true,
      });
    }
    throw error;
  } finally {
    await browser.close();
  }

  expectStatus(await api("/api/backup/recovery", { cookie: credentials.ADMIN }), 403);
  expectStatus(
    await api("/api/backup/recovery?action=plan", {
      method: "POST",
      cookie: owner,
      body: {
        enabled: false,
        intervalHours: 24,
        copyDirectory: path.join(directory, "external-backup-copy"),
      },
    }),
    200
  );
  const response = await fetch(base + "/api/backup/recovery", {
    method: "POST",
    headers: { Cookie: owner, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 200, await response.clone().text());
  const archive = path.join(directory, "recovery-roundtrip.zip");
  fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  const status = expectStatus(await api("/api/backup/recovery", { cookie: owner }), 200);
  assert.ok(status.status.lastSuccessAt);
  assert.ok(status.status.copiedTo);
  assert.deepEqual(fs.readFileSync(archive), fs.readFileSync(status.status.copiedTo));
  const python = process.platform === "win32" ? "py" : "python3";
  const restored = path.join(directory, "recovered-installation");
  const restoredResult = spawnSync(
    python,
    ["scripts/recovery-bundle.py", "restore", "--archive", archive, "--target", restored],
    { cwd: root, env, encoding: "utf8", windowsHide: true }
  );
  assert.equal(restoredResult.status, 0, restoredResult.stderr);
  const { createPrismaClient } = require("../../src/lib/prisma-client.cjs");
  const db = createPrismaClient(
    "file:" + path.join(restored, "prisma/dev.db").replaceAll("\\", "/")
  );
  try {
    assert.equal(await db.refund.count({ where: { paymentId: first.paymentId } }), 3);
    assert.ok((await db.auditEvent.count()) > 0);
    assert.ok((await db.paymentAttempt.count()) > 0);
    assert.ok((await db.cashShift.count()) > 0);
  } finally {
    await db.$disconnect();
  }
  const currentDb = createPrismaClient(env.TEPSY_DATABASE_URL);
  try {
    const payments = await currentDb.payment.findMany({
      where: { cashShiftId: shift.id, paymentMethod: "CASH" },
    });
    const opening = await currentDb.cashShift.findUnique({ where: { id: shift.id } });
    const expected =
      Number(opening.openingCash) + payments.reduce((n, p) => n + Number(p.amountPaid), 0) - 60;
    const closed = expectStatus(
      await api("/api/pos/shift", {
        method: "PATCH",
        cookie: owner,
        body: { shiftId: shift.id, closingCash: expected.toFixed(2) },
      }),
      200
    );
    assert.equal(closed.cashRefunds, "60.00");
    assert.equal(Number(closed.expectedCash), expected);
    assert.equal(closed.cashDifference, "0.00");
    assert.deepEqual(
      expectStatus(
        await api("/api/pos/refunds", { method: "POST", cookie: owner, body: refund }),
        200
      ),
      first
    );
    const before = expectStatus(
      await api("/api/reports/z-report?period=all", { cookie: owner }),
      200
    ).summary.totalRevenue;
    // Explicit disposable legacy records model earlier releases with mixed currencies.
    const legacy = await currentDb.order.create({ data: { status: "PAID", totalPrice: "200" } });
    const key = "legacy-eur-" + crypto.randomUUID();
    const p = await currentDb.payment.create({
      data: { orderId: legacy.id, paymentMethod: "OTHER", amountPaid: "200", idempotencyKey: key },
    });
    await currentDb.paymentAttempt.create({
      data: {
        idempotencyKey: key,
        requestFingerprint: "legacy-review-fixture",
        responseJson: JSON.stringify({
          receipt: {
            ...payment.receipt,
            id: p.id,
            currency: "€",
            orderIds: [legacy.id],
            amountPaid: "200.00",
          },
        }),
      },
    });
    assert.equal(
      expectStatus(await api("/api/reports/z-report?period=all", { cookie: owner }), 200).summary
        .totalRevenue,
      before
    );
    assert.equal(
      expectStatus(
        await api("/api/reports/z-report?period=all&currency=" + encodeURIComponent("€"), {
          cookie: owner,
        }),
        200
      ).summary.totalRevenue,
      200
    );
    evidence.checks.push(
      "real shift closing deducts refunds; historical EUR entries remain separate from TL collections"
    );
  } finally {
    await currentDb.$disconnect();
  }
  const verified = await fetch(base + "/api/backup/recovery?action=verify", {
    method: "POST",
    headers: { Cookie: owner, "Content-Type": "application/zip" },
    body: fs.readFileSync(archive),
  });
  assert.equal(verified.status, 200, await verified.text());
  evidence.checks.push(
    "full recovery archive verifies, copies with matching bytes and restores financial/audit history into a new folder"
  );
  await stopServer();
  const planFile = path.join(env.TEPSY_BACKUP_DIR, "backup-plan.json"),
    statusFile = path.join(env.TEPSY_BACKUP_DIR, "backup-status.json");
  const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
  plan.enabled = true;
  fs.writeFileSync(planFile, JSON.stringify(plan));
  const expired = JSON.parse(fs.readFileSync(statusFile, "utf8"));
  expired.lastSuccessAt = "2000-01-01T00:00:00Z";
  expired.lastAttemptAt = expired.lastSuccessAt;
  fs.writeFileSync(statusFile, JSON.stringify(expired));
  await startServer();
  let scheduled;
  for (let retry = 0; retry < 80; retry++) {
    scheduled = expectStatus(await api("/api/backup/recovery", { cookie: owner }), 200);
    if (!scheduled.running && scheduled.status.lastSuccessAt !== expired.lastSuccessAt) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.notEqual(scheduled.status.lastSuccessAt, expired.lastSuccessAt);
  assert.ok(scheduled.status.copiedTo);
  expectStatus(
    await api("/api/backup/recovery?action=plan", {
      method: "POST",
      cookie: owner,
      body: { ...plan, enabled: false },
    }),
    200
  );
  evidence.checks.push(
    "automatic full backups resume when due after restart and verify the configured second copy"
  );
  fs.writeFileSync(
    path.join(directory, "operations-results.json"),
    JSON.stringify(evidence, null, 2)
  );
  return evidence;
}
module.exports = { runOperationsChecks };
