"use client";

import RestaurantIdentity from "@/components/RestaurantIdentity";
import Link from "next/link";
import { Banknote, WalletCards } from "lucide-react";

export default function PosCommandBar({
  lang,
  t,
  sections,
  selectedSection,
  setSelectedSection,
  setShiftError,
  setShiftPanelOpen,
  currentShift,
  occupiedCount,
  tables,
  billReqCount,
  onHistory,
}) {
  const labels =
    lang === "en"
      ? {
          title: "Cashier",
          eyebrow: "FRONT OF HOUSE",
          chooseSection: "Dining section",
          openShift: "Open cash shift",
          closeShift: "Close cash shift",
          shiftOpen: "Shift is open",
          shiftClosed: "No shift open",
          zReport: "Z report",
          tablesOccupied: "occupied",
          billRequested: "bill requested",
        }
      : {
          title: "Kasa · Tahsilat",
          eyebrow: "ÖN SALON",
          chooseSection: "Salon bölümü",
          openShift: "Kasa vardiyası aç",
          closeShift: "Kasa vardiyasını kapat",
          shiftOpen: "Vardiya açık",
          shiftClosed: "Vardiya kapalı",
          zReport: "Z raporu",
          tablesOccupied: "dolu",
          billRequested: "hesap istendi",
        };

  return (
    <header className="pos-command-bar">
      <div className="pos-command-brand">
        <span className="pos-command-icon">
          <RestaurantIdentity />
        </span>
        <div>
          <span>{labels.eyebrow}</span>
          <h1>{labels.title}</h1>
        </div>
      </div>

      <label className="pos-section-picker">
        <span>{labels.chooseSection}</span>
        <select
          value={selectedSection}
          onChange={(event) => setSelectedSection(event.target.value)}
          aria-label={labels.chooseSection}
        >
          {sections.map((section) => (
            <option key={section} value={section}>
              {section}
            </option>
          ))}
          {!sections.length && (
            <option value="">{lang === "en" ? "No sections" : "Bölüm yok"}</option>
          )}
        </select>
      </label>

      <div className="pos-command-actions">
        <div className={`pos-shift-status ${currentShift ? "is-open" : "is-closed"}`} role="status">
          {currentShift ? (
            <Banknote size={16} aria-hidden="true" />
          ) : (
            <WalletCards size={16} aria-hidden="true" />
          )}
          <span>{currentShift ? labels.shiftOpen : labels.shiftClosed}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            setShiftError("");
            setShiftPanelOpen(true);
          }}
          className="pos-command-button"
        >
          {currentShift ? labels.closeShift : labels.openShift}
        </button>
        <button type="button" className="pos-command-button" onClick={onHistory}>
          {lang === "tr" ? "Tahsilat geçmişi" : "Payment history"}
        </button>
        <Link href="/admin/reports" className="pos-command-link">
          {labels.zReport}
        </Link>
      </div>

      <div
        className="pos-command-summary"
        aria-label={lang === "en" ? "Dining room summary" : "Salon özeti"}
      >
        <span>
          <strong>{occupiedCount}</strong> / {tables.length} {labels.tablesOccupied}
        </span>
        {billReqCount > 0 && (
          <span className="pos-bill-request-count">
            <strong>{billReqCount}</strong> {t("billRequested") || labels.billRequested}
          </span>
        )}
      </div>
    </header>
  );
}
