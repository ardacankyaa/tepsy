const { createFixture, base, output } = require("./fixture.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
let browser;

// A disposable Engine.IO polling peer: the application uses its actual Socket.IO client.
// No live socket, order, shift or payment is changed by this test.
async function pollingPeer(page) {
  let offline = false,
    serial = 0;
  const sessions = new Map();
  function deliver(session) {
    if (session.poll && session.messages.length) {
      const route = session.poll;
      session.poll = null;
      route
        .fulfill({ contentType: "text/plain", body: session.messages.splice(0).join("\x1e") })
        .catch(() => {
          // Navigation/transport loss can cancel an already queued polling response.
          sessions.delete(session.id);
        });
    }
  }
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    for (const session of sessions.values()) session.poll?.abort("failed").catch(() => {});
    sessions.clear();
  });
  await page.route("**/socket.io/**", async (route) => {
    if (offline) return route.abort("failed");
    const request = route.request(),
      url = new URL(request.url());
    const sid = url.searchParams.get("sid");
    if (!sid) {
      const id = "qa-" + ++serial;
      sessions.set(id, { id, messages: [], poll: null });
      return route.fulfill({
        contentType: "text/plain",
        body:
          "0" +
          JSON.stringify({
            sid: id,
            upgrades: [],
            pingInterval: 60000,
            pingTimeout: 60000,
            maxPayload: 1000000,
          }),
      });
    }
    const session = sessions.get(sid);
    if (!session) return route.fulfill({ status: 400, body: "Unknown test session" });
    if (request.method() === "POST") {
      if ((request.postData() || "").split("\x1e").some((packet) => packet.startsWith("40"))) {
        session.messages.push("40" + JSON.stringify({ sid }));
        deliver(session);
      }
      return route.fulfill({ contentType: "text/plain", body: "ok" });
    }
    session.poll = route;
    deliver(session);
  });
  return {
    emit(event, data = {}) {
      for (const session of sessions.values()) {
        session.messages.push("42" + JSON.stringify([event, data]));
        deliver(session);
      }
    },
    async disconnect() {
      offline = true;
      for (const session of sessions.values()) {
        if (session.poll) {
          await session.poll.abort("failed").catch(() => {});
          session.poll = null;
        }
      }
      sessions.clear();
    },
    reconnect() {
      offline = false;
    },
  };
}
(async () => {
  const fixture = await createFixture();
  browser = fixture.browser;
  const { page, failures } = fixture;
  const peer = await pollingPeer(page);
  let ticket = "Before outage",
    shift = null;
  await page.route("**/api/orders?activeOnly=true", (route) =>
    route.fulfill({
      json: [
        {
          id: "realtime-ticket",
          status: "PENDING",
          createdAt: new Date().toISOString(),
          table: { id: "t0", tableNumber: ticket, section: "Salon" },
          items: [
            {
              id: "realtime-item",
              quantity: 1,
              status: "PENDING",
              menuItemName: "Soup",
              unitPrice: 50,
            },
          ],
        },
      ],
    })
  );
  await page.route("**/api/pos/shift", (route) => route.fulfill({ json: { currentShift: shift } }));
  await page.goto(base + "/kitchen");
  await page.locator(".kds-ticket-card").filter({ hasText: "Before outage" }).waitFor();
  await page
    .getByRole("button", { name: "Görünüm ve tercihler", exact: true })
    .filter({ visible: true })
    .click();
  await page.locator('.nav-connection[data-connected="true"]').waitFor();
  await page.keyboard.press("Escape");
  await peer.disconnect();
  await page.locator(".connection-warning").waitFor({ timeout: 10000 });
  ticket = "Arrived while offline";
  peer.reconnect();
  await page.locator(".kds-ticket-card").filter({ hasText: ticket }).waitFor({ timeout: 15000 });
  await page.locator(".connection-warning").waitFor({ state: "hidden" });

  await page.goto(base + "/pos");
  await page.locator(".pos-shift-status.is-closed").waitFor();
  // The initial closed indicator can render before the new document connects.
  // Wait for the actual Socket.IO state before sending another client's event.
  await page
    .getByRole("button", { name: "Görünüm ve tercihler", exact: true })
    .filter({ visible: true })
    .click();
  await page.locator('.nav-connection[data-connected="true"]').waitFor();
  await page.keyboard.press("Escape");
  shift = {
    id: "shift-opened-elsewhere",
    status: "OPEN",
    openingCash: 100,
    openedAt: new Date().toISOString(),
  };
  peer.emit("cash-shift:opened", { shiftId: shift.id });
  await page.locator(".pos-shift-status.is-open").waitFor();
  shift = null;
  peer.emit("cash-shift:closed", { shiftId: "shift-opened-elsewhere" });
  await page.locator(".pos-shift-status.is-closed").waitFor();

  // Reconnect must refresh shifts even when the notification itself was missed.
  await peer.disconnect();
  await page.locator(".connection-warning").waitFor({ timeout: 10000 });
  shift = {
    id: "shift-opened-offline",
    status: "OPEN",
    openingCash: 200,
    openedAt: new Date().toISOString(),
  };
  peer.reconnect();
  await page.locator(".pos-shift-status.is-open").waitFor({ timeout: 15000 });
  await page.locator(".connection-warning").waitFor({ state: "hidden" });

  // A concurrent close conflict refreshes the state so the cashier can recover.
  await page.getByRole("button", { name: "Kasa vardiyasını kapat", exact: true }).click();
  await page.locator(".pos-shift-cash-field input").fill("200");
  shift = null;
  let closePosts = 0;
  await page.route("**/api/pos/shift", async (route) => {
    if (route.request().method() === "PATCH") {
      closePosts++;
      return route.fulfill({
        status: 409,
        json: { code: "shift-already-closed", error: "Vardiya başka cihazda kapatıldı." },
      });
    }
    return route.fulfill({ json: { currentShift: shift } });
  });
  await page
    .getByRole("dialog", { name: "Kasa vardiyasını kapat", exact: true })
    .getByRole("button", { name: "Vardiyayı kapat", exact: true })
    .click();
  await page.getByRole("alert").filter({ hasText: "Vardiya başka cihazda kapatıldı." }).waitFor();
  assert.equal(closePosts, 1);
  await page.locator(".pos-shift-status.is-closed").waitFor();
  assert.deepEqual(failures, []);
  fs.writeFileSync(
    output + "/realtime-recovery-results.json",
    JSON.stringify(
      {
        passed: true,
        kitchenReconnect: true,
        disconnectWarning: true,
        shiftEvents: true,
        shiftReconnect: true,
        shiftConflictRecovery: true,
        failures,
      },
      null,
      2
    )
  );
  console.log(
    "PASS kitchen outage recovery, visible disconnect warning and shared cashier shift events/reconnect/conflict"
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  if (browser) await browser.close();
  process.exitCode = 1;
});
