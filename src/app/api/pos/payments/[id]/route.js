export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { authorizePaymentAccess } from "@/lib/payment-access.mjs";
import { readPaymentReceipt } from "@/lib/payment-receipts.mjs";
import { PaymentRequestError } from "@/lib/payment-request.mjs";

export async function GET(request, context) {
  try {
    await authorizePaymentAccess(request, prisma);
    const { id } = await context.params;
    const receipt = await readPaymentReceipt(prisma, id);
    return NextResponse.json({ receipt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PaymentRequestError)
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    console.error("Ödeme fişi hatası:", error);
    return NextResponse.json({ error: "Ödeme fişi yüklenemedi." }, { status: 500 });
  }
}
