export const dynamic = "force-dynamic";

import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { readRequestJson } from "@/lib/request-json.mjs";
import prisma from "@/lib/db";
import { requireStaffRole } from "@/lib/route-access.mjs";

export async function POST(request) {
  const access = await requireStaffRole(request, prisma, ["ADMIN"]);
  if (access.denied) return access.denied;
  let body;
  try {
    body = await readRequestJson(request);
  } catch (error) {
    return NextResponse.json({ error: "Geçersiz JSON isteği." }, { status: error?.status || 400 });
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof body.tableId !== "string"
  ) {
    return NextResponse.json({ error: "Masa gerekli." }, { status: 400 });
  }
  const { tableId } = body;
  if (!tableId) return NextResponse.json({ error: "Masa gerekli." }, { status: 400 });
  const table = await prisma.table.findUnique({
    where: { id: tableId },
    select: { id: true, isArchived: true, qrToken: true },
  });
  if (!table || table.isArchived)
    return NextResponse.json({ error: "Masa bulunamadı." }, { status: 404 });
  if (!table.qrToken) {
    await prisma.table.updateMany({
      where: { id: tableId, qrToken: null, isArchived: false },
      data: { qrToken: randomBytes(24).toString("hex") },
    });
  }
  const current = await prisma.table.findUnique({
    where: { id: tableId },
    select: { qrToken: true },
  });
  const token = current?.qrToken;
  if (!token) return NextResponse.json({ error: "QR kodu oluşturulamadı." }, { status: 409 });
  return NextResponse.json({ token, path: `/menu/${token}` });
}
