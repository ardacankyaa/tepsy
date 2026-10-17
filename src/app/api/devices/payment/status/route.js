export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
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

export async function GET() {
  return statusResponse();
}

export async function POST() {
  return statusResponse();
}
