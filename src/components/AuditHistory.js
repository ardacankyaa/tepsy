"use client";
import { useCallback, useEffect, useState } from "react";
const actions = {
  ORDER_CREATED: ["Sipariş eklendi", "Order created"],
  ORDER_UPDATED: ["Sipariş güncellendi", "Order updated"],
  PAYMENT_RECORDED: ["Tahsilat / indirim", "Payment / discount"],
  PAYMENT_REFUND: ["İade / düzeltme", "Refund / correction"],
  BACKUP_PLAN: ["Yedek planı", "Backup plan"],
  BACKUP_CREATED: ["Tam yedek", "Full backup"],
};
export default function AuditHistory({ lang }) {
  const [events, setEvents] = useState([]),
    [cursor, setCursor] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const tr = lang === "tr";
  const load = useCallback(
    async (before) => {
      setBusy(true);
      setError("");
      try {
        const r = await fetch(
          `/api/audit${before ? "?before=" + encodeURIComponent(before) : ""}`,
          {
            cache: "no-store",
          }
        );
        if (!r.ok) throw new Error("audit-unavailable");
        const d = await r.json();
        if (!Array.isArray(d?.events)) throw new Error("audit-invalid-response");
        setEvents(d.events);
        setCursor(d.nextCursor);
      } catch {
        setError(tr ? "İşlem geçmişi alınamadı." : "Activity history could not be loaded.");
      } finally {
        setBusy(false);
      }
    },
    [tr]
  );
  useEffect(() => {
    load();
  }, [load]);
  return (
    <section
      className="mt-4 grid min-w-0 gap-3 border-t border-[var(--border)] pt-4"
      aria-label={tr ? "İşlem geçmişi" : "Activity history"}
    >
      <h3 className="text-sm font-semibold">{tr ? "İşlem geçmişi" : "Activity history"}</h3>
      <p className="text-xs text-[var(--text-secondary)]">
        {tr
          ? "Sipariş, iptal, tahsilat, indirim ve iadelerde işlemi yapan kişi kaydedilir."
          : "Orders, cancellations, payments, discounts and refunds record the person responsible."}
      </p>
      <div className="max-h-64 min-w-0 overflow-auto">
        <ul className="grid gap-3 text-xs">
          {events.map((e) => (
            <li
              key={e.id}
              className="grid min-w-0 gap-1 border-b border-[var(--border)] pb-2 break-words"
            >
              <strong>
                {actions[e.action]?.[tr ? 0 : 1] || e.action} · {e.actorName}
              </strong>
              <time>{new Date(e.createdAt).toLocaleString(tr ? "tr-TR" : "en-US")}</time>
              <span className="break-all">{e.entityId}</span>
              {e.details.reason && <span>{e.details.reason}</span>}
              {e.details.amount && (
                <span>
                  {e.details.amount} {e.details.currency || ""}
                </span>
              )}
              {e.details.discountReason && <span>{e.details.discountReason}</span>}
              {e.details.items?.map((item, i) => (
                <span key={i}>
                  {item.quantity} × {item.name}
                </span>
              ))}
              {e.details.action === "cancelItemId" && (
                <span>{tr ? "Ürün iptali" : "Item cancellation"}</span>
              )}
              {e.details.previousStatus && e.details.status && (
                <span>
                  {e.details.previousStatus} → {e.details.status}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
      {!busy && !events.length && !error && (
        <p className="text-xs">{tr ? "Henüz işlem yok." : "No activity yet."}</p>
      )}
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="secondary-action min-h-11 px-3 text-xs"
          disabled={busy}
          onClick={() => load()}
        >
          {tr ? "Yenile" : "Refresh"}
        </button>
        {cursor && (
          <button
            type="button"
            className="secondary-action min-h-11 px-3 text-xs"
            disabled={busy}
            onClick={() => load(cursor)}
          >
            {tr ? "Daha eski işlemler" : "Older activity"}
          </button>
        )}
      </div>
    </section>
  );
}
