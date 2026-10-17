const { createFixture, base, output } = require("./fixture.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
let browser, page;
async function assertControlsFit(scope, label) {
  const errors = await scope.evaluate((root) => {
    const errors = [];
    for (const control of root.querySelectorAll("button,input,select")) {
      const box = control.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      if (box.left < -1 || box.right > innerWidth + 1)
        errors.push("control outside viewport: " + control.textContent);
      if (control.tagName !== "BUTTON") continue;
      const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (
          !node.textContent.trim() ||
          getComputedStyle(node.parentElement).textOverflow === "ellipsis"
        )
          continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const text of range.getClientRects())
          if (
            text.left < box.left - 2 ||
            text.right > box.right + 2 ||
            text.top < box.top - 2 ||
            text.bottom > box.bottom + 2
          )
            errors.push("button text clips: " + node.textContent);
      }
    }
    for (const row of root.querySelectorAll(".pos-payment-entry,.pos-history-summary>div")) {
      const box = row.getBoundingClientRect();
      for (const child of row.children) {
        const rect = child.getBoundingClientRect();
        if (rect.left < box.left - 1 || rect.right > box.right + 1)
          errors.push("history row clips: " + child.textContent);
      }
    }
    return errors;
  });
  assert.deepEqual(errors, [], label);
}
(async () => {
  const fixture = await createFixture();
  browser = fixture.browser;
  page = fixture.page;
  page.setDefaultTimeout(10000);
  const table = {
    id: "split-table",
    tableNumber: "Bölüşülen masa",
    section: "Salon",
    capacity: 4,
    status: "OCCUPIED",
    shape: "SQUARE",
    width: 96,
    height: 96,
    posX: 20,
    posY: 20,
    orders: [],
  };
  const order = {
    id: "split-order",
    tableId: table.id,
    status: "DELIVERED",
    totalPrice: 100,
    discountAmount: 0,
    payments: [],
    items: [
      {
        id: "split-item",
        menuItemName: "Paylaşılan hesap",
        quantity: 1,
        unitPrice: 100,
        menuItem: { id: "m0", name: "Paylaşılan hesap", price: 100 },
      },
    ],
  };
  table.orders = [order];
  const payments = [],
    receipts = new Map(),
    attempts = new Map(),
    prints = [];
  let paidCents = 0;
  const amount = (cents) => (cents / 100).toFixed(2);
  const totals = () => ({
    cash: amount(
      payments
        .filter((p) => p.paymentMethod === "CASH")
        .reduce((sum, p) => sum + Math.round(Number(p.amountPaid) * 100), 0)
    ),
    card: amount(
      payments
        .filter((p) => p.paymentMethod === "CREDIT_CARD")
        .reduce((sum, p) => sum + Math.round(Number(p.amountPaid) * 100), 0)
    ),
    other: "0.00",
    total: amount(paidCents),
    paymentCount: payments.length,
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      method = request.method();
    let data,
      status = 200;
    if (url.pathname === "/api/tables") data = [table];
    else if (url.pathname === "/api/orders") data = [order];
    else if (url.pathname === "/api/pos/payments") {
      const scoped = url.searchParams.has("orderIds");
      const nextParty = scoped && !url.searchParams.get("orderIds").split(",").includes(order.id);
      data = {
        payments: nextParty ? [] : [...payments].reverse(),
        totals: nextParty
          ? { cash: "0.00", card: "0.00", other: "0.00", total: "0.00", paymentCount: 0 }
          : totals(),
        nextCursor: null,
        account: scoped
          ? {
              grossTotal: "100.00",
              discountAmount: "0.00",
              netTotal: "100.00",
              totalPaid: nextParty ? "0.00" : amount(paidCents),
              remainingBalance: nextParty ? "100.00" : amount(10000 - paidCents),
              orderIds: [nextParty ? "en-split-order" : order.id],
            }
          : null,
      };
    } else if (url.pathname.startsWith("/api/pos/payments/"))
      data = { receipt: receipts.get(url.pathname.split("/").pop()) };
    else if (url.pathname === "/api/pos/payment" && method === "POST") {
      const payload = request.postDataJSON();
      if (payload.paymentMethod === "CREDIT_CARD" && !payload.manualCardConfirmed) {
        status = 409;
        data = { code: "manual-card-confirmation-required" };
      } else if (attempts.has(payload.idempotencyKey)) data = attempts.get(payload.idempotencyKey);
      else {
        const cents = payload.amountPaid
          ? Math.round(Number(payload.amountPaid) * 100)
          : 10000 - paidCents;
        assert.ok(cents > 0 && cents <= 10000 - paidCents, "UI submitted invalid installment");
        paidCents += cents;
        const id = "payment-" + (payments.length + 1),
          receiptNumber = "TPS-CMTESTRECEIPTNUMBER" + String(payments.length + 1).padStart(12, "0");
        const receipt = {
          id,
          receiptNumber,
          kind: "PAYMENT",
          snapshotKind: "PAYMENT_SNAPSHOT",
          snapshotVersion: 1,
          restaurantName: "Bölüşme Restoranı",
          currency: "₺",
          tableId: table.id,
          tableNumber: table.tableNumber,
          section: table.section,
          orderIds: [order.id],
          items: [
            {
              id: "split-item",
              name: "Paylaşılan hesap",
              menuItemName: "Paylaşılan hesap",
              quantity: 1,
              unitPrice: "100.00",
              total: "100.00",
            },
          ],
          grossTotal: "100.00",
          discountAmount: "0.00",
          netTotal: "100.00",
          orderTotal: "100.00",
          totalAmount: amount(cents),
          amountPaid: amount(cents),
          totalPaid: amount(paidCents),
          remainingBalance: amount(10000 - paidCents),
          paymentMethod: payload.paymentMethod,
          timestamp: new Date().toISOString(),
          cardVerification: payload.paymentMethod === "CREDIT_CARD" ? "MANUAL" : undefined,
        };
        receipts.set(id, receipt);
        payments.push({ ...receipt, createdAt: receipt.timestamp });
        order.payments.push({
          id,
          paymentMethod: payload.paymentMethod,
          amountPaid: amount(cents),
        });
        if (paidCents === 10000) {
          order.status = "PAID";
          table.status = "AVAILABLE";
          table.orders = [];
        }
        data = {
          success: true,
          receipt,
          amountPaid: receipt.amountPaid,
          remainingBalance: receipt.remainingBalance,
          grossTotal: receipt.grossTotal,
          discountAmount: receipt.discountAmount,
          netTotal: receipt.netTotal,
          cardVerification: receipt.cardVerification,
          orders: [order],
          table,
        };
        attempts.set(payload.idempotencyKey, data);
      }
    } else if (url.pathname === "/api/print/receipt") {
      prints.push(request.postDataJSON());
      data = { success: true, accepted: true };
    } else {
      await route.fallback();
      return;
    }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.goto(base + "/pos");
  await page
    .getByRole("button", { name: new RegExp(table.tableNumber) })
    .first()
    .click();
  assert.equal(
    await page.locator(".pos-discount-fields").isVisible(),
    false,
    "secondary discount tools start closed"
  );
  assert.equal(
    await page.locator(".pos-split-payments").isVisible(),
    false,
    "full payment is the default path"
  );
  await page.locator(".pos-split-disclosure > summary").click();
  await page.getByRole("spinbutton", { name: "Kişi sayısı", exact: true }).fill("3");
  await page.getByRole("button", { name: "Eşit böl", exact: true }).click();
  const plan = page.getByTestId("split-payment-plan");
  await plan.waitFor();
  const planText = await plan.innerText();
  assert.equal((planText.match(/33,34/g) || []).length, 1, "one person must absorb the extra cent");
  assert.equal((planText.match(/33,33/g) || []).length, 2, "three shares must sum to100.00");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (theme) => document.documentElement.setAttribute("data-theme", theme),
        theme
      );
      await assertControlsFit(page.locator(".pos-split-payments"), `split ${width}px ${theme}`);
      await page.locator(".pos-split-payments").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(output, `split-plan-${width}-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const partial = page.getByRole("textbox", { name: "Kısmi ödeme tutarı", exact: true });
  assert.equal(Number(await partial.inputValue()), 33.34);
  await page.getByRole("button", { name: "NAKİT", exact: true }).click();
  await page.locator("#printable-receipt").waitFor();
  assert.equal(await page.locator(".receipt-paper-totals .is-paid dd").innerText(), "33,34 ₺");
  await page.locator(".receipt-dialog").getByRole("button", { name: "Kapat", exact: true }).click();
  assert.equal(payments.length, 1);
  assert.equal(
    Number(await partial.inputValue()),
    33.33,
    "equal split should advance to the next share"
  );

  await partial.fill("20");
  await page.getByRole("button", { name: "KREDİ KARTI", exact: true }).click();
  const manual = page.getByRole("dialog", { name: "Manuel kart kaydını onayla", exact: true });
  await manual.waitFor();
  await manual.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await manual.waitFor({ state: "hidden" });
  assert.equal(payments.length, 1, "manual confirmation cancellation must not collect money");
  await page.getByRole("button", { name: "KREDİ KARTI", exact: true }).click();
  await manual.getByRole("button", { name: "Harici terminalde tahsil ettim", exact: true }).click();
  await page.locator("#printable-receipt").waitFor();
  assert.equal(await page.locator(".receipt-paper-totals .is-paid dd").innerText(), "20,00 ₺");
  await page.locator(".receipt-dialog").getByRole("button", { name: "Kapat", exact: true }).click();
  await page.locator(".pos-history-disclosure > summary").click();
  const history = page.locator(".pos-payment-history");
  await history.locator(".pos-payment-entry").nth(1).waitFor();
  assert.equal(await history.locator(".pos-payment-entry").count(), 2);
  const summary = history.getByTestId("payment-history-summary");
  assert.ok((await summary.innerText()).includes("33,34"));
  assert.ok((await summary.innerText()).includes("20,00"));
  await page.reload();
  await page
    .getByRole("button", { name: new RegExp(table.tableNumber) })
    .first()
    .click();
  await page.locator(".pos-history-disclosure > summary").click();
  await history.locator(".pos-payment-entry").nth(1).waitFor();
  assert.equal(
    await history.locator(".pos-payment-entry").count(),
    2,
    "history must survive refresh"
  );
  await page.getByRole("button", { name: "NAKİT", exact: true }).click();
  await page.locator("#printable-receipt").waitFor();
  assert.equal(await page.locator(".receipt-paper-totals .is-paid dd").innerText(), "46,66 ₺");
  await page.locator(".receipt-dialog").getByRole("button", { name: "Kapat", exact: true }).click();
  assert.equal(table.status, "AVAILABLE");
  assert.deepEqual(
    payments.map((p) => [p.paymentMethod, p.amountPaid]),
    [
      ["CASH", "33.34"],
      ["CREDIT_CARD", "20.00"],
      ["CASH", "46.66"],
    ]
  );
  assert.deepEqual(totals(), {
    cash: "80.00",
    card: "20.00",
    other: "0.00",
    total: "100.00",
    paymentCount: 3,
  });
  await page.reload();
  await page.getByRole("button", { name: "Tahsilat geçmişi", exact: true }).click();
  const globalHistory = page.getByRole("dialog", { name: "Tahsilat geçmişi", exact: true });
  await globalHistory.locator(".pos-payment-entry").nth(2).waitFor();
  assert.equal(
    await globalHistory.locator(".pos-payment-entry").count(),
    3,
    "completed account receipts remain accessible"
  );
  for (const payment of payments) {
    await globalHistory
      .getByRole("button", { name: "Fişi aç: " + payment.receiptNumber, exact: true })
      .click();
    await page.locator("#printable-receipt").waitFor();
    assert.equal(
      await page.locator(".receipt-paper-totals .is-paid dd").innerText(),
      Number(payment.amountPaid).toLocaleString("tr-TR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + " ₺"
    );
    assert.ok(
      (await page.locator("#printable-receipt").innerText()).includes(payment.receiptNumber)
    );
    await page.getByRole("button", { name: "Fiş yazıcısına gönder", exact: true }).click();
    await page.getByText("Fiş yazdırma kuyruğuna gönderildi.", { exact: true }).waitFor();
    assert.equal(
      prints.at(-1).paymentId || prints.at(-1).receiptId,
      payment.id,
      "reprint must use the selected payment snapshot"
    );
    await page
      .locator(".receipt-dialog")
      .getByRole("button", { name: "Kapat", exact: true })
      .click();
    await page.getByRole("button", { name: "Tahsilat geçmişi", exact: true }).click();
    await globalHistory.locator(".pos-payment-entry").nth(2).waitFor();
  }
  assert.equal(payments.length, 3, "opening and printing past receipts must never collect again");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (theme) => document.documentElement.setAttribute("data-theme", theme),
        theme
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
        `history ${width}px overflow`
      );
      const bounds = await globalHistory.evaluate((el) => ({
        width: el.getBoundingClientRect().width,
        viewport: innerWidth,
        scroll: el.scrollWidth,
        client: el.clientWidth,
      }));
      assert.ok(
        bounds.width <= bounds.viewport && bounds.scroll <= bounds.client + 1,
        JSON.stringify(bounds)
      );
      await assertControlsFit(globalHistory, `history ${width}px ${theme}`);
      await page.screenshot({
        path: path.join(output, `split-payment-history-${width}-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    localStorage.setItem("tepsy_lang", "en");
    document.cookie = "tepsy_lang=en; Path=/; SameSite=Lax";
  });
  await page.reload();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: "Payment history", exact: true }).click();
    const englishHistory = page.getByRole("dialog", { name: "Payment history", exact: true });
    await englishHistory.locator(".pos-payment-entry").nth(2).waitFor();
    await assertControlsFit(englishHistory, `English history ${width}px`);
    await page.screenshot({
      path: path.join(output, `split-history-en-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
  }
  table.status = "OCCUPIED";
  table.orders = [{ ...order, id: "en-split-order", status: "DELIVERED", payments: [] }];
  await page.goto(base + "/pos");
  await page
    .getByRole("button", { name: new RegExp(table.tableNumber) })
    .first()
    .click();
  await page.locator(".pos-split-disclosure > summary").click();
  await page.getByRole("spinbutton", { name: "Number of people", exact: true }).fill("3");
  await page.getByRole("button", { name: "Split equally", exact: true }).click();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (theme) => document.documentElement.setAttribute("data-theme", theme),
        theme
      );
      await assertControlsFit(
        page.locator(".pos-split-payments"),
        `English split ${width}px ${theme}`
      );
      await page.locator(".pos-split-payments").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(output, `split-plan-en-${width}-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
  assert.deepEqual(fixture.failures, []);
  fs.writeFileSync(
    path.join(output, "split-payments-results.json"),
    JSON.stringify(
      {
        passed: true,
        payments: payments.map((p) => ({
          id: p.id,
          method: p.paymentMethod,
          amount: p.amountPaid,
        })),
        totals: totals(),
        prints: prints.length,
        failures: fixture.failures,
      },
      null,
      2
    )
  );
  console.log(
    "PASS: equal-split rounding/advance, custom mixed methods, manual-card cancellation, per-payment receipts, totals, refresh/completed-table history and safe reprints"
  );
})()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
    if (page)
      await page
        .screenshot({ path: path.join(output, "split-payments-failure.png"), fullPage: true })
        .catch(() => {});
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
