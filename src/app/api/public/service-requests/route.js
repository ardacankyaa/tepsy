export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { readRequestJson } from "@/lib/request-json.mjs";
import { serviceRequestAllowed } from "@/lib/qr-policy.cjs";
import { withServiceRequestLock } from "@/lib/service-request-lock.cjs";

export async function POST(request) {
  try {
    const body = await readRequestJson(request);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.token !== "string" ||
      typeof body.type !== "string"
    ) {
      return NextResponse.json({ error: "İstek geçersiz." }, { status: 400 });
    }
    const { token, type } = body;
    if (!/^[a-f0-9]{48}$/.test(token) || !["WAITER", "BILL"].includes(type))
      return NextResponse.json({ error: "İstek geçersiz." }, { status: 400 });
    const table = await prisma.table.findUnique({
      where: { qrToken: token },
      select: { id: true, tableNumber: true, isArchived: true },
    });
    if (!table || table.isArchived)
      return NextResponse.json({ error: "Masa bulunamadı." }, { status: 404 });
    const result = await withServiceRequestLock(table.id, type, () =>
      prisma.$transaction(async (tx) => {
        const last = await tx.serviceRequest.findFirst({
          where: { tableId: table.id, type },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true, status: true },
        });
        if (last?.status === "OPEN" || !serviceRequestAllowed(last?.createdAt)) return null;
        return tx.serviceRequest.create({
          data: { tableId: table.id, type },
          select: { id: true, type: true, status: true },
        });
      })
    );
    if (!result)
      return NextResponse.json(
        {
          error: "İstek zaten bekliyor veya çok kısa süre önce gönderildi.",
          retryAfterSeconds: 60,
        },
        { status: 429 }
      );
    global.io
      ?.to("role:ADMIN")
      .to("role:WAITER")
      .emit("service:request", { ...result, tableId: table.id, tableNumber: table.tableNumber });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    if (error.code === "invalid-json-body")
      return NextResponse.json(
        { error: "İstek verisi geçersiz veya çok büyük." },
        { status: error.status }
      );
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "Geçersiz JSON isteği." }, { status: 400 });
    console.error("Service request failed:", error);
    return NextResponse.json({ error: "İstek gönderilemedi." }, { status: 500 });
  }
}
