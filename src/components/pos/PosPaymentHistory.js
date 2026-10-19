"use client";
import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import RefundDialog from "./RefundDialog";
import "@/styles/pos-payments.css";

export default function PosPaymentHistory({
  tableId,
  orderIds = "",
  version = 0,
  lang,
  formatPrice,
  onReceipt,
  onAccountChange,
  global = false,
}) {
  const [result, setResult] = useState(null);
  const [cursor, setCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [refundEntry, setRefundEntry] = useState(null);
  const [canRefund, setCanRefund] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/auth/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active) setCanRefund(Boolean(d && (!d.authEnabled || d.session?.role === "ADMIN")));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const tr = lang === "tr";
  function historicalAmount(value, currency) {
    if (currency === undefined) return formatPrice(value);
    const number = (Number(value) || 0).toLocaleString(tr ? "tr-TR" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return currency && ["$", "€", "£"].includes(currency)
      ? `${currency}${number}`
      : `${number} ${currency || "?"}`;
  }
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ limit: "20" });
    if (tableId) query.set("tableId", tableId);
    if (orderIds) query.set("orderIds", orderIds);
    if (cursor) query.set("before", cursor);
    fetch(`/api/pos/payments?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.payments) || !data.totals)
          throw new Error(data.error || "history-unavailable");
        if (controller.signal.aborted) return;
        setResult(data);
        onAccountChange?.({ tableId, orderIds, summary: data.account || null });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setError(
          error.message === "history-unavailable"
            ? tr
              ? "Tahsilat geçmişi alınamadı."
              : "Payment history could not be loaded."
            : error.message
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [tableId, orderIds, version, cursor, retry, tr, onAccountChange]);
  const totals = result?.totals;
  const currencyTotals = result?.totalsByCurrency?.length
    ? result.totalsByCurrency
    : [{ ...totals, currency: undefined }];
  return (
    <section
      className="pos-payment-history"
      aria-label={
        global
          ? tr
            ? "Tahsilat geçmişi"
            : "Payment history"
          : orderIds
            ? tr
              ? "Bu hesabın tahsilatları"
              : "Payments for this account"
            : tr
              ? "Masanın tahsilat geçmişi"
              : "Payments for this table"
      }
    >
      <header>
        <h4>
          {global
            ? tr
              ? "Kaydedilen tahsilatlar"
              : "Recorded payments"
            : orderIds
              ? tr
                ? "Bu hesabın tahsilatları"
                : "Payments for this account"
              : tr
                ? "Masanın tahsilat geçmişi"
                : "Payments for this table"}
        </h4>
        {totals && (
          <span>
            {totals.paymentCount} {tr ? "tahsilat" : "payments"}
          </span>
        )}
      </header>
      {totals && (
        <div data-testid="payment-history-summary">
          {currencyTotals.map((bucket) => (
            <div key={bucket.currency || "unknown"}>
              {currencyTotals.length > 1 && (
                <h5>
                  {bucket.currency || (tr ? "Para birimi kaydedilmemiş" : "Currency not recorded")}
                </h5>
              )}
              <dl className="pos-history-summary">
                <div>
                  <dt>{tr ? "Nakit tahsilat" : "Cash collected"}</dt>
                  <dd>{historicalAmount(bucket.cash, bucket.currency)}</dd>
                </div>
                <div>
                  <dt>{tr ? "Kart tahsilatı" : "Card collected"}</dt>
                  <dd>{historicalAmount(bucket.card, bucket.currency)}</dd>
                </div>
                <div>
                  <dt>{tr ? "Diğer tahsilat" : "Other collected"}</dt>
                  <dd>{historicalAmount(bucket.other, bucket.currency)}</dd>
                </div>
                <div className="pos-history-total">
                  <dt>{tr ? "Toplam tahsilat" : "Total collected"}</dt>
                  <dd>{historicalAmount(bucket.total, bucket.currency)}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}
      {currencyTotals.length > 1 && (
        <p>
          {tr
            ? "Farklı para birimleri ayrı gösterilir."
            : "Different currencies are shown separately."}
        </p>
      )}
      {loading && <p role="status">{tr ? "Tahsilatlar yükleniyor…" : "Loading payments…"}</p>}
      {error && (
        <div className="pos-history-error">
          <p role="alert">{error}</p>
          <button
            type="button"
            className="secondary-action"
            onClick={() => setRetry((value) => value + 1)}
          >
            {tr ? "Yeniden dene" : "Try again"}
          </button>
        </div>
      )}
      {!loading && !error && result?.payments.length === 0 && (
        <p>
          {tr
            ? "Henüz tahsilat kaydı yok. Her ödeme burada ayrı fişiyle görünür."
            : "No payments yet. Each payment will appear here with its own receipt."}
        </p>
      )}
      {result?.payments.length > 0 && (
        <div className="pos-payment-entries">
          {result.payments.map((entry) => (
            <article className="pos-payment-entry" key={entry.id}>
              <div>
                <strong>{entry.receiptNumber}</strong>
                {global && (
                  <span>
                    {entry.tableNumber}
                    {entry.section ? ` · ${entry.section}` : ""}
                  </span>
                )}
                <span>
                  {entry.paymentMethod === "CASH"
                    ? tr
                      ? "Nakit"
                      : "Cash"
                    : entry.paymentMethod === "CREDIT_CARD"
                      ? tr
                        ? "Kart"
                        : "Card"
                      : tr
                        ? "Diğer"
                        : "Other"}{" "}
                  ·{" "}
                  <time dateTime={entry.createdAt}>
                    {new Date(entry.createdAt).toLocaleString(tr ? "tr-TR" : "en-GB", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </time>
                </span>
              </div>
              <strong className="pos-history-amount">
                {historicalAmount(entry.amountPaid, entry.currency)}
              </strong>
              <div className="pos-history-actions">
                {Number(entry.refundedAmount || 0) > 0 && (
                  <span className="text-xs">
                    {tr ? "İade: " : "Refunded: "}
                    {historicalAmount(entry.refundedAmount, entry.currency)}
                  </span>
                )}
                {canRefund &&
                  entry.currency &&
                  Number(entry.refundableAmount ?? entry.amountPaid) > 0 && (
                    <button
                      type="button"
                      className="secondary-action min-h-11 px-2 text-xs"
                      onClick={() => setRefundEntry(entry)}
                    >
                      {tr ? "İade / düzeltme" : "Refund / correction"}
                    </button>
                  )}
                <button
                  type="button"
                  className="pos-history-receipt"
                  aria-label={`${tr ? "Fişi aç" : "Open receipt"}: ${entry.receiptNumber}`}
                  disabled={loading || entry.receiptAvailable === false}
                  onClick={() => onReceipt(entry.id)}
                >
                  <Receipt size={17} aria-hidden="true" />
                  <span>{tr ? "Fiş" : "Receipt"}</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {refundEntry && (
        <RefundDialog
          key={refundEntry.id}
          entry={refundEntry}
          lang={lang}
          onClose={() => setRefundEntry(null)}
          onSaved={() => {
            setRefundEntry(null);
            setRetry((n) => n + 1);
          }}
        />
      )}
      {(cursor || result?.nextCursor) && (
        <nav className="pos-history-pages" aria-label={tr ? "Tahsilat sayfaları" : "Payment pages"}>
          {cursor && (
            <button type="button" disabled={loading} onClick={() => setCursor("")}>
              {tr ? "En yeni tahsilatlar" : "Latest payments"}
            </button>
          )}
          {result?.nextCursor && (
            <button type="button" disabled={loading} onClick={() => setCursor(result.nextCursor)}>
              {tr ? "Daha eski tahsilatlar" : "Older payments"}
            </button>
          )}
        </nav>
      )}
    </section>
  );
}
