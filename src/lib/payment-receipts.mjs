import { centsToMoney, computeOrderBalance, FinanceError, moneyToCents } from "./finance.mjs";
import { PaymentRequestError } from "./payment-request.mjs";

function sumCents(values) {
  const sum = values.reduce((total, value) => total + value, 0);
  if (!Number.isSafeInteger(sum))
    throw new FinanceError("invalid-money", "Payment total is outside the supported range.");
  return sum;
}

function receiptNumber(id) {
  // The complete immutable payment ID makes receipt identifiers unique, including legacy records.
  return `TPS-${String(id).toUpperCase()}`;
}

function receiptItems(orders) {
  return orders.flatMap((order) =>
    (order.items || [])
      .filter((item) => item.status !== "CANCELLED")
      .map((item) => {
        const unitPriceCents = moneyToCents(item.unitPrice);
        const totalCents = unitPriceCents * item.quantity;
        if (!Number.isSafeInteger(totalCents))
          throw new FinanceError(
            "invalid-money",
            "Receipt item total is outside the supported range."
          );
        return {
          id: item.id,
          name: item.menuItemName || item.menuItem?.name || item.name || "Ürün",
          quantity: item.quantity,
          unitPrice: centsToMoney(unitPriceCents),
          total: centsToMoney(totalCents),
        };
      })
  );
}

export function buildPaymentReceipt({ response, restaurant, cardVerification, accountOrders }) {
  const payment = response.payments[0];
  if (!payment) throw new Error("A successful payment must contain at least one allocation.");
  const orders = accountOrders || response.orders || [];
  const balances = orders.map(computeOrderBalance);
  const amountPaidCents = sumCents(
    response.payments.map((entry) => moneyToCents(entry.amountPaid))
  );
  return {
    id: payment.id,
    receiptNumber: receiptNumber(payment.id),
    kind: "PAYMENT",
    snapshotKind: "PAYMENT_SNAPSHOT",
    snapshotVersion: 1,
    restaurantName: restaurant?.restaurantName || "TEPSY",
    currency: restaurant?.currency || "₺",
    tableId: response.table?.id || orders.find((order) => order.tableId)?.tableId || null,
    tableNumber:
      response.table?.tableNumber ||
      orders.find((order) => order.table)?.table?.tableNumber ||
      null,
    section: response.table?.section || orders.find((order) => order.table)?.table?.section || null,
    orderIds: orders.map((order) => order.id),
    items: receiptItems(orders),
    grossTotal: centsToMoney(sumCents(balances.map((balance) => balance.grossCents))),
    discountAmount: centsToMoney(sumCents(balances.map((balance) => balance.discountCents))),
    netTotal: centsToMoney(sumCents(balances.map((balance) => balance.netCents))),
    orderTotal: centsToMoney(sumCents(balances.map((balance) => balance.netCents))),
    amountPaid: centsToMoney(amountPaidCents),
    totalAmount: centsToMoney(amountPaidCents),
    totalPaid: centsToMoney(sumCents(balances.map((balance) => balance.paidCents))),
    remainingBalance: centsToMoney(sumCents(balances.map((balance) => balance.remainingCents))),
    paymentMethod: payment.paymentMethod,
    timestamp: new Date(response.timestamp).toISOString(),
    cardVerification: cardVerification || null,
  };
}

export async function buildAccountPaymentReceipt(
  client,
  { response, restaurant, cardVerification }
) {
  const orderIds = (response.orders || []).map((order) => order.id);
  if (!orderIds.length) throw new Error("A payment receipt requires an account.");
  const tableId =
    response.table?.id || response.orders.find((order) => order.tableId)?.tableId || null;
  const scope = scopeQuery({ tableId, orderIds });
  const connected = await client.$queryRawUnsafe(
    `${scope.sql} SELECT orderId FROM connected`,
    ...scope.args
  );
  const orders = await client.order.findMany({
    where: {
      id: { in: connected.map((row) => row.orderId) },
      status: { not: "CANCELLED" },
      ...(tableId ? { tableId } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      items: { where: { status: { not: "CANCELLED" } }, include: { menuItem: true } },
      payments: true,
    },
  });
  return buildPaymentReceipt({ restaurant, cardVerification, response, accountOrders: orders });
}

function storedResponse(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Invalid response");
    return parsed;
  } catch {
    throw new PaymentRequestError(
      500,
      "invalid-payment-receipt",
      "Kaydedilmiş ödeme fişi okunamadı."
    );
  }
}

