export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { credentialSessionVersion, sessionFromRequest } from "@/lib/auth-local";
import { currentStaffSession } from "@/lib/security-policy.cjs";
import { canRunSetup, isLoopbackAddress } from "@/lib/setup-policy.cjs";
import { trustedClientAddress } from "@/lib/trusted-client.cjs";

export async function GET(request) {
  try {
    const [config, staffCount] = await Promise.all([
      prisma.restaurantConfig.findFirst({
        select: {
          restaurantName: true,
          isSetupCompleted: true,
          ownerName: true,
          restaurantCode: true,
          authEnabled: true,
          accessPasswordHash: true,
        },
      }),
      prisma.staffUser.count({ where: { isActive: true } }),
    ]);
    let canSetup = false;
    if (!config?.isSetupCompleted && !config?.accessPasswordHash) {
      const [tables, orders, payments, staff, categories] = await Promise.all([
        prisma.table.count(),
        prisma.order.count(),
        prisma.payment.count(),
        prisma.staffUser.count(),
        prisma.category.count(),
      ]);
      canSetup = canRunSetup({
        tables,
        orders,
        payments,
        staff,
        categories,
        isSetupCompleted: config?.isSetupCompleted,
        hasAccessPassword: Boolean(config?.accessPasswordHash),
      });
    }
    const session = await currentStaffSession(
      sessionFromRequest(request),
      (id) =>
        prisma.staffUser.findUnique({
          where: { id },
          select: { id: true, role: true, isActive: true, updatedAt: true },
        }),
      credentialSessionVersion(config?.accessPasswordHash)
    );
    return NextResponse.json({
      service: "tepsy",
      restaurantName: config?.restaurantName || "TEPSY",
      ownerName: config?.ownerName || "",
      restaurantCode: config?.restaurantCode || "TEPSY",
      authEnabled: Boolean(config?.authEnabled && config?.accessPasswordHash),
      hasStaff: staffCount > 0,
      isSetupCompleted: Boolean(config?.isSetupCompleted),
      canSetup,
      canRecoverOwner: Boolean(
        config?.accessPasswordHash && isLoopbackAddress(trustedClientAddress(request))
      ),
      canCreateRestaurant: Boolean(
        config?.accessPasswordHash &&
        config?.isSetupCompleted &&
        config?.authEnabled &&
        process.env.TEPSY_DEMO_MODE !== "1" &&
        isLoopbackAddress(trustedClientAddress(request))
      ),
      session,
    });
  } catch (error) {
    console.error("Auth status failed:", error);
    return NextResponse.json({ error: "Oturum durumu alınamadı." }, { status: 500 });
  }
}
