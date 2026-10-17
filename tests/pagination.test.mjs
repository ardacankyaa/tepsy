import test from "node:test";
import assert from "node:assert/strict";
import { paginate } from "../src/lib/pagination.mjs";

test("pagination reaches all 150 tables without changing total or record order", () => {
  const rows = Array.from({ length: 150 }, (_, id) => ({ id }));
  const seen = [];
  for (let page = 1; page <= 13; page++) seen.push(...paginate(rows, page, 12).items);
  assert.deepEqual(seen, rows);
  assert.equal(paginate(rows, 13, 12).total, 150);
  assert.equal(paginate(rows, 13, 12).start, 145);
});
test("a deleted final page clamps to the last valid page and empty data stays navigable", () => {
  assert.equal(paginate([1, 2, 3], 10, 2).page, 2);
  assert.deepEqual(paginate([], 3, 12), {
    items: [],
    page: 1,
    pageCount: 1,
    total: 0,
    start: 0,
    end: 0,
  });
  assert.equal(paginate([1, 2], -1, 0).page, 1);
});
