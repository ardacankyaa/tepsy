const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { createPrismaClient } = require("../src/lib/prisma-client.cjs");

const root = path.resolve(__dirname, "..");

function disposableDatabase() {
  const qa = path.join(root, ".tepsy", "qa");
  fs.mkdirSync(qa, { recursive: true });
  const directory = fs.mkdtempSync(path.join(qa, "prisma-client-"));
  const file = path.join(directory, "test.db");
  const ddl = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules", "prisma", "build", "index.js"),
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema",
      path.join(root, "prisma", "schema.prisma"),
      "--script",
    ],
    { cwd: root, encoding: "utf8", windowsHide: true }
  );
  assert.equal(ddl.status, 0, ddl.stderr);
  const db = new DatabaseSync(file);
  db.exec(ddl.stdout);
  db.close();
  return { file, remove: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test("a write outside an open transaction is not rolled back with it", async (t) => {
  const { file, remove } = disposableDatabase();
  const prisma = createPrismaClient("file:" + file.replaceAll("\\", "/"));
  t.after(async () => {
    await prisma.$disconnect();
    remove();
  });
  let release;
  const holding = new Promise((resolve) => (release = resolve));
  let started;
  const begun = new Promise((resolve) => (started = resolve));
  const failed = prisma
    .$transaction(async (tx) => {
      await tx.table.create({ data: { tableNumber: "rolled-back" } });
      started();
      await holding;
      throw new Error("rollback");
    })
    .then(
      () => assert.fail("transaction should roll back"),
      (error) => assert.match(error.message, /rollback/)
    );
  await begun;
  const outside = prisma.table.create({ data: { tableNumber: "outside" } });
  setTimeout(release, 50);
  await Promise.all([failed, outside]);
  const tables = await prisma.table.findMany({ select: { tableNumber: true } });
  assert.deepEqual(
    tables.map((table) => table.tableNumber),
    ["outside"]
  );
});

test("DateTime values keep the epoch-millisecond storage of existing databases", async (t) => {
  const { file, remove } = disposableDatabase();
  const legacy = new DatabaseSync(file);
  const createdAt = Date.UTC(2025, 0, 2, 3, 4, 5, 678);
  legacy
    .prepare(`INSERT INTO "Table" (id, tableNumber, createdAt, updatedAt) VALUES (?, ?, ?, ?)`)
    .run("legacy", "L1", createdAt, createdAt);
  const prisma = createPrismaClient("file:" + file.replaceAll("\\", "/"));
  t.after(async () => {
    await prisma.$disconnect();
    remove();
  });
  const existing = await prisma.table.findUnique({ where: { id: "legacy" } });
  assert.equal(existing.createdAt.getTime(), createdAt);
  await prisma.table.create({ data: { tableNumber: "N1" } });
  const ordered = await prisma.table.findMany({
    where: { createdAt: { gt: new Date(createdAt - 1) } },
    orderBy: { createdAt: "asc" },
  });
  assert.deepEqual(
    ordered.map((table) => table.tableNumber),
    ["L1", "N1"]
  );
  const types = legacy.prepare(`SELECT DISTINCT typeof(createdAt) AS type FROM "Table"`).all();
  legacy.close();
  assert.deepEqual(
    types.map((row) => row.type),
    ["integer"]
  );
});
