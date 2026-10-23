export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireStaffRole } from "@/lib/route-access.mjs";
export async function GET(request) {
  const access = await requireStaffRole(request, prisma, ["ADMIN"]);
  if (access.denied) return access.denied;
  try {
    const cursor = new URL(request.url).searchParams.get("before");
    if (cursor && !/^[A-Za-z0-9_-]{1,128}$/.test(cursor))
      return NextResponse.json({ error: "Geçersiz sayfa." }, { status: 400 });
    const events = await prisma.auditEvent.findMany({
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return NextResponse.json(
      {
        events: events
          .slice(0, 50)
          .map(({ detailsJson, ...row }) => ({ ...row, details: JSON.parse(detailsJson) })),
        nextCursor: events.length > 50 ? events[49].id : null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Audit read failed", error);
    return NextResponse.json({ error: "İşlem geçmişi okunamadı." }, { status: 500 });
  }
}
