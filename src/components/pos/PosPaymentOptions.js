"use client";

import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Dialog } from "@/components/ui/Workspace";
import { previewItemPaymentAmount } from "@/lib/item-payments.mjs";
import PosItemPayments from "./PosItemPayments";
import PosSplitPayments from "./PosSplitPayments";
import "@/styles/pos-payments.css";

export default function PosPaymentOptions({
  tableId,
  orders,
  remaining,
  partialAmount,
  selectedItems = [],
  tipAmount,
  discountPercent,
  latestPayment,
  busy,
  lang,
  formatPrice,
  onAmountChange,
  onItemsChange,
}) {
  const tr = lang === "tr";
  const group = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("split");
  const [revision, setRevision] = useState(0);
  const itemAmount = previewItemPaymentAmount(orders, selectedItems, discountPercent);
  const customAmount = Number(String(partialAmount).replace(",", "."));
  const amount = selectedItems.length ? itemAmount : partialAmount ? customAmount : remaining;
  const tip = Number(String(tipAmount || "0").replace(",", "."));
  const amountLabel = selectedItems.length
    ? tr
      ? "Seçilen ürünler"
      : "Selected items"
    : partialAmount
      ? tr
        ? "Bu tahsilat"
        : "This payment"
      : tr
        ? "Kalan hesabın tamamı"
        : "Full remaining balance";
  const modes = [
    ["split", tr ? "Hesabı eşit böl" : "Split equally"],
    ["custom", tr ? "Özel ödeme" : "Custom payment"],
    ["items", tr ? "Ürün seçerek öde" : "Pay selected items"],
  ];
  function chooseMode(next) {
    if (next === mode) return;
    onAmountChange("");
    onItemsChange([]);
    setMode(next);
  }
  function reset() {
    onAmountChange("");
    onItemsChange([]);
    setMode("split");
    setRevision((value) => value + 1);
  }
  const summary = (
    <div className="pos-payment-choice-summary" role="status">
      <div>
        <span>{amountLabel}</span>
        <strong>{amount !== null && Number.isFinite(amount) ? formatPrice(amount) : "—"}</strong>
      </div>
      {tip > 0 && (
        <div>
          <span>{tr ? "Bahşiş dahil bu tahsilat" : "This collection including tip"}</span>
          <strong>
            {amount !== null && Number.isFinite(amount) ? formatPrice(amount + tip) : "—"}
          </strong>
        </div>
      )}
    </div>
  );
  return (
    <div className="pos-payment-options">
      <button
        type="button"
        className="pos-payment-options-trigger"
        onClick={() => setOpen(true)}
        disabled={busy}
      >
        <span>{tr ? "Hesabı böl / özel ödeme" : "Split / custom payment"}</span>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
      {(partialAmount || selectedItems.length > 0 || tip > 0) && summary}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={tr ? "Ödemeyi düzenle" : "Customize payment"}
        className="pos-payment-options-dialog"
        footer={
          <div className="pos-payment-options-footer">
            <button
              type="button"
              onClick={reset}
              disabled={busy || (!partialAmount && !selectedItems.length)}
            >
              {tr ? "Tüm kalan tutara dön" : "Use full balance"}
            </button>
            <button
              type="button"
              className="primary-action"
              onClick={() => setOpen(false)}
              disabled={
                busy || (mode === "items" && (!selectedItems.length || itemAmount === null))
              }
            >
              {tr ? "Tamam" : "Done"}
            </button>
          </div>
        }
      >
        <p className="pos-payment-options-intro">
          {tr ? "Kalan hesap" : "Remaining balance"}: <strong>{formatPrice(remaining)}</strong>
        </p>
        <fieldset className="pos-payment-mode">
          <legend className="sr-only">{tr ? "Ödeme biçimi" : "Payment choice"}</legend>
          {modes.map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name={group}
                value={value}
                checked={mode === value}
                onChange={() => chooseMode(value)}
                disabled={busy}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        {mode === "items" ? (
          <PosItemPayments
            orders={orders}
            selection={selectedItems}
            onChange={onItemsChange}
            busy={busy}
            lang={lang}
            formatPrice={formatPrice}
          />
        ) : (
          <PosSplitPayments
            key={`${tableId}:${mode}:${revision}`}
            tableId={tableId}
            remaining={remaining}
            amount={partialAmount}
            onAmountChange={onAmountChange}
            latestPayment={latestPayment}
            busy={busy}
            lang={lang}
            formatPrice={formatPrice}
            mode={mode}
          />
        )}
        {summary}
        <p className="pos-payment-options-hint">
          {tr
            ? "Tamam dedikten sonra nakit, kart veya diğer yöntemle tahsil edin."
            : "Choose cash, card or another payment method after closing this window."}
        </p>
      </Dialog>
    </div>
  );
}
