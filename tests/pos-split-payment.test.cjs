const test = require("node:test");
const assert = require("node:assert/strict");
const {
  splitRemainingBalance,
  parseAmountCents,
  centsAmount,
} = require("../src/lib/pos-split-payment.cjs");

test("three people share 100 without losing a cent, with remainder assigned once", () => {
  assert.deepEqual(splitRemainingBalance("100.00", 3), [3334, 3333, 3333]);
  assert.deepEqual(splitRemainingBalance("0.03", 3), [1, 1, 1]);
  assert.deepEqual(splitRemainingBalance("12,35", 2), [618, 617]);
});
test("equal sharing rejects zero, fractional people and shares below one cent", () => {
  for (const [amount, count] of [
    ["0", 2],
    ["0.01", 2],
    ["100", 0],
    ["100", 1.5],
    ["100", 51],
    ["abc", 2],
  ])
    assert.throws(() => splitRemainingBalance(amount, count), RangeError);
});
test("split input keeps exact cents and rejects ambiguous or excessive precision", () => {
  assert.equal(parseAmountCents(" 33,34 "), 3334);
  assert.equal(centsAmount(3334), "33.34");
  for (const value of ["1.001", "1e3", "-1", "1.000,00", {}, "9007199254740992"])
    assert.equal(parseAmountCents(value), null);
});
