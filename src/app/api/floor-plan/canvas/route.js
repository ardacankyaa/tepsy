export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireStaffRole } from "@/lib/route-access.mjs";
import {
  DEFAULT_CANVAS_HEIGHT,
  DEFAULT_CANVAS_WIDTH,
  validateCanvasSettings,
} from "@/lib/floorplan-data.cjs";

function canvasForSection(section, savedSettings) {
  return (
    savedSettings.get(section) || {
      section,
      width: DEFAULT_CANVAS_WIDTH,
      height: DEFAULT_CANVAS_HEIGHT,
    }
  );
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedSection = searchParams.get("section")?.trim();
    const savedSettings = await prisma.floorPlanSection.findMany({ orderBy: { section: "asc" } });
    const settingsBySection = new Map(savedSettings.map((setting) => [setting.section, setting]));

    if (requestedSection !== undefined) {
      if (!requestedSection || requestedSection.length > 80) {
        return NextResponse.json({ error: "Bölüm adı geçersiz." }, { status: 400 });
      }
      return NextResponse.json(canvasForSection(requestedSection, settingsBySection));
    }

    const [tables, elements] = await Promise.all([
      prisma.table.findMany({
        where: { isArchived: false },
        select: { section: true },
        distinct: ["section"],
      }),
      prisma.floorElement.findMany({ select: { section: true }, distinct: ["section"] }),
    ]);
    const sections = new Set(
      [
        ...tables.map(({ section }) => section),
        ...elements.map(({ section }) => section),
        ...savedSettings.map(({ section }) => section),
      ].filter((section) => typeof section === "string" && section.trim())
    );

    const canvases = Array.from(sections)
      .sort((a, b) => a.localeCompare(b))
      .map((section) => canvasForSection(section, settingsBySection));
    return NextResponse.json(canvases);
  } catch (error) {
    console.error("Floor plan canvas fetch failed:", error);
    return NextResponse.json({ error: "Kroki boyutları alınamadı." }, { status: 500 });
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

  const validation = validateCanvasSettings(body);
  if (validation.error) {
    const message =
      validation.error === "invalid-section"
        ? "Bölüm adı geçersiz."
        : "Kroki genişliği 720 ile 10000, yüksekliği 450 ile 10000 arasında olmalıdır.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const saved = await prisma.floorPlanSection.upsert({
      where: { section: validation.value.section },
      create: validation.value,
      update: { width: validation.value.width, height: validation.value.height },
    });
    global.io?.emit("floorplan:canvas_update", saved);
    return NextResponse.json(saved);
  } catch (error) {
    console.error("Floor plan canvas update failed:", error);
    return NextResponse.json({ error: "Kroki boyutları kaydedilemedi." }, { status: 500 });
  }
}
