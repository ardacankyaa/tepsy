export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { canAccessInitialSetup, canRunSetup } from "@/lib/setup-policy.cjs";
import { readImageRequest, storeMenuImage } from "@/lib/menu-images.cjs";

export async function POST(request) {
  try {
    // The custom server overwrites this header with the actual socket address.
    if (!canAccessInitialSetup(null, request.headers.get("x-tepsy-client-ip")))
      return NextResponse.json(
        { error: "Kurulum sunucu bilgisayarında yapılmalıdır." },
        { status: 403 }
      );
    const [config, tables, orders, payments, staff, categories] = await Promise.all([
      prisma.restaurantConfig.findFirst({
        select: { isSetupCompleted: true, accessPasswordHash: true },
      }),
      prisma.table.count(),
      prisma.order.count(),
      prisma.payment.count(),
      prisma.staffUser.count(),
      prisma.category.count(),
    ]);
    if (
      !canRunSetup({
        tables,
        orders,
        payments,
        staff,
        categories,
        isSetupCompleted: config?.isSetupCompleted,
        hasAccessPassword: Boolean(config?.accessPasswordHash),
      })
    )
      return NextResponse.json(
        { error: "Kurulum tamamlandı. Logoyu işletme ayarlarından değiştirin." },
        { status: 409 }
      );
    const { bytes, type } = await readImageRequest(request);
    return NextResponse.json(await storeMenuImage(bytes, type), {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (!error.status) console.error("Restaurant logo upload failed:", error);
    return NextResponse.json(
      { error: error.status ? error.message : "Logo kaydedilemedi. Yeniden deneyin." },
      { status: error.status || 500 }
    );
  }
}
