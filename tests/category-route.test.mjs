import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (
  await readFile(new URL("../src/app/api/categories/route.js", import.meta.url), "utf8")
)
  .replace(/^import[^\r\n]*;?\r?\n/gm, "")
  .replace(/export /g, "");
const NextResponse = { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) };

function loadDelete(productCount) {
  const deleted = [];
  const prisma = {
    menuItem: { count: async () => productCount },
    category: {
      delete: async (args) => {
        deleted.push(args.where.id);
        return { id: args.where.id };
      },
    },
    $transaction: async (work) => work(prisma),
  };
  const DELETE = new Function(
    "NextResponse",
    "prisma",
    "normalizeCategoryInput",
    "global",
    "requireStaffRole",
    `${source}\nreturn DELETE;`
  )(
    NextResponse,
    prisma,
    () => ({}),
    {},
    async () => ({ session: { role: "ADMIN" } })
  );
  return { DELETE, deleted };
}

const request = { url: "http://localhost/api/categories?id=cat-1" };

test("a category with products is refused instead of cascading product deletion", async () => {
  const { DELETE, deleted } = loadDelete(3);
  const result = await DELETE(request);
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "category-not-empty");
  assert.deepEqual(deleted, []);
});

test("an empty category can be deleted", async () => {
  const { DELETE, deleted } = loadDelete(0);
  const result = await DELETE(request);
  assert.equal(result.status, 200);
  assert.deepEqual(deleted, ["cat-1"]);
});
