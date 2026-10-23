export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireStaffRole } from "@/lib/route-access.mjs";
import { readDeviceConfig } from "@/lib/devices/config";
import { getPaymentTerminalStatus } from "@/lib/devices/payments";

async function statusResponse() {
  try {
    const config = await readDeviceConfig();
    const status = await getPaymentTerminalStatus(config.paymentTerminal);
    return NextResponse.json({ success: true, status });
  } catch (error) {
    console.error("Payment terminal status error:", error);
    return NextResponse.json(
      {
        success: false,
        status: {
          implemented: false,
          connected: false,
          canInitiatePayment: false,
        },
        error: "Ödeme terminali durumu okunamadı.",
      },
      { status: 503 }
    );
  }
}

export async function GET(request) {
  const access = await requireStaffRole(request, prisma, ["ADMIN"]);
  if (access.denied) return access.denied;
  return statusResponse();
}

export async function POST(request) {
  const access = await requireStaffRole(request, prisma, ["ADMIN"]);
  if (access.denied) return access.denied;
  return statusResponse();
}
