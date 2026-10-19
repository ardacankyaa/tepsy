export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { centsToMoney, moneyToCents } from "@/lib/finance.mjs";
import {
  calculateCashShiftClose,
  CashShiftError,
  parseCashShiftCloseRequest,
  parseCashShiftOpenRequest,
  requireOpenCashShift,
} from "@/lib/cash-shift.mjs";
import { credentialSessionVersion, sessionFromRequest } from "@/lib/auth-local";
import { currentStaffSession } from "@/lib/security-policy.cjs";

const ACTIVE_SHIFT_KEY = "ACTIVE";
const ACTIVE_SHIFT_SELECT = { id: true, status: true, activeKey: true };

async function authorizeCashier(request, client) {
  const config = await client.restaurantConfig.findFirst({
    select: { authEnabled: true, accessPasswordHash: true },
  });
  if (!config?.authEnabled || !config.accessPasswordHash) return null;

  const session = await currentStaffSession(
    sessionFromRequest(request),
    (id) =>
      client.staffUser.findUnique({
        where: { id },
        select: { id: true, role: true, isActive: true, updatedAt: true },
      }),
    credentialSessionVersion(config.accessPasswordHash)
  );
  if (!session) throw new CashShiftError(401, "session-required", "Oturum gerekli.");
  if (!new Set(["ADMIN", "CASHIER"]).has(session.role)) {
    throw new CashShiftError(403, "forbidden", "Kasa vardiyası işlemi rolünüz için açık değil.");
  }
  return session;
}

function optionalMoney(value) {
  return value == null ? null : centsToMoney(moneyToCents(value));
}

function optionalCashDifference(value) {
  if (value == null) return null;
  // Only the derived drawer difference can be negative; counts and payments stay nonnegative.
  const text = String(value).trim();
  return centsToMoney(text.startsWith("-") ? -moneyToCents(text.slice(1)) : moneyToCents(value));
}

function serializeShift(shift) {
  if (!shift) return null;
  return {
    id: shift.id,
    status: shift.status,
    openingCash: centsToMoney(moneyToCents(shift.openingCash)),
    closingCash: optionalMoney(shift.closingCash),
    expectedCash: optionalMoney(shift.expectedCash),
    cashDifference: optionalCashDifference(shift.cashDifference),
    cashPayments: centsToMoney(moneyToCents(shift.cashPayments)),
    cardPayments: centsToMoney(moneyToCents(shift.cardPayments)),
    otherPayments: centsToMoney(moneyToCents(shift.otherPayments)),
    cashRefunds: centsToMoney(moneyToCents(shift.cashRefunds ?? "0")),
    cardRefunds: centsToMoney(moneyToCents(shift.cardRefunds ?? "0")),
    otherRefunds: centsToMoney(moneyToCents(shift.otherRefunds ?? "0")),
    paymentCount: shift.paymentCount,
    openingNote: shift.openingNote,
    closingNote: shift.closingNote,
    openedById: shift.openedById,
    closedById: shift.closedById,
    openedAt: shift.openedAt,
    closedAt: shift.closedAt,
  };
}

function summarizeClosedShift(shift) {
  let paymentsSnapshot;
  try {
    paymentsSnapshot = JSON.parse(shift.paymentsSnapshot || "[]");
  } catch {
    throw new CashShiftError(500, "invalid-payment-snapshot", "Kapanış ödeme dökümü okunamadı.");
  }
  if (!Array.isArray(paymentsSnapshot)) {
    throw new CashShiftError(500, "invalid-payment-snapshot", "Kapanış ödeme dökümü geçersiz.");
  }
  return {
    success: true,
    shift: serializeShift(shift),
    openingCash: centsToMoney(moneyToCents(shift.openingCash)),
    cashPayments: centsToMoney(moneyToCents(shift.cashPayments)),
    cardPayments: centsToMoney(moneyToCents(shift.cardPayments)),
    otherPayments: centsToMoney(moneyToCents(shift.otherPayments)),
    cashRefunds: centsToMoney(moneyToCents(shift.cashRefunds ?? "0")),
    cardRefunds: centsToMoney(moneyToCents(shift.cardRefunds ?? "0")),
    otherRefunds: centsToMoney(moneyToCents(shift.otherRefunds ?? "0")),
    expectedCash: optionalMoney(shift.expectedCash),
    closingCash: optionalMoney(shift.closingCash),
    cashDifference: optionalCashDifference(shift.cashDifference),
    paymentCount: shift.paymentCount,
    paymentsSnapshot,
    refundsSnapshot: JSON.parse(shift.refundsSnapshot || "[]"),
    timestamp: shift.closedAt,
  };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new CashShiftError(400, "invalid-json", "Geçersiz JSON isteği.");
  }
}

function errorResponse(error) {
  if (error instanceof CashShiftError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error?.code === "P2002") {
    return NextResponse.json(
      { error: "Açık kasa vardiyası zaten var.", code: "shift-already-open" },
      { status: 409 }
    );
  }
  console.error("Kasa vardiyası API hatası:", error);
  return NextResponse.json({ error: "Kasa vardiyası işlemi tamamlanamadı." }, { status: 500 });
}

