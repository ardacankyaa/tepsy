export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireStaffRole } from "@/lib/route-access.mjs";
import { selectReportCurrency } from "@/lib/report-currency.mjs";
import { centsToMoney, moneyToCents } from "@/lib/finance.mjs";
import { summarizeRefunds } from "@/lib/refunds.mjs";
import { aggregateCollections, aggregateProductSales } from "@/lib/z-report-finance.mjs";
import {
  BUSINESS_TIME_ZONE,
  ReportPeriodError,
  resolveReportPeriod,
} from "@/lib/report-period.mjs";

function moneyNumber(cents) {
  return Number(centsToMoney(cents));
}

function serializeSalesRows(rows) {
  return rows
    .map((row) => ({
      ...row,
      grossRevenue: moneyNumber(row.grossRevenueCents),
      discountAmount: moneyNumber(row.discountAmountCents),
      totalRevenue: moneyNumber(row.totalRevenueCents),
    }))
    .map(({ grossRevenueCents, discountAmountCents, totalRevenueCents, ...row }) => row);
}

export async function GET(request) {
  const access = await requireStaffRole(request, prisma, ["ADMIN", "CASHIER"]);
  if (access.denied) return access.denied;
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "today";
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");
    const config = await prisma.restaurantConfig.findFirst({
      select: { timeZone: true, currency: true },
    });
    const timeZone = config?.timeZone || BUSINESS_TIME_ZONE;
    const { start, end } = resolveReportPeriod({
      period,
      startDateParam,
      endDateParam,
      timeZone,
    });

    const [allPayments, allOrders, allRefunds] = await Promise.all([
      prisma.payment.findMany({
        where: { createdAt: { gte: start, lte: end } },
        include: { order: { include: { table: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      prisma.order.findMany({
        where: {
          createdAt: { gte: start, lte: end },
          status: { notIn: ["CANCELLED", "AWAITING_WAITER_APPROVAL"] },
        },
        include: {
          payments: true,
          items: {
            include: {
              menuItem: { include: { category: true } },
            },
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      prisma.refund.findMany({
        where: { createdAt: { gte: start, lte: end } },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const keys = [
      ...new Set(
        [...allPayments, ...allOrders.flatMap((o) => o.payments)]
          .map((p) => p.idempotencyKey)
          .filter(Boolean)
      ),
    ];
    const attempts = await prisma.paymentAttempt.findMany({
      where: { idempotencyKey: { in: keys } },
    });
    const { payments, orders, refunds, currency, availableCurrencies } = selectReportCurrency({
      payments: allPayments,
      orders: allOrders,
      refunds: allRefunds,
      attempts,
      currentCurrency: config?.currency || "₺",
      requested: searchParams.get("currency"),
    });
    const refundCents = (method) => summarizeRefunds(refunds, method).amountCents;
    const refundTipCents = (method) => summarizeRefunds(refunds, method).tipCents;
    const refundPrincipalCents = (method) => summarizeRefunds(refunds, method).principalCents;
    const collectionSummary = aggregateCollections(payments);
    const productSummary = aggregateProductSales(orders);
    const averageOrderValueCents = collectionSummary.averageOrderValueCents;
    const topProducts = serializeSalesRows(productSummary.products);
    const categoryBreakdown = serializeSalesRows(productSummary.categories);

    return NextResponse.json({
      period,
      currency,
      availableCurrencies,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      basis: {
        revenue: "payment-created-at",
        products: "order-created-at",
        timeZone,
      },
      summary: {
        tipTotal: moneyNumber(
          payments.reduce((sum, p) => sum + moneyToCents(p.tipAmount || 0), 0) - refundTipCents()
        ),
        collectionsIncludingTips: moneyNumber(
          collectionSummary.totalRevenueCents +
            payments.reduce((sum, p) => sum + moneyToCents(p.tipAmount || 0), 0) -
            refundCents()
        ),
        totalRevenue: moneyNumber(collectionSummary.totalRevenueCents - refundPrincipalCents()),
        grossCollections: moneyNumber(collectionSummary.totalRevenueCents),
        refundTotal: moneyNumber(refundCents()),
        cashRevenue: moneyNumber(collectionSummary.cashRevenueCents - refundPrincipalCents("CASH")),
        cardRevenue: moneyNumber(
          collectionSummary.cardRevenueCents - refundPrincipalCents("CREDIT_CARD")
        ),
        otherRevenue: moneyNumber(
          collectionSummary.otherRevenueCents - refundPrincipalCents("OTHER")
        ),
        totalOrdersCount: collectionSummary.totalOrdersCount,
        averageOrderValue: moneyNumber(averageOrderValueCents),
        salesOrdersCount: productSummary.ordersCount,
        grossProductSales: moneyNumber(productSummary.grossSalesCents),
        productDiscountAmount: moneyNumber(productSummary.discountCents),
        netProductSales: moneyNumber(productSummary.netSalesCents),
        inconsistentProductOrderCount: productSummary.inconsistentOrdersCount,
      },
      refunds: refunds.map(({ responseJson, requestFingerprint, idempotencyKey, ...row }) => row),
      topProducts,
      categoryBreakdown,
      transactions: payments.map((payment) => ({
        id: payment.id,
        amountPaid: moneyNumber(moneyToCents(payment.amountPaid)),
        tipAmount: moneyNumber(moneyToCents(payment.tipAmount || 0)),
        paymentMethod: payment.paymentMethod,
        createdAt: payment.createdAt,
        tableNumber: payment.order?.table?.tableNumber || "Masa",
        section: payment.order?.table?.section || "Genel",
      })),
    });
  } catch (error) {
    if (error instanceof ReportPeriodError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    console.error("Z-Raporu Hatası:", error);
    return NextResponse.json({ error: "Rapor verileri alınamadı" }, { status: 500 });
  }
}
