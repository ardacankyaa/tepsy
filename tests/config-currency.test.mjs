import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeRestaurantLogoUrl } from "../src/lib/restaurant-logo.cjs";
// Request doubles expose json(); real-stream size limits are covered in request-body tests.
const readRequestJson = async (request) => {
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error("Invalid JSON request body."), {
      code: "invalid-json-body",
      status: 400,
    });
  }
};
const source = (await readFile(new URL("../src/app/api/config/route.js", import.meta.url), "utf8"))
  .replace(/^import[\s\S]*?from "[^"]+";\r?$/gm, "")
  .replace(/export /g, "");
function route(active) {
  let currency = "₺";
  const client = {
    restaurantConfig: {
      findFirst: async () => ({ id: "config", currency, authEnabled: false }),
      update: async ({ data }) => ({
        id: "config",
        currency: (currency = data.currency || currency),
      }),
    },
    order: { count: async () => (active ? 1 : 0) },
    payment: { count: async () => 0 },
    cashShift: { count: async () => 0 },
  };
  client.$transaction = (fn) => fn(client);
  const deps = {
    readRequestJson,
    requireStaffRole: async () => ({ session: { userId: "owner", role: "ADMIN" } }),
    prisma: client,
    normalizeRestaurantLogoUrl,
    normalizeRestaurantCode: (v) => v,
    isValidTimeZone: () => true,
    global: {},
    NextResponse: { json: (body, o = {}) => ({ body, status: o.status || 200 }) },
    console: { error() {} },
  };
  return new Function(...Object.keys(deps), source + "\nreturn {GET, PUT}")(...Object.values(deps));
}
test("currency cannot reinterpret recorded orders, including closed accounts", async () => {
  const r = route(true);
  assert.equal((await r.PUT({ json: async () => ({ currency: "€" }) })).status, 409);
  assert.equal((await r.GET()).body.currency, "₺");
});
test("a fresh business can choose currency and saving the existing currency remains valid", async () => {
  assert.equal((await route(false).PUT({ json: async () => ({ currency: "€" }) })).status, 200);
  assert.equal((await route(true).PUT({ json: async () => ({ currency: "₺" }) })).status, 200);
});
