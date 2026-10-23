import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEFAULT_FLOOR_ELEMENTS } from "../src/lib/floor-elements.mjs";
import setupPolicy from "../src/lib/setup-policy.cjs";
import menuInput from "../src/lib/menu-input.cjs";
import setupCredentials from "../src/lib/setup-credentials.cjs";
import restaurantLogo from "../src/lib/restaurant-logo.cjs";
import { hashCredential, verifyCredential } from "../src/lib/auth-local.js";

const response = (body, options = {}) => ({ body, status: options.status ?? 200 });

async function loadRoute(path, routeDependencies) {
  // Role checks are covered by route-access tests; these cases exercise route logic.
  const dependencies = {
    requireStaffRole: async () => ({ session: { userId: "owner", role: "ADMIN" } }),
    ...routeDependencies,
  };
  const routeSource = (await readFile(new URL(path, import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?from "[^"]+";\r?$/gm, "")
    .replace(/export /g, "");
  return new Function(
    ...Object.keys(dependencies),
    `${routeSource}\nreturn { GET: typeof GET === 'function' ? GET : undefined, POST: typeof POST === 'function' ? POST : undefined, PUT: typeof PUT === 'function' ? PUT : undefined };`
  )(...Object.values(dependencies));
}

async function configRoute(prisma) {
  return loadRoute("../src/app/api/config/route.js", {
    NextResponse: { json: response },
    prisma,
    normalizeRestaurantCode: (value) => value,
    normalizeRestaurantLogoUrl: restaurantLogo.normalizeRestaurantLogoUrl,
    isValidTimeZone: () => true,
    disconnectAllSockets: () => {},
    invalidateAuthConfigCache: () => {},
    global: {},
  });
}

function setupDatabase({ seed, failOn } = {}) {
  let committed = {
    config: null,
    tables: [],
    orders: [],
    payments: [],
    orderItems: [],
    staff: [],
    categories: [],
    menuItems: [],
    floorElements: [],
    ...(seed || {}),
  };
  const calls = { transactions: 0, deletes: 0 };

  function makeClient(getState, setState, transaction = false) {
    const failIfRequested = (name) => {
      if (failOn === name) throw new Error(`failed at ${name}`);
    };
    const readArray = (name) => getState()[name];
    const insert = (name, data, idPrefix) => {
      failIfRequested(`${name}.create`);
      const rows = readArray(name);
      const row = { id: `${idPrefix}-${rows.length + 1}`, ...structuredClone(data) };
      setState({ ...getState(), [name]: [...rows, row] });
      return row;
    };
    const removeAll = (name) => {
      calls.deletes += 1;
      setState({ ...getState(), [name]: [] });
      return { count: 0 };
    };

    return {
      restaurantConfig: {
        findFirst: async () => structuredClone(getState().config),
        create: async ({ data }) => {
          failIfRequested("restaurantConfig.create");
          if (getState().config) throw new Error("Unique config ID already exists");
          const config = { id: "config", ...structuredClone(data) };
          setState({ ...getState(), config });
          return config;
        },
        update: async ({ data }) => {
          failIfRequested("restaurantConfig.update");
          const config = { ...getState().config, ...structuredClone(data) };
          setState({ ...getState(), config });
          return config;
        },
        upsert: async ({ create, update }) => {
          if (getState().config)
            return makeClient(getState, setState, transaction).restaurantConfig.update({
              data: update,
            });
          return makeClient(getState, setState, transaction).restaurantConfig.create({
            data: create,
          });
        },
        deleteMany: async () => removeAll("config"),
      },
      table: {
        count: async () => readArray("tables").length,
        create: async ({ data }) => insert("tables", data, "table"),
        deleteMany: async () => removeAll("tables"),
      },
      order: {
        count: async () => readArray("orders").length,
        deleteMany: async () => removeAll("orders"),
      },
      payment: {
        count: async () => readArray("payments").length,
        deleteMany: async () => removeAll("payments"),
      },
      orderItem: { deleteMany: async () => removeAll("orderItems") },
      staffUser: { count: async () => readArray("staff").length },
      category: {
        count: async () => readArray("categories").length,
        create: async ({ data }) => insert("categories", data, "category"),
        deleteMany: async () => removeAll("categories"),
      },
      menuItem: {
        create: async ({ data }) => insert("menuItems", data, "menu-item"),
        deleteMany: async () => removeAll("menuItems"),
      },
      floorElement: {
        createMany: async ({ data }) => {
          failIfRequested("floorElement.createMany");
          setState({
            ...getState(),
            floorElements: [...readArray("floorElements"), ...structuredClone(data)],
          });
          return { count: data.length };
        },
        deleteMany: async () => removeAll("floorElements"),
      },
    };
  }

  const root = makeClient(
    () => committed,
    (next) => {
      committed = next;
    }
  );
  root.$transaction = async (callback) => {
    calls.transactions += 1;
    let draft = structuredClone(committed);
    const tx = makeClient(
      () => draft,
      (next) => {
        draft = next;
      },
      true
    );
    const result = await callback(tx);
    committed = draft;
    return result;
  };
  return { prisma: root, state: () => structuredClone(committed), calls };
}

const validSetup = {
  restaurantName: "Test Cafe",
  restaurantCode: "CAFE01",
  ownerPassword: "OwnerPassword123",
  ownerPasswordConfirm: "OwnerPassword123",
  currency: "₺",
  sections: [{ name: "Inside", tableCount: 20 }],
  categories: [{ name: "Coffee", items: [{ name: "Tea", price: 10, description: "Hot tea" }] }],
};

async function setupRoute(database) {
  return loadRoute("../src/app/api/setup/route.js", {
    NextResponse: { json: response },
    prisma: database.prisma,
    DEFAULT_FLOOR_ELEMENTS,
    canRunSetup: setupPolicy.canRunSetup,
    normalizeMenuInput: menuInput.normalizeMenuInput,
    normalizeSetupCredentials: setupCredentials.normalizeSetupCredentials,
    normalizeRestaurantLogoUrl: restaurantLogo.normalizeRestaurantLogoUrl,
    hashCredential,
    invalidateAuthConfigCache: () => {},
    disconnectAllSockets: () => {},
    global: { io: null },
  });
}

test("config GET returns setup defaults without persisting or completing setup", async () => {
  let createCalls = 0;
  const api = await configRoute({
    restaurantConfig: {
      findFirst: async () => null,
      create: async () => {
        createCalls += 1;
        throw new Error("GET must not persist config");
      },
    },
  });

  const result = await api.GET();

  assert.equal(result.status, 200);
  assert.equal(createCalls, 0);
  assert.equal(result.body.isSetupCompleted, false);
  assert.equal(result.body.hasAccessPassword, false);
  assert.equal(result.body.restaurantName, "Restoranım");
});

test("config PUT rejects malformed identity fields before database writes", async () => {
  for (const body of [
    null,
    [],
    { restaurantName: {} },
    { ownerName: {} },
    { tagline: [] },
    { restaurantCode: "   " },
  ]) {
    const api = await configRoute({
      restaurantConfig: {
        findFirst: async () => ({ id: "config", isSetupCompleted: true }),
        create: async () => {
          assert.fail("Invalid configuration persisted");
        },
        update: async () => {
          assert.fail("Invalid configuration persisted");
        },
      },
    });
    const result = await api.PUT({ json: async () => body });
    assert.equal(result.status, 400);
  }
});

test("config PUT returns 400 for invalid JSON", async () => {
  const api = await configRoute({});
  const result = await api.PUT({
    json: async () => {
      throw new SyntaxError("invalid JSON");
    },
  });
  assert.equal(result.status, 400);
});

test("setup validates input before any transaction or database mutation", async () => {
  const database = setupDatabase();
  const api = await setupRoute(database);
  const result = await api.POST({
    json: async () => ({
      ...validSetup,
      sections: [{ name: "  ", tableCount: 1 }],
    }),
  });

  assert.equal(result.status, 400);
  assert.deepEqual(database.state().tables, []);
  assert.equal(database.state().config, null);
  assert.equal(database.calls.transactions, 0);
});

test("setup completes an existing unconfigured restaurant without replacing its preferences", async () => {
  const database = setupDatabase({
    seed: {
      config: {
        id: "config",
        isSetupCompleted: false,
        defaultLanguage: "en",
        timeZone: "Europe/London",
        ownerName: "Owner",
      },
    },
  });
  const api = await setupRoute(database);
  const result = await api.POST({ json: async () => validSetup });
  assert.equal(result.status, 200);
  assert.equal(database.state().config.restaurantName, "Test Cafe");
  assert.equal(database.state().config.isSetupCompleted, true);
  assert.equal(database.state().config.defaultLanguage, "en");
  assert.equal(database.state().config.ownerName, "Owner");
});

test("setup rejects malformed JSON as a client error without writing", async () => {
  const database = setupDatabase();
  const api = await setupRoute(database);
  const result = await api.POST({
    json: async () => {
      throw new SyntaxError("Invalid JSON");
    },
  });
  assert.equal(result.status, 400);
  assert.equal(database.calls.transactions, 0);
});

test("setup rejects malformed collections and missing product prices", async () => {
  for (const categories of [
    { name: "Not an array" },
    [{ name: "Coffee", items: "bad" }],
    [{ name: "Coffee", items: [{ name: "Tea", price: null }] }],
    [{ name: "Coffee", items: [{ name: "Tea", price: "" }] }],
  ]) {
    const database = setupDatabase();
    const api = await setupRoute(database);
    const result = await api.POST({ json: async () => ({ ...validSetup, categories }) });
    assert.equal(result.status, 400);
    assert.equal(database.calls.transactions, 0);
  }
});

test("setup atomically creates data without deleting and keeps all table positions in bounds", async () => {
  const database = setupDatabase();
  const api = await setupRoute(database);
  const result = await api.POST({ json: async () => validSetup });

  assert.equal(result.status, 200);
  assert.equal(database.calls.transactions, 1);
  assert.equal(database.calls.deletes, 0);
  assert.equal(database.state().config.isSetupCompleted, true);
  assert.equal(database.state().config.authEnabled, true);
  assert.equal(database.state().config.restaurantCode, "CAFE01");
  assert.notEqual(database.state().config.accessPasswordHash, validSetup.ownerPassword);
  assert.ok(verifyCredential(validSetup.ownerPassword, database.state().config.accessPasswordHash));
  assert.equal(database.state().tables.length, 20);
  assert.equal(database.state().categories.length, 1);
  assert.equal(database.state().menuItems.length, 1);
  assert.ok(
    database
      .state()
      .tables.every(
        (table) => table.posX >= 0 && table.posX <= 100 && table.posY >= 0 && table.posY <= 100
      )
  );
});

test("a failure during setup rolls back every earlier setup write", async () => {
  const database = setupDatabase({ failOn: "categories.create" });
  const api = await setupRoute(database);
  const result = await api.POST({ json: async () => validSetup });

  assert.equal(result.status, 500);
  assert.equal(database.calls.transactions, 1);
  assert.equal(database.state().config, null);
  assert.deepEqual(database.state().tables, []);
  assert.deepEqual(database.state().categories, []);
});

test("setup rechecks existing business data inside the transaction and preserves it", async () => {
  const existingOrder = { id: "order-1" };
  const database = setupDatabase({ seed: { orders: [existingOrder] } });
  const api = await setupRoute(database);
  const result = await api.POST({ json: async () => validSetup });

  assert.equal(result.status, 409);
  assert.equal(database.calls.transactions, 1);
  assert.deepEqual(database.state().orders, [existingOrder]);
  assert.equal(database.state().config, null);
  assert.deepEqual(database.state().tables, []);
});

test("setup gives sections with the same initials unique table numbers", async () => {
  const database = setupDatabase();
  const api = await setupRoute(database);
  const result = await api.POST({
    json: async () => ({
      ...validSetup,
      sections: [
        { name: "Inside", tableCount: 1 },
        { name: "Indoor", tableCount: 1 },
      ],
    }),
  });

  assert.equal(result.status, 200);
  assert.equal(new Set(database.state().tables.map((table) => table.tableNumber)).size, 2);
});

test("setup rejects missing, weak or mismatched owner credentials without any writes", async () => {
  for (const patch of [
    { restaurantCode: "" },
    { restaurantCode: "a".repeat(33) },
    { restaurantCode: "BAD CODE" },
    { ownerPassword: undefined },
    { ownerPassword: "short", ownerPasswordConfirm: "short" },
    { ownerPasswordConfirm: "different" },
    { ownerPassword: " ".repeat(8), ownerPasswordConfirm: " ".repeat(8) },
  ]) {
    const database = setupDatabase();
    const api = await setupRoute(database);
    const result = await api.POST({ json: async () => ({ ...validSetup, ...patch }) });
    assert.equal(result.status, 400);
    assert.equal(database.calls.transactions, 0);
    assert.equal(database.state().config, null);
  }
});
test("setup persists a valid optional local business logo and rejects arbitrary logo paths", async () => {
  const database = setupDatabase();
  const api = await setupRoute(database);
  const restaurantLogoUrl = "/api/public/menu-images/" + "a".repeat(64) + ".webp";
  assert.equal(
    (await api.POST({ json: async () => ({ ...validSetup, restaurantLogoUrl }) })).status,
    200
  );
  assert.equal(database.state().config.restaurantLogoUrl, restaurantLogoUrl);
  for (const restaurantLogoUrl of [
    "https://other.example/logo.png",
    "/private/secret",
    "data:image/png;base64,abc",
  ]) {
    const isolated = setupDatabase();
    const route = await setupRoute(isolated);
    assert.equal(
      (await route.POST({ json: async () => ({ ...validSetup, restaurantLogoUrl }) })).status,
      400
    );
    assert.equal(isolated.calls.transactions, 0);
  }
});
