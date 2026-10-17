export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { sessionFromRequest } from "@/lib/auth-local";
import {
  calculateItemsTotalCents,
  centsToMoney,
  FinanceError,
  moneyToCents,
} from "@/lib/finance.mjs";
import {
  isOrderActionAllowedForRole,
  OrderWorkflowError,
  validateOrderPatch,
} from "@/lib/order-workflow.mjs";
import {
  preferOrderItemNameSnapshots,
  preferTableOrderItemNameSnapshots,
} from "@/lib/order-idempotency-server.mjs";

const ACTIVE_ORDER_STATUSES = ["PENDING", "PREPARING", "READY", "DELIVERED"];

class OrderRequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "OrderRequestError";
    this.status = status;
    this.code = code;
  }
}

function parseWorkflowError(error) {
  const status = [
    "closed-order",
    "invalid-transition",
    "partially-paid-order",
    "paid-order-cancellation",
    "approval-required",
  ].includes(error.code)
    ? 409
    : 400;
  return new OrderRequestError(status, error.code, error.message);
}

async function assertAuthorized(tx, request, action) {
  const config = await tx.restaurantConfig.findFirst({
    select: { authEnabled: true, accessPasswordHash: true },
  });
  if (!config?.authEnabled || !config.accessPasswordHash) return;

  const session = sessionFromRequest(request);
  if (!session) throw new OrderRequestError(401, "session-required", "Oturum gerekli.");
  if (!isOrderActionAllowedForRole(session.role, action)) {
    throw new OrderRequestError(403, "forbidden", "Bu sipariş işlemi rolünüz için açık değil.");
  }
}

