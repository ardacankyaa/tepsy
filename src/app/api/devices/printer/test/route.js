export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { readDeviceConfig } from "@/lib/devices/config";
import { deviceErrorResponse } from "@/lib/devices/http";
import { printReceipt } from "@/lib/devices/printers";
import { buildPrinterTestReceipt } from "@/lib/devices/receipt";

export async function POST() {
  try {
    const config = await readDeviceConfig();
    const result = await printReceipt(buildPrinterTestReceipt(), config.receiptPrinter);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Printer test error:", error);
    return deviceErrorResponse(error, "Yazıcı testi tamamlanamadı.");
  }
}
