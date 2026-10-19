import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import logo from "../src/lib/restaurant-logo.cjs";
import setupPolicy from "../src/lib/setup-policy.cjs";
const imageUrl = "/api/public/menu-images/" + "a".repeat(64) + ".webp";
const json = (body, options = {}) => ({ body, status: options.status || 200 });
async function route(name, dependencies) {
  const source = (
    await readFile(new URL("../src/app/api/" + name + "/route.js", import.meta.url), "utf8")
  )
    .replace(/^import[\s\S]*?from "[^"]+";\r?$/gm, "")
    .replace(/export /g, "");
  return new Function(
    ...Object.keys(dependencies),
    source +
      '\nreturn { POST: typeof POST === "function" ? POST : undefined, PUT: typeof PUT === "function" ? PUT : undefined, GET: typeof GET === "function" ? GET : undefined };'
  )(...Object.values(dependencies));
}
test("restaurant logo accepts only uploaded local assets and explicit removal", () => {
  assert.equal(logo.normalizeRestaurantLogoUrl(imageUrl), imageUrl);
  assert.equal(logo.normalizeRestaurantLogoUrl(null), null);
  assert.equal(logo.normalizeRestaurantLogoUrl(""), null);
  assert.equal(logo.normalizeRestaurantLogoUrl(undefined), undefined);
  for (const value of [
    "https://example.com/logo.png",
    "//example.com/logo.webp",
    "/brand/logo.png",
    imageUrl + "?evil",
    "/api/public/menu-images/../secret",
    {},
    1,
  ])
    assert.throws(
      () => logo.normalizeRestaurantLogoUrl(value),
      (error) => error.status === 400
    );
});
test("config persists, broadcasts, retains, and clears optional restaurant logo", async () => {
  let config = {
    id: "config",
    restaurantName: "Test Cafe",
    accessPasswordHash: null,
    authEnabled: false,
  };
  const events = [];
  const api = await route("config", {
    NextResponse: { json },
    prisma: {
      $transaction: async function (fn) {
        return fn(this);
      },
      order: { count: async () => 0 },
      payment: { count: async () => 0 },
      cashShift: { count: async () => 0 },
      restaurantConfig: {
        findFirst: async () => config,
        update: async ({ data }) => (config = { ...config, ...data }),
      },
    },
    normalizeRestaurantLogoUrl: logo.normalizeRestaurantLogoUrl,
    normalizeRestaurantCode: (value) => value,
    isValidTimeZone: () => true,
    global: { io: { emit: (event, data) => events.push([event, data]) } },
    invalidateAuthConfigCache: () => {},
    disconnectAllSockets: () => {},
  });
  const put = (body) => api.PUT({ json: async () => body });
  assert.equal((await put({ restaurantLogoUrl: imageUrl })).status, 200);
  assert.equal((await api.GET()).body.restaurantLogoUrl, imageUrl);
  assert.equal(events.at(-1)[1].restaurantLogoUrl, imageUrl);
  assert.equal((await put({ restaurantName: "Renamed Cafe" })).body.restaurantLogoUrl, imageUrl);
  assert.equal((await put({ restaurantLogoUrl: "https://evil.example/logo.svg" })).status, 400);
  assert.equal(config.restaurantLogoUrl, imageUrl);
  assert.equal((await put({ restaurantLogoUrl: null })).body.restaurantLogoUrl, null);
});
test("QR menu exposes restaurant logo without exposing owner credentials", async () => {
  const api = await route("public/menu", {
    NextResponse: { json },
    prisma: {
      table: { findUnique: async () => ({ tableNumber: "A-1", isArchived: false }) },
      restaurantConfig: {
        findFirst: async () => ({ restaurantName: "Test Cafe", restaurantLogoUrl: imageUrl }),
      },
      category: { findMany: async () => [] },
    },
  });
  const response = await api.GET({
    url: "http://localhost/api/public/menu?token=" + "a".repeat(48),
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.restaurant.logoUrl, imageUrl);
  assert.equal(response.body.restaurant.accessPasswordHash, undefined);
});
test("setup logo upload is permitted only on empty local installation", async () => {
  let stored = 0;
  let read = 0;
  let state = { config: null, tables: 0, orders: 0, payments: 0, staff: 0, categories: 0 };
  const api = await route("setup/logo", {
    NextResponse: { json },
    prisma: {
      restaurantConfig: { findFirst: async () => state.config },
      table: { count: async () => state.tables },
      order: { count: async () => state.orders },
      payment: { count: async () => state.payments },
      staffUser: { count: async () => state.staff },
      category: { count: async () => state.categories },
    },
    canAccessInitialSetup: setupPolicy.canAccessInitialSetup,
    canRunSetup: setupPolicy.canRunSetup,
    readImageRequest: async () => {
      read++;
      return { bytes: Buffer.from("sanitized fixture"), type: "image/png" };
    },
    storeMenuImage: async () => {
      stored++;
      return { imageUrl };
    },
  });
  const upload = (ip) => api.POST({ headers: new Headers(ip ? { "x-tepsy-client-ip": ip } : {}) });
  for (const ip of [null, "192.168.1.22"]) assert.equal((await upload(ip)).status, 403);
  assert.equal(stored, 0);
  assert.equal(read, 0);
  assert.equal((await upload("127.0.0.1")).status, 201);
  assert.equal(stored, 1);
  for (const changes of [
    { config: { isSetupCompleted: true } },
    { config: { accessPasswordHash: "hash" } },
    { tables: 1 },
    { orders: 1 },
    { payments: 1 },
    { staff: 1 },
    { categories: 1 },
  ]) {
    state = {
      config: null,
      tables: 0,
      orders: 0,
      payments: 0,
      staff: 0,
      categories: 0,
      ...changes,
    };
    assert.equal((await upload("::1")).status, 409);
  }
  assert.equal(stored, 1);
  assert.equal(read, 1);
});
