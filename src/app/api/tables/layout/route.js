export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { validateTableLayoutPayload } from "@/lib/floorplan-data.cjs";

async function handleLayoutUpdate(request) {
  try {
    const body = await request.json();
    const validation = validateTableLayoutPayload(body?.tables);
    if (validation.error) {
      return NextResponse.json({ error: "Geçersiz masa koordinat verisi" }, { status: 400 });
    }
    const tables = validation.value;

    const updatePromises = tables.map((t) => {
      const dataToUpdate = {};
      if (t.posX !== undefined) dataToUpdate.posX = Math.max(0, Math.min(100, Number(t.posX) || 0));
      if (t.posY !== undefined) dataToUpdate.posY = Math.max(0, Math.min(100, Number(t.posY) || 0));
      if (t.shape !== undefined && ["SQUARE", "ROUND", "RECTANGLE"].includes(t.shape))
        dataToUpdate.shape = t.shape;
      if (t.width !== undefined) dataToUpdate.width = t.width;
      if (t.height !== undefined) dataToUpdate.height = t.height;
      if (t.capacity !== undefined)
        dataToUpdate.capacity = Math.max(1, Math.min(30, Math.round(Number(t.capacity) || 4)));
      if (t.tableNumber !== undefined && String(t.tableNumber).trim())
        dataToUpdate.tableNumber = String(t.tableNumber).trim().slice(0, 40);

      return prisma.table.update({
        where: { id: t.id },
        data: dataToUpdate,
      });
    });

    await prisma.$transaction(updatePromises);

    if (global.io) {
      global.io.emit("table:layout_update");
      global.io.emit("table:update");
    }

    return NextResponse.json({ success: true, count: tables.length });
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "Geçersiz JSON isteği." }, { status: 400 });
    console.error("Kroki yerleşim kaydetme hatası:", error);
    return NextResponse.json({ error: "Kroki yerleşimi kaydedilemedi" }, { status: 500 });
  }
}

export async function POST(request) {
  return handleLayoutUpdate(request);
}

export async function PUT(request) {
  return handleLayoutUpdate(request);
}
