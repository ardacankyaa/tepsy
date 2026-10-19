import test from "node:test";
import assert from "node:assert/strict";
import * as reportCurrency from "../src/lib/report-currency.mjs";
const { selectReportCurrency } = reportCurrency;

test("report controls retain the requested historical currency and a route back to current currency", () => {
  for (const selected of ["€", "unknown"]) {
    assert.deepEqual(
      reportCurrency.reportCurrencyOptions({
        currentCurrency: "₺",
        selected,
        availableCurrencies: ["₺"],
      }),
      ["₺", selected]
    );
    assert.deepEqual(
      reportCurrency.reportCurrencyOptions({ currentCurrency: "₺", selected }),
      ["₺", selected],
      "Loading and failed reports must still allow returning to the current currency"
    );
  }
});
test("currency controls deduplicate current/selected values and label unknown historical units", () => {
  assert.deepEqual(
    reportCurrency.reportCurrencyOptions({
      currentCurrency: "₺",
      selected: "unknown",
      availableCurrencies: ["₺", "€", null, "€"],
    }),
    ["₺", "unknown", "€"]
  );
});

test("a historical currency with no activity stays empty instead of converting or relabeling TL", () => {
  const result = selectReportCurrency({
    currentCurrency: "₺",
    requested: "€",
    payments: [{ id: "tl", idempotencyKey: "tl" }],
    orders: [],
    refunds: [],
    attempts: [
      { idempotencyKey: "tl", responseJson: JSON.stringify({ receipt: { currency: "₺" } }) },
    ],
  });
  assert.equal(result.currency, "€");
  assert.deepEqual(result.payments, []);
  assert.deepEqual(result.availableCurrencies, ["₺"]);
});

test("historical TL and EUR collections never combine or relabel unknown legacy amounts", () => {
  const input = {
    currentCurrency: "€",
    payments: [
      { id: "tl", idempotencyKey: "tl" },
      { id: "eur", idempotencyKey: "eur" },
      { id: "old" },
    ],
    orders: [],
    refunds: [],
    attempts: [
      { idempotencyKey: "tl", responseJson: JSON.stringify({ receipt: { currency: "₺" } }) },
      { idempotencyKey: "eur", responseJson: JSON.stringify({ receipt: { currency: "€" } }) },
    ],
  };
  assert.deepEqual(
    selectReportCurrency(input).payments.map((p) => p.id),
    ["eur"]
  );
  assert.deepEqual(
    selectReportCurrency({ ...input, requested: "₺" }).payments.map((p) => p.id),
    ["tl"]
  );
  assert.deepEqual(
    selectReportCurrency({ ...input, requested: "unknown" }).payments.map((p) => p.id),
    ["old"]
  );
});
