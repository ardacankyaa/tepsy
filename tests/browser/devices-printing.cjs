const { createFixture, base, output } = require("./fixture.cjs");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
let browser;
(async () => {
  const f = await createFixture({ hasTouch: true });
  browser = f.browser;
  const { page, failures } = f;
  page.setDefaultTimeout(10000);
  await page.addInitScript(() => {
    window.print = () => {
      window.top.__printCalls = (window.top.__printCalls || 0) + 1;
      window.top.__printText = document.body.innerText;
    };
  });
  let config = {
    version: 1,
    network: { qrBaseUrl: "" },
    receiptPrinter: {
      enabled: true,
      adapter: "TCP_ESC_POS",
      host: "127.0.0.1",
      port: 9100,
      charsPerLine: 32,
      cutPaper: false,
      openCashDrawer: true,
    },
    paymentTerminal: { enabled: false, adapter: "MANUAL" },
  };
  const saved = [],
    prints = [],
    scenes = [];
  let terminalFails = false;
  const table = {
    id: "print-table",
    tableNumber: "Baski masa",
    section: "Salon",
    status: "OCCUPIED",
    shape: "SQUARE",
    width: 96,
    height: 96,
    posX: 20,
    posY: 20,
    orders: [],
  };
  const order = {
    id: "print-order",
    tableId: table.id,
    status: "DELIVERED",
    totalPrice: 700,
    discountAmount: 0,
    payments: [],
    items: Array.from({ length: 70 }, (_, i) => ({
      id: "print-item-" + i,
      menuItemName: "PRINT ITEM " + String(i + 1).padStart(3, "0"),
      quantity: 1,
      unitPrice: 10,
    })),
  };
  table.orders = [order];
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    let data,
      status = 200;
    if (u.pathname === "/api/devices") {
      if (req.method() === "PUT") {
        config = req.postDataJSON();
        saved.push(config);
      }
      data = { config };
    } else if (u.pathname === "/api/devices/printer/test") data = { success: true, accepted: true };
    else if (u.pathname === "/api/devices/payment/status") {
      if (terminalFails) {
        status = 503;
        data = { success: false, error: "QA terminal unreachable" };
      } else
        data = {
          success: true,
          status: {
            connected: true,
            implemented: false,
            canInitiatePayment: false,
            message: "QA reachable; no bank approval",
          },
        };
    } else if (u.pathname === "/api/print/receipt") {
      prints.push(req.postDataJSON());
      data = { success: true, accepted: true };
    } else if (u.pathname === "/api/tables") data = [table];
    else if (u.pathname === "/api/orders") data = [order];
    else {
      await route.fallback();
      return;
    }
    await route.fulfill({ status, json: data });
  });
  for (const lang of ["tr", "en"]) {
    await page.goto(base + "/login");
    await page.evaluate((lang) => localStorage.setItem("tepsy_lang", lang), lang);
    await page.goto(base + "/admin/settings");
    await page
      .getByRole("button", { name: lang === "tr" ? "QR ve cihazlar" : "QR & devices", exact: true })
      .click();
    const panel = page.locator("#device-settings"),
      width = panel.getByRole("spinbutton", { name: /Satır genişliği|Characters per line/ });
    assert.equal(await width.inputValue(), "32");
    const cutter = panel.getByRole("checkbox", { name: /Fiş sonunda|Cut paper/ }),
      drawer = panel.getByRole("checkbox", { name: /para çekmecesini|cash drawer/ });
    assert.equal(await cutter.isChecked(), false);
    assert.equal(await drawer.isChecked(), true);
    for (const viewport of [320, 768]) {
      await page.setViewportSize({ width: viewport, height: 900 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (theme) => document.documentElement.setAttribute("data-theme", theme),
          theme
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false
        );
        for (const input of [width, cutter, drawer]) await input.click({ trial: true });
        scenes.push({ lang, width: viewport, theme });
      }
    }
    await panel
      .locator("header")
      .getByRole("button", { name: lang === "tr" ? "Kaydet" : "Save", exact: true })
      .click();
    await page.waitForFunction(
      () => !document.querySelector("#device-settings header button:disabled")
    );
    assert.equal(saved.at(-1).receiptPrinter.charsPerLine, 32);
    assert.equal(saved.at(-1).receiptPrinter.cutPaper, false);
    assert.equal(saved.at(-1).receiptPrinter.openCashDrawer, true);
    await panel
      .getByRole("button", { name: lang === "tr" ? "Test fişi" : "Test receipt", exact: true })
      .click();
    await page.waitForFunction(() => !document.querySelector("#device-settings button:disabled"));
    await panel
      .getByRole("combobox", { name: /Bağlantı yöntemi|Connection method/ })
      .selectOption("BROWSER");
    await panel
      .getByRole("button", { name: lang === "tr" ? "Test fişi" : "Test receipt", exact: true })
      .click();
    await page.waitForFunction(() => window.__printCalls >= 1);
    assert.match(
      await page.evaluate(() => window.__printText),
      lang === "tr" ? /TEST FİŞİ/ : /TEST RECEIPT/
    );
    await panel
      .getByRole("combobox", { name: /Entegrasyon|Integration/ })
      .selectOption("NEXO_LOCAL");
    await panel.getByRole("textbox", { name: /Terminal IP/ }).fill("127.0.0.1");
    await panel
      .getByRole("button", {
        name: lang === "tr" ? "Bağlantıyı test et" : "Test connection",
        exact: true,
      })
      .click();
    await panel
      .getByText(lang === "tr" ? "Ağda erişilebilir" : "Reachable on network", { exact: true })
      .waitFor();
    terminalFails = true;
    await panel
      .getByRole("button", {
        name: lang === "tr" ? "Bağlantıyı test et" : "Test connection",
        exact: true,
      })
      .click();
    await panel
      .getByText(lang === "tr" ? "Bağlantı yok" : "Not connected", { exact: true })
      .waitFor();
    terminalFails = false;
    config.receiptPrinter = {
      enabled: true,
      adapter: "TCP_ESC_POS",
      host: "127.0.0.1",
      port: 9100,
      charsPerLine: 32,
      cutPaper: false,
      openCashDrawer: true,
    };
  }
  await page.goto(base + "/pos");
  await page
    .getByRole("button", { name: /Baski masa/ })
    .first()
    .click();
  await page.locator(".pos-preview-button").click();
  const receipt = page.locator("#printable-receipt");
  await receipt.waitFor();
  assert.equal(await receipt.locator(".receipt-paper-items>div").count(), 70);
  await page.getByRole("button", { name: "Send to receipt printer", exact: true }).click();
  await page.getByRole("button", { name: "Print receipt again", exact: true }).waitFor();
  assert.equal(prints.at(-1).kind, "BILL");
  await page.getByRole("button", { name: "Print from browser", exact: true }).click();
  await page.waitForFunction(() => window.__printCalls >= 1);
  await page.emulateMedia({ media: "print" });
  assert.equal(
    await receipt
      .locator(".receipt-paper-items")
      .evaluate((el) => el.scrollHeight > el.clientHeight + 1),
    false,
    "all item rows must be expanded for printing"
  );
  for (const [name, size] of [
    ["58mm", { width: "58mm", height: "200mm" }],
    ["a4", { format: "A4" }],
  ]) {
    await page.pdf({
      path: path.join(output, "long-receipt-" + name + ".pdf"),
      ...size,
      printBackground: true,
    });
  }
  assert.deepEqual(failures, []);
  fs.writeFileSync(
    path.join(output, "devices-printing-results.json"),
    JSON.stringify({ passed: true, scenes, items: 70, pageErrors: failures }, null, 2)
  );
  console.log(
    "PASS: printer settings retained, browser test receipt, terminal status resets, long 58mm/A4 print PDFs, unpaid bill identity"
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  if (browser) await browser.close();
  process.exitCode = 1;
});
