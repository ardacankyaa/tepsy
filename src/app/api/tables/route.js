export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireStaffRole } from "@/lib/route-access.mjs";
import {
  canArchiveTable,
  canSetTableAvailable,
  canUpdateTableFields,
} from "@/lib/table-archive.cjs";
import { validateTableDimensions } from "@/lib/floorplan-data.cjs";
import { preferTableOrderItemNameSnapshots } from "@/lib/order-idempotency-server.mjs";
import { normalizeTableInput, TableInputError } from "@/lib/table-input.cjs";
import { itemAvailability } from "@/lib/item-payments.mjs";

// Broadcasts reach every staff role; the table's QR token stays out of them.
const tableEvent = (table) => ({ id: table.id, status: table.status });

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const section = searchParams.get("section");
    const status = searchParams.get("status");

    const where = { isArchived: false };
    if (section && section !== "ALL") where.section = section;
    if (status && status !== "ALL") where.status = status;

    const tables = await prisma.table.findMany({
      where,
      orderBy: { tableNumber: "asc" },
      include: {
        serviceRequests: { where: { status: "OPEN" }, select: { id: true, type: true } },
        orders: {
          where: {
            status: { notIn: ["PAID", "CANCELLED", "AWAITING_WAITER_APPROVAL"] },
          },
          include: {
            payments: {
              select: {
                amountPaid: true,
                tipAmount: true,
                itemsJson: true,
                paymentMethod: true,
                createdAt: true,
              },
            },
            items: {
              where: { status: { not: "CANCELLED" } },
              include: {
                menuItem: {
                  select: { id: true, name: true, price: true },
                },
              },
            },
          },
        },
      },
    });

    return NextResponse.json(
      tables
        .map(preferTableOrderItemNameSnapshots)
        .map((t) => ({ ...t, orders: t.orders.map(itemAvailability) }))
    );
  } catch (error) {
    console.error("GET /api/tables error:", error);
    return NextResponse.json({ error: "Masalar listelenemedi" }, { status: 500 });
  }
}

export async function POST(req) {
  const access = await requireStaffRole(req, prisma, ["ADMIN"]);
  if (access.denied) return access.denied;
  try {
    const body = normalizeTableInput(await req.json(), true);
    const { tableNumber, capacity, section, posX, posY, shape, width, height } = body;

    if (!tableNumber) {
      return NextResponse.json({ error: "Masa numarası zorunludur" }, { status: 400 });
    }

    const dimensions = validateTableDimensions({
      width: width === undefined ? 85 : width,
      height: height === undefined ? 85 : height,
    });
    if (dimensions.error) {
      return NextResponse.json(
        { error: "Masa boyutları 40 ile 480 arasında olmalıdır." },
        { status: 400 }
      );
    }

    const newTable = await prisma.table.create({
      data: {
        tableNumber: String(tableNumber),
        capacity: Number(capacity) || 4,
        section: section || "İç Mekan",
        status: "AVAILABLE",
        posX: typeof posX === "number" ? posX : 20,
        posY: typeof posY === "number" ? posY : 20,
        shape: shape || "SQUARE",
        width: dimensions.value.width,
        height: dimensions.value.height,
      },
    });

    if (global.io) {
      global.io.emit("table:update", tableEvent(newTable));
      global.io.emit("table:layout_update", { tableId: newTable.id });
    }

    return NextResponse.json(newTable, { status: 201 });
  } catch (error) {
    if (error instanceof TableInputError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    if (error?.code === "P2002")
      return NextResponse.json({ error: "Bu masa adı zaten kullanılıyor." }, { status: 409 });
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "Geçersiz JSON isteği." }, { status: 400 });
    console.error("POST /api/tables error:", error);
    return NextResponse.json({ error: "Masa oluşturulamadı" }, { status: 500 });
  }
}

