const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

// These checks use the real production HTTP API. No request is fulfilled with fixtures.
async function runBrowserChecks({
  base,
  directory,
  api,
  expectStatus,
  tables,
  espresso,
  code,
  owner,
  credentials,
}) {
  const evidence = {
    checks: [],
    screenshots: [],
    pageErrors: [],
    consoleErrors: [],
    network: [],
    failedRequests: [],
    orders: [],
  };
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.TEPSY_BROWSER || process.env.RESTOPOS_BROWSER || "chrome",
  });
  const contexts = [];
  let activePage;
  async function context(options = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
    contexts.push(ctx);
    await ctx.addInitScript(() => {
      // A noopener popup starts with an opaque about:blank document.
      // Only the test setup may skip storage there; application errors stay recorded.
      try {
        localStorage.setItem("tepsy_lang", "en");
        localStorage.setItem("restopos_lang", "en");
        localStorage.setItem("soundEnabled", "false");
      } catch {
        /* Navigation will initialize preferences on the real origin. */
      }
    });
    return ctx;
  }
  async function pageFor(ctx) {
    const page = await ctx.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", (error) =>
      evidence.pageErrors.push({ url: page.url(), error: error.message })
    );
    page.on("console", (message) => {
      if (message.type() === "error")
        evidence.consoleErrors.push({ url: page.url(), message: message.text() });
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin === base)
        evidence.network.push({
          path: url.pathname,
          method: response.request().method(),
          status: response.status(),
        });
    });
    page.on("requestfailed", (request) => {
      // Navigating or reloading legitimately cancels outstanding React fetches.
      if (!request.failure()?.errorText?.includes("ERR_ABORTED"))
        evidence.failedRequests.push({ url: request.url(), error: request.failure()?.errorText });
    });
    activePage = page;
    return page;
  }
  async function open(page, pathname) {
    activePage = page;
    await page.goto(`${base}${pathname}`, { waitUntil: "networkidle" });
  }
  async function shot(page, name) {
    activePage = page;
    const filename = `${name}.png`;
    await page.screenshot({ path: path.join(directory, filename), fullPage: true });
    fs.writeFileSync(path.join(directory, `${name}.html`), await page.content());
    evidence.screenshots.push(filename);
  }
  async function assertNoOverflow(page, label) {
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    assert.ok(
      dimensions.document <= dimensions.viewport + 1,
      `${label} horizontal overflow: ${JSON.stringify(dimensions)}`
    );
  }
  async function login(page, role, name = `QA ${role}`) {
    await open(page, "/login");
    await page.getByRole("button", { name: "Staff", exact: true }).click();
    await page.getByLabel("Restaurant code", { exact: true }).fill(code);
    await page.getByLabel("Staff name", { exact: true }).fill(name);
    await page.getByLabel("Staff PIN", { exact: true }).fill("8246");
    const response = page.waitForResponse(
      (res) => res.url().endsWith("/api/auth/login") && res.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    assert.equal((await response).status(), 200);
    await page.waitForURL(
      `**/${role === "WAITER" ? "order" : role === "KITCHEN" ? "kitchen" : "pos"}`
    );
    await page.waitForLoadState("networkidle");
  }
  try {
    const staffContext = await context();
    const staffPage = await pageFor(staffContext);
    await login(staffPage, "WAITER");
    await open(staffPage, `/order/${tables[5].id}`);
    await staffPage.getByRole("button", { name: /^QA Espresso,/ }).waitFor({ state: "visible" });
    // DOM is inspected after hydration before choosing the product/quantity controls.
    const staffControls = await staffPage.getByRole("button").allTextContents();
    assert.ok(staffControls.some((text) => text.includes("QA Espresso")));
    await staffPage.getByRole("button", { name: /^QA Espresso,/ }).click();
    const dock = staffPage.locator("aside.service-order-dock");
    await dock.getByRole("button", { name: "QA Espresso increase", exact: true }).click();
    await staffPage.getByRole("button", { name: /^QA Tea,/ }).click();
    await dock.getByRole("button", { name: "QA Tea decrease", exact: true }).click();
    assert.equal(await dock.locator(".service-draft-line").count(), 1);
    assert.equal(await dock.locator(".service-draft-line .service-line-quantity").innerText(), "2");
    await dock.getByPlaceholder("Note for the kitchen").fill("Browser staff order");
    await shot(staffPage, "staff-desktop-cart");
    const createdResponse = staffPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/orders" && response.request().method() === "POST"
    );
    await dock.getByRole("button", { name: "SEND ORDER TO KITCHEN", exact: true }).click();
    const creation = await createdResponse;
    assert.equal(creation.status(), 201);
    const staffOrder = await creation.json();
    assert.equal(Number(staffOrder.totalPrice), 85);
    assert.equal(staffOrder.items.length, 1);
    assert.equal(staffOrder.items[0].quantity, 2);
    const firstPayload = JSON.parse(creation.request().postData());
    assert.ok(firstPayload.idempotencyKey, "UI order creation includes a retry key");
    const replay = await staffContext.request.post(`${base}/api/orders`, { data: firstPayload });
    assert.equal(replay.status(), 201);
    assert.equal((await replay.json()).id, staffOrder.id);
    assert.equal(
      expectStatus(await api(`/api/orders?tableId=${tables[5].id}`, { cookie: owner }), 200).length,
      1
    );
    evidence.orders.push({ id: staffOrder.id, source: "STAFF", tableId: tables[5].id, total: 85 });
    await staffPage.reload({ waitUntil: "networkidle" });
    await dock
      .getByRole("region", { name: "Sent orders" })
      .getByText("QA Espresso", { exact: true })
      .waitFor();
    assert.equal(await dock.locator(".service-draft-line").count(), 0);
    await shot(staffPage, "staff-order-persisted");
    await assertNoOverflow(staffPage, "desktop staff");
    evidence.checks.push(
      "staff login, add/increase/remove, submit, retry replay and refresh persistence"
    );

    // A successful submission must release its key so the next draft becomes a new order.
    await staffPage.getByRole("button", { name: /^QA Tea,/ }).click();
    const nextResponse = staffPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/orders" && response.request().method() === "POST"
    );
    await dock.getByRole("button", { name: "SEND ORDER TO KITCHEN", exact: true }).click();
    const nextCreation = await nextResponse;
    assert.equal(nextCreation.status(), 201);
    const nextPayload = JSON.parse(nextCreation.request().postData());
    assert.ok(nextPayload.idempotencyKey);
    assert.notEqual(nextPayload.idempotencyKey, firstPayload.idempotencyKey);
    const nextOrder = await nextCreation.json();
    assert.notEqual(nextOrder.id, staffOrder.id);
    assert.equal(Number(nextOrder.totalPrice), 18.25);
    assert.equal(
      expectStatus(await api(`/api/orders?tableId=${tables[5].id}`, { cookie: owner }), 200).length,
      2
    );
    expectStatus(
      await api(`/api/orders/${nextOrder.id}`, {
        method: "PATCH",
        cookie: owner,
        body: { status: "CANCELLED" },
      }),
      200
    );
    evidence.checks.push("successful staff order allows a distinct next draft and key");

    const kitchenContext = await context();
    const kitchenPage = await pageFor(kitchenContext);
    await login(kitchenPage, "KITCHEN");
    const ticket = kitchenPage
      .locator(".kds-ticket-card")
      .filter({ hasText: tables[5].tableNumber });
    await ticket.click();
    const preparingResponse = kitchenPage.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/orders/${staffOrder.id}`) &&
        response.request().method() === "PATCH"
    );
    await kitchenPage.getByRole("button", { name: "Preparing", exact: true }).click();
    assert.equal((await preparingResponse).status(), 200);
    const readyResponse = kitchenPage.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/orders/${staffOrder.id}`) &&
        response.request().method() === "PATCH"
    );
    await kitchenPage.getByRole("button", { name: "Ready ✓", exact: true }).click();
    assert.equal((await readyResponse).status(), 200);
    assert.equal(
      expectStatus(await api(`/api/orders/${staffOrder.id}`, { cookie: owner }), 200).status,
      "READY"
    );
    await shot(kitchenPage, "kitchen-ready");
    evidence.checks.push("real kitchen login, prepare and ready updates");

    const managerContext = await context();
    const ownerSeparator = owner.indexOf("=");
    await managerContext.addCookies([
      {
        name: owner.slice(0, ownerSeparator),
        value: owner.slice(ownerSeparator + 1),
        url: base,
        httpOnly: true,
        sameSite: "Lax",
      },
      { name: "tepsy_theme", value: "dark", url: base },
    ]);
    const managerPage = await pageFor(managerContext);
    await open(managerPage, "/admin/settings");
    const sharp = require("sharp");
    const logoBytes = await sharp({
      create: { width: 40, height: 40, channels: 4, background: "#ce641b" },
    })
      .png()
      .toBuffer();
    const logoUpload = managerPage.waitForResponse(
      (r) => r.url().endsWith("/api/menu-images") && r.request().method() === "POST"
    );
    await managerPage
      .locator('.restaurant-logo-field input[type="file"]')
      .setInputFiles({ name: "restaurant-logo.png", mimeType: "image/png", buffer: logoBytes });
    assert.equal((await logoUpload).status(), 201);
    await managerPage.getByRole("img", { name: "Business logo preview" }).waitFor();
    const logoSave = managerPage.waitForResponse(
      (r) => r.url().endsWith("/api/config") && r.request().method() === "PUT"
    );
    await managerPage.getByRole("button", { name: "Save general settings", exact: true }).click();
    assert.equal((await logoSave).status(), 200);
    const savedLogo = expectStatus(
      await api("/api/config", { cookie: owner }),
      200
    ).restaurantLogoUrl;
    assert.match(savedLogo, /\/api\/public\/menu-images\//);
    await managerPage.reload({ waitUntil: "networkidle" });
    assert.equal(
      await managerPage.getByRole("img", { name: "Business logo preview" }).getAttribute("src"),
      savedLogo
    );
    await managerPage.getByRole("button", { name: "Remove logo", exact: true }).click();
    const removal = managerPage.waitForResponse(
      (r) => r.url().endsWith("/api/config") && r.request().method() === "PUT"
    );
    await managerPage.getByRole("button", { name: "Save general settings", exact: true }).click();
    assert.equal((await removal).status(), 200);
    assert.equal(
      expectStatus(await api("/api/config", { cookie: owner }), 200).restaurantLogoUrl,
      null
    );
    expectStatus(
      await api("/api/config", {
        method: "PUT",
        cookie: owner,
        body: { restaurantLogoUrl: savedLogo },
      }),
      200
    );
    evidence.checks.push("real restaurant logo upload, save, reload, removal and restored logo");
    await open(managerPage, "/admin/tables");
    const createQrResponse = managerPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/tables/qr") && response.request().method() === "POST"
    );
    await managerPage
      .getByRole("button", { name: new RegExp("QR.*" + tables[7].tableNumber, "i") })
      .click();
    const createdQr = await createQrResponse;
    assert.equal(createdQr.status(), 200);
    const managementQr = await createdQr.json();
    const qrDialog = managerPage.getByRole("dialog").filter({ visible: true });
    await qrDialog.getByRole("img", { name: new RegExp("QR menu code for table") }).waitFor();
    assert.equal(
      await qrDialog.getByRole("link", { name: "Open link", exact: true }).getAttribute("href"),
      managementQr.path
    );
    const popupPromise = managerPage.waitForEvent("popup");
    await qrDialog.getByRole("link", { name: "Open link", exact: true }).click();
    const previewPage = await popupPromise;
    previewPage.on("pageerror", (error) =>
      evidence.pageErrors.push({ url: previewPage.url(), error: error.message })
    );
    await previewPage.getByRole("button", { name: "QA Espresso Add", exact: true }).waitFor();
    assert.equal(new URL(previewPage.url()).origin, base);
    assert.equal(new URL(previewPage.url()).pathname, managementQr.path);
    assert.equal(await previewPage.locator("html").getAttribute("data-theme"), "dark");
    await shot(previewPage, "manager-qr-preview-dark");
    await previewPage.close();
    await managerPage.keyboard.press("Escape");
    evidence.checks.push(
      "real management QR generation and same-origin guest preview preserve the selected theme"
    );

    const token = expectStatus(
      await api("/api/tables/qr", {
        method: "POST",
        cookie: owner,
        body: { tableId: tables[6].id },
      }),
      200
    ).token;
    const customerContext = await context({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const customerPage = await pageFor(customerContext);
    await open(customerPage, `/menu/${token}`);
    await customerPage
      .getByRole("button", { name: "QA Espresso Add", exact: true })
      .waitFor({ state: "visible" });
    assert.equal(
      await customerPage.getByRole("heading", { name: "QA Espresso", exact: true }).count(),
      1
    );
    await customerPage.getByRole("button", { name: "QA Espresso Add", exact: true }).click();
    await customerPage
      .locator(".service-mobile-action-bar")
      .getByRole("button", { name: /Cart/ })
      .click();
    const cart = customerPage.getByRole("dialog");
    await cart.getByRole("button", { name: "QA Espresso increase", exact: true }).click();
    assert.equal(await cart.locator(".service-line-quantity").innerText(), "2");
    await cart.getByLabel("Order note (optional)", { exact: false }).fill("Browser QR order");
    await shot(customerPage, "customer-mobile-cart");
    await assertNoOverflow(customerPage, "mobile customer cart");
    const qrResponse = customerPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/public/orders") && response.request().method() === "POST"
    );
    await cart.getByRole("button", { name: "Send order", exact: true }).click();
    const submission = await qrResponse;
    assert.equal(submission.status(), 202);
    const qrOrder = await submission.json();
    const qrPayload = JSON.parse(submission.request().postData());
    assert.ok(qrPayload.idempotencyKey, "QR UI uses a retry key");
    const qrReplay = await customerContext.request.post(`${base}/api/public/orders`, {
      data: qrPayload,
    });
    assert.equal(qrReplay.status(), 202);
    assert.equal((await qrReplay.json()).orderId, qrOrder.orderId);
    assert.equal(
      expectStatus(await api("/api/qr-requests", { cookie: owner }), 200).filter(
        (order) => order.tableLabel === tables[6].tableNumber
      ).length,
      1
    );
    evidence.orders.push({ id: qrOrder.orderId, source: "QR", tableId: tables[6].id, total: 85 });
    await customerPage.getByTestId("qr-order-pending").waitFor({ state: "visible" });
    await customerPage.reload({ waitUntil: "networkidle" });
    await customerPage.getByTestId("qr-order-pending").waitFor({ state: "visible" });
    expectStatus(
      await api("/api/qr-requests", {
        method: "PATCH",
        cookie: credentials.WAITER,
        body: { id: qrOrder.orderId, action: "APPROVE" },
      }),
      200
    );
    await customerPage.reload({ waitUntil: "networkidle" });
    await customerPage
      .getByText("Your order was accepted by the waiter.", { exact: true })
      .waitFor();
    const persistedQr = expectStatus(
      await api(`/api/orders/${qrOrder.orderId}`, { cookie: owner }),
      200
    );
    assert.equal(persistedQr.items[0].quantity, 2);
    assert.equal(Number(persistedQr.totalPrice), 85);
    assert.equal(persistedQr.tableId, tables[6].id);
    expectStatus(
      await api(`/api/orders/${qrOrder.orderId}`, {
        method: "PATCH",
        cookie: credentials.KITCHEN,
        body: { status: "PREPARING" },
      }),
      200
    );
    await customerPage.reload({ waitUntil: "networkidle" });
    await customerPage.getByText("Your order is being prepared.", { exact: true }).waitFor();
    await shot(customerPage, "customer-mobile-preparing");
    await customerPage.getByRole("button", { name: "TR", exact: true }).click();
    await customerPage.getByText("Siparişiniz hazırlanıyor.", { exact: true }).waitFor();
    await assertNoOverflow(customerPage, "mobile customer status");
    evidence.checks.push(
      "mobile QR cart, submit, retry key, waiter approval, live status on refresh, Turkish switch"
    );

    const ownerContext = await context();
    const separator = owner.indexOf("=");
    await ownerContext.addCookies([
      {
        name: owner.slice(0, separator),
        value: owner.slice(separator + 1),
        url: base,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const floorPage = await pageFor(ownerContext);
    await open(floorPage, "/");
    const cashierContext = await context();
    const cashierPage = await pageFor(cashierContext);
    await login(cashierPage, "CASHIER");
    await open(staffPage, "/order");
    const callResponse = customerPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/public/service-requests") &&
        response.request().method() === "POST"
    );
    await customerPage.getByRole("button", { name: "Garson çağır", exact: true }).click();
    assert.equal((await callResponse).status(), 202);
    await floorPage.getByRole("button", { name: /^Pending requests: 1$/ }).waitFor();
    await floorPage
      .locator(".table-node")
      .filter({ has: floorPage.locator(".table-call-badge") })
      .first()
      .waitFor();
    await staffPage.getByRole("button", { name: /^Pending requests: 1$/ }).click();
    const callsDialog = staffPage.getByRole("dialog", { name: "Pending requests", exact: true });
    await callsDialog.getByText("Waiter call", { exact: true }).waitFor();
    await callsDialog.getByRole("button", { name: "Resolved", exact: true }).click();
    await callsDialog.getByText("No pending requests.", { exact: true }).waitFor();
    await staffPage.keyboard.press("Escape");
    await floorPage.locator(".service-notification-trigger").waitFor({ state: "detached" });
    const billResponse = customerPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/public/service-requests") &&
        response.request().method() === "POST"
    );
    await customerPage.getByRole("button", { name: "Hesap iste", exact: true }).click();
    assert.equal((await billResponse).status(), 202);
    await staffPage.getByRole("button", { name: /^Pending requests: 1$/ }).click();
    await callsDialog.getByText("Bill requested", { exact: true }).waitFor();
    await callsDialog.getByRole("button", { name: "Send to checkout", exact: true }).click();
    await callsDialog.getByText("No pending requests.", { exact: true }).waitFor();
    await staffPage.keyboard.press("Escape");
    await cashierPage.getByRole("button", { name: "List", exact: true }).click();
    await cashierPage
      .locator(".pos-table-card.bill-requested")
      .filter({ hasText: tables[6].tableNumber })
      .waitFor();
    assert.equal(
      expectStatus(await api("/api/tables", { cookie: credentials.CASHIER }), 200).find(
        (table) => table.id === tables[6].id
      ).status,
      "BILL_REQUESTED"
    );
    await shot(floorPage, "floor-bill-request-live");
    await shot(cashierPage, "checkout-bill-request-live");
    evidence.checks.push(
      "real QR waiter call appears on floor and orders; waiter bill approval changes checkout without reload"
    );

    await staffPage.setViewportSize({ width: 390, height: 844 });
    await open(staffPage, "/order");
    await staffPage.getByRole("button", { name: "Open navigation", exact: true }).click();
    const nav = staffPage.getByRole("dialog");
    assert.equal(await nav.getByRole("link", { name: "Management", exact: true }).count(), 0);
    await nav.getByRole("button", { name: "Sign out", exact: true }).click();
    await staffPage.waitForURL("**/login");
    await staffPage.waitForLoadState("networkidle");
    const afterLogout = await staffContext.request.get(`${base}/api/tables`);
    assert.equal(afterLogout.status(), 401);
    await shot(staffPage, "staff-mobile-logout");
    await assertNoOverflow(staffPage, "mobile login");
    evidence.checks.push("mobile role navigation, logout, protected API denies cleared session");

    assert.deepEqual(evidence.pageErrors, [], "browser JavaScript exceptions");
    assert.deepEqual(evidence.consoleErrors, [], "browser console errors");
    assert.deepEqual(evidence.failedRequests, [], "failed browser requests");
    const badResponses = evidence.network.filter((entry) => entry.status >= 400);
    assert.deepEqual(badResponses, [], "unexpected failed browser HTTP responses");
    return evidence;
  } catch (error) {
    if (activePage && !activePage.isClosed()) {
      await shot(activePage, "browser-failure").catch(() => {});
    }
    throw error;
  } finally {
    fs.writeFileSync(
      path.join(directory, "browser-results.json"),
      JSON.stringify(evidence, null, 2)
    );
    for (const ctx of contexts) await ctx.close();
    await browser.close();
  }
}

module.exports = { runBrowserChecks };
