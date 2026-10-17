"use client";
import { useId, useState } from "react";
import { isAllowedMenuImageUrl } from "@/lib/menu-input.cjs";
import MenuPhoto from "./MenuPhoto";

const TYPES = ["image/jpeg", "image/png", "image/webp"];
export default function MenuPhotoEditor({ value, onChange, onBusyChange, disabled, lang, name }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isTr = lang === "tr";
  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    if (!TYPES.includes(file.type)) {
      setError(isTr ? "JPEG, PNG veya WebP fotoğraf seçin." : "Choose a JPEG, PNG or WebP photo.");
      return;
    }
    if (!file.size || file.size > 5 * 1024 * 1024) {
      setError(
        isTr
          ? "Fotoğraf boş olamaz ve en fazla 5 MB olabilir."
          : "The photo must be nonempty and at most 5 MB."
      );
      return;
    }
    setBusy(true);
    onBusyChange(true);
    try {
      const response = await fetch("/api/menu-images", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const result = await response.json();
      if (!response.ok || !result.imageUrl)
        throw new Error(
          isTr
            ? result.error || "Fotoğraf yüklenemedi. Yeniden deneyin."
            : "Photo could not be uploaded. Try again."
        );
      onChange(result.imageUrl);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  const invalidUrl = Boolean(value && !isAllowedMenuImageUrl(value));
  return (
    <div className="menu-photo-editor">
      <label className="form-field" htmlFor={`${id}-file`}>
        {isTr ? "Ürün fotoğrafı" : "Product photo"}
        <input
          id={`${id}-file`}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled || busy}
          onChange={upload}
        />
      </label>
      <p className="menu-photo-hint">
        {isTr
          ? "JPEG, PNG veya WebP · en fazla 5 MB. Fotoğraf garson ve QR menüsünde görünür."
          : "JPEG, PNG or WebP · up to 5 MB. Shown in the waiter and QR menus."}
      </p>
      <label className="form-field" htmlFor={`${id}-url`}>
        {isTr ? "Fotoğraf adresi (isteğe bağlı)" : "Photo URL (optional)"}
        <input
          id={`${id}-url`}
          type="text"
          value={value || ""}
          onChange={(event) => {
            setError("");
            onChange(event.target.value);
          }}
          disabled={disabled || busy}
          maxLength={2000}
          placeholder="https://…"
          pattern="(?:https://[^\s]+|/(?!/)[^\s]*)"
        />
      </label>
      {invalidUrl && (
        <p role="alert">
          {isTr
            ? "HTTPS adresi veya / ile başlayan yerel adres girin."
            : "Enter an HTTPS address or a local path starting with /."}
        </p>
      )}
      {value && (
        <div className="menu-photo-preview">
          <MenuPhoto
            src={value}
            name={name || (isTr ? "Ürün fotoğrafı" : "Product photo")}
            className="menu-photo-preview-image"
          />
          <button
            type="button"
            className="secondary-action"
            disabled={disabled || busy}
            onClick={() => {
              onChange("");
              setError("");
            }}
          >
            {isTr ? "Fotoğrafı kaldır" : "Remove photo"}
          </button>
        </div>
      )}
      {busy && <p role="status">{isTr ? "Fotoğraf yükleniyor…" : "Uploading photo…"}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