export async function PUT(req) {
  const access = await requireStaffRole(req, prisma, ["ADMIN", "WAITER", "CASHIER"]);
  if (access.denied) return access.denied;
  try {
    const body = normalizeTableInput(await req.json());
    const role = access.session.role;
    if (!canUpdateTableFields(role, body))
      return NextResponse.json({ error: "Yetkisiz masa değişikliği." }, { status: 403 });
    const { id, status, capacity, section, tableNumber, posX, posY, shape, width, height } = body;

    if (!id) {
      return NextResponse.json({ error: "Masa ID zorunludur" }, { status: 400 });
    }

    const dimensions = validateTableDimensions({
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
    });
    if (dimensions.error) {
      return NextResponse.json(
        { error: "Masa boyutları 40 ile 480 arasında olmalıdır." },
        { status: 400 }
      );
    }

    if (status !== undefined && !["AVAILABLE", "OCCUPIED", "BILL_REQUESTED"].includes(status)) {
      return NextResponse.json({ error: "Masa durumu geçersiz." }, { status: 400 });
    }
    const dataToUpdate = {};
    if (status !== undefined) dataToUpdate.status = status;
    if (capacity !== undefined) dataToUpdate.capacity = Number(capacity);
    if (section !== undefined) dataToUpdate.section = section;
    if (tableNumber !== undefined) dataToUpdate.tableNumber = String(tableNumber);
    if (posX !== undefined) dataToUpdate.posX = Number(posX);
    if (posY !== undefined) dataToUpdate.posY = Number(posY);
    if (shape !== undefined) dataToUpdate.shape = String(shape);
    if (dimensions.value.width !== undefined) dataToUpdate.width = dimensions.value.width;
    if (dimensions.value.height !== undefined) dataToUpdate.height = dimensions.value.height;

    const updatedTable = await prisma.$transaction(async (tx) => {
      const existingTable = await tx.table.findUnique({
        where: { id },
        include: { orders: { select: { status: true } } },
      });
      if (!existingTable || existingTable.isArchived)
        throw new TableInputError("Masa bulunamadı.", 404);
      if (status === "AVAILABLE" && !canSetTableAvailable(existingTable.orders))
        throw new TableInputError("Açık hesabı olan masa boşaltılamaz.", 409);
      return tx.table.update({ where: { id }, data: dataToUpdate });
    });

    if (global.io) {
      global.io.emit("table:update", tableEvent(updatedTable));
      if (status === "BILL_REQUESTED") {
        global.io.emit("table:bill_requested", {
          tableId: updatedTable.id,
          tableNumber: updatedTable.tableNumber,
          section: updatedTable.section,
        });
      }
      if (posX !== undefined || posY !== undefined || shape !== undefined) {
        global.io.emit("table:layout_update", { tableId: updatedTable.id });
      }
    }

    return NextResponse.json(updatedTable);
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "Geçersiz JSON isteği." }, { status: 400 });
    if (error instanceof TableInputError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    if (error?.code === "P2002")
      return NextResponse.json({ error: "Bu masa adı zaten kullanılıyor." }, { status: 409 });
    console.error("PUT /api/tables error:", error);
    return NextResponse.json({ error: "Masa güncellenemedi" }, { status: 500 });
  }
}

export async function DELETE(req) {
  const access = await requireStaffRole(req, prisma, ["ADMIN"]);
  if (access.denied) return access.denied;
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Masa ID zorunludur" }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const table = await tx.table.findUnique({
        where: { id },
        include: { orders: { select: { status: true } } },
      });
      if (!table || table.isArchived) return { status: 404, error: "Masa bulunamadı" };
      if (!canArchiveTable(table.orders))
        return { status: 409, error: "Açık hesabı olan masa arşivlenemez" };
      await tx.table.update({ where: { id }, data: { isArchived: true } });
      return { status: 200 };
    });

    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });

    if (global.io) {
      global.io.emit("table:update", { id, deleted: true });
      global.io.emit("table:layout_update", { tableId: id, deleted: true });
    }

    return NextResponse.json({ success: true, message: "Masa arşivlendi" });
  } catch (error) {
    console.error("DELETE /api/tables error:", error);
    return NextResponse.json({ error: "Masa silinemedi" }, { status: 500 });
  }
}
