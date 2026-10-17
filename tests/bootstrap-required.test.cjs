const test = require("node:test");
const assert = require("node:assert/strict");

let createBootstrapAccessResponse;
try {
  ({ createBootstrapAccessResponse } = require("../src/lib/bootstrap-required-response.cjs"));
} catch {
  // Keep the pre-implementation failure as an assertion about the missing behavior.
}

test("bootstrap browser response directs staff to server-local settings without echoing request host", () => {
  assert.equal(
    typeof createBootstrapAccessResponse,
    "function",
    "a browser-facing bootstrap response is required"
  );
  const response = createBootstrapAccessResponse({ isApi: false, port: 3042 });
  assert.equal(response.contentType, "text/html; charset=utf-8");
  assert.match(response.body, /http:\/\/localhost:3042\/admin\/settings/);
  assert.match(response.body, /sunucu bilgisayarında/i);
  assert.doesNotMatch(response.body, /evil\.example/);
});

test("bootstrap API response stays JSON and validates the settings port", () => {
  assert.equal(
    typeof createBootstrapAccessResponse,
    "function",
    "a browser-facing bootstrap response is required"
  );
  const apiResponse = createBootstrapAccessResponse({ isApi: true, port: 3042 });
  assert.equal(apiResponse.contentType, "application/json; charset=utf-8");
  assert.equal(
    JSON.parse(apiResponse.body).error,
    "Yönetici şifresi sunucu bilgisayarında ayarlanmadan ağ erişimi açılamaz."
  );
  const browserResponse = createBootstrapAccessResponse({ isApi: false, port: '3000"><script>' });
  assert.match(browserResponse.body, /http:\/\/localhost:3000\/admin\/settings/);
  assert.doesNotMatch(browserResponse.body, /<script>/);
});

test("remote bootstrap screen shows a copyable server URL without linking to client localhost", () => {
  assert.equal(
    typeof createBootstrapAccessResponse,
    "function",
    "a browser-facing bootstrap response is required"
  );
  const response = createBootstrapAccessResponse({ isApi: false, port: 3042 });
  assert.doesNotMatch(response.body, /<a\b/i);
  assert.match(response.body, /TEPSY sunucu bilgisayarındaki tarayıcıya şu adresi yazın/);
});
