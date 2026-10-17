const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeTableInput } = require("../src/lib/table-input.cjs");

test("table names and coordinates are normalized without accepting corrupt layout values", () => {
  assert.deepEqual(
    normalizeTableInput(
      { tableNumber: " Masa 1 ", capacity: "4", posX: 42.5, shape: "ROUND" },
      true
    ),
    { tableNumber: "Masa 1", capacity: 4, posX: 42.5, shape: "ROUND" }
  );
  for (const body of [
    null,
    [],
    {},
    { tableNumber: {} },
    { tableNumber: " " },
    { tableNumber: "Masa", capacity: -1 },
    { tableNumber: "Masa", capacity: 1.5 },
    { tableNumber: "Masa", posX: Infinity },
    { tableNumber: "Masa", posY: 101 },
    { tableNumber: "Masa", shape: "HEXAGON" },
  ])
    assert.throws(() => normalizeTableInput(body, true));
  assert.throws(() => normalizeTableInput({ id: "t1", section: "" }));
  assert.throws(() => normalizeTableInput({ id: "t1", capacity: true }));
});
