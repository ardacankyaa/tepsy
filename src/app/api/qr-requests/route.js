export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { preferOrderItemNameSnapshots } from "@/lib/order-idempotency-server.mjs";

export async function GET() {
  const orders = await prisma.order.findMany({
    where: { status: "AWAITING_WAITER_APPROVAL", source: "QR" },
    orderBy: { createdAt: "asc" },
    include: {
      table: { select: { tableNumber: true } },
      items: { include: { menuItem: { select: { name: true } } } },
    },
  });
  return NextResponse.json(
    orders.map((order) => ({
      id: order.id,
      tableLabel: order.table?.tableNumber || "?",
      submittedAt: order.createdAt,
      orderNotes: order.notes,
      items: order.items.map((item) => ({
        menuItemName: item.menuItemName || item.menuItem?.name || "",
        quantity: item.quantity,
        notes: item.notes,
      })),
    }))
  );
}

export async function PATCH(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Geçersiz JSON isteği.", code: "invalid-json" },
        { status: 400 }
      );
    }
    const { id, action } = body || {};
    if (typeof id !== "string" || !id || !["APPROVE", "REJECT"].includes(action))
      return NextResponse.json({ error: "İstek geçersiz." }, { status: 400 });
    const nextStatus = action === "APPROVE" ? "PENDING" : "CANCELLED";
    const result = await prisma.$transaction(async (tx) => {
      const changed = await tx.order.updateMany({
        where: { id, source: "QR", status: "AWAITING_WAITER_APPROVAL" },
        data: { status: nextStatus },
      });
      if (changed.count !== 1) return null;
      const order = await tx.order.findUnique({
        where: { id },
        include: {
          table: { select: { id: true, tableNumber: true, section: true, status: true } },
          items: { include: { menuItem: { select: { id: true, name: true, price: true } } } },
        },
      });
      if (action === "APPROVE" && order.tableId) {
        const tableUpdate = await tx.table.updateMany({
          where: { id: order.tableId, isArchived: false },
          data: { status: order.table.status === "BILL_REQUESTED" ? "BILL_REQUESTED" : "OCCUPIED" },
        });
        if (tableUpdate.count !== 1) throw new Error("qr-order-table-conflict");
      }
      return preferOrderItemNameSnapshots(order);
    });
    if (!result) return NextResponse.json({ error: "Bekleyen istek bulunamadı." }, { status: 409 });
    if (action === "APPROVE") global.io?.emit("order:new", result);
    global.io
      ?.to("role:ADMIN")
      .to("role:WAITER")
      .emit("qr:reviewed", { id: result.id, status: nextStatus });
    return NextResponse.json({ requestId: result.id, status: nextStatus });
  } catch (error) {
    if (error?.message === "qr-order-table-conflict")
      return NextResponse.json(
        { error: "Masa artık sipariş için kullanılamıyor." },
        { status: 409 }
      );
    console.error("QR review failed:", error);
    return NextResponse.json({ error: "İstek işlenemedi." }, { status: 500 });
  }
}
