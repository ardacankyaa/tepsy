"use client";
import { useId, useState } from "react";
export default function RestaurantLogoField({
  value,
  onChange,
  lang = "tr",
  setup = false,
  disabled = false,
  onBusyChange,
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tr = lang === "tr";
  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      !file.size ||
      file.size > 5 * 1024 * 1024
    ) {
      setError(
        tr
          ? "JPEG, PNG veya WebP seçin; dosya en fazla 5 MB olabilir."
          : "Choose a JPEG, PNG or WebP file up to 5 MB."
      );
      return;
    }
    setBusy(true);
    onBusyChange?.(true);
    try {
      const response = await fetch(setup ? "/api/setup/logo" : "/api/menu-images", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const result = await response.json();
      if (!response.ok || !result.imageUrl)
        throw new Error(
          tr ? result.error || "Logo yüklenemedi." : "Logo could not be uploaded. Try again."
        );
      onChange(result.imageUrl);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <div className="restaurant-logo-field grid min-w-0 gap-3">
      <label htmlFor={id} className="grid min-w-0 gap-2 text-sm font-medium">
        {tr ? "İşletme logosu (isteğe bağlı)" : "Business logo (optional)"}
        <input
          id={id}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled || busy}
          onChange={upload}
          className="w-full min-w-0 max-w-full rounded-xl border border-[var(--border)] p-2 text-sm"
        />
      </label>
      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
        {tr
          ? "JPEG, PNG veya WebP · en fazla 5 MB. Logo eklemezseniz işletmenizin baş harfi gösterilir."
          : "JPEG, PNG or WebP · up to 5 MB. Your business initial appears when no logo is set."}
      </p>
      {value && (
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <img
            src={value}
            alt={tr ? "İşletme logosu önizlemesi" : "Business logo preview"}
            width="128"
            height="96"
            className="h-24 w-32 rounded-xl border border-[var(--border)] bg-white p-2 object-contain"
          />
          <button
            type="button"
            className="secondary-action min-h-11 px-4"
            disabled={disabled || busy}
            onClick={() => {
              onChange(null);
              setError("");
            }}
          >
            {tr ? "Logoyu kaldır" : "Remove logo"}
          </button>
        </div>
      )}
      {busy && (
        <p role="status" className="text-sm">
          {tr ? "Logo yükleniyor…" : "Uploading logo…"}
        </p>
      )}
      {error && (
        <p role="alert" className="break-words text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
