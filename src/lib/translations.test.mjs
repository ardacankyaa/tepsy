import test from "node:test";
import assert from "node:assert/strict";
import { translations } from "./translations.mjs";

function keyShape(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, keyShape(value[key])])
    );
  }
  return typeof value;
}

test("Turkish and English share complete application, home, and settings dictionaries", () => {
  assert.deepEqual(keyShape(translations.tr), keyShape(translations.en));

  for (const locale of ["tr", "en"]) {
    for (const section of ["homePage", "settingsPage"]) {
      assert.ok(translations[locale][section], `${locale}.${section} must exist`);
      for (const [key, value] of Object.entries(translations[locale][section])) {
        if (typeof value === "string") {
          assert.ok(value.trim(), `${locale}.${section}.${key} must not be blank`);
        }
      }
    }
  }
});

test("shared home and settings dictionaries retain their localized screen copy", () => {
  assert.equal(translations.tr.homePage.serviceMode, "Operasyon");
  assert.equal(translations.en.homePage.serviceMode, "Service");
  assert.equal(translations.tr.homePage.selectTitle, "Krokiden bir masa seçin");
  assert.equal(translations.en.homePage.selectTitle, "Select a table on the floor plan");
  assert.equal(translations.tr.settingsPage.qrOrdering, "QR üzerinden sipariş");
  assert.equal(translations.en.settingsPage.qrOrdering, "Orders by QR");
  assert.equal(translations.tr.settingsPage.roles.WAITER, "Garson");
  assert.equal(translations.en.settingsPage.roles.WAITER, "Waiter");
});
