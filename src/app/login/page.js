"use client";

import BrandLogo from "@/components/BrandLogo";
import { useEffect, useState } from "react";
import { useApp } from "@/lib/AppContext";
import { LegalLinks } from "@/components/ui/Workspace";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ChefHat,
  CreditCard,
  KeyRound,
  LockKeyhole,
  Utensils,
  UserRound,
} from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { lang, setLang } = useApp();
  const tr = lang === "tr";
  const [status, setStatus] = useState(null);
  const [mode, setMode] = useState("OWNER");
  const [restaurantCode, setRestaurantCode] = useState("");
  const [username, setUsername] = useState("");
  const [credential, setCredential] = useState("");
  const [rememberDevice, setRememberDevice] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/status")
      .then((response) => response.json())
      .then((data) => {
        setStatus(data);
        setRestaurantCode("");
        if (data.session)
          router.replace(
            data.session.role === "ADMIN"
              ? "/"
              : { WAITER: "/order", KITCHEN: "/kitchen", CASHIER: "/pos" }[data.session.role] || "/"
          );
      })
      .catch(() => setError("Yerel sunucuya bağlanılamadı."));
  }, [router]);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantCode,
          username: mode === "STAFF" ? username : "",
          password: credential,
          rememberDevice: mode === "OWNER" && rememberDevice,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Giriş yapılamadı.");
      router.replace(result.redirectTo || "/");
      router.refresh();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-story" aria-label="TEPSY">
        <div className="login-brand">
          <BrandLogo full />
          <div>
            <span className="login-brand-caption">
              {tr ? "Restoran çalışma alanı" : "Restaurant workspace"}
            </span>
          </div>
        </div>
        <div className="login-story-content">
          <p className="login-kicker">
            {status?.restaurantName || "TEPSY"} {restaurantCode && <span>· {restaurantCode}</span>}
          </p>
          <h1>{tr ? "Her vardiya, aynı özenle." : "Every shift, thoughtfully connected."}</h1>
          <p className="login-lede">
            {tr
              ? "Salon, mutfak ve kasa tek akışta buluşur. İşletme hesabınızla veya personel bilgilerinizle devam edin."
              : "Floor, kitchen and checkout in one flow. Continue with your owner account or staff credentials."}
          </p>
          <div className="login-role-list">
            <div>
              <span className="login-role-icon">
                <Utensils className="h-4 w-4" />
              </span>
              <span>
                <strong>{tr ? "Salon" : "Floor"}</strong>
                <small>{tr ? "Masa ve servis akışı" : "Tables and service"}</small>
              </span>
            </div>
            <div>
              <span className="login-role-icon">
                <ChefHat className="h-4 w-4" />
              </span>
              <span>
                <strong>{tr ? "Mutfak" : "Kitchen"}</strong>
                <small>{tr ? "Hazırlık ve teslim" : "Preparation and handoff"}</small>
              </span>
            </div>
            <div>
              <span className="login-role-icon">
                <CreditCard className="h-4 w-4" />
              </span>
              <span>
                <strong>{tr ? "Kasa" : "Checkout"}</strong>
                <small>{tr ? "Hesap ve tahsilat" : "Bills and payments"}</small>
              </span>
            </div>
          </div>
        </div>
        <div className="login-local-note">
          <span className="login-local-dot" />
          <span>
            {tr
              ? "İşletmenizin yerel sunucusunda çalışır"
              : "Runs on your restaurant’s local server"}
          </span>
        </div>
      </section>

      <section className="login-access" aria-label="Hesap girişi">
        <div className="login-access-card">
          <div className="login-access-heading">
            <button
              type="button"
              className="secondary-action mb-5 px-4"
              onClick={() => setLang(tr ? "en" : "tr")}
            >
              {tr ? "English" : "Türkçe"}
            </button>
            <h2>
              {status?.restaurantName ||
                (tr ? "İşletmenize hoş geldiniz" : "Welcome to your workspace")}
            </h2>
            <p>
              {status?.ownerName
                ? `${status.ownerName} · ${tr ? "İşletme sahibi" : "Owner"}`
                : tr
                  ? "Restoran kodunuzu ve giriş bilgilerinizi kullanın."
                  : "Enter your restaurant code and credentials."}
            </p>
          </div>

          {status && !status.authEnabled ? (
            <div className="space-y-4">
              <div className="rounded-[var(--radius-panel)] border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--text-secondary)]">
                {status.canSetup
                  ? tr
                    ? "Yeni işletmeniz için masaları, menüyü ve işletme sahibi şifresini birlikte belirleyin."
                    : "Set up your tables, menu and owner password for a new restaurant."
                  : tr
                    ? "Mevcut işletmenizde giriş koruması henüz etkin değil. Sunucu bilgisayarında Ayarlar’dan işletme sahibi şifresini belirleyin ve giriş korumasını açın."
                    : "This existing restaurant has no sign-in protection yet. On the server computer, set an owner password and enable protection in Settings."}
              </div>
              <button
                type="button"
                onClick={() =>
                  router.push(status.canSetup ? "/setup" : "/admin/settings#local-access")
                }
                className="primary-action flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 text-sm font-semibold"
              >
                {status.canSetup
                  ? tr
                    ? "İşletmeni kur"
                    : "Set up your restaurant"
                  : tr
                    ? "Güvenli girişi ayarla"
                    : "Configure secure sign-in"}{" "}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="segmented-control grid grid-cols-2">
                <button
                  type="button"
                  onClick={() => setMode("OWNER")}
                  aria-pressed={mode === "OWNER"}
                  className={`min-h-11 rounded-[6px] text-xs font-semibold ${mode === "OWNER" ? "bg-[var(--surface-raised)] text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}
                >
                  {tr ? "İşletme sahibi" : "Owner"}
                </button>
                <button
                  type="button"
                  onClick={() => setMode("STAFF")}
                  aria-pressed={mode === "STAFF"}
                  className={`min-h-11 rounded-[6px] text-xs font-semibold ${mode === "STAFF" ? "bg-[var(--surface-raised)] text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}
                >
                  {tr ? "Personel" : "Staff"}
                </button>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">
                  {tr ? "Restoran kodu" : "Restaurant code"}
                </span>
                <div className="flex min-h-12 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-inset)] px-3">
                  <KeyRound className="h-4 w-4 text-[var(--text-muted)]" />
                  <input
                    value={restaurantCode}
                    onChange={(event) =>
                      setRestaurantCode(event.target.value.toLocaleUpperCase("tr-TR"))
                    }
                    autoCapitalize="characters"
                    autoComplete="organization"
                    required
                    className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-primary)]"
                  />
                </div>
              </label>

              {mode === "STAFF" && (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">
                    {tr ? "Personel adı" : "Staff name"}
                  </span>
                  <div className="flex min-h-12 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-inset)] px-3">
                    <UserRound className="h-4 w-4 text-[var(--text-muted)]" />
                    <input
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      required
                      autoComplete="username"
                      className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-primary)]"
                    />
                  </div>
                </label>
              )}

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">
                  {mode === "OWNER"
                    ? tr
                      ? "İşletme sahibi şifresi"
                      : "Owner password"
                    : tr
                      ? "Personel PIN'i"
                      : "Staff PIN"}
                </span>
                <div className="flex min-h-12 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-inset)] px-3">
                  <LockKeyhole className="h-4 w-4 text-[var(--text-muted)]" />
                  <input
                    type="password"
                    value={credential}
                    onChange={(event) => setCredential(event.target.value)}
                    required
                    autoComplete={mode === "OWNER" ? "current-password" : "off"}
                    className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-primary)]"
                  />
                </div>
              </label>

              {mode === "OWNER" && (
                <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={rememberDevice}
                    onChange={(event) => setRememberDevice(event.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0"
                  />
                  <span>
                    {tr ? "Bu cihazı 30 gün hatırla" : "Remember this device for 30 days"}
                    <small className="mt-1 block">
                      {tr ? "Ortak kullanılan cihazlarda kapatın." : "Turn off on shared devices."}
                    </small>
                  </span>
                </label>
              )}
              {error && (
                <p
                  role="alert"
                  className="rounded-[var(--radius-control)] border border-[var(--danger-border)] bg-[var(--danger-surface)] p-3 text-xs text-[var(--danger)]"
                >
                  {error}
                </p>
              )}
              <button
                disabled={loading}
                className="primary-action flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 text-sm font-semibold disabled:opacity-50"
              >
                <LockKeyhole className="h-4 w-4" />
                {loading
                  ? tr
                    ? "Doğrulanıyor…"
                    : "Signing in…"
                  : tr
                    ? "Giriş yap"
                    : "Sign in"}{" "}
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          )}
          {!status && error && (
            <p role="alert" className="mt-4 text-sm text-[var(--danger)]">
              {error}
            </p>
          )}
          <LegalLinks />
          <p className="login-security-note">
            {tr
              ? "Giriş bilgileri bu işletmenin sunucusunda doğrulanır."
              : "Credentials are verified on this restaurant’s server."}
          </p>
        </div>
      </section>
    </div>
  );
}
