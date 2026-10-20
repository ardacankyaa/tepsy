"use client";

export default function PosItemPayments({
  orders,
  selection = [],
  onChange,
  busy,
  lang,
  formatPrice,
}) {
  const tr = lang === "tr";
  return (
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
        <button type="button" disabled={busy} onClick={() => onChange([])}>
          {tr ? "Seçimi temizle" : "Clear selection"}
        </button>
      )}
    </div>
  );
}
