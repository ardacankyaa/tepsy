export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { readDeviceConfig, writeDeviceConfig } from "@/lib/devices/config";
import { PRINTER_ADAPTERS, PAYMENT_ADAPTERS } from "@/lib/devices/validation";

export async function GET() {
  try {
    const config = await readDeviceConfig();
    return NextResponse.json({
      config,
      capabilities: {
        receiptPrinterAdapters: PRINTER_ADAPTERS,
        paymentTerminalAdapters: PAYMENT_ADAPTERS,
        freeLocalOnly: config.paymentTerminal.adapter !== "TOKENX_CLOUD",
      },
    });
  } catch (error) {
    console.error("Device config read error:", error);
    return NextResponse.json({ error: "Cihaz yapılandırması okunamadı." }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const config = await writeDeviceConfig(body);
    return NextResponse.json({ success: true, config });
  } catch (error) {
    console.error("Device config write error:", error);
    const invalid = error instanceof SyntaxError || !error?.code;
    return NextResponse.json(
      {
        success: false,
        error: invalid
          ? error?.message || "Geçersiz cihaz yapılandırması."
          : "Cihaz yapılandırması kaydedilemedi.",
      },
      { status: invalid ? 400 : 500 }
    );
  }
}