export function legacyPaymentReceipt(payment, response = null) {
  const original = response?.payments?.[0];
  const id = original?.id || payment.id;
  const orders = response?.orders || [];
  const optionalAmount = (value) => (value == null ? null : centsToMoney(moneyToCents(value)));
  const net = optionalAmount(response?.netTotal);
  const remaining = optionalAmount(response?.remainingBalance);
  const amountPaid = centsToMoney(moneyToCents(payment.amountPaid));
  return {
    id,
    receiptNumber: receiptNumber(id),
    kind: "PAYMENT",
    snapshotKind: response ? "LEGACY_RESPONSE" : "LEGACY_PAYMENT",
    snapshotVersion: 0,
    // These fields were never persisted by older releases; current settings are not historical facts.
    restaurantName: null,
    currency: null,
    tableId:
      response?.table?.id ||
      orders.find((order) => order.tableId)?.tableId ||
      payment.tableId ||
      payment.order?.tableId ||
      null,
    tableNumber: response?.table?.tableNumber || null,
    section: response?.table?.section || null,
    orderIds: orders.length
      ? orders.map((order) => order.id)
      : payment.orderIds || (payment.orderId ? [payment.orderId] : []),
    items: receiptItems(orders),
    grossTotal: optionalAmount(response?.grossTotal),
    discountAmount: optionalAmount(response?.discountAmount),
    netTotal: net,
    orderTotal: net,
    amountPaid,
    totalAmount: amountPaid,
    totalPaid:
      net != null && remaining != null
        ? centsToMoney(moneyToCents(net) - moneyToCents(remaining))
        : null,
    remainingBalance: remaining,
    paymentMethod: payment.paymentMethod,
    timestamp: new Date(response?.timestamp || payment.createdAt).toISOString(),
    cardVerification: response?.cardVerification || null,
  };
}

const IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;

export function parsePaymentHistoryQuery(url) {
  const params = url.searchParams;
  const tableId = params.get("tableId") || null;
  if (tableId && !IDENTIFIER.test(tableId))
    throw new PaymentRequestError(400, "invalid-table-id", "Masa kimliği geçersiz.");
  const orderIds = params.has("orderIds") ? [...new Set(params.get("orderIds").split(","))] : [];
  if (orderIds.length > 100 || orderIds.some((id) => !IDENTIFIER.test(id))) {
    throw new PaymentRequestError(400, "invalid-order-ids", "Sipariş kimlikleri geçersiz.");
  }
  const limitText = params.get("limit") || "20";
  const limit = Number(limitText);
  if (!/^\d+$/.test(limitText) || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new PaymentRequestError(400, "invalid-limit", "Fiş sayısı 1 ile 50 arasında olmalıdır.");
  }
  let before = null;
  const encoded = params.get("before");
  if (encoded) {
    try {
      if (encoded.length > 512 || !/^[A-Za-z0-9_-]+$/.test(encoded))
        throw new Error("Invalid cursor");
      before = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      if (
        !before ||
        typeof before !== "object" ||
        !/^\d{1,16}$/.test(before.at) ||
        !/^(key|id):[A-Za-z0-9._:-]{1,128}$/.test(before.key)
      )
        throw new Error("Invalid cursor");
    } catch {
      throw new PaymentRequestError(
        400,
        "invalid-cursor",
        "Fiş sayfası geçersiz; listeyi yenileyin."
      );
    }
  }
  return { tableId, orderIds, limit, before };
}

