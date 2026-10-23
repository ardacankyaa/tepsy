import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readRequestJson } from "../src/lib/request-json.mjs";
import { PaymentRequestError } from "../src/lib/payment-request.mjs";

const untouched = new Proxy(
  {},
  {
    get() {
      throw new Error("Oversized staff input must never reach the database");
    },
  }
);

async function staffRoute(route, method, dependencies) {
  const source = (
    await readFile(new URL(`../src/app/api/${route}/route.js`, import.meta.url), "utf8")
  )
    .replace(/^import[\s\S]*?from "[^"]+";\r?$/gm, "")
    .replace(/export /g, "");
  const all = {
    readRequestJson,
    NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) },
    prisma: untouched,
    requireStaffRole: async () => ({ session: { userId: "owner", role: "ADMIN" } }),
    ...dependencies,
  };
  return new Function(...Object.keys(all), `${source}\nreturn ${method};`)(...Object.values(all));
}

function oversized(url, method, bytes) {
  return new Request(url, { method, body: JSON.stringify({ padding: "x".repeat(bytes) }) });
}

function endless(url, method) {
  const state = { cancelled: false };
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(16384));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { request: new Request(url, { method, body, duplex: "half" }), state };
}

test("payment and order updates reject oversized and endless bodies before database work", async () => {
  const handlers = [
    [
      "pos/payment",
      "POST",
      await staffRoute("pos/payment", "POST", {
        authorizePaymentAccess: async () => null,
        PaymentRequestError,
      }),
      300 * 1024,
    ],
    ["orders/[id]", "PATCH", await staffRoute("orders/[id]", "PATCH", {}), 40 * 1024],
  ];
  for (const [route, method, handler, size] of handlers) {
    const url = `http://localhost/api/${route.replace("[id]", "order-1")}`;
    const context = { params: Promise.resolve({ id: "order-1" }) };
    const declared = await handler(oversized(url, method, size), context);
    assert.equal(declared.status, 413, `${method} ${route} declared length`);
    const { request, state } = endless(url, method);
    assert.equal((await handler(request, context)).status, 413, `${method} ${route} chunked`);
    assert.equal(state.cancelled, true);
    const malformed = new Request(url, { method, body: "{" });
    assert.equal((await handler(malformed, context)).status, 400, `${method} ${route} malformed`);
  }
});

test("no staff API route parses an unbounded request body", async () => {
  const { readdir } = await import("node:fs/promises");
  const root = new URL("../src/app/api/", import.meta.url);
  const pending = [root];
  const offenders = [];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const location = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) pending.push(location);
      else if (entry.name === "route.js") {
        const source = await readFile(location, "utf8");
        if (/\b(?:request|req)\.(?:json|text|formData|arrayBuffer)\(\)/.test(source))
          offenders.push(location.pathname);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
