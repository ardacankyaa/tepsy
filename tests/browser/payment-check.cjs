const { output } = require("./fixture.cjs");
module.exports = async (page) => {
  const origin = page.url().split("/").slice(0, 3).join("/");
  let mode = "manual";
  let confirmedPayments = 0;
  let attempts = 0;
  const table = {
    id: "ui-table",
    tableNumber: "Test Masa",
    section: "Salon",
    capacity: 4,
    status: "OCCUPIED",
    x: 150,
    y: 150,
    width: 100,
    height: 100,
    orders: [
      {
        id: "ui-order",
        status: "DELIVERED",
        totalPrice: 100,
        payments: [],
        items: [
          {
            id: "ui-item",
            quantity: 1,
            unitPrice: 100,
            menuItem: { name: "Test kahve", price: 100 },
          },
        ],
      },
    ],
  };
  await page.route("**/api/**", async (route) => {
    const path = "/" + route.request().url().split("/").slice(3).join("/").split("?")[0];
    let status = 200;
    let data = [];
    if (path === "/api/config") data = { restaurantName: "Arayüz testi", defaultLanguage: "tr" };
    if (path === "/api/auth/status") data = { authEnabled: false, session: { role: "ADMIN" } };
    if (path === "/api/tables")
      data = [
        table,
        {
          ...table,
          id: "terrace",
          tableNumber: "Teras Masa",
          section: "Teras",
          orders: [],
          status: "AVAILABLE",
        },
      ];
    if (path === "/api/pos/shift") data = { currentShift: { id: "shift", status: "OPEN" } };
    if (path === "/api/pos/payment") {
      attempts++;
      const body = route.request().postDataJSON();
      if (mode === "terminal") {
        status = 503;
        data = {
          code: "terminal-payment-unavailable",
          error: "Terminal onayı alınamadı; ödeme kaydedilmedi.",
        };
      } else if (!body.manualCardConfirmed) {
        status = 409;
        data = { code: "manual-card-confirmation-required" };
      } else {
        confirmedPayments++;
        data = {
          success: true,
          amountPaid: "100.00",
          remainingBalance: "0.00",
          cardVerification: "MANUAL",
          grossTotal: "100.00",
          discountAmount: "0.00",
          netTotal: "100.00",
        };
      }
    }
    if (path === "/api/print/receipt") {
      status = 503;
      data = { error: "Test: yazıcı bağlı değil." };
    }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${origin}/order`);
  await page.getByRole("button", { name: "Liste", exact: true }).click();
  const list = page.getByRole("list", { name: "Masa listesi" });
  await list.getByRole("button", { name: /Test Masa/ }).waitFor();
  if ((await list.getByRole("button").count()) !== 1) throw new Error("Section filtering failed");
  await page.getByRole("combobox", { name: /Bölüm/ }).selectOption("Teras");
  await list.getByRole("button", { name: /Teras Masa/ }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw new Error("Mobile horizontal overflow");
  await page.screenshot({ path: output + "/order-list-mobile.png" });
  await list.getByRole("button", { name: /Teras Masa/ }).click();
  await page.waitForURL("**/order/terrace");

  await page.goto(`${origin}/pos`);
  await page
    .getByRole("button", { name: /Test Masa/ })
    .first()
    .click();
  const manualPrompt = page.getByRole("dialog", { name: "Manuel kart kaydını onayla" });
  await page.getByRole("button", { name: "KREDİ KARTI", exact: true }).click();
  await manualPrompt.waitFor();
  await manualPrompt.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await page.waitForFunction(
    () => ![...document.querySelectorAll(".pos-confirm-dialog")].some((dialog) => dialog.open)
  );
  if (confirmedPayments !== 0 || attempts !== 1) throw new Error("Cancel recorded payment");

  mode = "terminal";
  await page.getByRole("button", { name: "KREDİ KARTI", exact: true }).click();
  await page.getByText("Terminal onayı alınamadı; ödeme kaydedilmedi.", { exact: true }).waitFor();
  if (confirmedPayments !== 0) throw new Error("Terminal failure recorded payment");

  mode = "manual";
  await page.getByRole("button", { name: "KREDİ KARTI", exact: true }).click();
  await manualPrompt
    .getByRole("button", { name: "Harici terminalde tahsil ettim", exact: true })
    .click();
  await page
    .getByText("Kart ödemesi görevli onayıyla manuel kaydedildi. TEPSY banka tahsilatı yapmadı.")
    .waitFor();
  await page.getByRole("button", { name: "Fiş yazıcısına gönder", exact: true }).click();
  await page.getByText(/Yeniden ödeme almayın/).waitFor();
  if (confirmedPayments !== 1) throw new Error("Printing changed payment count");
  await page.screenshot({ path: output + "/manual-card-printer-error.png" });
  await page.getByRole("button", { name: "Kapat", exact: true }).click();
  if (confirmedPayments !== 1) throw new Error("Closing receipt charged again");
  await page.evaluate(() => {
    window.__orderPaymentChecksPassed = true;
  });
  console.log(
    "PASS: section-filtered list, mobile layout, table navigation, manual cancel, terminal failure, manual confirmation and independent print error"
  );
};
