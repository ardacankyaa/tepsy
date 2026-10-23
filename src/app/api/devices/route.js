export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { readRequestJson } from "@/lib/request-json.mjs";
import prisma from "@/lib/db";
import { requireStaffRole } from "@/lib/route-access.mjs";
import { readDeviceConfig, writeDeviceConfig } from "@/lib/devices/config";
import { PRINTER_ADAPTERS, PAYMENT_ADAPTERS } from "@/lib/devices/validation";

export async function GET(request) {
  const access = await requireStaffRole(request, prisma, ["ADMIN"]);
  if (access.denied) return access.denied;
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
  const access = await requireStaffRole(request, prisma, ["ADMIN"]);
  if (access.denied) return access.denied;
  try {
    const body = await readRequestJson(request);
    const config = await writeDeviceConfig(body);
    return NextResponse.json({ success: true, config });
  } catch (error) {
    if (error?.code === "invalid-json-body")
      return NextResponse.json(
        { error: "Geçersiz veya çok büyük JSON isteği.", code: "invalid-json" },
        { status: error.status }
      );
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
