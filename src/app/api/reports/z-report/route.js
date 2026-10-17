export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { centsToMoney, moneyToCents } from "@/lib/finance.mjs";
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
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "today";
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");
    const config = await prisma.restaurantConfig.findFirst({ select: { timeZone: true } });
    const timeZone = config?.timeZone || BUSINESS_TIME_ZONE;
    const { start, end } = resolveReportPeriod({
      period,
      startDateParam,
      endDateParam,
      timeZone,
    });

    const [payments, orders] = await Promise.all([
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
          items: {
            include: {
              menuItem: { include: { category: true } },
            },
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    ]);

    const collectionSummary = aggregateCollections(payments);
    const productSummary = aggregateProductSales(orders);
    const averageOrderValueCents = collectionSummary.averageOrderValueCents;
    const topProducts = serializeSalesRows(productSummary.products);
    const categoryBreakdown = serializeSalesRows(productSummary.categories);

    return NextResponse.json({
      period,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      basis: {
        revenue: "payment-created-at",
        products: "order-created-at",
        timeZone,
      },
      summary: {
        totalRevenue: moneyNumber(collectionSummary.totalRevenueCents),
        cashRevenue: moneyNumber(collectionSummary.cashRevenueCents),
        cardRevenue: moneyNumber(collectionSummary.cardRevenueCents),
        otherRevenue: moneyNumber(collectionSummary.otherRevenueCents),
        totalOrdersCount: collectionSummary.totalOrdersCount,
        averageOrderValue: moneyNumber(averageOrderValueCents),
        salesOrdersCount: productSummary.ordersCount,
        grossProductSales: moneyNumber(productSummary.grossSalesCents),
        productDiscountAmount: moneyNumber(productSummary.discountCents),
        netProductSales: moneyNumber(productSummary.netSalesCents),
        inconsistentProductOrderCount: productSummary.inconsistentOrdersCount,
      },
      topProducts,
      categoryBreakdown,
      transactions: payments.map((payment) => ({
        id: payment.id,
        amountPaid: moneyNumber(moneyToCents(payment.amountPaid)),
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
