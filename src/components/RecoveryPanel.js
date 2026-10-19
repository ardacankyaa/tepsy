"use client";
import { useCallback, useEffect, useRef, useState } from "react";
export default function RecoveryPanel({ lang }) {
  const tr = lang === "tr";
  const [data, setData] = useState(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState({ enabled: false, intervalHours: 24, copyDirectory: "" });
  const [loadState, setLoadState] = useState("loading");
  const mounted = useRef(false),
    statusRequest = useRef(null),
    hasPlan = useRef(false);
  const load = useCallback(async () => {
    statusRequest.current?.abort();
    const controller = new AbortController();
    statusRequest.current = controller;
    setLoadState("loading");
    try {
      const response = await fetch("/api/backup/recovery", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted || !mounted.current) return;
      if (response.status === 401 || response.status === 403) {
        setLoadState("denied");
        return;
      }
      if (!response.ok) throw new Error("backup-status-unavailable");
      const result = await response.json();
      if (
        !result ||
        typeof result.plan?.enabled !== "boolean" ||
        !Number.isInteger(result.plan?.intervalHours) ||
        result.plan.intervalHours < 1 ||
        result.plan.intervalHours > 168 ||
        typeof result.plan?.copyDirectory !== "string"
      )
        throw new Error("backup-status-invalid");
      if (controller.signal.aborted || !mounted.current) return;
      setData(result);
      if (!hasPlan.current) {
        setPlan(result.plan);
        hasPlan.current = true;
      }
      setLoadState("ready");
    } catch {
      if (!controller.signal.aborted && mounted.current) setLoadState("error");
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
      statusRequest.current?.abort();
    };
  }, [load]);
  const perform = async (action, body) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/backup/recovery?action=${action}`, {
        method: "POST",
        headers: { "Content-Type": action === "verify" ? "application/zip" : "application/json" },
        body: action === "verify" ? body : JSON.stringify(body || {}),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      if (!mounted.current) return;
      if (action === "create") {
        const archive = await response.blob();
        if (!mounted.current) return;
        const url = URL.createObjectURL(archive);
        const link = document.createElement("a");
        link.href = url;
        link.download =
          response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ||
          "tepsy-recovery.zip";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage(tr ? "Doğrulanmış tam yedek indirildi." : "Verified full backup downloaded.");
      } else {
        const result = await response.json();
        if (!mounted.current) return;
        setMessage(
          action === "verify"
            ? tr
              ? `Yedek doğrulandı (${result.files} dosya). Mevcut veriler değiştirilmedi.`
              : `Backup verified (${result.files} files). Existing data was preserved.`
            : tr
              ? "Yedek planı kaydedildi."
              : "Backup plan saved."
        );
      }
      // A completed mutation stays successful even when the status refresh fails.
      await load();
    } catch (error) {
      if (mounted.current)
        setMessage(error.message || (tr ? "İşlem tamamlanamadı." : "Operation failed."));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <section
      className="mt-4 grid min-w-0 gap-3 border-t border-[var(--border)] pt-4"
      aria-label={tr ? "Tam yedek ve kurtarma" : "Full backup and recovery"}
    >
      <h3 className="text-sm font-semibold">
        {tr ? "Tam yedek ve kurtarma" : "Full backup and recovery"}
      </h3>
      <p className="text-xs text-[var(--text-secondary)]">
        {tr
          ? "Veritabanını, fişleri, iadeleri, işlem geçmişini, fotoğrafları ve cihaz ayarlarını doğrulanmış ZIP dosyasında saklar. Yönetim sunucu bilgisayarında işletme sahibine açıktır. Dosyayı özel tutun."
          : "Verified ZIP includes database, receipts, refunds, activity history, images and device settings. Managed by the owner on the server computer. Keep this file private."}
      </p>
      {loadState === "loading" && (
        <p role="status" className="text-xs text-[var(--text-secondary)]">
          {tr ? "Yedek durumu yükleniyor…" : "Loading backup status…"}
        </p>
      )}
      {loadState === "error" && (
        <div className="grid min-w-0 gap-2">
          <p role="alert" className="text-xs break-words text-[var(--danger)]">
            {tr
              ? "Yedek durumu alınamadı. Bağlantıyı kontrol edip yeniden deneyin."
              : "Backup status could not be loaded. Check the connection and try again."}
          </p>
          <button
            type="button"
            className="secondary-action min-h-11 px-3 text-xs"
            disabled={busy}
            onClick={() => load()}
          >
            {tr ? "Yeniden dene" : "Try again"}
          </button>
        </div>
      )}
      {loadState === "denied" && (
        <p className="text-xs">
          {tr
            ? "Yedek yönetimi için sunucu bilgisayarında işletme sahibi olarak giriş yapın."
            : "Sign in as the owner on the server computer to manage full backups."}
        </p>
      )}
      {data && loadState !== "denied" && (
        <>
          <dl className="grid min-w-0 gap-1 text-xs break-words">
            <div>
              <dt>{tr ? "Son başarılı yedek" : "Last successful backup"}</dt>
              <dd>
                {data.status?.lastSuccessAt
                  ? new Date(data.status.lastSuccessAt).toLocaleString(tr ? "tr-TR" : "en-US")
                  : tr
                    ? "Henüz yok"
                    : "None yet"}
              </dd>
            </div>
            {data.status?.filename && (
              <div>
                <dt>{tr ? "Dosya" : "File"}</dt>
                <dd className="break-all">{data.status.filename}</dd>
              </div>
            )}
            {data.status?.error && <div className="text-[var(--danger)]">{data.status.error}</div>}
            {data.status?.copyError && (
              <div className="text-[var(--danger)]">
                {tr ? "İkinci kopya hatası: " : "Second copy failed: "}
                {data.status.copyError}
              </div>
            )}
            {data.status?.copiedTo && (
              <div className="break-all">
                {tr ? "Doğrulanmış ikinci kopya: " : "Verified second copy: "}
                {data.status.copiedTo}
              </div>
            )}
          </dl>
          <form
            className="grid min-w-0 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              perform("plan", plan);
            }}
          >
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={plan.enabled}
                disabled={busy}
                onChange={(e) => setPlan({ ...plan, enabled: e.target.checked })}
              />
              {tr
                ? "Uygulama açıkken otomatik tam yedek al"
                : "Automatic full backups while the app is running"}
            </label>
            <label className="grid gap-1 text-xs">
              {tr ? "Yedek aralığı (saat)" : "Backup interval (hours)"}
              <input
                className="min-h-11 min-w-0 w-full rounded-lg border border-[var(--control-border)] bg-[var(--surface)] px-3 text-[var(--text-primary)]"
                type="number"
                min={1}
                max={168}
                required
                value={plan.intervalHours}
                onChange={(e) => setPlan({ ...plan, intervalHours: Number(e.target.value) })}
                disabled={busy}
              />
            </label>
            <label className="grid gap-1 text-xs">
              {tr
                ? "İkinci kopya klasörü (isteğe bağlı, tam yol)"
                : "Second copy folder (optional, absolute path)"}
              <input
                className="min-h-11 min-w-0 w-full rounded-lg border border-[var(--control-border)] bg-[var(--surface)] px-3 text-[var(--text-primary)]"
                value={plan.copyDirectory}
                disabled={busy}
                onChange={(e) => setPlan({ ...plan, copyDirectory: e.target.value })}
              />
            </label>
            <button className="secondary-action min-h-11 px-3 text-xs" disabled={busy}>
              {tr ? "Yedek planını kaydet" : "Save backup plan"}
            </button>
          </form>
          <button
            type="button"
            className="primary-action min-h-11 px-3 text-xs"
            disabled={busy}
            onClick={() => perform("create")}
          >
            {busy
              ? tr
                ? "İşleniyor…"
                : "Working…"
              : tr
                ? "Tam yedek oluştur ve indir"
                : "Create and download full backup"}
          </button>
          <label className="grid min-w-0 gap-2 text-xs">
            {tr ? "Kurtarma dosyasını doğrula" : "Verify a recovery archive"}
            <input
              className="min-w-0 w-full"
              type="file"
              accept=".zip"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) perform("verify", f);
                e.target.value = "";
              }}
            />
          </label>
          <p className="text-xs text-[var(--text-secondary)]">
            {tr
              ? "Doğrulama mevcut verileri değiştirmez. Kurulumla gelen kurtarma aracı yalnızca yeni bir klasöre geri yükler; eski kurulumun üzerine yazmaz. Geri yükleme sonrasında yeniden giriş gerekir."
              : "Verification preserves current data. The supplied recovery tool restores into a new folder only, preserving the old installation. Sign in again after recovery."}
          </p>
        </>
      )}
      {message && (
        <p role="status" className="text-xs break-words">
          {message}
        </p>
      )}
    </section>
  );
}
