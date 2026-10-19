export function selectReportCurrency({
  payments,
  orders,
  refunds,
  attempts,
  currentCurrency,
  requested,
}) {
  const snapshots = new Map();
  for (const attempt of attempts) {
    try {
      snapshots.set(
        attempt.idempotencyKey,
        JSON.parse(attempt.responseJson)?.receipt?.currency || null
      );
    } catch {
      snapshots.set(attempt.idempotencyKey, null);
    }
  }
  const paymentCurrency = (payment) => snapshots.get(payment.idempotencyKey) || null;
  const orderCurrency = (order) => {
    const units = [...new Set((order.payments || []).map(paymentCurrency))];
    return !units.length ? currentCurrency : units.length === 1 ? units[0] : null;
  };
  const availableCurrencies = [
    ...new Set([
      currentCurrency,
      ...payments.map(paymentCurrency),
      ...orders.map(orderCurrency),
      ...refunds.map((r) => r.currency),
    ]),
  ];
  const currency = requested === "unknown" ? null : requested || currentCurrency;
  if (currency !== null && !["₺", "$", "€", "£"].includes(currency))
    throw new Error("Geçersiz para birimi.");
  return {
    currency,
    availableCurrencies,
    payments: payments.filter((p) => paymentCurrency(p) === currency),
    orders: orders.filter((o) => orderCurrency(o) === currency),
    refunds: refunds.filter((r) => r.currency === currency),
  };
}
