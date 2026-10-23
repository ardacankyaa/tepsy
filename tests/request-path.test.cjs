const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalRequestPath, policyRequestPath } = require("../src/lib/request-path.cjs");

test("percent-encoded letters are decoded to the path Next.js routes", () => {
  assert.equal(canonicalRequestPath("/api/%62ackup"), "/api/backup");
  assert.equal(canonicalRequestPath("/%61dmin/settings?tab=1"), "/admin/settings");
  assert.equal(canonicalRequestPath("/api/%72eports/z-report#x"), "/api/reports/z-report");
  assert.equal(canonicalRequestPath("/api/%41UDIT"), "/api/AUDIT");
  assert.equal(policyRequestPath(canonicalRequestPath("/api/%41UDIT")), "/api/audit");
  assert.equal(canonicalRequestPath("/"), "/");
  assert.equal(canonicalRequestPath("/order/"), "/order");
  assert.equal(canonicalRequestPath("/menu/%C3%A7ay"), "/menu/çay");
});

test("ambiguous or malformed request paths are refused", () => {
  for (const target of [
    "",
    "*",
    "api/backup",
    "http://localhost/api/backup",
    "//api/backup",
    "/api//backup",
    "/api/backup//",
    "/api%2fbackup",
    "/api%2Fbackup",
    "/api%5cbackup",
    "/api%5Cbackup",
    "/api\\backup",
    "/api/./backup",
    "/api/x/../backup",
    "/api/%2e%2e/backup",
    "/api/%2E/backup",
    "/api/backup/..",
    "/api/%",
    "/api/%6",
    "/api/%zz",
    "/api/%E0%A4%A",
    "/api/%252fbackup",
    "/api/%00backup",
    "/api/back%0aup",
    "/" + "a".repeat(5000),
  ]) {
    assert.equal(canonicalRequestPath(target), null, target);
  }
});
