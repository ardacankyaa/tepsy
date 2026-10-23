export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { readRequestJson } from "@/lib/request-json.mjs";
import prisma from "@/lib/db";
import { authorizePaymentAccess } from "@/lib/payment-access.mjs";
import { auditActor } from "@/lib/audit.mjs";
import { parseRefund, refundPayment } from "@/lib/refunds.mjs";
import { PaymentRequestError } from "@/lib/payment-request.mjs";
import { FinanceError } from "@/lib/finance.mjs";
export async function POST(request) {
  try {
    const actor = await authorizePaymentAccess(request, prisma);
    if (actor && actor.role !== "ADMIN")
      throw new PaymentRequestError(403, "forbidden", "İadeyi yalnızca yönetici kaydedebilir.");
    const input = parseRefund(await readRequestJson(request));
    // SQLite serializes writers. Retries retain their original key; never redo an external refund.
    const result = await prisma.$transaction((tx) => refundPayment(tx, input, auditActor(request)));
    if (!result.replay) global.io?.emit("payment:completed", { refundId: result.response.id });
    return NextResponse.json(result.response, { headers: { "Cache-Control": "no-store" } });
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
    if (error instanceof FinanceError || error instanceof SyntaxError)
      return NextResponse.json({ error: "İade tutarı veya isteği geçersiz." }, { status: 400 });
    if (["P2002", "P2034", "P2028"].includes(error.code))
      return NextResponse.json(
        { error: "İade kaydı doğrulanamadı; aynı isteği yeniden deneyin." },
        { status: 409 }
      );
    console.error("Refund failed", error);
    return NextResponse.json(
      { error: "İade kaydedilemedi; aynı isteği yeniden deneyin." },
      { status: 500 }
    );
  }
}
