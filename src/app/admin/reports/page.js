"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ScrollPanel, PageControls, usePages } from "@/components/ui/Workspace";
import { useApp } from "@/lib/AppContext";
import { ArrowLeft, Printer, ShoppingBag, PieChart } from "lucide-react";

export default function AdminReportsPage() {
  const { t, formatPrice, lang, restaurantName } = useApp();
  const [period, setPeriod] = useState("today");
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reportGeneratedAt, setReportGeneratedAt] = useState("");
  const requestVersion = useRef(0);

  const fetchReport = useCallback(
    async (p = period) => {
      const version = ++requestVersion.current;
      setLoading(true);
      setLoadError("");
      setReportData(null);
      try {
        const res = await fetch(`/api/reports/z-report?period=${p}`);
        if (!res.ok) throw new Error("report-unavailable");
        const data = await res.json();
        if (version !== requestVersion.current) return;
        setReportData(data);
      } catch (e) {
        if (version !== requestVersion.current) return;
        console.error(e);
        setReportData(null);
        setLoadError(
          lang === "tr" ? "Rapor verileri alınamadı." : "Report data could not be loaded."
        );
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    },
    [lang, period]
  );

  useEffect(() => {
    fetchReport(period);
    return () => {
      requestVersion.current += 1;
    };
  }, [fetchReport, period]);

  useEffect(() => {
    setReportGeneratedAt(new Date().toLocaleString(lang === "tr" ? "tr-TR" : "en-US"));
  }, [lang, reportData]);

  const printZReport = () => {
    if (loading || loadError || !reportData) return;
    window.print();
  };

  const summary = reportData?.summary || {
    totalRevenue: 0,
    cashRevenue: 0,
    cardRevenue: 0,
    totalOrdersCount: 0,
    averageOrderValue: 0,
  };

  const topProducts = reportData?.topProducts || [];
  const productPage = usePages(topProducts, 8);
  const categoryBreakdown = reportData?.categoryBreakdown || [];
  const productSalesDenominator = Number(
    summary.netProductSales ??
      categoryBreakdown.reduce((sum, category) => sum + Number(category.totalRevenue || 0), 0)
  );

  const periods = [
    { key: "today", label: t("today") },
    { key: "yesterday", label: t("yesterday") },
    { key: "this_week", label: t("thisWeek") },
    { key: "this_month", label: t("thisMonth") },
    { key: "all", label: t("allTime") },
  ];

  return (
    <div className="admin-experience reports-experience">
      <div className="no-print admin-page-header flex-wrap">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            aria-label={t("back")}
            className="icon-action p-1 rounded-lg bg-[var(--surface-strong)] hover:bg-[var(--surface-strong)] text-[var(--text-secondary)]"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1>{t("zReportTitle")}</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="segmented-control flex-wrap">
            {periods.map((p) => (
              <button
                key={p.key}
                onClick={() => {
                  setPeriod(p.key);
                  productPage.setPage(1);
                }}
                aria-pressed={period === p.key}
                className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                  period === p.key
                    ? "bg-[var(--accent)] text-[var(--accent-ink)] font-black shadow-xs"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <button
            onClick={printZReport}
            disabled={loading || Boolean(loadError) || !reportData}
            className="primary-action px-3 py-1 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-ink)] font-black flex items-center gap-1 shadow-xs active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{t("printZReport")}</span>
          </button>
        </div>
      </div>

      <div className="no-print grid grid-cols-2 lg:grid-cols-4 gap-2 mb-2 shrink-0 text-xs">
        <div className="metric-card">
          <span className="text-xs text-[var(--text-muted)] font-bold">{t("totalRevenue")}</span>
          <div className="text-lg font-black text-[var(--text-primary)] mt-0.5">
            {loading || loadError ? "—" : formatPrice(summary.totalRevenue)}
          </div>
        </div>
        <div className="metric-card">
          <span className="text-xs text-[var(--text-muted)] font-bold">{t("cashSales")}</span>
          <div className="text-lg font-black text-[var(--text-primary)] mt-0.5">
            {loading || loadError ? "—" : formatPrice(summary.cashRevenue)}
          </div>
        </div>
        <div className="metric-card">
          <span className="text-xs text-[var(--text-muted)] font-bold">{t("creditCardSales")}</span>
          <div className="text-lg font-black text-[var(--text-primary)] mt-0.5">
            {loading || loadError ? "—" : formatPrice(summary.cardRevenue)}
          </div>
        </div>
        <div className="metric-card">
          <span className="text-xs text-[var(--text-muted)] font-bold">{t("averageTicket")}</span>
          <div className="text-lg font-black text-[var(--text-primary)] mt-0.5">
            {loading || loadError ? "—" : formatPrice(summary.averageOrderValue)}
          </div>
        </div>
      </div>

      {loadError && (
        <div
          role="alert"
          className="no-print surface-panel flex flex-1 flex-col items-center justify-center gap-3 text-center"
        >
          <p className="text-sm font-semibold text-[var(--danger)]">{loadError}</p>
          <p className="max-w-sm text-xs text-[var(--text-muted)]">
            {lang === "tr"
              ? "Satış tutarları yüklenemediği için sıfır değer gösterilmiyor."
              : "Unavailable sales totals are not displayed as zero."}
          </p>
          <button
            type="button"
            onClick={() => fetchReport(period)}
            className="secondary-action min-h-11 px-4 text-xs font-semibold"
          >
            {lang === "tr" ? "Yeniden dene" : "Try again"}
          </button>
        </div>
      )}

      <div
        className={`no-print report-details flex-1 ${loadError ? "hidden" : "grid"} grid-cols-1 lg:grid-cols-12 gap-2 min-h-0`}
      >
        <div className="surface-panel lg:col-span-8 rounded-2xl overflow-hidden flex flex-col min-h-0">
          <div className="p-2.5 bg-[var(--surface-inset)] border-b border-[var(--border)] font-bold text-xs text-[var(--text-primary)]">
            {t("productSalesBreakdown")} ({topProducts.length} {t("item")})
          </div>
          <ScrollPanel className="p-2" label={t("productSalesBreakdown")}>
            {loading ? (
              <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">
                {lang === "tr" ? "Rapor yükleniyor…" : "Loading report…"}
              </div>
            ) : topProducts.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center text-[var(--text-muted)]">
                <ShoppingBag className="mb-3 h-7 w-7" strokeWidth={1.5} />
                <p className="text-sm font-semibold text-[var(--text-secondary)]">
                  {lang === "tr" ? "Bu dönemde satış yok" : "No sales in this period"}
                </p>
                <p className="mt-1 max-w-xs text-xs">
                  {lang === "tr"
                    ? "Satış tamamlandığında ürün adetleri ve tutarları burada görünecek."
                    : "Product quantities and totals will appear after a sale."}
                </p>
              </div>
            ) : (
              <table className="report-sales-table w-full text-left text-xs text-[var(--text-secondary)]">
                <thead className="bg-[var(--surface-inset)] text-[var(--text-secondary)] font-bold text-xs sticky top-0 border-b border-[var(--border)]">
                  <tr>
                    <th className="py-2 px-3">{t("item")}</th>
                    <th className="py-2 px-3">{t("category")}</th>
                    <th className="py-2 px-3 text-center">{t("quantity")}</th>
                    <th className="py-2 px-3 text-right">{t("totalAmount")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]/60">
                  {productPage.items.map((p, idx) => (
                    <tr key={idx} className="hover:bg-[var(--surface-strong)]/50 transition-colors">
                      <td className="py-2 px-3 font-bold text-[var(--text-primary)] text-xs">
                        {p.name}
                      </td>
                      <td className="py-2 px-3 text-[var(--text-secondary)] text-xs">
                        {p.categoryName}
                      </td>
                      <td
                        data-label={t("quantity")}
                        className="py-2 px-3 text-center font-black text-[var(--text-primary)]"
                      >
                        {p.quantity}
                      </td>
                      <td
                        data-label={t("totalAmount")}
                        className="py-2 px-3 text-right font-black text-[var(--text-primary)]"
                      >
                        {formatPrice(p.totalRevenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ScrollPanel>
          <PageControls
            {...productPage}
            onChange={productPage.setPage}
            label={t("productSalesBreakdown")}
          />
        </div>

        <div className="surface-panel lg:col-span-4 rounded-2xl p-3 flex flex-col justify-between min-h-0">
          <div className="font-bold text-xs text-[var(--text-primary)] border-b border-[var(--border)] pb-2">
            {t("categoryBreakdown")}
            <p className="mt-1 text-xs font-normal text-[var(--text-secondary)]">
              {lang === "tr"
                ? "Sipariş tarihine göre net ürün satışları"
                : "Net product sales by order date"}
            </p>
          </div>
          <ScrollPanel className="py-2" label={t("categoryBreakdown")}>
            {!loading && categoryBreakdown.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center text-[var(--text-muted)]">
                <PieChart className="mb-3 h-7 w-7" strokeWidth={1.5} />
                <p className="text-sm font-semibold text-[var(--text-secondary)]">
                  {lang === "tr" ? "Dağılım verisi yok" : "No breakdown data"}
                </p>
                <p className="mt-1 text-xs">
                  {lang === "tr"
                    ? "Kategori payları ilk satışla oluşur."
                    : "Category shares appear after the first sale."}
                </p>
              </div>
            ) : (
              categoryBreakdown.map((cat, i) => {
                const pct =
                  productSalesDenominator > 0
                    ? ((Number(cat.totalRevenue) / productSalesDenominator) * 100).toFixed(0)
                    : 0;
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex justify-between text-xs font-bold text-[var(--text-secondary)]">
                      <span>{cat.categoryName}</span>
                      <span className="text-[var(--text-primary)] font-black">
                        {formatPrice(cat.totalRevenue)} ({pct}%)
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-[var(--surface-inset)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--accent)] rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </ScrollPanel>
        </div>
      </div>

      {!loading && !loadError && reportData && (
        <div
          id="printable-receipt"
          className="hidden print:block font-mono text-xs text-black p-4 space-y-3"
        >
          <div className="text-center border-b border-black pb-2">
            <h1 className="font-black text-sm">{restaurantName}</h1>
            <p className="text-xs">{t("zReportTitle")}</p>
            <p className="text-[9px]">{reportGeneratedAt}</p>
          </div>

          <div className="space-y-1 border-b border-dashed border-black pb-2 text-xs">
            <div className="flex justify-between font-bold">
              <span>{t("totalRevenue")}:</span>
              <span>{formatPrice(summary.totalRevenue)}</span>
            </div>
            <div className="flex justify-between">
              <span>{t("cash")}:</span>
              <span>{formatPrice(summary.cashRevenue)}</span>
            </div>
            <div className="flex justify-between">
              <span>{t("cardPos")}:</span>
              <span>{formatPrice(summary.cardRevenue)}</span>
            </div>
          </div>

          <table className="w-full">
            <tbody>
              {topProducts.map((p, i) => (
                <tr key={i}>
                  <td>{p.name}</td>
                  <td>{p.quantity}</td>
                  <td>{formatPrice(p.totalRevenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-center pt-2 text-[9px]">*** END OF DAY / Z-REPORT ***</div>
        </div>
      )}
    </div>
  );
}
