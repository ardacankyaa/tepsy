export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { recordAudit } from "@/lib/audit.mjs";
import {
  allocateDiscountAcrossOrders,
  basisPointsToPercent,
  centsToMoney,
  computeOrderBalance,
  discountPercentToBasisPoints,
  discountToCents,
  FinanceError,
  moneyToCents,
  planPayment,
} from "@/lib/finance.mjs";
import { parsePaymentRequest, PaymentRequestError } from "@/lib/payment-request.mjs";
import {
  attachPaymentToCashShift,
  CashShiftError,
  requireOpenCashShift,
} from "@/lib/cash-shift.mjs";
import {
  executeIdempotentPayment,
  readIdempotentPaymentResponse,
} from "@/lib/payment-idempotency.mjs";
import { getDeviceConfigPath, readDeviceConfig } from "@/lib/devices/config";
import {
  assertTokenXTransferCurrent,
  transferStorePath,
} from "@/lib/devices/terminal-transfer.mjs";
import { assertCardPaymentAllowed } from "@/lib/card-payment-policy.mjs";
import { authorizePaymentAccess } from "@/lib/payment-access.mjs";
import { buildAccountPaymentReceipt } from "@/lib/payment-receipts.mjs";
import { planItemPayment } from "@/lib/item-payments.mjs";
import {
  preferOrderItemNameSnapshots,
  preferTableOrderItemNameSnapshots,
} from "@/lib/order-idempotency-server.mjs";

const PAYABLE_ORDER_STATUSES = ["PENDING", "PREPARING", "READY", "DELIVERED"];
const PAYMENT_INCLUDE = {
  table: true,
  items: { where: { status: { not: "CANCELLED" } }, include: { menuItem: true } },
  payments: {
    select: {
      id: true,
      orderId: true,
      amountPaid: true,
      tipAmount: true,
      itemsJson: true,
      paymentMethod: true,
      createdAt: true,
    },
  },
};

function publicPayment(payment) {
  return {
    id: payment.id,
    orderId: payment.orderId,
    amountPaid: centsToMoney(moneyToCents(payment.amountPaid)),
    tipAmount: centsToMoney(moneyToCents(payment.tipAmount || 0)),
    items: payment.itemsJson ? JSON.parse(payment.itemsJson) : [],
    paymentMethod: payment.paymentMethod,
    createdAt: payment.createdAt,
  };
}

function sumCents(values, fieldName) {
  const sum = values.reduce((total, value) => total + value, 0);
  if (!Number.isSafeInteger(sum))
    throw new FinanceError("invalid-money", `${fieldName} is outside the supported range.`);
  return sum;
}

function summarizeOrders(orders) {
  const balances = orders.map(computeOrderBalance);
  return {
    grossCents: sumCents(
      balances.map((balance) => balance.grossCents),
      "Gross total"
    ),
    discountCents: sumCents(
      balances.map((balance) => balance.discountCents),
      "Discount total"
    ),
    netCents: sumCents(
      balances.map((balance) => balance.netCents),
      "Net total"
    ),
    remainingCents: sumCents(
      balances.map((balance) => balance.remainingCents),
      "Remaining balance"
    ),
  };
}

