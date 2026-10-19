"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Monitor, Printer, TriangleAlert } from "lucide-react";
import { useApp } from "@/lib/AppContext";
import { Dialog } from "@/components/ui/Workspace";

export default function ReceiptModal({ isOpen, onClose, data }) {
  const {
    t,
    formatPrice: currentFormatPrice,
    lang,
    restaurantName: currentRestaurantName,
    currency: currentCurrency,
  } = useApp();
  const [printState, setPrintState] = useState("idle");
  const [printMessage, setPrintMessage] = useState("");

  useEffect(() => {
    if (isOpen) {
      setPrintState("idle");
      setPrintMessage("");
    }
  }, [isOpen, data]);

  if (!isOpen || !data) return null;

  const recorded = data.kind === "PAYMENT" || Boolean(data.snapshotKind);
  const legacy = data.snapshotKind?.startsWith("LEGACY");
  const restaurantName = data.restaurantName || (legacy ? "TEPSY" : currentRestaurantName);
  const receiptCurrency = legacy ? data.currency : data.currency || currentCurrency;
  const formatPrice = (amount) => {
    if (!recorded) return currentFormatPrice(amount);
    const value = Number(amount) || 0;
    const number = value.toLocaleString(lang === "tr" ? "tr-TR" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    if (!receiptCurrency) return `${number} ?`;
    return ["$", "€", "£"].includes(receiptCurrency)
      ? `${receiptCurrency}${number}`
      : `${number} ${receiptCurrency}`;
  };
  const labels =
    lang === "tr"
      ? {
          serverPrint: "Fiş yazıcısına gönder",
          reprint: "Fişi yeniden yazdır",
          browserPrint: "Tarayıcıdan yazdır",
          sending: "Yazıcıya gönderiliyor…",
          sent: "Fiş yazdırma kuyruğuna gönderildi.",
          failed: "Sunucu yazıcısına gönderilemedi.",
          fallbackHint:
            "Ödeme kaydı korunuyor; yazdırma hatası tahsilatı iptal etmez. Yeniden ödeme almayın. Tarayıcıdan yazdırabilir veya bu fişi yeniden gönderebilirsiniz.",
        }
      : {
          serverPrint: "Send to receipt printer",
          reprint: "Print receipt again",
          browserPrint: "Print from browser",
          sending: "Sending to printer…",
          sent: "Receipt was sent to the print queue.",
          failed: "Could not send to the server printer.",
          fallbackHint:
            "The payment remains recorded; a printing error does not cancel it. Do not charge again. You can print from the browser or send this receipt again.",
        };

  const handleBrowserPrint = () => window.print();

  const {
    tableNumber,
    section,
    orderId,
    items = [],
    totalAmount = 0,
    grossTotal,
    discountAmount,
    netTotal,
    amountPaid,
    remainingBalance,
    totalPaid,
    paymentMethod = "CASH",
    timestamp = new Date(),
  } = data;

  const handleServerPrint = async () => {
    if (printState === "pending") return;
    setPrintState("pending");
    setPrintMessage(labels.sending);

    try {
      const response = await fetch("/api/print/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          recorded && data.id
            ? { paymentId: data.id }
            : {
                kind: data.kind,
                restaurantName,
                tableNumber,
                section,
                orderId,
                items,
                totalAmount,
                grossTotal,
                discountAmount,
                netTotal,
                amountPaid,
                remainingBalance,
                paymentMethod,
                timestamp,
              }
        ),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success || !result.accepted)
        throw new Error(result.error || labels.failed);
      setPrintState("success");
      setPrintMessage(result.message || labels.sent);
    } catch (error) {
      setPrintState("error");
      setPrintMessage(`${error.message || labels.failed} ${labels.fallbackHint}`);
    }
  };

  const methodLabel =
    paymentMethod === "CASH"
      ? t("cashPay")
      : paymentMethod === "OTHER"
        ? lang === "tr"
          ? "Diğer"
          : "Other"
        : data.cardVerification === "MANUAL"
          ? lang === "tr"
            ? "Kart · manuel kayıt"
            : "Card · manual record"
          : t("cardPay");

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title={recorded ? (lang === "tr" ? "Tahsilat fişi" : "Payment receipt") : t("receiptPreview")}
      className="receipt-dialog"
    >
      <article
        id="printable-receipt"
        className="receipt-paper"
        aria-label={lang === "tr" ? "Fiş önizlemesi" : "Receipt preview"}
      >
        <header className="receipt-paper-header">
          <h3>{restaurantName}</h3>
          <p>
            {recorded
              ? lang === "tr"
                ? "Tahsilat fişi"
                : "Payment receipt"
              : data.kind === "BILL"
                ? lang === "tr"
                  ? "Hesap dökümü"
                  : "Account details"
                : t("customerReceipt")}
          </p>
          <time dateTime={new Date(timestamp).toISOString()}>
            {new Date(timestamp).toLocaleString(lang === "tr" ? "tr-TR" : "en-US")}
          </time>
        </header>

        <div className="receipt-paper-context">
          <span>
            {t("table")}: {tableNumber} ({section})
          </span>
          <span>{orderId ? `#${String(orderId).slice(-4).toUpperCase()}` : ""}</span>
          {data.receiptNumber && (
            <strong className="receipt-paper-number">{data.receiptNumber}</strong>
          )}
        </div>

        <div className="receipt-paper-items">
          {items.map((item, index) => (
            <div key={`${item.id || "item"}-${index}`}>
              <span>
                {item.quantity}×{" "}
                {item.name ||
                  item.menuItemName ||
                  item.menuItem?.name ||
                  (lang === "tr" ? "Ürün" : "Item")}
              </span>
              <strong>
                {formatPrice((Number(item.unitPrice) || 0) * (Number(item.quantity) || 0))}
              </strong>
            </div>
          ))}
        </div>

        <dl className="receipt-paper-totals">
          {grossTotal !== undefined && grossTotal !== null ? (
            <>
              <div>
                <dt>{lang === "tr" ? "Brüt" : "Gross"}</dt>
                <dd>{formatPrice(grossTotal)}</dd>
              </div>
              <div>
                <dt>{lang === "tr" ? "İndirim" : "Discount"}</dt>
                <dd>{formatPrice(discountAmount)}</dd>
              </div>
              <div>
                <dt>Net</dt>
                <dd>{formatPrice(netTotal)}</dd>
              </div>
              <div className="is-paid">
                <dt>
                  {recorded
                    ? lang === "tr"
                      ? "Bu tahsilat"
                      : "This payment"
                    : lang === "tr"
                      ? "Ödenen"
                      : "Paid"}
                </dt>
                <dd>{formatPrice(amountPaid)}</dd>
              </div>
              {totalPaid !== undefined && totalPaid !== null && (
                <div>
                  <dt>{lang === "tr" ? "Bu hesapta ödenen" : "Paid on this account"}</dt>
                  <dd>{formatPrice(totalPaid)}</dd>
                </div>
              )}
              {remainingBalance !== undefined && remainingBalance !== null && (
                <div>
                  <dt>{lang === "tr" ? "Kalan" : "Remaining"}</dt>
                  <dd>{formatPrice(remainingBalance)}</dd>
                </div>
              )}
            </>
          ) : (
            <div className={recorded ? "is-paid" : "is-total"}>
              <dt>{recorded ? (lang === "tr" ? "Bu tahsilat" : "This payment") : t("totalDue")}</dt>
              <dd>{formatPrice(recorded ? amountPaid : totalAmount)}</dd>
            </div>
          )}
          {Number(data.tipAmount) > 0 && (
            <>
              <div>
                <dt>{lang === "tr" ? "Bahşiş" : "Tip"}</dt>
                <dd>{formatPrice(data.tipAmount)}</dd>
              </div>
              <div className="is-paid">
                <dt>{lang === "tr" ? "Bahşiş dahil tahsilat" : "Collected including tip"}</dt>
                <dd>{formatPrice(data.collectedTotal)}</dd>
              </div>
            </>
          )}
          {data.paymentItems?.length > 0 && (
            <div>
              <dt>{lang === "tr" ? "Bu ödemedeki ürünler" : "Items in this payment"}</dt>
              <dd>{data.paymentItems.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</dd>
            </div>
          )}
          {data.kind !== "BILL" && (
            <div>
              <dt>{t("paymentMethod")}</dt>
              <dd>{methodLabel}</dd>
            </div>
          )}
        </dl>

        <footer className="receipt-paper-footer">{t("thankYou")}</footer>
      </article>

      {legacy && (
        <p className="receipt-manual-note">
          {lang === "tr"
            ? "Eski ödeme kaydı: işletme adı ve para birimi o tarihte saklanmamış. Eksik bilgiler ? ile gösterilir."
            : "Legacy payment: restaurant name and currency were not saved at the time. Missing details are marked ?."}
        </p>
      )}

      {data.cardVerification === "MANUAL" && (
        <p className="receipt-manual-note">
          {lang === "tr"
            ? "Kart ödemesi görevli onayıyla manuel kaydedildi. TEPSY banka tahsilatı yapmadı."
            : "Card payment was recorded manually with cashier confirmation. TEPSY did not charge the card."}
        </p>
      )}

      <div aria-live="polite" className="receipt-print-status">
        {printState !== "idle" && (
          <div className={`receipt-print-message ${printState}`}>
            {printState === "pending" && <Loader2 size={17} aria-hidden="true" />}
            {printState === "success" && <CheckCircle2 size={17} aria-hidden="true" />}
            {printState === "error" && <TriangleAlert size={17} aria-hidden="true" />}
            <span>{printMessage}</span>
          </div>
        )}
      </div>

      <div className="receipt-print-actions">
        <button type="button" onClick={handleBrowserPrint} className="receipt-browser-print">
          <Monitor size={17} aria-hidden="true" />
          <span>{labels.browserPrint}</span>
        </button>
        <button
          type="button"
          onClick={handleServerPrint}
          disabled={printState === "pending"}
          className="receipt-server-print"
        >
          {printState === "pending" ? (
            <Loader2 size={17} aria-hidden="true" />
          ) : (
            <Printer size={17} aria-hidden="true" />
          )}
          <span>
            {printState === "error" || printState === "success"
              ? labels.reprint
              : labels.serverPrint}
          </span>
        </button>
      </div>

      <button type="button" onClick={onClose} className="receipt-close-button">
        {t("close")}
      </button>
    </Dialog>
  );
}
