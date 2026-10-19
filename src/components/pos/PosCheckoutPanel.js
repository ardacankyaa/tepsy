"use client";

import {
  Banknote,
  Check,
  CreditCard,
  MonitorCheck,
  Plus,
  Printer,
  Receipt,
  Trash2,
  X,
} from "lucide-react";
import { ScrollPanel } from "@/components/ui/Workspace";
import PosItemPayments from "./PosItemPayments";
import PosSplitPayments from "./PosSplitPayments";
import PosPaymentHistory from "./PosPaymentHistory";

export default function PosCheckoutPanel({ checkout, actions, formatPrice, t }) {
  const {
    table: selectedTable,
    activeOrders,
    items: allOrderItems,
    paymentError,
    itemActionError,
    posOrderAttempt,
    isAddingItem,
    rawSubtotal,
    discountPercent,
    discountReason,
    partialAmount,
    selectedItems,
    tipAmount,
    isProcessingPayment,
    currentShift,
    finalTotalAmount,
    account,
    accountOrderIds,
    historyRevision,
    latestPayment,
    receiptError,
    receiptLoading,
    lang,
  } = checkout;
  const {
    setShowAddMenuModal,
    setSelectedTable,
    handleCancelItem,
    setDiscountPercent,
    previewReceipt,
    setDiscountReason,
    setPartialAmount,
    setSelectedItems,
    setTipAmount,
    handlePayment,
    onReceipt,
    onAccountChange,
    onRetryPendingOrder,
    onChooseTable,
  } = actions;

  const labels =
    lang === "en"
      ? {
          account: "Account",
          openOrders: "open orders",
          noOpenOrders: "No open orders",
          addItem: "Add item",
          chooseTable: "Choose another table",
          returnTables: "Table list",
          accountLines: "Account details",
          noItems: "No items on this table",
          orderNote: "Order note",
          billPreview: "Print bill preview",
          discount: "Discount",
          paid: "Paid so far",
          remaining: "Remaining",
          subtotal: "Gross total",
          customDiscount: "Custom %",
          discountReason: "Discount reason",
          partialAmount: "Partial payment amount",
          partialHint: "Leave empty to settle the full remaining amount.",
          shiftRequired: "Open a cash shift before taking payment.",
          openShift: "Open shift",
          paymentPending: "Recording payment…",
          cashPayment: "Cash payment",
          cardPayment: "Card payment",
          otherPayment: "Other payment",
          removeItem: "Remove item",
        }
      : {
          account: "Hesap",
          openOrders: "açık sipariş",
          noOpenOrders: "Açık sipariş yok",
          addItem: "Ürün ekle",
          chooseTable: "Başka masa seç",
          returnTables: "Masa listesi",
          accountLines: "Hesap dökümü",
          noItems: "Bu masada ürün yok",
          orderNote: "Sipariş notu",
          billPreview: "Hesap fişini önizle",
          discount: "İndirim",
          paid: "Şimdiye kadar ödenen",
          remaining: "Kalan tutar",
          subtotal: "Brüt toplam",
          customDiscount: "Özel %",
          discountReason: "İndirim nedeni",
          partialAmount: "Kısmi ödeme tutarı",
          partialHint: "Tüm kalan tutarı almak için boş bırakın.",
          shiftRequired: "Tahsilat almadan önce kasa vardiyasını açın.",
          openShift: "Vardiya aç",
          paymentPending: "Ödeme kaydediliyor…",
          cashPayment: "Nakit tahsilat",
          cardPayment: "Kart tahsilatı",
          otherPayment: "Diğer tahsilat",
          removeItem: "Ürünü kaldır",
        };

  const grossAmount = Number(rawSubtotal) || 0;
  const activeDiscount = activeOrders.reduce(
    (sum, order) => sum + (Number(order.discountAmount) || 0),
    0
  );
  const activePaidAmount = activeOrders.reduce(
    (sum, order) =>
      sum +
      (order.payments || []).reduce(
        (total, payment) => total + (Number(payment.amountPaid) || 0),
        0
      ),
    0
  );
  const existingDiscount = account ? Number(account.discountAmount) : activeDiscount;
  const paidAmount = account ? Number(account.totalPaid) : activePaidAmount;
  const discountLocked = paidAmount > 0;
  const discountAmount = Math.max(
    existingDiscount,
    Math.round(grossAmount * (Number(discountPercent) || 0)) / 100
  );

  return (
    <section className="pos-checkout-panel" aria-labelledby="pos-checkout-title">
      {selectedTable ? (
        <>
          <header className="pos-checkout-header">
            <div className="pos-checkout-context">
              <span className="pos-checkout-table-mark">
                <Receipt size={18} aria-hidden="true" />
              </span>
              <div>
                <div className="pos-checkout-heading-line">
                  <h2 id="pos-checkout-title">{selectedTable.tableNumber}</h2>
                  <span className="pos-checkout-section">{selectedTable.section}</span>
                </div>
                <p>
                  {activeOrders.length > 0
                    ? `${activeOrders.length} ${labels.openOrders}`
                    : labels.noOpenOrders}
                </p>
              </div>
            </div>
            <div className="pos-checkout-header-actions">
              <button
                type="button"
                className="pos-back-to-tables"
                aria-label={labels.returnTables}
                onClick={onChooseTable}
              >
                <span>{labels.returnTables}</span>
              </button>
              <button
                type="button"
                className="pos-add-item-button"
                onClick={() => setShowAddMenuModal(true)}
                aria-label={labels.addItem}
              >
                <Plus size={18} aria-hidden="true" />
                <span>{labels.addItem}</span>
              </button>
              <button
                type="button"
                className="pos-close-account"
                onClick={() => setSelectedTable(null)}
                aria-label={t("close") || (lang === "en" ? "Close account" : "Hesabı kapat")}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          </header>

          <div className="pos-checkout-layout">
            <section className="pos-ledger" aria-labelledby="pos-ledger-title">
              <div className="pos-ledger-heading">
                <div>
                  <h3 id="pos-ledger-title">{labels.accountLines}</h3>
                  <span>
                    {allOrderItems.length} {lang === "en" ? "items" : "ürün"}
                  </span>
                </div>
              </div>
              {allOrderItems.length === 0 ? (
                <div className="pos-empty-ledger">
                  <Receipt size={28} aria-hidden="true" />
                  <p>{labels.noItems}</p>
                  <button type="button" onClick={() => setShowAddMenuModal(true)}>
                    <Plus size={16} aria-hidden="true" />
                    {labels.addItem}
                  </button>
                </div>
              ) : (
                <ScrollPanel
                  className="pos-item-scroll"
                  label={`${labels.accountLines}, ${selectedTable.tableNumber}`}
                >
                  <div className="pos-item-list">
                    {allOrderItems.map((item) => {
                      const name =
                        item.menuItemName ||
                        item.menuItem?.name ||
                        (lang === "en" ? "Item" : "Ürün");
                      const lineTotal =
                        (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0);
                      return (
                        <article
                          key={`${item.orderId || "order"}-${item.id}`}
                          className="pos-item-line"
                        >
                          <span className="pos-item-quantity">{item.quantity}×</span>
                          <div className="pos-item-description">
                            <strong>{name}</strong>
                            {item.notes && <p>{item.notes}</p>}
                          </div>
                          <strong className="pos-item-line-total">{formatPrice(lineTotal)}</strong>
                          <button
                            type="button"
                            className="pos-remove-item"
                            disabled={Boolean(posOrderAttempt) || isAddingItem}
                            onClick={() => handleCancelItem(item.orderId, item.id)}
                            aria-label={`${labels.removeItem}: ${name}`}
                          >
                            <Trash2 size={17} aria-hidden="true" />
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </ScrollPanel>
              )}
              {posOrderAttempt && (
                <div className="pos-action-error">
                  <p role="status">
                    {lang === "en"
                      ? "The order result could not be confirmed. Retry the same item before adding anything else."
                      : "Sipariş sonucu doğrulanamadı. Başka ürün eklemeden önce aynı isteği yeniden deneyin."}
                  </p>
                  <button
                    type="button"
                    onClick={onRetryPendingOrder}
                    disabled={isAddingItem}
                    className="pos-retry-order-button"
                  >
                    {isAddingItem
                      ? lang === "en"
                        ? "Checking…"
                        : "Kontrol ediliyor…"
                      : lang === "en"
                        ? "Retry same order"
                        : "Aynı siparişi yeniden dene"}
                  </button>
                </div>
              )}
              {itemActionError && !posOrderAttempt && (
                <p role="alert" className="pos-action-error">
                  {itemActionError}
                </p>
              )}
            </section>

            <section
              className="pos-payment-panel"
              aria-label={lang === "en" ? "Payment" : "Tahsilat"}
            >
              <div className="pos-payment-heading">
                <div>
                  <span>{labels.account}</span>
                  <h3>{lang === "en" ? "Payment" : "Tahsilat"}</h3>
                </div>
                <button
                  type="button"
                  onClick={previewReceipt}
                  disabled={activeOrders.length === 0}
                  className="pos-preview-button"
                >
                  <Printer size={17} aria-hidden="true" />
                  <span>{labels.billPreview}</span>
                </button>
              </div>

              <dl className="pos-payment-breakdown">
                <div>
                  <dt>{labels.subtotal}</dt>
                  <dd>{formatPrice(grossAmount)}</dd>
                </div>
                <div>
                  <dt>{labels.discount}</dt>
                  <dd>−{formatPrice(discountAmount)}</dd>
                </div>
                <div>
                  <dt>{labels.paid}</dt>
                  <dd>{formatPrice(paidAmount)}</dd>
                </div>
                <div className="pos-remaining-row">
                  <dt>{labels.remaining}</dt>
                  <dd>{formatPrice(finalTotalAmount)}</dd>
                </div>
              </dl>

              {paymentError && (
                <p role="alert" className="pos-payment-error">
                  {paymentError}
                </p>
              )}

              <details
                className="pos-options pos-discount-disclosure"
                open={Number(discountPercent) > 0}
              >
                <summary>
                  {lang === "tr" ? "İndirim uygula" : "Apply discount"}
                  {Number(discountPercent) > 0 && <span>{discountPercent}%</span>}
                </summary>
                <div className="pos-discount-presets" aria-label={labels.discount}>
                  {[10, 15, 20].map((percent) => (
                    <button
                      key={percent}
                      type="button"
                      disabled={discountLocked || isProcessingPayment}
                      aria-pressed={Number(discountPercent) === percent}
                      onClick={() =>
                        setDiscountPercent(Number(discountPercent) === percent ? 0 : percent)
                      }
                      className={Number(discountPercent) === percent ? "is-selected" : ""}
                    >
                      {percent}%
                    </button>
                  ))}
                  <span>{labels.discount}</span>
                </div>

                <div className="pos-discount-fields">
                  <label>
                    <span>{labels.customDiscount}</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={discountPercent}
                      disabled={discountLocked || isProcessingPayment}
                      onChange={(event) => setDiscountPercent(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>{labels.discountReason}</span>
                    <input
                      type="text"
                      maxLength={300}
                      value={discountReason}
                      onChange={(event) => setDiscountReason(event.target.value)}
                      disabled={
                        Number(discountPercent) === 0 || discountLocked || isProcessingPayment
                      }
                    />
                  </label>
                </div>
              </details>
              {discountLocked && (
                <p className="pos-discount-locked">
                  {lang === "tr"
                    ? "İlk tahsilattan sonra indirim sabit kalır."
                    : "Discount is fixed after the first payment."}
                </p>
              )}
              <PosItemPayments
                orders={activeOrders}
                selection={selectedItems}
                onChange={setSelectedItems}
                busy={isProcessingPayment}
                lang={lang}
                formatPrice={formatPrice}
                discountPercent={discountPercent}
                tipAmount={tipAmount}
              />
              <label className="pos-partial-field">
                <span>{lang === "tr" ? "Bahşiş (isteğe bağlı)" : "Tip (optional)"}</span>
                <small>
                  {lang === "tr"
                    ? "QR isteğindeki bahşiş burada düzenlenebilir. Hesap bedeline ek tahsil edilir."
                    : "Confirm or edit the QR tip. Collected in addition to the bill payment."}
                </small>
                <input
                  type="text"
                  inputMode="decimal"
                  value={tipAmount}
                  onChange={(e) => setTipAmount(e.target.value)}
                  disabled={isProcessingPayment}
                  placeholder="0.00"
                />
              </label>
              <details className="pos-options pos-split-disclosure" open={Boolean(partialAmount)}>
                <summary>
                  {lang === "tr" ? "Hesabı böl / özel tutar" : "Split or custom amount"}
                </summary>
                <PosSplitPayments
                  key={selectedTable.id}
                  tableId={selectedTable.id}
                  remaining={finalTotalAmount}
                  amount={partialAmount}
                  onAmountChange={setPartialAmount}
                  latestPayment={latestPayment}
                  busy={isProcessingPayment}
                  lang={lang}
                  formatPrice={formatPrice}
                />
              </details>
              {partialAmount && (
                <div className="pos-collection-amount" role="status">
                  <span>{lang === "tr" ? "Bu tahsilat" : "This payment"}</span>
                  <strong>
                    {Number.isFinite(Number(partialAmount.replace(",", ".")))
                      ? formatPrice(Number(partialAmount.replace(",", ".")))
                      : "—"}
                  </strong>
                </div>
              )}
              {!selectedItems?.length && Number(String(tipAmount || 0).replace(",", ".")) > 0 && (
                <div className="pos-collection-amount" role="status">
                  <span>
                    {lang === "tr" ? "Bahşiş dahil bu tahsilat" : "This collection including tip"}
                  </span>
                  <strong>
                    {formatPrice(
                      (partialAmount ? Number(partialAmount.replace(",", ".")) : finalTotalAmount) +
                        Number(String(tipAmount).replace(",", "."))
                    )}
                  </strong>
                </div>
              )}
              <p className="pos-method-hint">
                {lang === "tr"
                  ? "Tahsil etmek için ödeme yöntemini seçin."
                  : "Choose a payment method to collect."}
              </p>
              {!currentShift && (
                <p id="pos-shift-required" className="pos-shift-required">
                  {labels.shiftRequired}
                </p>
              )}
              {rawSubtotal > 0 ? (
                <div className="pos-payment-methods" aria-busy={isProcessingPayment}>
                  <button
                    type="button"
                    onClick={() => handlePayment("CASH")}
                    disabled={isProcessingPayment || !currentShift}
                    className="pos-method-cash"
                    aria-describedby={!currentShift ? "pos-shift-required" : undefined}
                  >
                    <Banknote size={19} aria-hidden="true" />
                    <span>{t("cash")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePayment("CREDIT_CARD")}
                    disabled={isProcessingPayment || !currentShift}
                    className="pos-method-card"
                    aria-describedby={!currentShift ? "pos-shift-required" : undefined}
                  >
                    <CreditCard size={19} aria-hidden="true" />
                    <span>{t("cardPos")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePayment("OTHER")}
                    disabled={isProcessingPayment || !currentShift}
                    className="pos-method-other"
                    aria-describedby={!currentShift ? "pos-shift-required" : undefined}
                  >
                    <Check size={19} aria-hidden="true" />
                    <span>{lang === "en" ? "Other" : "Diğer"}</span>
                  </button>
                  {isProcessingPayment && (
                    <p className="pos-payment-pending" role="status">
                      {labels.paymentPending}
                    </p>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAddMenuModal(true)}
                  className="pos-add-first-item"
                >
                  <Plus size={18} aria-hidden="true" />
                  {t("addItemToTable")}
                </button>
              )}
              {receiptLoading && (
                <p role="status">{lang === "tr" ? "Fiş yükleniyor…" : "Loading receipt…"}</p>
              )}
              {receiptError && (
                <p role="alert" className="pos-payment-error">
                  {receiptError}
                </p>
              )}
              <details className="pos-options pos-history-disclosure">
                <summary>
                  {lang === "tr" ? "Tahsilatlar ve fişler" : "Payments and receipts"}
                  <span>{formatPrice(paidAmount)}</span>
                </summary>
                <PosPaymentHistory
                  key={`${selectedTable.id}:${accountOrderIds}`}
                  tableId={selectedTable.id}
                  orderIds={accountOrderIds}
                  version={historyRevision}
                  lang={lang}
                  formatPrice={formatPrice}
                  onReceipt={onReceipt}
                  onAccountChange={onAccountChange}
                />
              </details>
            </section>
          </div>
        </>
      ) : (
        <div className="pos-no-selection">
          <MonitorCheck size={34} aria-hidden="true" />
          <h2>{t("selectATable")}</h2>
          <p>{t("selectATableDesc")}</p>
          <button type="button" onClick={onChooseTable} className="pos-command-button">
            {labels.chooseTable}
          </button>
        </div>
      )}
    </section>
  );
}
