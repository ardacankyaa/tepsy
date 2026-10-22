export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";

export async function GET() {
  let requests;
  try {
    requests = await prisma.serviceRequest.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "asc" },
      include: { table: { select: { tableNumber: true } } },
    });
  } catch (error) {
    console.error("Service requests fetch failed:", error);
    return NextResponse.json({ error: "Servis istekleri alınamadı." }, { status: 500 });
  }
  return NextResponse.json(
    requests.map((entry) => ({
      id: entry.id,
      tableId: entry.tableId,
      tableLabel: entry.table.tableNumber,
      type: entry.type,
      submittedAt: entry.createdAt,
    }))
  );
}

export async function PATCH(request) {
  const body = await request.json().catch(() => ({}));
  if (!body || typeof body.id !== "string" || !body.id || body.action !== "RESOLVE")
    return NextResponse.json({ error: "İstek geçersiz." }, { status: 400 });
  let result;
  try {
    result = await resolveRequest(body.id);
  } catch (error) {
    console.error("Service request resolution failed:", error);
    return NextResponse.json({ error: "İstek işlenemedi." }, { status: 500 });
  }
  if (!result) return NextResponse.json({ error: "Açık istek bulunamadı." }, { status: 409 });
  const { entry, billRequested } = result;
  global.io
    ?.to("role:ADMIN")
    .to("role:WAITER")
    .emit("service:resolved", { id: entry.id, tableId: entry.tableId });
  if (billRequested) {
    const table = {
      id: entry.tableId,
      tableNumber: entry.table.tableNumber,
      status: "BILL_REQUESTED",
    };
    global.io
      ?.to("role:ADMIN")
      .to("role:WAITER")
      .to("role:CASHIER")
      .emit("table:bill_requested", table);
  }
  return NextResponse.json({ id: entry.id, tableId: entry.tableId, status: "RESOLVED" });
}

function resolveRequest(id) {
  return prisma.$transaction(async (tx) => {
    const entry = await tx.serviceRequest.findUnique({
      where: { id },
      include: { table: { select: { tableNumber: true, isArchived: true } } },
    });
    if (!entry || entry.status !== "OPEN") return null;
    const changed = await tx.serviceRequest.updateMany({
      where: { id: entry.id, status: "OPEN" },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
    if (!changed.count) return null;
    let billRequested = false;
    if (entry.type === "BILL" && !entry.table.isArchived) {
      const updated = await tx.table.updateMany({
        where: { id: entry.tableId, isArchived: false },
        data: { status: "BILL_REQUESTED" },
      });
      billRequested = updated.count > 0;
    }
    return { entry, billRequested };
  });
}
