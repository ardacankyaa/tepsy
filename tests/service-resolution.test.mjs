import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (
  await readFile(new URL("../src/app/api/service-requests/route.js", import.meta.url), "utf8")
)
  .replace(/^import[^\r\n]*;?\r?\n/gm, "")
  .replace(/export /g, "");
const NextResponse = { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) };
// Role checks are covered by the route access tests; these cases exercise resolution.
const allowWaiter = async () => ({ session: { userId: "waiter-1", role: "WAITER" } });
const loadPatch = (prisma, io) =>
  new Function("NextResponse", "prisma", "global", "requireStaffRole", `${source}\nreturn PATCH;`)(
    NextResponse,
    prisma,
    { io },
    allowWaiter
  );

for (const type of ["BILL", "WAITER"]) {
  test(`${type} resolution updates the correct table and notifies checkout only for a bill`, async () => {
    const writes = [];
    const events = [];
    const entry = {
      id: "call-1",
      tableId: "table-1",
      type,
      status: "OPEN",
      table: { tableNumber: "Bahçe 1", isArchived: false },
    };
    const prisma = {
      serviceRequest: { findUnique: async () => entry, updateMany: async () => ({ count: 1 }) },
      table: {
        updateMany: async (args) => {
          writes.push(args);
          return { count: 1 };
        },
      },
      $transaction: async (work) => work(prisma),
    };
    const room = {
      to() {
        return this;
      },
      emit(name, data) {
        events.push({ name, data });
      },
    };
    const PATCH = loadPatch(prisma, room);
    const result = await PATCH({ json: async () => ({ id: entry.id, action: "RESOLVE" }) });
    assert.equal(result.status, 200);
    assert.equal(writes.length, type === "BILL" ? 1 : 0);
    if (type === "BILL") {
      assert.equal(writes[0].where.id, entry.tableId);
      assert.equal(writes[0].data.status, "BILL_REQUESTED");
      assert.ok(
        events.some(
          (event) => event.name === "table:bill_requested" && event.data.id === entry.tableId
        )
      );
    }
    assert.ok(
      events.some((event) => event.name === "service:resolved" && event.data.id === entry.id)
    );
  });
}

test("a previously resolved bill cannot change the table or emit another notification", async () => {
  const prisma = {
    serviceRequest: {
      findUnique: async () => ({
        id: "call-1",
        type: "BILL",
        tableId: "table-1",
        status: "RESOLVED",
      }),
      updateMany: async () => ({ count: 0 }),
    },
    table: { updateMany: async () => assert.fail("must not update table") },
    $transaction: async (work) => work(prisma),
  };
  const PATCH = loadPatch(prisma, {
    to() {
      assert.fail("must not emit");
    },
  });
  assert.equal(
    (await PATCH({ json: async () => ({ id: "call-1", action: "RESOLVE" }) })).status,
    409
  );
});
