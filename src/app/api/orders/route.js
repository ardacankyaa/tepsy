export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireStaffRole } from "@/lib/route-access.mjs";
import { recordAudit } from "@/lib/audit.mjs";
import { orderListPage } from "@/lib/order-list-query.cjs";
import { normalizeOrderRequest } from "@/lib/order-input.mjs";
import {
  calculateItemsTotalCents,
  centsToMoney,
  FinanceError,
  moneyToCents,
} from "@/lib/finance.mjs";
import {
  findIdempotentOrder,
  optionalOrderIdempotencyKey,
  orderRequestFingerprint,
  OrderIdempotencyError,
  preferOrderItemNameSnapshots,
  withOrderIdempotencyLock,
} from "@/lib/order-idempotency-server.mjs";

const ACTIVE_ORDER_STATUSES = ["PENDING", "PREPARING", "READY", "DELIVERED"];
const ORDER_RESPONSE_INCLUDE = {
  table: { select: { id: true, tableNumber: true, section: true } },
  items: {
    where: { status: { not: "CANCELLED" } },
    include: {
      menuItem: { select: { id: true, name: true, price: true } },
    },
  },
};

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const tableId = searchParams.get("tableId");
    const status = searchParams.get("status");
    const activeOnly = searchParams.get("activeOnly") === "true";

    if (status === "AWAITING_WAITER_APPROVAL") {
      return NextResponse.json([]);
    }

    const where = {};
    if (tableId) where.tableId = tableId;

    if (status) {
      where.status = status;
    } else if (activeOnly) {
      where.status = { in: ACTIVE_ORDER_STATUSES };
    } else {
      where.status = { not: "AWAITING_WAITER_APPROVAL" };
    }

    const shouldPage =
      searchParams.has("limit") ||
      searchParams.has("cursor") ||
      (!activeOnly && !status && !tableId);
    const orders = await prisma.order.findMany({
      where,
      ...(shouldPage ? orderListPage(searchParams) : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        table: {
          select: { id: true, tableNumber: true, section: true },
        },
        items: {
          where: { status: { not: "CANCELLED" } },
          include: {
            menuItem: {
              select: { id: true, name: true, price: true, categoryId: true },
            },
          },
        },
      },
    });

    return NextResponse.json(orders.map(preferOrderItemNameSnapshots));
  } catch (error) {
    console.error("GET /api/orders error:", error);
    return NextResponse.json({ error: "Siparişler alınamadı" }, { status: 500 });
  }
}

export async function POST(req) {
  const access = await requireStaffRole(req, prisma, ["ADMIN", "WAITER", "CASHIER"]);
  if (access.denied) return access.denied;
  try {
    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Geçersiz JSON isteği." }, { status: 400 });
    }
    const input = normalizeOrderRequest(body);
    const idempotencyKey = optionalOrderIdempotencyKey(body);
    const requestFingerprint = idempotencyKey ? orderRequestFingerprint("STAFF", input) : null;

    const createOrder = () =>
      prisma.$transaction(async (tx) => {
        const existing = await findIdempotentOrder(tx, idempotencyKey, requestFingerprint);
        if (existing) {
          const order = await tx.order.findUnique({
            where: { id: existing.id },
            include: ORDER_RESPONSE_INCLUDE,
          });
          return { order, created: false };
        }

        const table = await tx.table.findUnique({
          where: { id: input.tableId },
          select: { id: true, isArchived: true, status: true },
        });
        if (!table) throw new FinanceError("table-not-found", "Table was not found.");
        if (table.isArchived)
          throw new FinanceError("archived-table", "An archived table cannot receive orders.");

        const menuItems = await tx.menuItem.findMany({
          where: {
            id: { in: [...new Set(input.items.map((item) => item.menuItemId))] },
            isAvailable: true,
          },
          select: { id: true, name: true, price: true, category: { select: { name: true } } },
        });
        const menuById = new Map(menuItems.map((item) => [item.id, item]));
        if (input.items.some((item) => !menuById.has(item.menuItemId))) {
          throw new FinanceError("menu-item-unavailable", "A menu item is missing or unavailable.");
        }

        const orderItemsData = input.items.map((item) => {
          const unitPriceCents = moneyToCents(menuById.get(item.menuItemId).price);
          return {
            menuItemId: item.menuItemId,
            menuItemName: menuById.get(item.menuItemId).name,
            menuItemCategoryName: menuById.get(item.menuItemId).category.name,
            quantity: item.quantity,
            unitPrice: centsToMoney(unitPriceCents),
            notes: item.notes,
            status: "PENDING",
          };
        });
        const totalCents = calculateItemsTotalCents(orderItemsData);

        const order = await tx.order.create({
          data: {
            tableId: input.tableId,
            status: "PENDING",
            totalPrice: centsToMoney(totalCents),
            notes: input.notes,
            ...(idempotencyKey && { idempotencyKey, requestFingerprint }),
            items: { create: orderItemsData },
          },
          include: ORDER_RESPONSE_INCLUDE,
        });

        const tableStatus = table.status === "BILL_REQUESTED" ? "BILL_REQUESTED" : "OCCUPIED";
        const tableUpdate = await tx.table.updateMany({
          where: { id: input.tableId, isArchived: false, status: table.status },
          data: { status: tableStatus },
        });
        if (tableUpdate.count !== 1) {
          throw new FinanceError(
            "table-conflict",
            "The table was archived while the order was being created."
          );
        }

        await recordAudit(tx, req, "ORDER_CREATED", order.id, {
          tableId: input.tableId,
          total: order.totalPrice,
          items: orderItemsData.map((item) => ({
            name: item.menuItemName,
            quantity: item.quantity,
          })),
        });
        return { order, created: true, tableStatus };
      });

    let result;
    try {
      result = await withOrderIdempotencyLock(idempotencyKey, createOrder);
    } catch (error) {
      if (!idempotencyKey) throw error;
      const existing = await findIdempotentOrder(prisma, idempotencyKey, requestFingerprint);
      if (!existing) throw error;
      result = {
        order: await prisma.order.findUnique({
          where: { id: existing.id },
          include: ORDER_RESPONSE_INCLUDE,
        }),
        created: false,
      };
    }
    const newOrder = result.order;

    if (result.created && global.io) {
      global.io.emit("order:new", {
        id: newOrder.id,
        tableId: newOrder.tableId,
        status: newOrder.status,
      });
      global.io.emit("table:update", { id: input.tableId, status: result.tableStatus });
    }

    return NextResponse.json(preferOrderItemNameSnapshots(newOrder), { status: 201 });
  } catch (error) {
    if (error instanceof OrderIdempotencyError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    if (error instanceof FinanceError) {
      const status =
        error.code === "table-not-found"
          ? 404
          : error.code === "archived-table" || error.code === "table-conflict"
            ? 409
            : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("POST /api/orders error:", error);
    return NextResponse.json({ error: "Sipariş oluşturulamadı" }, { status: 500 });
  }
}