async function buildPaymentResponse(client, { payments, orderIds, targetTableId }) {
  const uniqueOrderIds = [...new Set(orderIds)];
  const orders = uniqueOrderIds.length
    ? await client.order
        .findMany({
          where: { id: { in: uniqueOrderIds } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          include: PAYMENT_INCLUDE,
        })
        .then((entries) => entries.map(preferOrderItemNameSnapshots))
    : [];
  const inferredTableId = targetTableId || orders.find((order) => order.tableId)?.tableId || null;
  let table = null;
  if (inferredTableId) {
    table = preferTableOrderItemNameSnapshots(
      await client.table.findUnique({
        where: { id: inferredTableId },
        include: {
          orders: {
            where: { status: { in: PAYABLE_ORDER_STATUSES } },
            include: { items: { include: { menuItem: true } } },
          },
        },
      })
    );
  }

  const summary = summarizeOrders(orders);
  const amountPaidCents = sumCents(
    payments.map((payment) => moneyToCents(payment.amountPaid)),
    "Payment amount"
  );
  const amountPaid = centsToMoney(amountPaidCents);
  const paidOrders = orders.filter((order) => order.status === "PAID");
  return {
    success: true,
    table,
    orders,
    paidOrders,
    payments: payments.map(publicPayment),
    grossTotal: centsToMoney(summary.grossCents),
    discountAmount: centsToMoney(summary.discountCents),
    netTotal: centsToMoney(summary.netCents),
    orderTotal: centsToMoney(summary.netCents),
    amountPaid,
    totalPaid: amountPaid,
    remainingBalance: centsToMoney(summary.remainingCents),
    timestamp: new Date(),
  };
}

function prepareDiscounts(orders, parsed) {
  const percent = parsed.discountPercentBasisPoints;
  if (percent === 0) return [];

  const hasRecordedPaymentsOrDiscount = orders.some(
    (order) => (order.payments || []).length > 0 || moneyToCents(order.discountAmount ?? "0") > 0
  );
  if (hasRecordedPaymentsOrDiscount) {
    const matchesExistingDiscount = orders.every((order) => {
      const existingPercent = discountPercentToBasisPoints(order.discountPercent ?? "0");
      const existingReason = String(order.discountReason || "").trim() || null;
      return existingPercent === percent && existingReason === parsed.discountReason;
    });
    if (!matchesExistingDiscount) {
      throw new PaymentRequestError(
        409,
        "discount-locked",
        "İlk tahsilattan sonra indirim değiştirilemez."
      );
    }
    return [];
  }

  const grossTotalCents = sumCents(
    orders.map((order) => moneyToCents(order.totalPrice)),
    "Gross total"
  );
  const discountTotalCents = discountToCents(grossTotalCents, basisPointsToPercent(percent));
  return allocateDiscountAcrossOrders(orders, discountTotalCents).map((allocation) => ({
    ...allocation,
    discountPercent: basisPointsToPercent(percent),
    discountReason: parsed.discountReason,
  }));
}

async function createPayments(client, parsed) {
  const cashShift = requireOpenCashShift(
    await client.cashShift.findUnique({
      where: { activeKey: "ACTIVE" },
      select: { id: true, status: true, activeKey: true },
    })
  );

  if (parsed.tableId) {
    const table = await client.table.findUnique({
      where: { id: parsed.tableId },
      select: { id: true },
    });
    if (!table) throw new PaymentRequestError(404, "table-not-found", "Masa bulunamadı.");
  }

  let orders;
  if (parsed.orderId) {
    const order = await client.order.findUnique({
      where: { id: parsed.orderId },
      include: { items: { include: { menuItem: true } }, payments: true },
    });
    if (!order) throw new PaymentRequestError(404, "order-not-found", "Sipariş bulunamadı.");
    orders = [order];
  } else {
    orders = await client.order.findMany({
      where: {
        tableId: parsed.tableId,
        status: { in: PAYABLE_ORDER_STATUSES },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { items: { include: { menuItem: true } }, payments: true },
    });
  }

  if (orders.length === 0) {
    throw new PaymentRequestError(
      409,
      "no-payable-orders",
      "Ödeme yapılacak açık sipariş bulunamadı."
    );
  }

  const discountUpdates = prepareDiscounts(orders, parsed);
  for (const discount of discountUpdates) {
    const order = orders.find((candidate) => candidate.id === discount.orderId);
    const update = await client.order.updateMany({
      where: { id: order.id, status: order.status },
      data: {
        discountPercent: discount.discountPercent,
        discountAmount: centsToMoney(discount.discountCents),
        discountReason: discount.discountReason,
      },
    });
    if (update.count !== 1)
      throw new PaymentRequestError(
        409,
        "order-conflict",
        "Sipariş aynı anda değiştirildi; yeniden deneyin."
      );
    order.discountPercent = discount.discountPercent;
    order.discountAmount = centsToMoney(discount.discountCents);
    order.discountReason = discount.discountReason;
  }

  const paymentPlan = parsed.selectedItems
    ? planItemPayment(orders, parsed.selectedItems)
    : planPayment(orders, parsed.requestedAmountCents);
  const newPayments = [];
  for (const allocation of paymentPlan.allocations) {
    const order = orders.find((candidate) => candidate.id === allocation.orderId);
    if (
      allocation.amountCents > 0 ||
      allocation.nextStatus === "PAID" ||
      allocation.paymentItems?.length
    ) {
      const payment = await client.payment.create({
        data: attachPaymentToCashShift(cashShift, {
          orderId: order.id,
          paymentMethod: parsed.paymentMethod,
          amountPaid: centsToMoney(allocation.amountCents),
          tipAmount: centsToMoney(newPayments.length === 0 ? parsed.tipCents : 0),
          itemsJson: allocation.paymentItems ? JSON.stringify(allocation.paymentItems) : null,
          idempotencyKey: parsed.idempotencyKey,
          requestFingerprint: parsed.requestFingerprint,
        }),
      });
      newPayments.push(payment);
      for (const item of allocation.paymentItems || []) {
        const original = order.items.find((i) => i.id === item.orderItemId);
        const changed = await client.orderItem.updateMany({
          where: { id: item.orderItemId, paidQuantity: original.paidQuantity || 0 },
          data: { paidQuantity: { increment: item.quantity } },
        });
        if (changed.count !== 1)
          throw new PaymentRequestError(
            409,
            "item-conflict",
            "Ürün aynı anda tahsil edildi. Hesabı yenileyin."
          );
      }
    }

    if (allocation.nextStatus === "PAID" && order.status !== "PAID") {
      const statusUpdate = await client.order.updateMany({
        where: { id: order.id, status: order.status },
        data: { status: "PAID" },
      });
      if (statusUpdate.count !== 1) {
        throw new PaymentRequestError(
          409,
          "order-conflict",
          "Sipariş aynı anda değiştirildi; yeniden deneyin."
        );
      }
      order.status = "PAID";
    }
  }

  const selectedTableId = parsed.tableId || orders[0].tableId || null;
  if (selectedTableId) {
    const activeOrderCount = await client.order.count({
      where: {
        tableId: selectedTableId,
        status: { in: PAYABLE_ORDER_STATUSES },
      },
    });
    if (activeOrderCount === 0) {
      await client.table.updateMany({
        where: { id: selectedTableId },
        data: { status: "AVAILABLE" },
      });
    }
  }

  return buildPaymentResponse(client, {
    payments: newPayments,
    orderIds: orders.map((order) => order.id),
    targetTableId: selectedTableId,
  });
}

function errorResponse(error) {
  if (error instanceof PaymentRequestError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        ...(error.terminalBasketTransferRequired ? { terminalBasketTransferRequired: true } : {}),
      },
      { status: error.status }
    );
  }
  if (error instanceof CashShiftError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof FinanceError) {
    const status = ["overpayment", "overpaid-order", "invalid-order-state", "no-balance"].includes(
      error.code
    )
      ? 409
      : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  if (error?.code === "P2002") {
    return NextResponse.json(
      { error: "Ödeme isteği çakıştı; aynı anahtarla yeniden deneyin.", code: "idempotency-race" },
      { status: 409 }
    );
  }
  console.error("Ödeme işleme hatası:", error);
  return NextResponse.json({ error: "Ödeme işlemi gerçekleştirilemedi." }, { status: 500 });
}

export async function POST(request) {
  let parsed;
  try {
    await authorizePaymentAccess(request, prisma);
    let body;
    try {
      body = await request.json();
    } catch {
      throw new PaymentRequestError(400, "invalid-json", "Geçersiz JSON isteği.");
    }
    parsed = parsePaymentRequest(body);

    const result = await prisma.$transaction((tx) =>
      executeIdempotentPayment(tx, parsed, async (client) => {
        const config = parsed.paymentMethod === "CREDIT_CARD" ? await readDeviceConfig() : null;
        if (
          (parsed.selectedItems || parsed.tipCents) &&
          config?.paymentTerminal?.enabled &&
          config.paymentTerminal.adapter === "TOKENX_CLOUD"
        )
          throw new PaymentRequestError(
            409,
            "terminal-selection-unsupported",
            "Ürün bazlı veya bahşişli tahsilatı harici terminalde tamamlayıp Diğer yöntemiyle kaydedin. TokenX adisyon aktarımı bu seçimi desteklemiyor."
          );
        const cardVerification = assertCardPaymentAllowed(parsed, config?.paymentTerminal);
        if (
          parsed.paymentMethod === "CREDIT_CARD" &&
          config?.paymentTerminal?.enabled &&
          config.paymentTerminal.adapter === "TOKENX_CLOUD"
        )
          await assertTokenXTransferCurrent(
            client,
            parsed,
            config.paymentTerminal,
            transferStorePath(getDeviceConfigPath())
          );
        const response = await createPayments(client, parsed);
        const restaurant = await client.restaurantConfig.findFirst({
          select: { restaurantName: true, currency: true },
        });
        const receipt = await buildAccountPaymentReceipt(client, {
          response,
          restaurant,
          cardVerification,
        });
        await recordAudit(client, request, "PAYMENT_RECORDED", receipt.id, {
          amount: receipt.amountPaid,
          currency: receipt.currency,
          method: parsed.paymentMethod,
          discountReason: parsed.discountReason,
          discountPercent: basisPointsToPercent(parsed.discountPercentBasisPoints),
        });
        return { ...response, cardVerification, receipt };
      })
    );

    if (!result.isReplay && global.io) {
      const tableId =
        result.response.table?.id ||
        result.response.orders.find((order) => order.tableId)?.tableId ||
        null;
      global.io.emit("payment:completed", {
        tableId,
        orderIds: result.response.orders.map((order) => order.id),
      });
      if (result.response.table) {
        global.io.emit("table:update", {
          id: result.response.table.id,
          status: result.response.table.status,
        });
      }
    }

    return NextResponse.json(result.response, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error?.code === "P2002" && parsed) {
      try {
        const replay = await readIdempotentPaymentResponse(prisma, parsed);
        if (replay) {
          return NextResponse.json(replay, {
            status: 200,
            headers: { "Cache-Control": "no-store" },
          });
        }
      } catch (replayError) {
        return errorResponse(replayError);
      }
    }
    return errorResponse(error);
  }
}
