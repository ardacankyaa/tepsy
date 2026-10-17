const test = require("node:test");
const assert = require("node:assert/strict");
const { isValidTimeZone } = require("../src/lib/time-zone.cjs");

test("restaurant timezone accepts IANA zones and rejects arbitrary strings", () => {
  assert.equal(isValidTimeZone("Europe/Istanbul"), true);
  assert.equal(isValidTimeZone("UTC"), true);
  assert.equal(isValidTimeZone("Tomorrow/Noon"), false);
});
