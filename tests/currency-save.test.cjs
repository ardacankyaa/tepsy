const test = require("node:test"),
  assert = require("node:assert/strict");
const { saveCurrency } = require("../src/lib/currency-save.cjs");
test("currency save requires server confirmation before accepting a new currency", async () => {
  const calls = [];
  const currency = await saveCurrency(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ currency: "€" }) };
  }, "$");
  assert.equal(currency, "€");
  assert.equal(calls[0].url, "/api/config");
  assert.equal(calls[0].options.method, "PUT");
  assert.deepEqual(JSON.parse(calls[0].options.body), { currency: "$" });
});
test("failed, offline or malformed currency save cannot be applied", async () => {
  await assert.rejects(() => saveCurrency(async () => ({ ok: false, status: 403 }), "$"), /403/);
  await assert.rejects(
    () =>
      saveCurrency(async () => {
        throw Error("offline");
      }, "$"),
    /offline/
  );
  await assert.rejects(
    () =>
      saveCurrency(async () => ({ ok: true, json: async () => ({ currency: "invalid" }) }), "$"),
    /invalid-currency-response/
  );
  let calls = 0;
  await assert.rejects(
    () =>
      saveCurrency(async () => {
        calls++;
      }, "invalid"),
    /unsupported/
  );
  assert.equal(calls, 0);
});
