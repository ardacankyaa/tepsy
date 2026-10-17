"use client";

import Link from "next/link";
import { useApp } from "@/lib/AppContext";

export default function WorkspaceError({ reset }) {
  const { lang } = useApp();
  const english = lang === "en";
  return (
    <section
      className="mx-auto flex min-h-64 max-w-lg flex-col items-start justify-center gap-4 p-6"
      role="alert"
    >
      <p className="text-sm font-semibold text-[var(--text-secondary)]">TEPSY</p>
      <h1 className="text-2xl font-semibold">
        {english ? "This screen could not be loaded" : "Bu ekran yüklenemedi"}
      </h1>
      <p>
        {english
          ? "Try loading it again. If an order or payment was being sent, check its status before repeating the action."
          : "Ekranı yeniden yükleyin. Sipariş veya ödeme gönderiliyorsa işlemi tekrarlamadan önce durumunu kontrol edin."}
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="primary-action px-4" onClick={reset}>
          {english ? "Try again" : "Yeniden dene"}
        </button>
        <Link href="/" className="secondary-action px-4">
          {english ? "Go to workspace" : "Çalışma alanına dön"}
        </Link>
      </div>
    </section>
  );
}
