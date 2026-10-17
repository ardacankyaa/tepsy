export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { authorizePaymentAccess } from "@/lib/payment-access.mjs";
import { listPaymentHistory, parsePaymentHistoryQuery } from "@/lib/payment-receipts.mjs";
import { PaymentRequestError } from "@/lib/payment-request.mjs";

export async function GET(request) {
  try {
    await authorizePaymentAccess(request, prisma);
    const parsed = parsePaymentHistoryQuery(new URL(request.url));
    const result = await prisma.$transaction((client) => listPaymentHistory(client, parsed));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PaymentRequestError)
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    console.error("Ödeme geçmişi hatası:", error);
    return NextResponse.json({ error: "Ödeme geçmişi yüklenemedi." }, { status: 500 });
  }
}