export async function GET(request, { params }) {
  try {
    const { id } = await params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        table: true,
        items: { include: { menuItem: true } },
        payments: true,
      },
    });

    if (!order || order.status === "AWAITING_WAITER_APPROVAL") {
      return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });
    }
    return NextResponse.json(preferOrderItemNameSnapshots(order));
  } catch (error) {
    console.error("Sipariş detayı alma hatası:", error);
    return NextResponse.json({ error: "Sipariş detayı alınamadı" }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Geçersiz JSON isteği." }, { status: 400 });
    }
    const { id } = await params;

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: { items: true, payments: true, table: true },
      });
      if (!order) throw new OrderRequestError(404, "order-not-found", "Sipariş bulunamadı.");

      let action;
      try {
        action = validateOrderPatch(body, order);
      } catch (error) {
        if (error instanceof OrderWorkflowError) throw parseWorkflowError(error);
        throw error;
      }
      await assertAuthorized(tx, request, action);

      if (action.action === "addItems") {
        const items = body.addItems.map((item) => ({
          menuItemId: String(item?.menuItemId || item?.id || "").trim(),
          quantity: Number(item?.quantity),
          notes: item?.notes ? String(item.notes).trim().slice(0, 300) : null,
        }));
        if (
          items.some(
            (item) =>
              !item.menuItemId ||
              !Number.isSafeInteger(item.quantity) ||
              item.quantity < 1 ||
              item.quantity > 99
          )
        ) {
          throw new OrderRequestError(400, "invalid-items", "Sipariş kalemleri geçersiz.");
        }

        const menuItems = await tx.menuItem.findMany({
          where: {
            id: { in: [...new Set(items.map((item) => item.menuItemId))] },
            isAvailable: true,
          },
          select: { id: true, name: true, price: true, category: { select: { name: true } } },
        });
        const menuById = new Map(menuItems.map((item) => [item.id, item]));
        if (items.some((item) => !menuById.has(item.menuItemId))) {
          throw new OrderRequestError(
            400,
            "menu-item-unavailable",
            "Menüde olmayan veya satışa kapalı ürün var."
          );
        }

        const itemsToCreate = items.map((item) => ({
          ...item,
          menuItemName: menuById.get(item.menuItemId).name,
          menuItemCategoryName: menuById.get(item.menuItemId).category.name,
          unitPrice: centsToMoney(moneyToCents(menuById.get(item.menuItemId).price)),
          status: "PENDING",
        }));
        const additionalTotal = centsToMoney(calculateItemsTotalCents(itemsToCreate));
        for (const item of itemsToCreate) {
          await tx.orderItem.create({ data: { ...item, orderId: id } });
        }
        const updated = await tx.order.updateMany({
          where: { id, status: order.status },
          data: { totalPrice: { increment: additionalTotal } },
        });
        if (updated.count !== 1)
          throw new OrderRequestError(
            409,
            "order-conflict",
            "Sipariş aynı anda değiştirildi; yeniden deneyin."
          );
      } else if (action.action === "cancelItemId") {
        const item = await tx.orderItem.findFirst({ where: { id: action.itemId, orderId: id } });
        if (!item) throw new OrderRequestError(404, "item-not-found", "Sipariş kalemi bulunamadı.");
        if (item.status === "CANCELLED")
          throw new OrderRequestError(409, "item-cancelled", "Sipariş kalemi zaten iptal edildi.");
        const itemTotalCents = calculateItemsTotalCents([
          { unitPrice: item.unitPrice, quantity: item.quantity },
        ]);
        const totalCents = moneyToCents(order.totalPrice);
        if (itemTotalCents > totalCents) {
          throw new FinanceError(
            "inconsistent-order-total",
            "Sipariş toplamı kalem toplamından düşük."
          );
        }

        const cancelled = await tx.orderItem.updateMany({
          where: { id: item.id, orderId: id, status: item.status },
          data: { status: "CANCELLED" },
        });
        if (cancelled.count !== 1)
          throw new OrderRequestError(
            409,
            "item-conflict",
            "Sipariş kalemi aynı anda değiştirildi."
          );
        const remainingItems = await tx.orderItem.count({
          where: { orderId: id, status: { not: "CANCELLED" } },
        });
        const updated = await tx.order.updateMany({
          where: { id, status: order.status },
          data: {
            totalPrice: { decrement: centsToMoney(itemTotalCents) },
            ...(remainingItems === 0 && { status: "CANCELLED" }),
          },
        });
        if (updated.count !== 1)
          throw new OrderRequestError(
            409,
            "order-conflict",
            "Sipariş aynı anda değiştirildi; yeniden deneyin."
          );
      } else if (action.action === "itemStatusUpdate") {
        const updated = await tx.orderItem.updateMany({
          where: { id: action.itemId, orderId: id, status: action.expectedStatus },
          data: { status: action.status },
        });
        if (updated.count !== 1)
          throw new OrderRequestError(
            409,
            "item-conflict",
            "Sipariş kalemi aynı anda değiştirildi; yeniden deneyin."
          );
      } else if (action.action === "status") {
        if (action.status === "CANCELLED" && order.payments.length > 0) {
          throw new OrderRequestError(
            409,
            "paid-order-cancellation",
            "Ödeme kaydı olan sipariş iade akışından iptal edilmelidir."
          );
        }
        const updated = await tx.order.updateMany({
          where: { id, status: order.status },
          data: { status: action.status },
        });
        if (updated.count !== 1)
          throw new OrderRequestError(
            409,
            "order-conflict",
            "Sipariş durumu aynı anda değiştirildi; yeniden deneyin."
          );

        if (["READY", "PREPARING", "DELIVERED"].includes(action.status)) {
          await tx.orderItem.updateMany({
            where: { orderId: id, status: { not: "CANCELLED" } },
            data: { status: action.status },
          });
        }
      }

      const finalOrder = await tx.order.findUnique({ where: { id }, select: { status: true } });
      if (finalOrder.status === "CANCELLED" && order.tableId) {
        const activeOrdersCount = await tx.order.count({
          where: {
            tableId: order.tableId,
            status: { in: ACTIVE_ORDER_STATUSES },
            id: { not: id },
          },
        });
        if (activeOrdersCount === 0) {
          await tx.table.updateMany({
            where: { id: order.tableId },
            data: { status: "AVAILABLE" },
          });
        }
      }

      const updatedOrder = preferOrderItemNameSnapshots(
        await tx.order.findUnique({
          where: { id },
          include: {
            table: true,
            items: { include: { menuItem: true } },
            payments: true,
          },
        })
      );
      const updatedTable = updatedOrder?.tableId
        ? preferTableOrderItemNameSnapshots(
            await tx.table.findUnique({
              where: { id: updatedOrder.tableId },
              include: {
                orders: {
                  where: { status: { in: ACTIVE_ORDER_STATUSES } },
                  include: {
                    items: { where: { status: { not: "CANCELLED" } }, include: { menuItem: true } },
                  },
                },
              },
            })
          )
        : null;
      return {
        action,
        previousStatus: order.status,
        updatedOrder,
        updatedTable,
      };
    });

    if (global.io) {
      const orderEvent = {
        id: result.updatedOrder.id,
        tableId: result.updatedOrder.tableId,
        status: result.updatedOrder.status,
      };
      global.io.emit("order:update", orderEvent);
      if (result.updatedTable) {
        global.io.emit("table:update", {
          id: result.updatedTable.id,
          status: result.updatedTable.status,
        });
      }
      if (result.action.action === "status" && result.action.status === "READY") {
        global.io.emit("order:ready", orderEvent);
      }
      if (
        result.previousStatus === "AWAITING_WAITER_APPROVAL" &&
        result.action.status === "PENDING"
      ) {
        global.io.emit("order:new", orderEvent);
      }
    }

    return NextResponse.json(preferOrderItemNameSnapshots(result.updatedOrder));
  } catch (error) {
    if (error instanceof OrderRequestError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    if (error instanceof FinanceError) {
      const status = error.code === "inconsistent-order-total" ? 409 : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("Sipariş güncelleme hatası:", error);
    return NextResponse.json({ error: "Sipariş güncellenemedi" }, { status: 500 });
  }
}
