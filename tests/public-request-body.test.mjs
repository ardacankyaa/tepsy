import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readRequestJson } from "../src/lib/request-json.mjs";

async function publicRoute(name, method) {
  const source = (
    await readFile(new URL(`../src/app/api/public/${name}/route.js`, import.meta.url), "utf8")
  )
    .replace(/^import[\s\S]*?from "[^"]+";\r?$/gm, "")
    .replace(/export /g, "");
  const dependencies = {
    readRequestJson,
    NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) },
    normalizeCustomerItems: () => null,
    prisma: {
      table: {
        findUnique: async () => {
          throw new Error("Oversized public input must never reach the database");
        },
      },
    },
  };
  return new Function(...Object.keys(dependencies), `${source}\nreturn ${method};`)(
    ...Object.values(dependencies)
  );
}

test("every public JSON mutation rejects oversized data before database work, including chunked requests", async () => {
  for (const [name, method] of [
    ["orders", "POST"],
    ["orders", "DELETE"],
    ["service-requests", "POST"],
  ]) {
    const handler = await publicRoute(name, method);
    const large = JSON.stringify({
      token: "a".repeat(48),
      type: "WAITER",
      orderId: "order",
      padding: "x".repeat(40_000),
    });
    const request = new Request(`http://localhost/api/public/${name}`, { method, body: large });
    assert.equal(
      (await handler(request)).status,
      413,
      `${method} ${name} needs a streaming size limit`
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
    const chunked = new Request(`http://localhost/api/public/${name}`, {
      method,
      body: stream,
      duplex: "half",
    });
    assert.equal((await handler(chunked)).status, 413);
    assert.equal(cancelled, true);
  }
});

test("bounded JSON accepts a full QR cart and cancels a body that never finishes", async () => {
  const cart = {
    token: "a".repeat(48),
    items: Array.from({ length: 25 }, (_, index) => ({
      menuItemId: `product-${index}`,
      quantity: 20,
      notes: "x".repeat(300),
    })),
    orderNotes: "x".repeat(500),
  };
  assert.deepEqual(
    await readRequestJson(
      new Request("http://localhost/api/public/orders", {
        method: "POST",
        body: JSON.stringify(cart),
      })
    ),
    cart
  );
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    readRequestJson(
      new Request("http://localhost/api/public/orders", { method: "POST", body, duplex: "half" }),
      { timeoutMs: 20 }
    ),
    (e) => e.status === 408
  );
  assert.equal(cancelled, true);
});
