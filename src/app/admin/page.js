"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ScrollPanel } from "@/components/ui/Workspace";
import {
  UtensilsCrossed,
  Table as TableIcon,
  FileText,
  Map,
  Settings,
  RotateCcw,
  Coins,
  ArrowUpRight,
} from "lucide-react";
import { useApp } from "@/lib/AppContext";

export default function AdminDashboardPage() {
  const {
    t,
    lang,
    currency,
    setCurrency,
    currencySaving,
    currencyLocked,
    currencyError,
    formatPrice,
  } = useApp();
  const [report, setReport] = useState(null);
  const [tablesCount, setTablesCount] = useState(0);
  const [menuCount, setMenuCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  const fetchAdminData = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [repRes, tblRes, menuRes] = await Promise.all([
        fetch("/api/reports/z-report?period=today"),
        fetch("/api/tables"),
        fetch("/api/menu-items"),
      ]);

      if (!repRes.ok || !tblRes.ok || !menuRes.ok) throw new Error("admin-data-unavailable");
      setReport(await repRes.json());
      setTablesCount((await tblRes.json()).length);
      setMenuCount((await menuRes.json()).length);
    } catch (e) {
      console.error(e);
      setLoadError("admin-data-unavailable");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, []);

  const handleResetData = async () => {
    if (
      !window.confirm(
        `${t("resetConfirm")}\n${lang === "tr" ? "Önce doğrulanmış veritabanı yedeği alınacak." : "A verified database backup will be created first."}`
      )
    )
      return;
    const confirmation = window.prompt(
      lang === "tr" ? "Devam etmek için TEPSY yazın:" : "Type TEPSY to continue:"
    );
    if (confirmation === null) return;
    if (confirmation !== "TEPSY") {
      setResetError(
        lang === "tr"
          ? "Sıfırlama onayı eşleşmedi; veriler değiştirilmedi."
          : "Reset confirmation did not match; data was not changed."
      );
      return;
    }
    setResetBusy(true);
    setResetError("");
    try {
      const res = await fetch("/api/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "CLEAN", confirmation }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(
          data.error ||
            (lang === "tr"
              ? "Sıfırlama başarısız; veriler değiştirilmedi."
              : "Reset failed; data was not changed.")
        );
      window.location.href = "/setup";
    } catch (e) {
      setResetError(e.message);
      setResetBusy(false);
    }
  };

  const currencies = ["₺", "$", "€", "£"];

  const adminCards = [
    {
      title: t("floorPlanCardTitle"),
      path: "/admin/floorplan",
      desc: t("floorPlanCardDesc"),
      icon: Map,
      stats: t("floorPlan"),
    },
    {
      title: t("menuCardTitle"),
      path: "/admin/menu",
      desc: t("menuCardDesc"),
      icon: UtensilsCrossed,
      stats: `${loading || loadError ? "—" : menuCount} ${t("item")}`,
    },
    {
      title: t("tablesCardTitle"),
      path: "/admin/tables",
      desc: t("tablesCardDesc"),
      icon: TableIcon,
      stats: `${loading || loadError ? "—" : tablesCount} ${t("table")}`,
    },
    {
      title: t("reportsCardTitle"),
      path: "/admin/reports",
      desc: t("reportsCardDesc"),
      icon: FileText,
      stats: t("reportsCardTitle"),
    },
  ];

  const summary = report?.summary || {
    totalRevenue: 0,
    cashRevenue: 0,
    cardRevenue: 0,
    totalOrdersCount: 0,
    averageOrderValue: 0,
  };

  return (
    <div className="admin-experience">
      {/* Üst Yönetim Başlığı ve Araçlar */}
      <div className="admin-page-header">
        <div>
          <h1 className="page-title text-2xl text-[var(--text-primary)]">{t("adminTitle")}</h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">{t("adminSubtitle")}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {currencyLocked && (
            <span className="max-w-48 text-xs text-[var(--text-secondary)]">
              {lang === "tr"
                ? "Satış başladığı için para birimi sabit."
                : "Currency is fixed after trading starts."}
            </span>
          )}
          {/* Para Birimi Seçici */}
          <div className="segmented-control text-xs">
            <Coins className="w-3.5 h-3.5 text-[var(--accent-gold)]" />
            <span className="text-[10px] text-[var(--text-muted)] font-bold hidden sm:inline mr-1">
              {t("currencySetting")}:
            </span>
            <div className="flex gap-0.5">
              {currencies.map((c) => (
                <button
                  key={c}
                  onClick={() => setCurrency(c)}
                  aria-pressed={currency === c}
                  disabled={currencySaving || currencyLocked}
                  className={`w-6 h-6 rounded font-black text-xs transition-all ${
                    currency === c
                      ? "primary-action shadow-xs"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--accent-soft)]"
                  }`}
                  title={`${lang === "tr" ? "Para birimi" : "Currency"}: ${c}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <Link
            href="/admin/settings#business"
            className="primary-action min-h-10 px-3.5 py-2 rounded-xl font-black text-xs flex items-center gap-1.5 active:scale-95 transition-all"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>{lang === "tr" ? "İşletme ayarları" : "Business settings"}</span>
          </Link>

          <button
            onClick={handleResetData}
            disabled={resetBusy}
            className="secondary-action min-h-10 px-3 py-2 rounded-xl text-[var(--text-secondary)] hover:text-[var(--danger)] font-semibold text-xs flex items-center gap-1.5 active:scale-95"
            title={
              lang === "tr"
                ? "Tüm verileri sıfırla ve baştan başla"
                : "Reset all data and start again"
            }
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>
              {resetBusy
                ? lang === "tr"
                  ? "Yedekleniyor ve sıfırlanıyor…"
                  : "Backing up and resetting…"
                : t("reset")}
            </span>
          </button>
        </div>
      </div>

      {loadError && (
        <div
          role="alert"
          className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-[var(--danger-border)] bg-[var(--danger-surface)] px-3 text-xs text-[var(--text-secondary)]"
        >
          <span>
            {lang === "tr"
              ? "Yönetim verileri alınamadı. Gösterilen alanlar güncel olmayabilir."
              : "Management data could not be loaded. The displayed information may be outdated."}
          </span>
          <button
            type="button"
            onClick={fetchAdminData}
            className="secondary-action min-h-9 px-3 font-semibold"
          >
            {lang === "tr" ? "Yeniden dene" : "Retry"}
          </button>
        </div>
      )}
      {currencyError && (
        <div
          role="alert"
          className="rounded-[var(--radius-panel)] border border-[var(--danger-border)] bg-[var(--danger-surface)] px-3 py-2 text-xs text-[var(--danger)]"
        >
          {lang === "tr"
            ? "Para birimi kaydedilemedi. Mevcut para birimi korundu; yeniden deneyin."
            : "Currency could not be saved. The current currency was kept; try again."}
        </div>
      )}
      {resetError && (
        <div
          role="alert"
          className="rounded-[var(--radius-panel)] border border-[var(--danger-border)] bg-[var(--danger-surface)] px-3 py-2 text-xs text-[var(--danger)]"
        >
          {resetError}
        </div>
      )}

      {/* 4 Özet İstatistik Kutusu */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 shrink-0">
        <div className="metric-card">
          <span className="eyebrow">{t("todayRevenueAdmin")}</span>
          <div className="text-xl font-semibold text-[var(--text-primary)] mt-1">
            {loading || loadError ? "—" : formatPrice(summary.totalRevenue)}
          </div>
        </div>

        <div className="metric-card">
          <span className="eyebrow">{t("cashSales")}</span>
          <div className="text-xl font-semibold text-[var(--text-primary)] mt-1">
            {loading || loadError ? "—" : formatPrice(summary.cashRevenue)}
          </div>
        </div>

        <div className="metric-card">
          <span className="eyebrow">{t("creditCardSales")}</span>
          <div className="text-xl font-semibold text-[var(--text-primary)] mt-1">
            {loading || loadError ? "—" : formatPrice(summary.cardRevenue)}
          </div>
        </div>

        <div className="metric-card">
          <span className="eyebrow">{t("averageTicket")}</span>
          <div className="text-xl font-semibold text-[var(--text-primary)] mt-1">
            {loading || loadError ? "—" : formatPrice(summary.averageOrderValue)}
          </div>
        </div>
      </div>

      {/* 4 Büyük Yönetim Kartı */}
      <ScrollPanel className="admin-module-list surface-panel px-4" label={t("adminTitle")}>
        {adminCards.map((c, i) => {
          const Icon = c.icon;
          return (
            <Link key={i} href={c.path} className="admin-module-row group">
              <div className="module-icon">
                <Icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">{c.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                  {c.desc}
                </p>
              </div>
              <div className="admin-module-count inline-flex items-center gap-2">
                <span>{c.stats}</span>
                <ArrowUpRight className="h-4 w-4 text-[var(--accent)] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
            </Link>
          );
        })}
      </ScrollPanel>
    </div>
  );
}
