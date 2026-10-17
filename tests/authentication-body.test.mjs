import test from "node:test";
import assert from "node:assert/strict";
import { readAuthenticationBody } from "../src/lib/authentication-body.mjs";

test("authentication JSON stays compatible with normal credentials and rejects invalid JSON", async () => {
  const body = { restaurantCode: "TEST", password: "A password with spaces" };
  assert.deepEqual(
    await readAuthenticationBody(
      new Request("http://localhost/api/auth/login", { method: "POST", body: JSON.stringify(body) })
    ),
    body
  );
  await assert.rejects(
    readAuthenticationBody(
      new Request("http://localhost/api/auth/login", { method: "POST", body: "{" })
    ),
    (e) => e.status === 400
  );
});

test("oversized authentication bodies are rejected for declared and chunked payloads before buffering the full body", async () => {
  await assert.rejects(
    readAuthenticationBody(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Length": "1000000" },
        body: "{}",
      })
    ),
    (e) => e.status === 413
  );
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(8192));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    readAuthenticationBody(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: stream,
        duplex: "half",
      })
    ),
    (e) => e.status === 413
  );
  assert.equal(cancelled, true);
});
