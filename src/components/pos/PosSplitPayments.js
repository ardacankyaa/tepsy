"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Users } from "lucide-react";
import { centsAmount, parseAmountCents, splitRemainingBalance } from "@/lib/pos-split-payment.cjs";
import "@/styles/pos-payments.css";

export default function PosSplitPayments({
  tableId,
  remaining,
  amount,
  onAmountChange,
  latestPayment,
  busy,
  lang,
  formatPrice,
}) {
  const [people, setPeople] = useState("2");
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState("");
  const observed = useRef(latestPayment?.id);
  const tr = lang === "tr";
  const remainingCents = parseAmountCents(Number(remaining).toFixed(2));
  useEffect(() => {
    if (!latestPayment?.id || observed.current === latestPayment.id) return;
    observed.current = latestPayment.id;
    if (!plan || latestPayment.tableId !== tableId) return;
    const index = plan.selected;
    if (parseAmountCents(latestPayment.amountPaid) !== plan.shares[index]) {
      setPlan(null);
      return;
    }
    const paid = [...plan.paid, index];
    const next = plan.shares.findIndex((_, i) => !paid.includes(i));
    setPlan({ ...plan, paid, selected: next });
    onAmountChange(next < 0 ? "" : centsAmount(plan.shares[next]));
  }, [latestPayment, plan, tableId, onAmountChange]);
  const outstanding = plan
    ? plan.shares.reduce((sum, share, i) => sum + (plan.paid.includes(i) ? 0 : share), 0)
    : 0;
  const changed = Boolean(plan) && outstanding !== remainingCents;
  function divide() {
    setError("");
    try {
      const shares = splitRemainingBalance(Number(remaining).toFixed(2), people);
      setPlan({ shares, paid: [], selected: 0 });
      onAmountChange(centsAmount(shares[0]));
    } catch {
      setError(
        tr
          ? "2–50 kişi seçin; her pay en az 0,01 olmalı."
          : "Choose 2–50 people; each share must be at least 0.01."
      );
    }
  }
  function editAmount(value) {
    setPlan(null);
    setError("");
    onAmountChange(value);
  }
  return (
    <section className="pos-split-payments" aria-labelledby="pos-split-title">
      <h4 id="pos-split-title">
        <Users size={17} aria-hidden="true" />
        {tr ? "Ödeme kolaylığı" : "Split payment"}
      </h4>
      <p>
        {tr
          ? "Kalan hesabı eşit bölün veya bu tahsilat için özel tutar girin."
          : "Split the remaining balance equally or enter a custom amount for this payment."}
      </p>
      <div className="pos-split-tools">
        <label>
          {tr ? "Kişi sayısı" : "Number of people"}
          <input
            type="number"
            min="2"
            max="50"
            step="1"
            value={people}
            disabled={busy}
            onChange={(event) => setPeople(event.target.value)}
          />
        </label>
        <button type="button" disabled={busy || !remainingCents} onClick={divide}>
          {tr ? "Eşit böl" : "Split equally"}
        </button>
      </div>
      {plan && (
        <div
          className="pos-split-plan"
          data-testid="split-payment-plan"
          role="group"
          aria-label={tr ? "Kişi payları" : "Individual shares"}
        >
          {plan.shares.map((share, index) => (
            <button
              key={index}
              type="button"
              disabled={busy || changed || plan.paid.includes(index)}
              aria-pressed={plan.selected === index}
              onClick={() => {
                setPlan({ ...plan, selected: index });
                onAmountChange(centsAmount(share));
              }}
            >
              <span>
                {tr ? "Kişi" : "Person"} {index + 1}
              </span>
              <strong>{formatPrice(share / 100)}</strong>
              {plan.paid.includes(index) && (
                <span className="pos-split-paid">
                  <Check size={13} aria-hidden="true" />
                  {tr ? "Ödendi" : "Paid"}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {changed && (
        <p role="status">
          {tr
            ? "Hesap değişti. Kalan tutarı yeniden eşit bölün veya özel tutar girin."
            : "The balance changed. Split the remainder again or enter a custom amount."}
        </p>
      )}
      {error && (
        <p role="alert" className="pos-split-error">
          {error}
        </p>
      )}
      <label className="pos-partial-field">
        <span>{tr ? "Kısmi ödeme tutarı" : "Partial payment amount"}</span>
        <small>
          {tr
            ? "Boş bırakırsanız kalan tutarın tamamı tahsil edilir."
            : "Leave empty to collect the entire remaining balance."}
        </small>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          disabled={busy}
          onChange={(event) => editAmount(event.target.value)}
          placeholder="0.00"
          aria-label={tr ? "Kısmi ödeme tutarı" : "Partial payment amount"}
        />
      </label>
    </section>
  );
}
