export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireStaffRole } from "@/lib/route-access.mjs";
import { FLOOR_ELEMENT_TYPES } from "@/lib/floor-elements.mjs";
import {
  normalizeFloorElementDimensions,
  validateFloorElementsPayload,
} from "@/lib/floorplan-data.cjs";

const cleanElement = (element, section) => ({
  id: String(element.id || "").startsWith("floor-") ? String(element.id) : undefined,
  section,
  type: FLOOR_ELEMENT_TYPES.has(String(element.type || "").toUpperCase())
    ? String(element.type).toUpperCase()
    : "LABEL",
  label: element.label ? String(element.label).slice(0, 80) : null,
  posX: Math.max(0, Math.min(98, Number(element.posX) || 0)),
  posY: Math.max(0, Math.min(98, Number(element.posY) || 0)),
  ...normalizeFloorElementDimensions(element),
  rotation: Math.round(Number(element.rotation) || 0) % 360,
  color: element.color ? String(element.color).slice(0, 32) : null,
  locked: Boolean(element.locked),
});

export async function GET() {
  try {
    const elements = await prisma.floorElement.findMany({
      orderBy: [{ section: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json(elements);
  } catch (error) {
    console.error("Floor elements fetch failed:", error);
    return NextResponse.json({ error: "Kroki öğeleri alınamadı." }, { status: 500 });
  }
}

export async function PUT(request) {
  const access = await requireStaffRole(request, prisma, ["ADMIN"]);
  if (access.denied) return access.denied;
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçerli JSON gerekli." }, { status: 400 });
  }

  const validation = validateFloorElementsPayload(body);
  if (validation.error) {
    return NextResponse.json({ error: "Geçerli bölüm ve kroki öğeleri gerekli." }, { status: 400 });
  }

  const { section, elements } = validation.value;
  try {
    const cleaned = elements.map((element) => cleanElement(element, section));
    await prisma.$transaction([
      prisma.floorElement.deleteMany({ where: { section } }),
      ...cleaned.map((element) => prisma.floorElement.create({ data: element })),
    ]);
    const saved = await prisma.floorElement.findMany({
      where: { section },
      orderBy: { createdAt: "asc" },
    });
    global.io?.emit("floor-elements:update", { section });
    return NextResponse.json(saved);
  } catch (error) {
    console.error("Floor elements update failed:", error);
    return NextResponse.json({ error: "Kroki öğeleri kaydedilemedi." }, { status: 500 });
  }
}