function scopeQuery({ tableId, orderIds }) {
  const predicates = [];
  const args = [];
  let connections = "";
  if (orderIds.length) {
    const validResponse = "CASE WHEN json_valid(a.responseJson) THEN a.responseJson ELSE '{}' END";
    const tablePredicate = tableId ? "AND o.tableId = ?" : "";
    connections = `receipt_orders AS (
      SELECT a.idempotencyKey, r.value AS orderId FROM PaymentAttempt a, json_each(${validResponse}, '$.receipt.orderIds') r
        JOIN "Order" o ON o.id = r.value WHERE o.status != 'CANCELLED' ${tablePredicate}
      UNION
      SELECT a.idempotencyKey, json_extract(r.value, '$.id') AS orderId FROM PaymentAttempt a, json_each(${validResponse}, '$.orders') r
        JOIN "Order" o ON o.id = json_extract(r.value, '$.id') WHERE o.status != 'CANCELLED' ${tablePredicate}
    ), connected(orderId) AS (
      ${orderIds.map(() => "SELECT ?").join(" UNION ")}
      UNION
      SELECT r2.orderId FROM connected c JOIN receipt_orders r1 ON r1.orderId = c.orderId
        JOIN receipt_orders r2 ON r2.idempotencyKey = r1.idempotencyKey
    ), `;
    if (tableId) args.push(tableId, tableId);
    args.push(...orderIds);
  }
  if (tableId) {
    predicates.push(
      `(o.tableId = ? OR json_extract(CASE WHEN json_valid(a.responseJson) THEN a.responseJson ELSE '{}' END, '$.receipt.tableId') = ?)`
    );
    args.push(tableId, tableId);
  }
  if (orderIds.length) {
    // An attempt can include an order with no allocation yet. Its immutable snapshot still connects the account.
    predicates.push(`(p.orderId IN (SELECT orderId FROM connected) OR p.idempotencyKey IN (
      SELECT idempotencyKey FROM receipt_orders WHERE orderId IN (SELECT orderId FROM connected)
    ))`);
  }
  return {
    sql: `WITH RECURSIVE ${connections}scope AS (
      SELECT DISTINCT CASE WHEN p.idempotencyKey IS NULL THEN 'id:' || p.id ELSE 'key:' || p.idempotencyKey END AS groupKey
      FROM Payment p JOIN "Order" o ON o.id = p.orderId LEFT JOIN PaymentAttempt a ON a.idempotencyKey = p.idempotencyKey
      ${predicates.length ? `WHERE ${predicates.join(" AND ")}` : ""}
    ), grouped AS (
      SELECT CASE WHEN p.idempotencyKey IS NULL THEN 'id:' || p.id ELSE 'key:' || p.idempotencyKey END AS groupKey,
        MIN(p.id) AS id, MAX(p.createdAt) AS createdAt, MAX(o.tableId) AS tableId,
        MAX(p.paymentMethod) AS paymentMethod, MAX(a.responseJson) AS responseJson,
        SUM(CAST(ROUND(p.amountPaid * 100) AS INTEGER)) AS amountCents,
        SUM(CASE WHEN p.paymentMethod = 'CASH' THEN CAST(ROUND(p.amountPaid * 100) AS INTEGER) ELSE 0 END) AS cashCents,
        SUM(CASE WHEN p.paymentMethod = 'CREDIT_CARD' THEN CAST(ROUND(p.amountPaid * 100) AS INTEGER) ELSE 0 END) AS cardCents,
        SUM(CASE WHEN p.paymentMethod NOT IN ('CASH','CREDIT_CARD') THEN CAST(ROUND(p.amountPaid * 100) AS INTEGER) ELSE 0 END) AS otherCents
      FROM Payment p JOIN "Order" o ON o.id = p.orderId LEFT JOIN PaymentAttempt a ON a.idempotencyKey = p.idempotencyKey
      WHERE CASE WHEN p.idempotencyKey IS NULL THEN 'id:' || p.id ELSE 'key:' || p.idempotencyKey END IN (SELECT groupKey FROM scope)
      GROUP BY groupKey
    )`,
    args,
  };
}

function databaseCents(value) {
  const number = Number(value || 0);
  if (!Number.isSafeInteger(number) || number < 0)
    throw new FinanceError(
      "invalid-money",
      "Payment history amount is outside the supported range."
    );
  return number;
}

function publicHistoryEntry(row) {
  const response = storedResponse(row.responseJson);
  const amountPaid = centsToMoney(databaseCents(row.amountCents));
  const receipt =
    response?.receipt ||
    legacyPaymentReceipt(
      {
        id: row.id,
        tableId: row.tableId,
        amountPaid,
        paymentMethod: row.paymentMethod,
        createdAt: new Date(Number(row.createdAt)),
      },
      response
    );
  return {
    id: receipt.id,
    receiptNumber: receipt.receiptNumber,
    tableId: receipt.tableId,
    tableNumber: receipt.tableNumber,
    section: receipt.section,
    orderIds: receipt.orderIds,
    amountPaid,
    paymentMethod: receipt.paymentMethod,
    createdAt: receipt.timestamp,
    remainingBalance: receipt.remainingBalance,
    receiptAvailable: true,
    snapshotKind: receipt.snapshotKind,
    currency: receipt.currency,
    restaurantName: receipt.restaurantName,
  };
}

