const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeMenuInput, isAllowedMenuImageUrl } = require("../src/lib/menu-input.cjs");

test("accepts a two-decimal nonnegative price and explicit availability", () => {
  assert.deepEqual(
    normalizeMenuInput(
      { name: "  Kahve  ", categoryId: "cat1", price: "12.30", isAvailable: false },
      false
    ),
    {
      name: "Kahve",
      categoryId: "cat1",
      price: "12.30",
      isAvailable: false,
    }
  );
});

test("rejects malformed prices instead of silently rounding or parsing a prefix", () => {
  for (const price of ["12.345", "12abc", "-1", "NaN", Infinity, "", null, ["12.30"], [], {}]) {
    assert.throws(
      () => normalizeMenuInput({ name: "Tea", categoryId: "cat1", price }, false),
      /fiyat/i
    );
  }
});

test("menu image URLs are limited to HTTPS or same-origin root-relative paths", () => {
  for (const url of ["https://cdn.example.test/tea.jpg", "/images/tea.jpg"])
    assert.equal(isAllowedMenuImageUrl(url), true);
  for (const url of [
    "http://cdn.example.test/tea.jpg",
    "//cdn.example.test/tea.jpg",
    "javascript:alert(1)",
    "data:image/png;base64,abc",
    "/\\cdn.example.test/tea.jpg",
  ]) {
    assert.equal(isAllowedMenuImageUrl(url), false);
    assert.throws(
      () => normalizeMenuInput({ name: "Tea", categoryId: "cat1", price: 5, imageUrl: url }, false),
      /Görsel adresi/
    );
  }
});

test("rejects malformed booleans and empty names on update", () => {
  assert.throws(() => normalizeMenuInput({ isAvailable: "false" }, true), /stok/i);
  assert.throws(() => normalizeMenuInput({ name: "   " }, true), /ad/i);
  assert.deepEqual(normalizeMenuInput({ price: 5, isAvailable: true }, true), {
    price: "5.00",
    isAvailable: true,
  });
});
