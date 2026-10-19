"use client";
import { useState } from "react";
import { Dialog } from "@/components/ui/Workspace";
import { createIdempotencyKey } from "@/lib/order-idempotency.mjs";
export default function RefundDialog({ entry, lang, onClose, onSaved }) {
  const tr = lang === "tr";
  const key = `tepsy:refund-attempt:${entry.id}`;
  const [pending, setPending] = useState(() => {
    try {
      const v = JSON.parse(sessionStorage.getItem(key));
      return v?.paymentId === entry.id ? v : null;
    } catch {
      return null;
    }
  });
  const [amount, setAmount] = useState(
    pending?.amount || entry.refundableAmount || entry.amountPaid
  );
  const [reason, setReason] = useState(pending?.reason || "");
  const [confirmed, setConfirmed] = useState(Boolean(pending));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const principalRemaining = Number(
    entry.refundablePrincipalAmount ?? entry.refundableAmount ?? entry.amountPaid ?? 0
  );
  const tipRemaining = Number(entry.refundableTipAmount || 0);
  const requestedAmount = Number(String(amount).trim().replace(",", "."));
  const previewTipAmount = Number.isFinite(requestedAmount)
    ? Math.max(0, Math.round(requestedAmount * 100 - principalRemaining * 100)) / 100
    : null;
  const formatAmount = (value) =>
    `${new Intl.NumberFormat(tr ? "tr-TR" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value) || 0)} ${entry.currency || ""}`.trim();
  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    let payload = pending;
    try {
      if (!payload) {
        payload = {
          paymentId: entry.id,
          amount,
          reason,
          idempotencyKey: createIdempotencyKey(),
          externallyConfirmed: confirmed,
        };
        sessionStorage.setItem(key, JSON.stringify(payload));
        setPending(payload);
      }
      const response = await fetch("/api/pos/refunds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        if (
          [400, 401, 403, 404].includes(response.status) ||
          ["over-refund", "refund-currency", "insufficient-drawer", "shift-not-open"].includes(
            data.code
          )
        ) {
          sessionStorage.removeItem(key);
          setPending(null);
        }
        throw new Error(data.error || "refund-failed");
      }
      sessionStorage.removeItem(key);
      onSaved(data);
    } catch (e) {
      setError(
        e.message ||
          (tr
            ? "Kayıt doğrulanamadı; aynı isteği yeniden deneyin."
            : "Result uncertain; retry the same request.")
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={() => !busy && onClose()}
      title={tr ? "İade / düzeltme kaydı" : "Record refund / correction"}
      className="pos-confirm-dialog"
    >
      <form onSubmit={submit} className="grid min-w-0 gap-3">
        <p className="pos-dialog-description">
          {tr
            ? "Bu işlem banka iadesi başlatmaz. Tamamlanan dış iadeyi kaydeder; orijinal tahsilat korunur."
            : "This records an externally completed refund. It does not initiate a bank transaction; the original payment is preserved."}
        </p>
        <p className="text-xs break-all">
          {entry.receiptNumber} · {entry.currency || "?"}
        </p>
        <p className="text-xs">
          {tr ? "Kalan hesap bedeli" : "Remaining bill amount"}: {formatAmount(principalRemaining)}
          {tipRemaining > 0 && (
            <>
              <br />
              {tr ? "İade edilebilir bahşiş" : "Refundable tip"}: {formatAmount(tipRemaining)}
            </>
          )}
          <br />
          {tr
            ? "İade önce hesap bedeline, sonra bahşişe uygulanır."
            : "Refunds apply to the bill amount first, then to the tip."}
        </p>
        <label className="grid gap-1 text-sm">
          {tr ? "İade tutarı" : "Refund amount"}
          <input
            className="min-h-11 min-w-0 w-full rounded-lg border border-[var(--control-border)] bg-[var(--surface)] px-3 text-[var(--text-primary)]"
            inputMode="decimal"
            required
            value={amount}
            disabled={busy || Boolean(pending)}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        {tipRemaining > 0 && previewTipAmount !== null && previewTipAmount > 0 && (
          <p className="text-xs" role="status">
            {tr ? "Bu iadeye dahil olan bahşiş" : "Tip included in this refund"}:{" "}
            {formatAmount(Math.min(tipRemaining, previewTipAmount))}
          </p>
        )}
        <label className="grid gap-1 text-sm">
          {tr ? "İade / düzeltme nedeni" : "Refund / correction reason"}
          <textarea
            className="min-h-20 min-w-0 w-full rounded-lg border border-[var(--control-border)] bg-[var(--surface)] p-3 text-[var(--text-primary)]"
            required
            minLength={3}
            maxLength={300}
            value={reason}
            disabled={busy || Boolean(pending)}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            required
            checked={confirmed}
            disabled={busy || Boolean(pending)}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          {tr
            ? "İadenin müşteriye dışarıda tamamlandığını doğruluyorum."
            : "I confirm the customer refund was completed externally."}
        </label>
        {error && (
          <p role="alert" className="pos-dialog-error">
            {error}
          </p>
        )}
        <button className="pos-dialog-primary" disabled={busy || !confirmed}>
          {busy
            ? tr
              ? "Kaydediliyor…"
              : "Saving…"
            : pending
              ? tr
                ? "Aynı kaydı yeniden dene"
                : "Retry same record"
              : tr
                ? "Tamamlanan iadeyi kaydet"
                : "Record completed refund"}
        </button>
      </form>
    </Dialog>
  );
}
