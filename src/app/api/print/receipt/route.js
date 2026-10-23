export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { readRequestJson } from "@/lib/request-json.mjs";
import { readDeviceConfig } from "@/lib/devices/config";
import { deviceErrorResponse } from "@/lib/devices/http";
import { printReceipt } from "@/lib/devices/printers";
import { validateReceipt } from "@/lib/devices/validation";
import prisma from "@/lib/db";
import { authorizePaymentAccess } from "@/lib/payment-access.mjs";
import { readPaymentReceipt } from "@/lib/payment-receipts.mjs";
import { PaymentRequestError } from "@/lib/payment-request.mjs";

export async function POST(request) {
  try {
    await authorizePaymentAccess(request, prisma);
    const body = await readRequestJson(request, { maxBytes: 256 * 1024 });
    let receipt;
    if (body && Object.hasOwn(body, "paymentId")) {
      const snapshot = await readPaymentReceipt(prisma, body.paymentId);
      receipt = validateReceipt({ ...snapshot, currency: snapshot.currency || "UNKNOWN" });
    } else {
      const restaurant = await prisma.restaurantConfig.findFirst({ select: { currency: true } });
      receipt = validateReceipt(body);
      receipt.currency = restaurant?.currency || "₺";
    }
    const config = await readDeviceConfig();
    const result = await printReceipt(receipt, config.receiptPrinter);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error?.code === "invalid-json-body")
      return NextResponse.json(
        { error: "Geçersiz veya çok büyük JSON isteği.", code: "invalid-json" },
        { status: error.status }
      );
    if (error instanceof PaymentRequestError)
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    console.error("Receipt print error:", error);
    if (error instanceof SyntaxError || error?.message?.includes("Fiş")) {
      return NextResponse.json(
        {
          success: false,
          accepted: false,
          code: "INVALID_RECEIPT",
          error: error?.message || "Fiş verisi geçersiz.",
        },
        { status: 400 }
      );
    }
    return deviceErrorResponse(error, "Fiş yazdırılamadı.");
  }
}