export async function listPaymentHistory(client, parsed) {
  const scope = scopeQuery(parsed);
  const cursorArgs = parsed.before
    ? [BigInt(parsed.before.at), BigInt(parsed.before.at), parsed.before.key]
    : [];
  const [rows, totalsRows, accountRows, currencyRows] = await Promise.all([
    client.$queryRawUnsafe(
      `${scope.sql} SELECT * FROM grouped ${parsed.before ? "WHERE createdAt < ? OR (createdAt = ? AND groupKey < ?)" : ""} ORDER BY createdAt DESC, groupKey DESC LIMIT ?`,
      ...scope.args,
      ...cursorArgs,
      parsed.limit + 1
    ),
    client.$queryRawUnsafe(
      `${scope.sql} SELECT SUM(cashCents) AS cash, SUM(cardCents) AS card, SUM(otherCents) AS other, SUM(amountCents) AS total, COUNT(*) AS paymentCount FROM grouped`,
      ...scope.args
    ),
    parsed.orderIds.length
      ? client.$queryRawUnsafe(
          `${scope.sql}
      SELECT o.id, o.totalPrice, o.discountAmount, SUM(CAST(ROUND(p.amountPaid * 100) AS INTEGER)) AS paidCents
      FROM "Order" o LEFT JOIN Payment p ON p.orderId = o.id
      WHERE o.id IN (SELECT orderId FROM connected) AND o.status != 'CANCELLED' ${parsed.tableId ? "AND o.tableId = ?" : ""}
      GROUP BY o.id ORDER BY o.id ASC`,
          ...scope.args,
          ...(parsed.tableId ? [parsed.tableId] : [])
        )
      : null,
    client.$queryRawUnsafe(
      `${scope.sql}
      SELECT json_extract(CASE WHEN json_valid(responseJson) THEN responseJson ELSE '{}' END, '$.receipt.currency') AS currency,
        SUM(cashCents) AS cash, SUM(cardCents) AS card, SUM(otherCents) AS other, SUM(amountCents) AS total, COUNT(*) AS paymentCount
      FROM grouped GROUP BY currency ORDER BY currency ASC`,
      ...scope.args
    ),
  ]);
  const selected = rows.slice(0, parsed.limit);
  const last = selected.at(-1);
  const total = totalsRows[0] || {};
  const balances = accountRows?.map((order) =>
    computeOrderBalance({
      totalPrice: order.totalPrice,
      discountAmount: order.discountAmount,
      payments: [{ amountPaid: centsToMoney(databaseCents(order.paidCents)) }],
    })
  );
  return {
    payments: selected.map(publicHistoryEntry),
    totals: {
      cash: centsToMoney(databaseCents(total.cash)),
      card: centsToMoney(databaseCents(total.card)),
      other: centsToMoney(databaseCents(total.other)),
      total: centsToMoney(databaseCents(total.total)),
      paymentCount: Number(total.paymentCount || 0),
    },
    totalsByCurrency: currencyRows.map((entry) => ({
      currency: entry.currency || null,
      cash: centsToMoney(databaseCents(entry.cash)),
      card: centsToMoney(databaseCents(entry.card)),
      other: centsToMoney(databaseCents(entry.other)),
      total: centsToMoney(databaseCents(entry.total)),
      paymentCount: Number(entry.paymentCount || 0),
    })),
    nextCursor:
      rows.length > parsed.limit && last
        ? Buffer.from(JSON.stringify({ at: String(last.createdAt), key: last.groupKey })).toString(
            "base64url"
          )
        : null,
    account: balances
      ? {
          grossTotal: centsToMoney(sumCents(balances.map((balance) => balance.grossCents))),
          discountAmount: centsToMoney(sumCents(balances.map((balance) => balance.discountCents))),
          netTotal: centsToMoney(sumCents(balances.map((balance) => balance.netCents))),
          totalPaid: centsToMoney(sumCents(balances.map((balance) => balance.paidCents))),
          remainingBalance: centsToMoney(
            sumCents(balances.map((balance) => balance.remainingCents))
          ),
          orderIds: accountRows.map((order) => order.id),
        }
      : null,
  };
}

export async function readPaymentReceipt(client, id) {
  if (typeof id !== "string" || !IDENTIFIER.test(id))
    throw new PaymentRequestError(400, "invalid-payment-id", "Ödeme kimliği geçersiz.");
  const payment = await client.payment.findUnique({
    where: { id },
    include: { order: { select: { tableId: true } } },
  });
  if (!payment) throw new PaymentRequestError(404, "payment-not-found", "Ödeme fişi bulunamadı.");
  if (!payment.idempotencyKey) return legacyPaymentReceipt(payment);
  const attempt = await client.paymentAttempt.findUnique({
    where: { idempotencyKey: payment.idempotencyKey },
  });
  const response = storedResponse(attempt?.responseJson);
  if (response?.receipt) return response.receipt;
  const allocations = await client.payment.findMany({
    where: { idempotencyKey: payment.idempotencyKey },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return legacyPaymentReceipt(
    {
      ...payment,
      id: allocations[0]?.id || payment.id,
      orderIds: allocations.map((entry) => entry.orderId),
      amountPaid: centsToMoney(
        sumCents(allocations.map((entry) => moneyToCents(entry.amountPaid)))
      ),
    },
    response
  );
}