export async function GET(request) {
  try {
    await authorizeCashier(request, prisma);
    const [current, latestClosed] = await Promise.all([
      prisma.cashShift.findUnique({ where: { activeKey: ACTIVE_SHIFT_KEY } }),
      prisma.cashShift.findFirst({
        where: { status: "CLOSED" },
        orderBy: [{ closedAt: "desc" }, { openedAt: "desc" }],
      }),
    ]);
    if (current && current.status !== "OPEN") {
      throw new CashShiftError(500, "invalid-active-shift", "Açık vardiya kaydı tutarsız.");
    }
    return NextResponse.json(
      {
        success: true,
        currentShift: serializeShift(current),
        latestClosedShift: serializeShift(latestClosed),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request) {
  try {
    const actor = await authorizeCashier(request, prisma);
    const input = parseCashShiftOpenRequest(await readJson(request));
    const existing = await prisma.cashShift.findUnique({
      where: { activeKey: ACTIVE_SHIFT_KEY },
      select: ACTIVE_SHIFT_SELECT,
    });
    if (existing)
      throw new CashShiftError(409, "shift-already-open", "Açık kasa vardiyası zaten var.");

    const shift = await prisma.cashShift.create({
      data: {
        activeKey: ACTIVE_SHIFT_KEY,
        status: "OPEN",
        openingCash: centsToMoney(input.openingCashCents),
        openingNote: input.openingNote,
        openedById: actor?.userId || null,
      },
    });

    global.io?.emit("cash-shift:opened", { shiftId: shift.id, openedAt: shift.openedAt });
    return NextResponse.json(
      { success: true, shift: serializeShift(shift) },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request) {
  try {
    const actor = await authorizeCashier(request, prisma);
    const input = parseCashShiftCloseRequest(await readJson(request));
    const result = await prisma.$transaction(async (tx) => {
      const requestedShift = await tx.cashShift.findUnique({ where: { id: input.shiftId } });
      if (!requestedShift) throw new CashShiftError(404, "shift-not-found", "Vardiya bulunamadı.");

      if (requestedShift.status === "CLOSED") {
        const sameCloseRequest =
          optionalMoney(requestedShift.closingCash) === centsToMoney(input.closingCashCents) &&
          (requestedShift.closingNote || null) === input.closingNote;
        if (!sameCloseRequest)
          throw new CashShiftError(
            409,
            "shift-already-closed",
            "Vardiya daha önce farklı sayımla kapatıldı."
          );
        return { response: summarizeClosedShift(requestedShift), isReplay: true };
      }

      const activeShift = requireOpenCashShift(
        await tx.cashShift.findUnique({
          where: { activeKey: ACTIVE_SHIFT_KEY },
          select: ACTIVE_SHIFT_SELECT,
        })
      );
      if (activeShift.id !== requestedShift.id) {
        throw new CashShiftError(
          409,
          "shift-not-active",
          "Yalnızca etkin kasa vardiyası kapatılabilir."
        );
      }

      const closedAt = new Date();
      const payments = await tx.payment.findMany({
        where: { cashShiftId: requestedShift.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          orderId: true,
          paymentMethod: true,
          amountPaid: true,
          tipAmount: true,
          createdAt: true,
        },
      });
      const refunds = await tx.refund.findMany({
        where: { cashShiftId: requestedShift.id },
        select: {
          id: true,
          paymentId: true,
          amount: true,
          paymentMethod: true,
          reason: true,
          createdAt: true,
        },
      });
      const summary = calculateCashShiftClose({
        refunds,
        shift: requestedShift,
        payments,
        closingCashCents: input.closingCashCents,
        closedAt,
      });
      const changed = await tx.cashShift.updateMany({
        where: { id: requestedShift.id, status: "OPEN", activeKey: ACTIVE_SHIFT_KEY },
        data: {
          activeKey: null,
          status: "CLOSED",
          closingCash: summary.closingCash,
          expectedCash: summary.expectedCash,
          cashDifference: summary.cashDifference,
          cashPayments: summary.cashPayments,
          cardPayments: summary.cardPayments,
          otherPayments: summary.otherPayments,
          paymentCount: summary.paymentCount,
          paymentsSnapshot: JSON.stringify(summary.paymentsSnapshot),
          cashRefunds: summary.cashRefunds,
          cardRefunds: summary.cardRefunds,
          otherRefunds: summary.otherRefunds,
          refundsSnapshot: JSON.stringify(summary.refundsSnapshot),
          closingNote: input.closingNote,
          closedById: actor?.userId || null,
          closedAt: summary.closedAt,
        },
      });
      if (changed.count !== 1) {
        throw new CashShiftError(
          409,
          "shift-conflict",
          "Vardiya aynı anda değiştirildi; yenileyip tekrar deneyin."
        );
      }
      const closedShift = await tx.cashShift.findUnique({ where: { id: requestedShift.id } });
      return { response: summarizeClosedShift(closedShift), isReplay: false };
    });

    if (!result.isReplay) {
      global.io?.emit("cash-shift:closed", {
        shiftId: result.response.shift.id,
        closedAt: result.response.shift.closedAt,
      });
    }
    return NextResponse.json(result.response, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
