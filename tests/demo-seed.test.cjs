const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path");
test("demo seed rejects missing explicit test database before constructing a database client", () => {
  let clients = 0;
  const count = async () => 1;
  const fake = class {
    constructor() {
      clients++;
      for (const key of ["table", "order", "payment", "staffUser", "category"])
        this[key] = { count };
      this.restaurantConfig = { findFirst: async () => ({ isSetupCompleted: true }) };
      this.$disconnect = async () => {};
    }
  };
  const source = fs.readFileSync("prisma/seed.js", "utf8");
  assert.throws(
    () =>
      vm.runInNewContext(source, {
        require: (name) =>
          name === "../src/lib/prisma-client.cjs"
            ? { createPrismaClient: () => new fake() }
            : name.startsWith("node:")
              ? require(name)
              : require(path.resolve("prisma", name)),
        process: { env: {}, cwd: () => process.cwd(), exit: () => {} },
        console: { log: () => {}, error: () => {} },
      }),
    /SEED_DATABASE_URL/
  );
  assert.equal(clients, 0);
});

test("demo seed accepts a dedicated initialized QA database and rejects live/outside/missing paths", () => {
  const { resolveSeedDatabaseUrl } = require("../src/lib/demo-seed-policy.cjs");
  const qa = path.resolve(".tepsy/qa"),
    root = fs.mkdtempSync(path.join(qa, "demo-seed-policy-"));
  assert.ok(root.startsWith(qa + path.sep));
  try {
    const target = path.join(root, ".tepsy", "qa", "demo.db");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "");
    const url = "file:" + target.replaceAll("\\", "/");
    assert.equal(resolveSeedDatabaseUrl({ TEPSY_SEED_DATABASE_URL: url }, root), url);
    assert.equal(resolveSeedDatabaseUrl({ RESTOPOS_SEED_DATABASE_URL: url }, root), url);
    assert.throws(
      () => resolveSeedDatabaseUrl({ TEPSY_SEED_DATABASE_URL: url, TEPSY_DATABASE_URL: url }, root),
      /restaurant database/
    );
    for (const candidate of [
      "file:" + path.join(root, "prisma", "dev.db"),
      "file:" + path.join(root, "..", "outside.db"),
      url + "?x=1",
      "https://localhost/demo.db",
      "file:" + path.join(root, ".tepsy", "qa", "missing.db"),
    ]) {
      assert.throws(() => resolveSeedDatabaseUrl({ TEPSY_SEED_DATABASE_URL: candidate }, root));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
