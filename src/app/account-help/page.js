"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";
import { LegalLinks } from "@/components/ui/Workspace";
import { useApp } from "@/lib/AppContext";
import { ArrowLeft, ArrowRight, KeyRound, Store } from "lucide-react";

const ATTEMPT_STORAGE = "tepsy_new_restaurant_attempt";
const inputClass =
  "min-h-12 w-full min-w-0 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text-primary)]";
const buttonClass =
  "primary-action flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 py-3 text-center text-sm font-semibold disabled:opacity-50";

function storeAttempt(attempt) {
  try {
    if (attempt) sessionStorage.setItem(ATTEMPT_STORAGE, JSON.stringify(attempt));
    else sessionStorage.removeItem(ATTEMPT_STORAGE);
  } catch {
    /* The in-memory attempt still supports a safe retry. */
  }
}

function safeRestaurantUrl(value) {
  try {
    const url = new URL(value);
    const localHosts = ["localhost", "127.0.0.1", "[::1]"];
    const sameHost =
      url.hostname === window.location.hostname ||
      (localHosts.includes(url.hostname) && localHosts.includes(window.location.hostname));
    return sameHost && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export default function AccountHelpPage() {
  const { lang, setLang } = useApp();
  const tr = lang === "tr";
  const [action, setAction] = useState("recover");
  const [staff, setStaff] = useState(false);
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(false);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recovered, setRecovered] = useState(false);
  const [attempt, setAttempt] = useState(null);
  const [job, setJob] = useState(null);
  const [pollError, setPollError] = useState(false);
  const [pollVersion, setPollVersion] = useState(0);
  const submitLock = useRef(false);

  const loadStatus = useCallback(async () => {
    setStatusError(false);
    try {
      const response = await fetch("/api/auth/status", { cache: "no-store" });
      if (!response.ok) throw new Error("status-unavailable");
      const result = await response.json();
      if (!result || typeof result.authEnabled !== "boolean") throw new Error("invalid-status");
      setStatus(result);
    } catch {
      setStatusError(true);
    }
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setAction(query.get("action") === "new" ? "new" : "recover");
    setStaff(query.get("role") === "staff");
    try {
      const saved = JSON.parse(sessionStorage.getItem(ATTEMPT_STORAGE) || "null");
      if (saved && typeof saved.key === "string" && /^[a-zA-Z0-9-]{16,100}$/.test(saved.key)) {
        const next = { key: saved.key, ...(typeof saved.id === "string" ? { id: saved.id } : {}) };
        setAttempt(next);
      }
    } catch {
      storeAttempt(null);
    }
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (action !== "new" || !attempt?.id || !status?.canCreateRestaurant) return;
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        const response = await fetch(`/api/auth/restaurants?id=${encodeURIComponent(attempt.id)}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("job-unavailable");
        const result = await response.json();
        if (!["STARTING", "READY", "FAILED"].includes(result.status))
          throw new Error("invalid-job");
        const url = result.status === "READY" ? safeRestaurantUrl(result.url) : null;
        if (result.status === "READY" && !url) throw new Error("invalid-restaurant-url");
        if (cancelled) return;
        setJob({ status: result.status, url });
        setPollError(false);
        if (result.status === "STARTING") timer = setTimeout(poll, 1500);
      } catch {
        if (!cancelled) setPollError(true);
      }
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [action, attempt?.id, status?.canCreateRestaurant, pollVersion]);

  const recover = async (event) => {
    event.preventDefault();
    if (submitLock.current) return;
    setError("");
    if (newPassword !== confirmation) {
      setError(tr ? "Şifreler eşleşmiyor." : "Passwords do not match.");
      return;
    }
    submitLock.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), newPassword }),
      });
      if (!response.ok) {
        if (response.status >= 500) throw new Error("recovery-response-unavailable");
        if (response.status === 429)
          setError(
            tr
              ? "Çok fazla deneme yapıldı. Bir süre bekleyip yeniden deneyin."
              : "Too many attempts. Wait before trying again."
          );
        else if (response.status === 403)
          setError(
            tr
              ? "Kurtarma işlemini TEPSY sunucu bilgisayarında localhost adresinden açın."
              : "Open recovery on the TEPSY server computer using localhost."
          );
        else
          setError(
            tr
              ? "Kod geçersiz, süresi dolmuş veya şifre uygun değil. Sunucuda yeni bir kod oluşturup tekrar deneyin."
              : "The code is invalid or expired, or the password is unsuitable. Generate a new code on the server and try again."
          );
        return;
      }
      const result = await response.json();
      if (!result.success) throw new Error("recovery-response");
      setRecovered(true);
      setCode("");
      setNewPassword("");
      setConfirmation("");
    } catch {
      setError(
        tr
          ? "Sunucunun yanıtı alınamadı. Önce yeni şifrenizle giriş yapmayı deneyin. Giriş olmazsa yeni bir kurtarma kodu oluşturun."
          : "The server response was not received. Try signing in with your new password first. If it does not work, generate a new recovery code."
      );
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  };

  const createRestaurant = async (event) => {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setError("");
    const next = attempt || { key: crypto.randomUUID() };
    setAttempt(next);
    storeAttempt(next);
    try {
      const response = await fetch("/api/auth/restaurants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerPassword, idempotencyKey: next.key }),
      });
      if (!response.ok) {
        setError(
          response.status === 401
            ? tr
              ? "Mevcut işletme sahibi şifresi doğrulanamadı."
              : "The current owner password could not be verified."
            : tr
              ? "Kurulum başlatılamadı. Aynı istekle tekrar deneyebilirsiniz."
              : "Setup could not start. You can safely retry the same request."
        );
        return;
      }
      const result = await response.json();
      if (typeof result.id !== "string" || !["STARTING", "READY"].includes(result.status))
        throw new Error("invalid-create-response");
      const saved = { key: next.key, id: result.id };
      setAttempt(saved);
      storeAttempt(saved);
      setOwnerPassword("");
      setJob({ status: "STARTING" });
      setPollError(false);
    } catch {
      setError(
        tr
          ? "Yanıt alınamadı. Mevcut restoranınız korunur. Aynı düğmeyle tekrar deneyin; istek anahtarı korunarak çift kurulum önlenir."
          : "No response was received. Your current restaurant is preserved. Retry using the same button; the saved request key prevents duplicate installations."
      );
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="login-page account-help-page">
      <section className="login-story" aria-label="TEPSY">
        <BrandLogo full />
        <div className="login-story-content">
          <p className="login-kicker">
            {tr ? "İşletmeniz sizin kontrolünüzde" : "Your restaurant, in your control"}
          </p>
          <h1>{tr ? "Güvenle devam edin." : "Continue with confidence."}</h1>
          <p className="login-lede">
            {tr
              ? "Hesabınıza yeniden erişin veya verileri birbirinden ayrı tutulan yeni bir restoran kurun."
              : "Recover access to your account or set up another restaurant with separate data."}
          </p>
        </div>
        <p className="login-local-note">
          {tr
            ? "Mevcut restoran kayıtları korunur."
            : "Your current restaurant records are preserved."}
        </p>
      </section>
      <section className="login-access" aria-label={tr ? "Hesap yardımı" : "Account help"}>
        <div className="login-access-card min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <Link
              href="/login"
              className="secondary-action flex min-h-11 items-center gap-2 px-3 text-sm"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" />
              {tr ? "Girişe dön" : "Back to sign in"}
            </Link>
            <button
              type="button"
              className="secondary-action min-h-11 px-3 text-sm"
              onClick={() => setLang(tr ? "en" : "tr")}
            >
              {tr ? "English" : "Türkçe"}
            </button>
          </div>
          <div className="login-access-heading">
            <span className="login-role-icon mb-4">
              {action === "new" ? <Store className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">
              {action === "new"
                ? tr
                  ? "Yeni restoran oluştur"
                  : "Create a new restaurant"
                : tr
                  ? "İşletme sahibi erişimini kurtar"
                  : "Recover owner access"}
            </h1>
            <p>
              {action === "new"
                ? tr
                  ? "Yeni restoran ayrı veritabanı, ayarlar ve adresle açılır. Mevcut restoranınız ve kayıtları korunur."
                  : "The new restaurant gets its own database, settings and address. Your current restaurant and records are preserved."
                : tr
                  ? "Şifrenizi TEPSY’nin kurulu olduğu sunucu bilgisayarından güvenli biçimde yenileyin."
                  : "Reset your password securely from the computer running your TEPSY server."}
            </p>
          </div>
          {statusError ? (
            <div role="alert" className="space-y-3 text-sm text-[var(--danger)]">
              <p>
                {tr
                  ? "Sunucuya bağlanılamadı. Bağlantınızı kontrol edip tekrar deneyin."
                  : "Unable to reach the server. Check your connection and try again."}
              </p>
              <button type="button" className="secondary-action min-h-11 px-3" onClick={loadStatus}>
                {tr ? "Yeniden dene" : "Retry"}
              </button>
            </div>
          ) : !status ? (
            <p role="status" className="text-sm text-[var(--text-muted)]">
              {tr ? "Bağlantı kontrol ediliyor…" : "Checking connection…"}
            </p>
          ) : action === "recover" ? (
            <div className="space-y-5">
              <div className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-inset)] p-4 text-sm text-[var(--text-secondary)]">
                <strong>{tr ? "Personel PIN’ini mi unuttunuz?" : "Forgot your staff PIN?"}</strong>
                <p className="mt-2">
                  {tr
                    ? "Personel PIN’i için işletme sahibinizden Ekip bölümünde yeni bir PIN belirlemesini isteyin."
                    : "Ask your restaurant owner to set a new PIN in the Team section."}
                </p>
                {staff && (
                  <p className="mt-2">
                    {tr
                      ? "Aşağıdaki kurtarma yalnızca işletme sahibi şifresini yeniler."
                      : "The recovery below resets only the owner password."}
                  </p>
                )}
              </div>
              {!status.canRecoverOwner ? (
                <p className="text-sm text-[var(--text-secondary)]">
                  {tr
                    ? "Bu işlemi TEPSY sunucu bilgisayarında, localhost adresinden açın. İşletme sahibi hesabı henüz kurulmadıysa önce restoran kurulumunu tamamlayın."
                    : "Open this page on the TEPSY server computer using localhost. If there is no owner account yet, complete restaurant setup first."}
                </p>
              ) : recovered ? (
                <div className="space-y-4">
                  <p role="status" className="text-sm text-[var(--text-secondary)]">
                    {tr
                      ? "Şifreniz yenilendi. Önceki işletme sahibi oturumları kapatıldı. Yeni şifrenizle giriş yapabilirsiniz."
                      : "Your password has been reset and previous owner sessions were signed out. You can sign in with your new password."}
                  </p>
                  <Link className={buttonClass} href="/login">
                    {tr ? "Yeni şifreyle giriş yap" : "Sign in with your new password"}
                    <ArrowRight className="h-4 w-4 shrink-0" />
                  </Link>
                </div>
              ) : (
                <>
                  <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--text-secondary)]">
                    <li>
                      {tr
                        ? "Sunucu bilgisayarında, TEPSY kurulum klasöründeki OWNER-RECOVERY.bat dosyasını açın."
                        : "On the server computer, open OWNER-RECOVERY.bat in the TEPSY installation folder."}
                    </li>
                    <li>
                      {tr
                        ? "Açılan penceredeki tek kullanımlık kodu aşağıya girin. Kodun süresi dolduysa yeni bir kod oluşturun."
                        : "Enter the one-time code shown in the window. Generate another code if it has expired."}
                    </li>
                  </ol>
                  <details className="text-sm text-[var(--text-secondary)]">
                    <summary className="min-h-11 cursor-pointer py-3">
                      {tr ? "Terminal ile kod oluştur" : "Generate a code from a terminal"}
                    </summary>
                    <p>
                      {tr
                        ? "Etkin TEPSY kurulum klasöründe çalıştırın:"
                        : "Run from the active TEPSY installation folder:"}
                    </p>
                    <code className="mt-2 block break-all rounded-[var(--radius-control)] bg-[var(--surface-inset)] p-3 select-all">
                      npm run owner:recovery
                    </code>
                  </details>
                  <form onSubmit={recover} className="space-y-4">
                    <HelpInput
                      label={tr ? "Kurtarma kodu" : "Recovery code"}
                      value={code}
                      onChange={setCode}
                      autoComplete="off"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={128}
                    />
                    <HelpInput
                      label={tr ? "Yeni şifre" : "New password"}
                      type="password"
                      value={newPassword}
                      onChange={setNewPassword}
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                    />
                    <HelpInput
                      label={tr ? "Yeni şifre tekrar" : "Confirm new password"}
                      type="password"
                      value={confirmation}
                      onChange={setConfirmation}
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                    />
                    <p className="text-xs text-[var(--text-muted)]">
                      {tr
                        ? "En az 8 karakter kullanın. Kod ve şifre tarayıcı depolamasına kaydedilmez."
                        : "Use at least 8 characters. Your code and password are not saved in browser storage."}
                    </p>
                    {error && <HelpError>{error}</HelpError>}
                    <button disabled={busy} className={buttonClass}>
                      {busy
                        ? tr
                          ? "Yenileniyor…"
                          : "Resetting…"
                        : tr
                          ? "Şifreyi yenile"
                          : "Reset password"}
                    </button>
                    {error && (
                      <Link
                        href="/login"
                        className="secondary-action flex min-h-11 items-center justify-center px-3 text-sm"
                      >
                        {tr ? "Giriş yapmayı dene" : "Try signing in"}
                      </Link>
                    )}
                  </form>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {status.canSetup ? (
                <Link href="/setup" className={buttonClass}>
                  {tr ? "İlk restoranını kur" : "Set up your first restaurant"}
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </Link>
              ) : !status.canCreateRestaurant ? (
                <p className="text-sm text-[var(--text-secondary)]">
                  {tr
                    ? "Yeni kurulum için bu sayfayı TEPSY sunucu bilgisayarında localhost adresinden açın. Önce mevcut restoranın işletme sahibi şifresi belirlenmiş olmalıdır."
                    : "To create an installation, open this page on the TEPSY server computer using localhost. The current restaurant must have an owner password configured first."}
                </p>
              ) : attempt?.id ? (
                <div className="space-y-4">
                  {pollError ? (
                    <>
                      <HelpError>
                        {tr
                          ? "Kurulum durumu alınamadı. Yeni istek oluşturmadan aynı kurulumu kontrol edebilirsiniz."
                          : "Setup status could not be loaded. Check the same installation without creating another request."}
                      </HelpError>
                      <button
                        type="button"
                        className={buttonClass}
                        onClick={() => {
                          setPollError(false);
                          setPollVersion((v) => v + 1);
                        }}
                      >
                        {tr ? "Durumu tekrar kontrol et" : "Check status again"}
                      </button>
                    </>
                  ) : job?.status === "READY" ? (
                    <>
                      <p role="status" className="text-sm text-[var(--text-secondary)]">
                        {tr
                          ? "Ayrı restoranınız hazır. Kurulum ekranında adını, menüsünü ve yeni şifresini belirleyin."
                          : "Your separate restaurant is ready. Set its name, menu and new password in setup."}
                      </p>
                      <a
                        href={job.url}
                        className={buttonClass}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {tr ? "Yeni restoranı kur" : "Set up the new restaurant"}
                        <ArrowRight className="h-4 w-4 shrink-0" />
                      </a>
                      <p className="break-all text-xs text-[var(--text-muted)]">{job.url}</p>
                    </>
                  ) : job?.status === "FAILED" ? (
                    <>
                      <HelpError>
                        {tr
                          ? "Ayrı kurulum tamamlanamadı. Mevcut restoranınız korunuyor. Sunucu penceresindeki hata ayrıntılarını kontrol edin."
                          : "The separate installation could not finish. Your current restaurant is preserved. Check the server window for details."}
                      </HelpError>
                      <button
                        type="button"
                        className="secondary-action min-h-11 w-full px-3 text-sm"
                        onClick={() => {
                          storeAttempt(null);
                          setAttempt(null);
                          setJob(null);
                          setError("");
                        }}
                      >
                        {tr ? "Yeni bir kurulum denemesi başlat" : "Start a new setup attempt"}
                      </button>
                    </>
                  ) : (
                    <p role="status" className="text-sm text-[var(--text-secondary)]">
                      {tr
                        ? "Hazırlanıyor… Bu işlem birkaç dakika sürebilir. Sayfayı yenileseniz de aynı kurulumun durumu kontrol edilir."
                        : "Preparing… This may take a few minutes. Reloading this page continues checking the same installation."}
                    </p>
                  )}
                </div>
              ) : (
                <form onSubmit={createRestaurant} className="space-y-4">
                  <p className="text-sm text-[var(--text-secondary)]">
                    {tr
                      ? "İşlemi onaylamak için mevcut işletme sahibi şifrenizi girin. Yeni restoran açıldığında onun için ayrı bir işletme sahibi şifresi belirleyeceksiniz."
                      : "Enter the current owner password to authorize this action. You will choose a separate owner password when the new restaurant opens."}
                  </p>
                  <HelpInput
                    label={tr ? "Mevcut işletme sahibi şifresi" : "Current owner password"}
                    type="password"
                    value={ownerPassword}
                    onChange={setOwnerPassword}
                    autoComplete="current-password"
                    maxLength={128}
                  />
                  {error && <HelpError>{error}</HelpError>}
                  <button disabled={busy} className={buttonClass}>
                    {busy
                      ? tr
                        ? "Başlatılıyor…"
                        : "Starting…"
                      : tr
                        ? "Ayrı restoran kurulumu oluştur"
                        : "Create a separate restaurant installation"}
                  </button>
                </form>
              )}
            </div>
          )}
          <LegalLinks />
        </div>
      </section>
    </div>
  );
}

function HelpInput({ label, value, onChange, type = "text", ...props }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
        required
        {...props}
      />
    </label>
  );
}

function HelpError({ children }) {
  return (
    <p
      role="alert"
      className="rounded-[var(--radius-control)] border border-[var(--danger-border)] bg-[var(--danger-surface)] p-3 text-sm text-[var(--danger)]"
    >
      {children}
    </p>
  );
}
