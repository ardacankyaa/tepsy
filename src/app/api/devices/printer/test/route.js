export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireStaffRole } from "@/lib/route-access.mjs";
import { readDeviceConfig } from "@/lib/devices/config";
import { deviceErrorResponse } from "@/lib/devices/http";
import { printReceipt } from "@/lib/devices/printers";
import { buildPrinterTestReceipt } from "@/lib/devices/receipt";

export async function POST(request) {
  const access = await requireStaffRole(request, prisma, ["ADMIN"]);
  if (access.denied) return access.denied;
  try {
    const config = await readDeviceConfig();
    const result = await printReceipt(buildPrinterTestReceipt(), config.receiptPrinter);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Printer test error:", error);
    return deviceErrorResponse(error, "Yazıcı testi tamamlanamadı.");
  }
}
