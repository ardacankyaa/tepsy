export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readRequestJson } from "@/lib/request-json.mjs";
import prisma from "@/lib/db";
import { requireStaffRole } from "@/lib/route-access.mjs";
import { validateTableLayoutPayload } from "@/lib/floorplan-data.cjs";

async function handleLayoutUpdate(request) {
  try {
    const body = await readRequestJson(request, { maxBytes: 1024 * 1024 });
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
        where: { id: t.id, isArchived: false },
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
    if (error?.code === "invalid-json-body")
      return NextResponse.json(
        { error: "Geçersiz veya çok büyük JSON isteği.", code: "invalid-json" },
        { status: error.status }
      );
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "Geçersiz JSON isteği." }, { status: 400 });
    if (error?.code === "P2002")
      return NextResponse.json({ error: "Bu masa adı zaten kullanılıyor." }, { status: 409 });
    if (error?.code === "P2025")
      return NextResponse.json(
        { error: "Masa bulunamadı veya arşivlendi; krokiyi yenileyin." },
        { status: 404 }
      );
    console.error("Kroki yerleşim kaydetme hatası:", error);
    return NextResponse.json({ error: "Kroki yerleşimi kaydedilemedi" }, { status: 500 });
  }
}

export async function POST(request) {
  const access = await requireStaffRole(request, prisma, ["ADMIN"]);
  if (access.denied) return access.denied;
  return handleLayoutUpdate(request);
}

export async function PUT(request) {
  const access = await requireStaffRole(request, prisma, ["ADMIN"]);
  if (access.denied) return access.denied;
  return handleLayoutUpdate(request);
}
