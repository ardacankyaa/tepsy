"use client";
import { planItemPayment } from "@/lib/item-payments.mjs";
import { allocateDiscountAcrossOrders } from "@/lib/finance.mjs";

export default function PosItemPayments({
  orders,
  selection = [],
  onChange,
  busy,
  lang,
  formatPrice,
  discountPercent,
  tipAmount,
}) {
  const tr = lang === "tr";
  let amount = null;
  if (selection.length) {
    try {
      // Preview only; the server recalculates from its current snapshots.
      const gross = orders.reduce((s, o) => s + Math.round(Number(o.totalPrice) * 100), 0);
      const discount = Math.round((gross * Number(discountPercent || 0)) / 100);
      const allocated = allocateDiscountAcrossOrders(orders, discount);
      const locked = orders.some(
        (o) => (o.payments || []).length > 0 || Number(o.discountAmount || 0) > 0
      );
      const previewOrders = orders.map((o) => {
        const value = allocated.find((a) => a.orderId === o.id)?.discountCents || 0;
        return { ...o, discountAmount: locked ? Number(o.discountAmount || 0) : value / 100 };
      });
      amount =
        planItemPayment(previewOrders, selection).allocations.reduce(
          (s, a) => s + a.amountCents,
          0
        ) / 100;
    } catch {
      amount = null;
    }
  }
  return (
    <details className="pos-options" open={selection.length > 0}>
      <summary>{tr ? "Ürün seçerek öde" : "Pay selected items"}</summary>
      <div className="pos-split-payments">
        <p>
          {tr
            ? "Ödenecek ürünleri ve adetlerini seçin. Tutar otomatik hesaplanır."
            : "Select products and quantities. The amount is calculated automatically."}
        </p>
        {orders.map((order) => (
          <div key={order.id}>
            {order.itemPaymentsAvailable === false && (
              <p role="status">
                {tr
                  ? "Bu siparişte tutar bazlı ödeme var; kalanını özel tutarla tahsil edin."
                  : "This order has amount-only payments. Use a custom amount for its remainder."}
              </p>
            )}
            {(order.items || [])
              .filter((i) => i.status !== "CANCELLED")
              .map((item) => {
                const remaining =
                  order.itemPaymentsAvailable === false
                    ? 0
                    : (item.remainingQuantity ?? item.quantity);
                const value = selection.find((s) => s.orderItemId === item.id)?.quantity || 0;
                return (
                  <label className="pos-item-payment-choice" key={item.id}>
                    <span>
                      {item.menuItemName || item.menuItem?.name}
                      <small>
                        {tr ? "Kalan" : "Remaining"}: {remaining} · {formatPrice(item.unitPrice)}
                      </small>
                    </span>
                    <select
                      aria-label={`${tr ? "Ödenecek adet" : "Quantity to pay"}: ${item.menuItemName || item.menuItem?.name}`}
                      value={value}
                      disabled={busy || !remaining}
                      onChange={(e) =>
                        onChange([
                          ...selection.filter((s) => s.orderItemId !== item.id),
                          ...(Number(e.target.value)
                            ? [{ orderItemId: item.id, quantity: Number(e.target.value) }]
                            : []),
                        ])
                      }
                    >
                      {Array.from({ length: remaining + 1 }, (_, i) => (
                        <option key={i} value={i}>
                          {i}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
          </div>
        ))}
        {selection.length > 0 && (
          <>
            <p role="status">
              {tr ? "Seçilen ürünler" : "Selected items"}:{" "}
              <strong>{amount === null ? "—" : formatPrice(amount)}</strong>
            </p>
            <p>
              {tr ? "Bahşiş dahil bu tahsilat" : "This collection including tip"}:{" "}
              <strong>
                {amount === null
                  ? "—"
                  : formatPrice(
                      amount + Math.max(0, Number(String(tipAmount || 0).replace(",", ".")) || 0)
                    )}
              </strong>
            </p>
            <button type="button" disabled={busy} onClick={() => onChange([])}>
              {tr ? "Seçimi temizle" : "Clear selection"}
            </button>
          </>
        )}
      </div>
    </details>
  );
}
