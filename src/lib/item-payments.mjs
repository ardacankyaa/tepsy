import {
  moneyToCents,
  centsToMoney,
  computeOrderBalance,
  allocateDiscountAcrossOrders,
} from "./finance.mjs";
import { PaymentRequestError } from "./payment-errors.mjs";

const PAYABLE_ORDER_STATUSES = new Set(["PENDING", "PREPARING", "READY", "DELIVERED"]);

// Client preview only. Checkout always recalculates from server snapshots.
export function previewItemPaymentAmount(orders, selections, discountPercent = 0) {
  if (!selections.length) return null;
  try {
    const gross = orders.reduce((sum, order) => sum + moneyToCents(order.totalPrice), 0);
    const discount = Math.round((gross * Number(discountPercent || 0)) / 100);
    const allocated = allocateDiscountAcrossOrders(orders, discount);
    const locked = orders.some(
      (order) => (order.payments || []).length > 0 || Number(order.discountAmount || 0) > 0
    );
    const previewOrders = orders.map((order) => ({
      ...order,
      discountAmount: locked
        ? Number(order.discountAmount || 0)
        : (allocated.find((part) => part.orderId === order.id)?.discountCents || 0) / 100,
    }));
    return (
      planItemPayment(previewOrders, selections).allocations.reduce(
        (sum, allocation) => sum + allocation.amountCents,
        0
      ) / 100
    );
  } catch {
    return null;
  }
}

export function itemAvailability(order) {
  const available = !(order.payments || []).some(
    (p) => moneyToCents(p.amountPaid) > 0 && !p.itemsJson
  );
  return {
    ...order,
    itemPaymentsAvailable: available,
    items: (order.items || []).map((item) => ({
      ...item,
      paidQuantity: item.paidQuantity || 0,
      remainingQuantity: available ? Math.max(0, item.quantity - (item.paidQuantity || 0)) : 0,
    })),
  };
}

export function planItemPayment(orders, selections) {
  const wanted = new Map(selections.map((s) => [s.orderItemId, s.quantity]));
  const allocations = [];
  for (const order of orders) {
    const items = (order.items || [])
      .filter((i) => i.status !== "CANCELLED")
      .sort((a, b) => a.id.localeCompare(b.id));
    const selected = items.filter((i) => wanted.has(i.id));
    if (!selected.length) continue;
    if (!PAYABLE_ORDER_STATUSES.has(order.status))
      throw new PaymentRequestError(
        409,
        "invalid-order-state",
        "Sipariş tahsil edilebilir durumda değil."
      );
    if (!itemAvailability(order).itemPaymentsAvailable)
      throw new PaymentRequestError(
        409,
        "unallocated-payment",
        "Bu siparişte tutar bazlı ödeme var. Kalan bakiyeyi tutar üzerinden tahsil edin."
      );
    const balance = computeOrderBalance(order);
    const gross = items.reduce((s, i) => s + moneyToCents(i.unitPrice) * i.quantity, 0);
    if (gross !== balance.grossCents || !Number.isSafeInteger(gross))
      throw new PaymentRequestError(
        409,
        "item-balance-mismatch",
        "Ürün toplamı hesapla eşleşmiyor; hesabı yenileyin."
      );
    let cumulative = 0,
      discountUsed = 0,
      amountCents = 0;
    const paymentItems = [];
    for (const item of items) {
      const requested = wanted.get(item.id) || 0;
      const paid = item.paidQuantity || 0;
      if (requested > item.quantity - paid)
        throw new PaymentRequestError(
          409,
          "item-already-paid",
          "Seçilen ürün adedi artık ödenebilir değil. Hesabı yenileyin."
        );
      let line = 0;
      for (let n = 0; n < item.quantity; n++) {
        const price = moneyToCents(item.unitPrice);
        cumulative += price;
        const discount = gross
          ? Number((BigInt(balance.discountCents) * BigInt(cumulative)) / BigInt(gross))
          : 0;
        const net = price - (discount - discountUsed);
        discountUsed = discount;
        if (n >= paid && n < paid + requested) line += net;
      }
      if (requested) {
        wanted.delete(item.id);
        amountCents += line;
        paymentItems.push({
          orderItemId: item.id,
          name: item.menuItemName || item.menuItem?.name || "Ürün",
          quantity: requested,
          unitPrice: centsToMoney(moneyToCents(item.unitPrice)),
          amount: centsToMoney(line),
        });
      }
    }
    if (amountCents > balance.remainingCents)
      throw new PaymentRequestError(409, "overpayment", "Seçim kalan bakiyeyi aşıyor.");
    allocations.push({
      orderId: order.id,
      amountCents,
      nextStatus: amountCents === balance.remainingCents ? "PAID" : order.status,
      paymentItems,
    });
  }
  if (wanted.size || !allocations.length)
    throw new PaymentRequestError(
      409,
      "invalid-selected-items",
      "Seçilen ürün bu açık hesapta bulunamadı."
    );
  return { allocations };
}
