const test = require("node:test");
const assert = require("node:assert/strict");
const { isLegalPath } = require("../src/lib/legal-paths.cjs");

test("only the three informational pages are public legal paths", () => {
  for (const path of ["/privacy", "/terms", "/cookies"]) assert.equal(isLegalPath(path), true);
  for (const path of ["/privacy/admin", "/api/privacy", "/admin", "/terms-extra", "", null])
    assert.equal(isLegalPath(path), false);
});
