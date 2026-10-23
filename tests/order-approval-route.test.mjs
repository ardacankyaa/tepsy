import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as finance from "../src/lib/finance.mjs";
import * as workflow from "../src/lib/order-workflow.mjs";
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

const source = (
  await readFile(new URL("../src/app/api/orders/[id]/route.js", import.meta.url), "utf8")
)
  .replace(/^import[\s\S]*?from [^\r\n]*;\r?\n/gm, "")
  .replace(/export /g, "");
const NextResponse = { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) };

function loadPatch(prisma) {
  const identity = (value) => value;
  return new Function(
    "NextResponse",
    "prisma",
    "global",
    "recordAudit",
    "sessionFromRequest",
    "calculateItemsTotalCents",
    "centsToMoney",
    "FinanceError",
    "moneyToCents",
    "isOrderActionAllowedForRole",
    "OrderWorkflowError",
    "validateOrderPatch",
    "preferOrderItemNameSnapshots",
    "preferTableOrderItemNameSnapshots",
    "readRequestJson",
    `${source}\nreturn PATCH;`
  )(
    NextResponse,
    prisma,
    {},
    async () => {},
    () => null,
    finance.calculateItemsTotalCents,
    finance.centsToMoney,
    finance.FinanceError,
    finance.moneyToCents,
    workflow.isOrderActionAllowedForRole,
    workflow.OrderWorkflowError,
    workflow.validateOrderPatch,
    identity,
    identity,
    readRequestJson
  );
}

function approvalPrisma({ tableStatus = "AVAILABLE", tableAvailable = true } = {}) {
  const tableWrites = [];
  const order = {
    id: "order-1",
    tableId: "table-1",
    status: "AWAITING_WAITER_APPROVAL",
    items: [],
    payments: [],
    table: { id: "table-1", status: tableStatus },
  };
  const prisma = {
    restaurantConfig: { findFirst: async () => null },
    order: {
      findUnique: async () => order,
      updateMany: async () => ({ count: 1 }),
    },
    table: {
      updateMany: async (args) => {
        tableWrites.push(args);
        return { count: tableAvailable ? 1 : 0 };
      },
      findUnique: async () => ({ id: "table-1", status: "OCCUPIED", orders: [] }),
    },
    $transaction: async (work) => work(prisma),
  };
  return { prisma, tableWrites };
}

const approve = { json: async () => ({ status: "PENDING" }) };
const params = { params: Promise.resolve({ id: "order-1" }) };

test("approving a QR order through the order route occupies its table", async () => {
  const { prisma, tableWrites } = approvalPrisma();
  const result = await loadPatch(prisma)(approve, params);
  assert.equal(result.status, 200);
  assert.equal(tableWrites.length, 1);
  assert.deepEqual(tableWrites[0].where, { id: "table-1", isArchived: false });
  assert.equal(tableWrites[0].data.status, "OCCUPIED");
});

test("approval keeps a requested bill and refuses an archived table", async () => {
  const kept = approvalPrisma({ tableStatus: "BILL_REQUESTED" });
  await loadPatch(kept.prisma)(approve, params);
  assert.equal(kept.tableWrites[0].data.status, "BILL_REQUESTED");

  const archived = approvalPrisma({ tableAvailable: false });
  const result = await loadPatch(archived.prisma)(approve, params);
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "table-conflict");
});
