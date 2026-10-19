import test from "node:test";
import assert from "node:assert/strict";
import { selectReportCurrency } from "../src/lib/report-currency.mjs";
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
