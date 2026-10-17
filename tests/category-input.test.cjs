const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeCategoryInput } = require("../src/lib/category-input.cjs");

test("category creation normalizes a bounded name and typed defaults", () => {
  assert.deepEqual(normalizeCategoryInput({ name: "  İçecekler  " }), {
    name: "İçecekler",
    sortOrder: 0,
    icon: "Coffee",
  });
  assert.deepEqual(normalizeCategoryInput({ name: "Food", sortOrder: 2, icon: "Utensils" }), {
    name: "Food",
    sortOrder: 2,
    icon: "Utensils",
  });
});

test("category rejects malformed scalar fields before database access", () => {
  for (const body of [
    null,
    [],
    { name: 4 },
    { name: " " },
    { name: "x".repeat(121) },
    { name: "a", sortOrder: true },
    { name: "a", sortOrder: 1.2 },
    { name: "a", sortOrder: 100001 },
    { name: "a", icon: {} },
  ]) {
    assert.throws(
      () => normalizeCategoryInput(body),
      (error) => error.status === 400
    );
  }
});

test("category update requires a typed ID and at least one valid field", () => {
  assert.deepEqual(normalizeCategoryInput({ id: "c1", sortOrder: 0 }, true), { sortOrder: 0 });
  for (const body of [
    { id: true, name: "a" },
    { id: "c1" },
    { id: "c1", name: "" },
    { id: "c1", icon: "" },
  ]) {
    assert.throws(
      () => normalizeCategoryInput(body, true),
      (error) => error.status === 400
    );
  }
});
