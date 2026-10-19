export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { authorizePaymentAccess } from "@/lib/payment-access.mjs";
import { parsePaymentRequest, PaymentRequestError } from "@/lib/payment-request.mjs";
import { requireOpenCashShift } from "@/lib/cash-shift.mjs";
import { getDeviceConfigPath, readDeviceConfig } from "@/lib/devices/config";
import {
  loadTransferAccount,
  sendTokenXAccount,
  transferStorePath,
} from "@/lib/devices/terminal-transfer.mjs";

export async function POST(request) {
  try {
    await authorizePaymentAccess(request, prisma);
    const parsed = parsePaymentRequest(await request.json());
    if (parsed.selectedItems || parsed.tipCents) {
      throw new PaymentRequestError(
        409,
        "terminal-selection-unsupported",
        "Ürün bazlı veya bahşişli tahsilat TokenX adisyon aktarımıyla desteklenmiyor."
      );
    }
    const { paymentTerminal } = await readDeviceConfig();
    if (
      parsed.paymentMethod !== "CREDIT_CARD" ||
      !paymentTerminal.enabled ||
      paymentTerminal.adapter !== "TOKENX_CLOUD"
    )
      return NextResponse.json({ skipped: true, accepted: false });
    requireOpenCashShift(await prisma.cashShift.findUnique({ where: { activeKey: "ACTIVE" } }));
    const account = await prisma.$transaction((tx) => loadTransferAccount(tx, parsed));
    const transfer = await sendTokenXAccount({
      account,
      parsed,
      terminal: paymentTerminal,
      filename: transferStorePath(getDeviceConfigPath()),
    });
    return NextResponse.json(
      { accepted: true, ...transfer, paymentApproved: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json(
        { accepted: false, code: "invalid-json", error: "Geçersiz JSON isteği." },
        { status: 400 }
      );
    return NextResponse.json(
      {
        accepted: false,
        code: error.code || "terminal-transfer-error",
        error: error.status ? error.message : "Adisyon terminale aktarılamadı; ödeme kaydedilmedi.",
      },
      { status: error.status || 503 }
    );
  }
}
