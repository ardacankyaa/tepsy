"use client";

import { useId } from "react";
import "@/styles/tip-disclosure.css";

export default function TipDisclosure({ value, onChange, disabled, lang, formatPrice, hint }) {
  const id = useId();
  const tr = lang === "tr";
  const amount = Number(String(value || "0").replace(",", "."));
  const invalid = !Number.isFinite(amount) || amount < 0;
  const label = tr ? "Bahşiş (isteğe bağlı)" : "Tip (optional)";
  return (
    <details className="tip-disclosure">
      <summary>
        <span>{tr ? "Bahşiş ekle" : "Add a tip"}</span>
        <strong>
          {invalid
            ? tr
              ? "Tutarı kontrol edin"
              : "Check the amount"
            : amount > 0
              ? formatPrice(amount)
              : tr
                ? "İsteğe bağlı"
                : "Optional"}
        </strong>
      </summary>
      <div className="tip-disclosure-content">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-describedby={`${id}-hint`}
          placeholder="0.00"
        />
        <p id={`${id}-hint`}>{hint}</p>
      </div>
    </details>
  );
}
