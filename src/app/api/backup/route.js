export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";

export async function GET() {
  try {
    const [
      config,
      tables,
      categories,
      orders,
      floorElements,
      staff,
      cashShifts,
      paymentAttempts,
      floorPlanSections,
      refunds,
      activity,
    ] = await Promise.all([
      prisma.restaurantConfig.findFirst({
        select: {
          restaurantName: true,
          restaurantLogoUrl: true,
          ownerName: true,
          restaurantCode: true,
          tagline: true,
          currency: true,
          defaultLanguage: true,
          timeZone: true,
          qrOrderEnabled: true,
          authEnabled: true,
          isSetupCompleted: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.table.findMany({ orderBy: { tableNumber: "asc" } }),
      prisma.category.findMany({
        orderBy: { sortOrder: "asc" },
        include: { items: { orderBy: { name: "asc" } } },
      }),
      prisma.order.findMany({
        orderBy: { createdAt: "asc" },
        include: {
          items: true,
          payments: true,
        },
      }),
      prisma.floorElement.findMany({ orderBy: [{ section: "asc" }, { createdAt: "asc" }] }),
      prisma.staffUser.findMany({
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.cashShift.findMany(),
      prisma.paymentAttempt.findMany(),
      prisma.floorPlanSection.findMany(),
      prisma.refund.findMany(),
      prisma.auditEvent.findMany(),
    ]);

    const exportedAt = new Date().toISOString();
    const safeDate = exportedAt.slice(0, 10);
    return NextResponse.json(
      {
        format: "tepsy-local-backup",
        version: 2,
        completeRecovery: false,
        exportedAt,
        config,
        tables,
        categories,
        orders,
        floorElements,
        staff,
        cashShifts,
        paymentAttempts,
        floorPlanSections,
        refunds,
        activity,
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="tepsy-backup-${safeDate}.json"`,
        },
      }
    );
  } catch (error) {
    console.error("Local backup export failed:", error);
    return NextResponse.json({ error: "Yerel yedek hazırlanamadı." }, { status: 500 });
  }
}
