"use client";

import RestaurantIdentity from "@/components/RestaurantIdentity";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import MenuPhoto from "@/components/ui/MenuPhoto";
import TipDisclosure from "@/components/ui/TipDisclosure";
import {
  Bell,
  Check,
  CircleAlert,
  LoaderCircle,
  Minus,
  Plus,
  ReceiptText,
  ShoppingBag,
  Utensils,
  Search,
  ChevronRight,
  X,
} from "lucide-react";
import { useApp } from "@/lib/AppContext";
import { Dialog, LegalLinks, PageControls, ScrollPanel, usePages } from "@/components/ui/Workspace";
import {
  clearOrderAttempt,
  isDefinitiveOrderRejection,
  restoreOrderAttempt,
  restoreOrCreateOrderAttempt,
} from "@/lib/order-idempotency.mjs";
import "@/styles/service.css";
import "@/styles/qr-menu.css";

const COPY = {
  tr: {
    welcome: "Bugün ne istersiniz?",
    intro:
      "Ürünleri keşfedin, sepetinizi oluşturun. Siparişiniz garson onayından sonra hazırlanır.",
    search: "Menüde ara",
    searchPlaceholder: "Ürün, içerik veya kategori ara…",
    noResults: "Aramanıza uygun ürün bulunamadı.",
    clearFilters: "Filtreleri temizle",
    details: "detayları",
    backToMenu: "Menüye dön",
    selected: "Sepette",
    category: "Kategori",
    cartHint: "Menüden bir ürün seçerek başlayın.",
    cartLimits: "Bir siparişte en fazla 25 farklı ürün ve her üründen 20 adet seçebilirsiniz.",
    orderRejected:
      "Sipariş gönderilemedi. Sepetinizi kontrol edip yeniden deneyin veya garsonunuza danışın.",
    requestWaiting: "İsteğiniz zaten iletildi. Görevli sizinle ilgilenecek.",
    serviceHint: "Bir şeye ihtiyacınız varsa buradan haber verebilirsiniz.",
    sent: "İletildi",
    seconds: "sn",
    approvalHint: "Siparişiniz önce garson tarafından onaylanır.",
    menu: "Menü",
    table: "Masa",
    loading: "Menü yükleniyor…",
    loadError: "Menü şu anda açılamadı.",
    retry: "Yeniden dene",
    empty: "Menüde şu anda ürün yok.",
    add: "Ekle",
    cart: "Sepet",
    cartEmpty: "Sepetiniz boş.",
    order: "Siparişi gönder",
    orderingClosed: "QR siparişi şu anda kapalı.",
    closedHint: "Garson çağırabilir veya hesap isteyebilirsiniz.",
    waiter: "Garson çağır",
    bill: "Hesap iste",
    sendWaiter: "Garson çağrısı gönderildi.",
    sendBill: "Hesap isteği gönderildi.",
    requestError: "İstek gönderilemedi. Lütfen tekrar deneyin.",
    orderError: "Sipariş sonucu doğrulanamadı. Aynı siparişi yeniden deneyebilirsiniz.",
    retryOrder: "Aynı siparişi yeniden dene",
    retryNotice:
      "Önceki sipariş isteğinin sonucu doğrulanamadı. Aynı içerikle yeniden deneyin; sepet kilitli.",
    orderStorageError:
      "Güvenli yeniden deneme için tarayıcı oturumu kaydedilemedi. Tarayıcı depolamasını etkinleştirip yeniden deneyin.",
    waiting: "Garson onayı bekleniyor",
    orderAccepted: "Sipariş isteğiniz garson onayına iletildi.",
    restored: "İsteğiniz kayıtlı. Güncel onay durumunu görevlinizden öğrenebilirsiniz.",
    withdraw: "İsteği geri çek",
    withdrawing: "Geri çekiliyor…",
    orderCancelled: "Sipariş isteği geri çekildi.",
    cancelError: "İstek artık geri çekilemiyor. Garsonla görüşün.",
    all: "Tümü",
    itemCount: "ürün",
    notes: "Sipariş notu (isteğe bağlı)",
    total: "Toplam",
    notePrivacy:
      "Notlar siparişi hazırlamak için işletmeye iletilir; kişisel, sağlık veya kart bilgisi yazmayın.",
    privacy: "Gizlilik bilgisi",
  },
  en: {
    welcome: "What would you like today?",
    intro: "Explore the menu and build your cart. Your order is prepared after waiter approval.",
    search: "Search menu",
    searchPlaceholder: "Search products, ingredients or categories…",
    noResults: "No products match your search.",
    clearFilters: "Clear filters",
    details: "details",
    backToMenu: "Back to menu",
    selected: "In cart",
    category: "Category",
    cartHint: "Choose a product from the menu to get started.",
    cartLimits: "Choose up to 25 different products, with a maximum of 20 of each per order.",
    orderRejected: "The order was not sent. Check your cart and try again, or ask your waiter.",
    requestWaiting: "Your request has already been sent. A member of staff will assist you.",
    serviceHint: "Let us know if you need anything.",
    sent: "Sent",
    seconds: "s",
    approvalHint: "Your order is first confirmed by a waiter.",
    menu: "Menu",
    table: "Table",
    loading: "Loading menu…",
    loadError: "The menu could not be opened.",
    retry: "Try again",
    empty: "There are no menu items right now.",
    add: "Add",
    cart: "Cart",
    cartEmpty: "Your cart is empty.",
    order: "Send order",
    orderingClosed: "QR ordering is currently closed.",
    closedHint: "You can still call a waiter or request the bill.",
    waiter: "Call waiter",
    bill: "Request bill",
    sendWaiter: "Waiter call sent.",
    sendBill: "Bill request sent.",
    requestError: "The request could not be sent. Please try again.",
    orderError: "The order result could not be confirmed. You can retry the same order.",
    retryOrder: "Retry same order",
    retryNotice:
      "The previous order result could not be confirmed. Retry with the same contents; the cart is locked.",
    orderStorageError:
      "The browser could not save a safe retry. Enable browser session storage and try again.",
    waiting: "Waiting for waiter approval",
    orderAccepted: "Your order request was sent for waiter approval.",
    restored: "Your request is saved. Please ask staff for its current approval status.",
    withdraw: "Withdraw request",
    withdrawing: "Withdrawing…",
    orderCancelled: "The order request was withdrawn.",
    cancelError: "This request can no longer be withdrawn. Please ask a waiter.",
    all: "All",
    itemCount: "items",
    notes: "Order note (optional)",
    total: "Total",
    notePrivacy:
      "Notes are sent to the restaurant to prepare your order. Do not include personal, health, or card details.",
    privacy: "Privacy information",
  },
};

const currencyCodes = {
  "₺": "TRY",
  TRY: "TRY",
  "€": "EUR",
  EUR: "EUR",
  $: "USD",
  USD: "USD",
  "£": "GBP",
  GBP: "GBP",
};
const EMPTY_MENU_ITEMS = [];
const EMPTY_MENU_CATEGORIES = [];
const MAX_QUANTITY = 20;
const MAX_PRODUCTS = 25;
const searchText = (value) =>
  String(value || "")
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

function PublicCart({
  cartItems,
  cartTotal,
  copy,
  formatPrice,
  lang,
  menu,
  onNoteChange,
  onSubmit,
  onUpdateQuantity,
  orderBusy,
  orderAttempt,
  orderAttemptReady,
  orderNotes,
  tipAmount,
  onTipChange,
}) {
  const isTr = lang === "tr";
  const orderNoteId = useId();
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <div className="service-order-cart-content service-public-cart-content">
      <div className="service-cart-heading">
        <div>
          <h2>{copy.cart}</h2>
          <p>
            {cartCount} {copy.itemCount}
          </p>
        </div>
      </div>
      <ScrollPanel
        className="service-public-cart-scroll"
        label={isTr ? "Sepet ürünleri" : "Cart items"}
      >
        {cartItems.length === 0 ? (
          <div className="service-empty-inline">
            <ShoppingBag aria-hidden="true" />
            <p>{copy.cartEmpty}</p>
            <small>{copy.cartHint}</small>
          </div>
        ) : (
          <div className="service-order-lines">
            {cartItems.map((item) => (
              <div key={item.id} className="service-order-line service-draft-line">
                <span className="service-line-quantity">{item.quantity}</span>
                <span className="service-line-name">
                  {item.name}
                  <small>{formatPrice(item.price)}</small>
                </span>
                <span className="service-line-price">
                  {formatPrice(Number(item.price || 0) * item.quantity)}
                </span>
                <div className="service-quantity-controls">
                  <button
                    type="button"
                    disabled={Boolean(orderAttempt) || orderBusy || !orderAttemptReady}
                    onClick={() => onUpdateQuantity(item.id, -1)}
                    aria-label={`${item.name} ${isTr ? "azalt" : "decrease"}`}
                  >
                    <Minus aria-hidden="true" />
                  </button>
                  <span aria-live="polite">{item.quantity}</span>
                  <button
                    type="button"
                    disabled={
                      Boolean(orderAttempt) ||
                      orderBusy ||
                      !orderAttemptReady ||
                      item.quantity >= MAX_QUANTITY
                    }
                    onClick={() => onUpdateQuantity(item.id, 1)}
                    aria-label={`${item.name} ${isTr ? "artır" : "increase"}`}
                  >
                    <Plus aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollPanel>
      {(cartItems.length > 0 || orderAttempt) && (
        <div className="service-cart-footer">
          <p className="qr-cart-guidance">{copy.approvalHint}</p>
          {orderAttempt && (
            <p className="service-action-hint" role="status">
              {copy.retryNotice}
            </p>
          )}
          <label className="service-note-label" htmlFor={orderNoteId}>
            {copy.notes}
            <span>{orderNotes.length}/500</span>
          </label>
          <p className="service-note-privacy">
            {copy.notePrivacy} <Link href="/privacy">{copy.privacy}</Link>
          </p>
          <textarea
            id={orderNoteId}
            value={orderNotes}
            onChange={(event) => onNoteChange(event.target.value.slice(0, 500))}
            disabled={Boolean(orderAttempt) || orderBusy || !orderAttemptReady}
            maxLength={500}
            rows={3}
          />
          <TipDisclosure
            value={tipAmount}
            onChange={onTipChange}
            disabled={Boolean(orderAttempt) || orderBusy || !orderAttemptReady}
            lang={lang}
            formatPrice={formatPrice}
            hint={
              isTr
                ? "Bahşiş kasada onaylanarak tahsil edilir. Şimdi kartınızdan çekim yapılmaz."
                : "The tip is confirmed and collected at checkout."
            }
          />
          <div className="service-total-row service-total-emphasis">
            <span>{copy.total}</span>
            <strong>
              {formatPrice(cartTotal + (Number(String(tipAmount).replace(",", ".")) || 0))}
            </strong>
          </div>
          <button
            type="button"
            disabled={orderBusy || !orderAttemptReady || (!orderAttempt && !menu?.orderingEnabled)}
            onClick={onSubmit}
            className="service-button service-button-primary service-submit-order"
          >
            {orderBusy ? (
              <span className="service-spinner" aria-hidden="true" />
            ) : (
              <ShoppingBag aria-hidden="true" />
            )}
            {orderBusy
              ? isTr
                ? "Gönderiliyor…"
                : "Sending…"
              : orderAttempt
                ? copy.retryOrder
                : copy.order}
          </button>
          {!menu?.orderingEnabled && <p className="service-action-hint">{copy.closedHint}</p>}
        </div>
      )}
    </div>
  );
}

export default function PublicMenuPage() {
  const params = useParams();
  const token = typeof params?.token === "string" ? params.token : "";
  const { lang, setLang } = useApp();
  const copy = COPY[lang] || COPY.tr;
  const isTr = lang === "tr";
  const [menu, setMenu] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [categoryId, setCategoryId] = useState("ALL");
  const [search, setSearch] = useState("");
  const [detailItem, setDetailItem] = useState(null);
  const [serviceUntil, setServiceUntil] = useState({});
  const [now, setNow] = useState(0);
  const [cart, setCart] = useState({});
  const [cartOpen, setCartOpen] = useState(false);
  const [orderNotes, setOrderNotes] = useState("");
  const [tipAmount, setTipAmount] = useState("");
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderAttempt, setOrderAttempt] = useState(null);
  const [orderAttemptReady, setOrderAttemptReady] = useState(false);
  const orderAttemptRef = useRef(null);
  const [pendingOrderId, setPendingOrderId] = useState("");
  const [pendingStatus, setPendingStatus] = useState("");
  const [pendingOrderRestored, setPendingOrderRestored] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [serviceBusy, setServiceBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const orderAttemptStorageKey = `tepsy:order-attempt:qr:${token}`;
  const items = Array.isArray(menu?.items) ? menu.items : EMPTY_MENU_ITEMS;
  const categories = Array.isArray(menu?.categories) ? menu.categories : EMPTY_MENU_CATEGORIES;
  const visibleItems = useMemo(() => {
    const terms = searchText(search).trim().split(/\s+/).filter(Boolean);
    return items.filter((item) => {
      if (categoryId !== "ALL" && item.categoryId !== categoryId) return false;
      const category = categories.find((entry) => entry.id === item.categoryId);
      const content = searchText(`${item.name} ${item.description || ""} ${category?.name || ""}`);
      return terms.every((term) => content.includes(term));
    });
  }, [items, categories, categoryId, search]);
  const productPages = usePages(visibleItems, 6);
  const setProductPage = productPages.setPage;

  useEffect(() => {
    if (!Object.keys(serviceUntil).length) return;
    const interval = setInterval(() => {
      const current = Date.now();
      setNow(current);
      setServiceUntil((values) =>
        Object.fromEntries(Object.entries(values).filter(([, until]) => until > current))
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [serviceUntil]);

  useEffect(() => {
    if (!token) return;
    const storageKey = `tepsy:qr-pending:${token}`;
    const legacyKey = `restopos:qr-pending:${token}`;
    try {
      const savedOrderId =
        sessionStorage.getItem(storageKey) || sessionStorage.getItem(legacyKey) || "";
      setPendingOrderId(savedOrderId);
      setPendingOrderRestored(Boolean(savedOrderId));
    } catch (error) {
      console.warn("Saved QR order could not be restored:", error);
    }
  }, [token]);

  useEffect(() => {
    setOrderAttemptReady(false);
    const attempt = restoreOrderAttempt(orderAttemptStorageKey, "token", token);
    orderAttemptRef.current = attempt;
    setOrderAttempt(attempt);
    if (attempt) {
      const payload = JSON.parse(attempt.body);
      setCart(
        Object.fromEntries(
          (Array.isArray(payload.items) ? payload.items : []).map((item) => [
            item.menuItemId,
            item.quantity,
          ])
        )
      );
      setOrderNotes(payload.orderNotes || "");
      setTipAmount(payload.tipAmount || "");
    }
    setOrderAttemptReady(true);
  }, [orderAttemptStorageKey, token]);

  useEffect(() => {
    if (!token || !pendingOrderId) {
      setPendingStatus("");
      return;
    }
    const controller = new AbortController();
    const refreshStatus = async () => {
      try {
        const query = new URLSearchParams({ token, orderId: pendingOrderId });
        const response = await fetch(`/api/public/orders?${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 404) {
          try {
            sessionStorage.removeItem(`tepsy:qr-pending:${token}`);
            sessionStorage.removeItem(`restopos:qr-pending:${token}`);
          } catch {
            /* Storage may be unavailable. */
          }
          setPendingOrderId("");
          return;
        }
        if (!response.ok) return;
        const data = await response.json();
        if (data.status === "CANCELLED") {
          try {
            sessionStorage.removeItem(`tepsy:qr-pending:${token}`);
            sessionStorage.removeItem(`restopos:qr-pending:${token}`);
          } catch {
            /* Storage may be unavailable. */
          }
          setPendingOrderId("");
          return;
        }
        setPendingStatus(data.status || "");
      } catch (error) {
        if (error.name !== "AbortError")
          console.warn("QR order status could not be refreshed:", error);
      }
    };
    refreshStatus();
    const interval = setInterval(refreshStatus, 15000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [token, pendingOrderId]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    fetch(`/api/public/menu?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "menu-load-failed");
        return data;
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setMenu(data);
          setCategoryId("ALL");
          setProductPage(1);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error("Public QR menu could not be loaded:", error);
          setLoadError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, reload, setProductPage]);

  useEffect(() => {
    const defaultLanguage = menu?.restaurant?.defaultLanguage;
    const hasSavedLanguage = Boolean(
      localStorage.getItem("tepsy_lang") ||
      localStorage.getItem("restopos_lang") ||
      document.cookie.split(";").some((part) => {
        const trimmed = part.trim();
        return trimmed.startsWith("tepsy_lang=") || trimmed.startsWith("restopos_lang=");
      })
    );
    if (!hasSavedLanguage && (defaultLanguage === "tr" || defaultLanguage === "en"))
      setLang(defaultLanguage);
  }, [menu, setLang]);

  const tableLabel = menu?.table?.label ? String(menu.table.label) : "";
  const displayTable = /^(masa|table)\b/i.test(tableLabel)
    ? tableLabel
    : `${copy.table} · ${tableLabel}`;
  const cartItems = useMemo(
    () =>
      items.filter((item) => cart[item.id]).map((item) => ({ ...item, quantity: cart[item.id] })),
    [items, cart]
  );
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cartItems.reduce(
    (sum, item) => sum + Number(item.price || 0) * item.quantity,
    0
  );
  const formatPrice = (value) => {
    const code = currencyCodes[menu?.restaurant?.currency] || menu?.restaurant?.currency;
    try {
      if (/^[A-Z]{3}$/.test(code || "")) {
        return new Intl.NumberFormat(lang === "tr" ? "tr-TR" : "en-US", {
          style: "currency",
          currency: code,
        }).format(Number(value) || 0);
      }
    } catch {
      /* Keep the configured currency visible for unknown codes. */
    }
    return `${(Number(value) || 0).toLocaleString(lang === "tr" ? "tr-TR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code || ""}`.trim();
  };

  const updateQuantity = (itemId, delta) => {
    if (orderAttemptRef.current || orderBusy || !orderAttemptReady) return;
    setCart((current) => {
      const nextQuantity = (current[itemId] || 0) + delta;
      if (nextQuantity <= 0) {
        const next = { ...current };
        delete next[itemId];
        return next;
      }
      if (
        nextQuantity > MAX_QUANTITY ||
        (!current[itemId] && Object.keys(current).length >= MAX_PRODUCTS)
      )
        return current;
      return { ...current, [itemId]: nextQuantity };
    });
  };

  const submitOrder = async () => {
    if (!token || orderBusy || !orderAttemptReady) return;
    const existingAttempt = orderAttemptRef.current;
    if (!existingAttempt && (!menu?.orderingEnabled || !cartItems.length)) return;
    if (!existingAttempt && !/^\d+(?:[.,]\d{1,2})?$/.test(String(tipAmount || "0").trim())) {
      setNotice({
        tone: "error",
        text:
          lang === "tr"
            ? "Bahşiş sıfır veya pozitif ve en fazla iki ondalık basamaklı olmalıdır."
            : "Enter a nonnegative tip with up to two decimal places.",
      });
      return;
    }
    const payload = {
      token,
      items: cartItems.map(({ id, quantity }) => ({ menuItemId: id, quantity })),
      orderNotes: orderNotes.trim(),
      tipAmount: String(tipAmount || "0").replace(",", "."),
    };
    const attempt =
      existingAttempt ||
      restoreOrCreateOrderAttempt(orderAttemptStorageKey, payload, "token", token);
    if (!attempt) {
      setNotice({ tone: "error", text: copy.orderStorageError });
      return;
    }
    orderAttemptRef.current = attempt;
    setOrderAttempt(attempt);
    setOrderBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/public/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: attempt.body,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (isDefinitiveOrderRejection(response.status)) {
          clearOrderAttempt(orderAttemptStorageKey);
          orderAttemptRef.current = null;
          setOrderAttempt(null);
        }
        const error = new Error(data.error || "order-submit-failed");
        error.definitive = isDefinitiveOrderRejection(response.status);
        throw error;
      }
      clearOrderAttempt(orderAttemptStorageKey);
      orderAttemptRef.current = null;
      setOrderAttempt(null);
      setCart({});
      setOrderNotes("");
      setTipAmount("");
      setCartOpen(false);
      const nextPendingOrderId = data.orderId || "";
      setPendingOrderId(nextPendingOrderId);
      setPendingStatus(data.status || "AWAITING_WAITER_APPROVAL");
      setPendingOrderRestored(false);
      if (nextPendingOrderId) {
        try {
          sessionStorage.setItem(`tepsy:qr-pending:${token}`, nextPendingOrderId);
          sessionStorage.setItem(`restopos:qr-pending:${token}`, nextPendingOrderId);
        } catch (error) {
          console.warn("QR order state could not be saved:", error);
        }
      }
      setNotice({ tone: "success", text: `${copy.orderAccepted} ${copy.waiting}` });
    } catch (error) {
      console.error("Public QR order could not be submitted:", error);
      setNotice({ tone: "error", text: error.definitive ? copy.orderRejected : copy.orderError });
    } finally {
      setOrderBusy(false);
    }
  };

  const withdrawOrder = async () => {
    if (!token || !pendingOrderId || cancelBusy) return;
    setCancelBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/public/orders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, orderId: pendingOrderId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.status !== "CANCELLED") {
        if (response.status === 409) {
          // Approval may race with withdrawal. Keep tracking the accepted order.
          const query = new URLSearchParams({ token, orderId: pendingOrderId });
          const latest = await fetch(`/api/public/orders?${query}`, { cache: "no-store" });
          if (latest.ok) {
            const current = await latest.json();
            setPendingStatus(current.status || "");
          }
        }
        throw new Error(data.error || "order-withdraw-failed");
      }
      try {
        sessionStorage.removeItem(`tepsy:qr-pending:${token}`);
        sessionStorage.removeItem(`restopos:qr-pending:${token}`);
      } catch {
        /* Storage can be unavailable in private mode. */
      }
      setPendingOrderId("");
      setPendingStatus("");
      setPendingOrderRestored(false);
      setNotice({ tone: "success", text: copy.orderCancelled });
    } catch (error) {
      console.error("Public QR order could not be withdrawn:", error);
      setNotice({ tone: "error", text: copy.cancelError });
    } finally {
      setCancelBusy(false);
    }
  };

  const sendServiceRequest = async (type) => {
    if (!token || serviceBusy || loading || loadError || !menu || serviceUntil[type] > Date.now())
      return;
    setServiceBusy(type);
    setNotice(null);
    try {
      const response = await fetch("/api/public/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, type }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok || response.status === 429) {
        const seconds =
          response.status === 429
            ? Math.max(1, Math.min(300, Number(data.retryAfterSeconds) || 60))
            : 60;
        const current = Date.now();
        setNow(current);
        setServiceUntil((values) => ({ ...values, [type]: current + seconds * 1000 }));
      }
      if (response.status === 429) {
        setNotice({ tone: "success", text: copy.requestWaiting });
        return;
      }
      if (!response.ok) throw new Error(data.error || "service-request-failed");
      setNotice({ tone: "success", text: type === "WAITER" ? copy.sendWaiter : copy.sendBill });
    } catch (error) {
      console.error("Public QR service request failed:", error);
      setNotice({ tone: "error", text: copy.requestError });
    } finally {
      setServiceBusy("");
    }
  };

  const pendingMessage =
    pendingStatus === "PENDING"
      ? isTr
        ? "Garson siparişinizi onayladı."
        : "Your order was accepted by the waiter."
      : pendingStatus === "PREPARING"
        ? isTr
          ? "Siparişiniz hazırlanıyor."
          : "Your order is being prepared."
        : pendingStatus === "READY"
          ? isTr
            ? "Siparişiniz hazır."
            : "Your order is ready."
          : pendingStatus === "DELIVERED" || pendingStatus === "PAID"
            ? isTr
              ? "Siparişiniz servis edildi."
              : "Your order has been served."
            : pendingOrderRestored
              ? copy.restored
              : copy.waiting;

  const publicCartProps = {
    cartItems,
    cartTotal,
    copy,
    formatPrice,
    lang,
    menu,
    onNoteChange: (value) => setOrderNotes(value.slice(0, 500)),
    onSubmit: submitOrder,
    onUpdateQuantity: updateQuantity,
    orderBusy,
    orderAttempt,
    orderAttemptReady,
    orderNotes,
    tipAmount,
    onTipChange: setTipAmount,
  };

  return (
    <div className="service-root service-qr-root customer-experience">
      <header className="service-toolbar service-qr-toolbar">
        <div className="service-toolbar-leading">
          <span className="service-brand-mark" aria-hidden="true">
            <RestaurantIdentity
              name={menu?.restaurant?.name}
              logoUrl={menu?.restaurant?.logoUrl || null}
            />
          </span>
          <div className="service-heading-copy">
            <p className="service-eyebrow">{copy.menu}</p>
            <h1>{menu?.restaurant?.name || "TEPSY"}</h1>
            {tableLabel && <p className="service-qr-table-label">{displayTable}</p>}
          </div>
        </div>
        <div className="service-toolbar-actions">
          {tableLabel && <span className="qr-table-badge">{displayTable}</span>}
          <div
            className="service-segmented service-language-switch"
            role="group"
            aria-label={isTr ? "Dil" : "Language"}
          >
            <button type="button" onClick={() => setLang("tr")} aria-pressed={lang === "tr"}>
              TR
            </button>
            <button type="button" onClick={() => setLang("en")} aria-pressed={lang === "en"}>
              EN
            </button>
          </div>
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            aria-expanded={cartOpen}
            className="service-button service-button-primary service-mobile-cart-trigger"
          >
            <ShoppingBag aria-hidden="true" />
            {copy.cart}
            <span className="service-count-badge">{cartCount}</span>
          </button>
        </div>
      </header>

      {!loading && !loadError && (
        <section className="qr-welcome">
          <div>
            <p className="service-eyebrow">{isTr ? "Hoş geldiniz" : "Welcome"}</p>
            <h2>{copy.welcome}</h2>
            <p className="qr-intro">{copy.intro}</p>
          </div>
          <span className="qr-welcome-icon" aria-hidden="true">
            <Utensils />
          </span>
        </section>
      )}

      <section
        className="qr-hospitality"
        aria-label={isTr ? "Servis istekleri" : "Service requests"}
      >
        <p>{copy.serviceHint}</p>
        <div className="service-qr-service-actions">
          {[
            { type: "WAITER", label: copy.waiter, Icon: Bell },
            { type: "BILL", label: copy.bill, Icon: ReceiptText },
          ].map(({ type, label, Icon }) => {
            const remaining = Math.max(0, Math.ceil(((serviceUntil[type] || 0) - now) / 1000));
            return (
              <div key={type} className="qr-service-option">
                <button
                  type="button"
                  aria-label={label}
                  onClick={() => sendServiceRequest(type)}
                  disabled={loading || loadError || !menu || Boolean(serviceBusy) || remaining > 0}
                  className="service-button service-button-quiet"
                >
                  {serviceBusy === type ? (
                    <span className="service-spinner" aria-hidden="true" />
                  ) : remaining > 0 ? (
                    <Check aria-hidden="true" />
                  ) : (
                    <Icon aria-hidden="true" />
                  )}
                  {label}
                </button>
                {remaining > 0 && (
                  <small>
                    {copy.sent} · {remaining} {copy.seconds}
                  </small>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {notice && (
        <div
          className={`service-notice ${notice.tone === "error" ? "is-error" : "is-success"}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.tone === "error" ? (
            <CircleAlert aria-hidden="true" />
          ) : (
            <Check aria-hidden="true" />
          )}
          <p>{notice.text}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label={isTr ? "Bildirimi kapat" : "Dismiss notice"}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      )}

      {pendingOrderId && (
        <section data-testid="qr-order-pending" className="service-qr-pending" aria-live="polite">
          <div>
            <span className="service-eyebrow">{isTr ? "Sipariş durumu" : "Order status"}</span>
            <p>{pendingMessage}</p>
          </div>
          {(!pendingStatus || pendingStatus === "AWAITING_WAITER_APPROVAL") && (
            <button
              type="button"
              onClick={withdrawOrder}
              disabled={cancelBusy}
              className="service-button service-button-quiet"
            >
              {cancelBusy ? (
                <span className="service-spinner" aria-hidden="true" />
              ) : (
                <X aria-hidden="true" />
              )}
              {cancelBusy ? copy.withdrawing : copy.withdraw}
            </button>
          )}
        </section>
      )}

      <div className="service-qr-workspace">
        <section className="service-work-panel service-qr-products-panel" aria-label={copy.menu}>
          {loading ? (
            <div className="service-loading service-qr-state" role="status">
              <LoaderCircle className="service-loading-icon" aria-hidden="true" />
              {copy.loading}
            </div>
          ) : loadError ? (
            <div className="service-empty-state service-qr-state" role="alert">
              <CircleAlert aria-hidden="true" />
              <p>{copy.loadError}</p>
              <button
                type="button"
                onClick={() => setReload((value) => value + 1)}
                className="service-button service-button-quiet"
              >
                {copy.retry}
              </button>
            </div>
          ) : (
            <>
              {!menu?.orderingEnabled && (
                <div className="service-ordering-closed">
                  <strong>{copy.orderingClosed}</strong>
                  <p>{copy.closedHint}</p>
                </div>
              )}
              <div className="service-qr-tools">
                <div className="qr-search">
                  <Search aria-hidden="true" />
                  <input
                    type="search"
                    aria-label={copy.search}
                    placeholder={copy.searchPlaceholder}
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setProductPage(1);
                    }}
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearch("");
                        setProductPage(1);
                      }}
                      aria-label={isTr ? "Aramayı temizle" : "Clear search"}
                    >
                      <X aria-hidden="true" />
                    </button>
                  )}
                </div>
                <div className="qr-category-chips" role="group" aria-label={copy.category}>
                  {[
                    { id: "ALL", name: copy.all },
                    ...categories.filter((category) =>
                      items.some((item) => item.categoryId === category.id)
                    ),
                  ].map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      aria-label={category.name}
                      aria-pressed={categoryId === category.id}
                      onClick={() => {
                        setCategoryId(category.id);
                        setProductPage(1);
                      }}
                    >
                      {category.name}
                      <span aria-hidden="true">
                        {category.id === "ALL"
                          ? items.length
                          : items.filter((item) => item.categoryId === category.id).length}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="qr-results">
                  <h2>
                    {categoryId === "ALL"
                      ? copy.menu
                      : categories.find((category) => category.id === categoryId)?.name}
                  </h2>
                  <span className="service-result-count" role="status">
                    {visibleItems.length} {copy.itemCount}
                  </span>
                </div>
              </div>
              {visibleItems.length === 0 ? (
                <div className="service-empty-state service-qr-empty">
                  <Search aria-hidden="true" />
                  <p>{search || categoryId !== "ALL" ? copy.noResults : copy.empty}</p>
                  {(search || categoryId !== "ALL") && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearch("");
                        setCategoryId("ALL");
                        setProductPage(1);
                      }}
                      className="service-button service-button-quiet"
                    >
                      {copy.clearFilters}
                    </button>
                  )}
                </div>
              ) : (
                <div className="service-qr-product-scroll">
                  <div className="service-qr-product-grid">
                    {productPages.items.map((item) => {
                      const quantity = cart[item.id] || 0;
                      const unavailable = item.isAvailable === false;
                      return (
                        <article
                          key={item.id}
                          className={`service-qr-product ${unavailable ? "is-unavailable" : ""}`}
                        >
                          <MenuPhoto
                            src={item.imageUrl}
                            name={item.name}
                            className="menu-photo-qr"
                          />
                          <div className="service-qr-product-copy">
                            <span className="qr-product-category">
                              {categories.find((category) => category.id === item.categoryId)?.name}
                            </span>
                            <h3 aria-label={item.name}>
                              <button
                                type="button"
                                className="qr-product-details"
                                onClick={() => setDetailItem(item)}
                                aria-label={`${item.name} ${copy.details}`}
                              >
                                {item.name}
                                <ChevronRight aria-hidden="true" />
                              </button>
                            </h3>
                            {item.description && <p>{item.description}</p>}
                            {quantity > 0 && (
                              <span className="qr-product-selected">
                                {copy.selected} · {quantity}
                              </span>
                            )}
                          </div>
                          <div className="service-qr-product-action">
                            <strong>{formatPrice(item.price)}</strong>
                            <button
                              type="button"
                              disabled={
                                !menu?.orderingEnabled ||
                                unavailable ||
                                Boolean(orderAttempt) ||
                                orderBusy ||
                                !orderAttemptReady ||
                                quantity >= MAX_QUANTITY ||
                                (!quantity && cartItems.length >= MAX_PRODUCTS)
                              }
                              onClick={() => updateQuantity(item.id, 1)}
                              aria-label={`${item.name} ${copy.add}`}
                              className="service-button service-button-primary"
                            >
                              <Plus aria-hidden="true" />
                              {quantity > 0 ? (
                                <span className="service-count-badge">{quantity}</span>
                              ) : (
                                copy.add
                              )}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className="qr-cart-limits">{copy.cartLimits}</p>
              {productPages.pageCount > 1 && (
                <PageControls
                  page={productPages.page}
                  pageCount={productPages.pageCount}
                  total={productPages.total}
                  start={productPages.start}
                  end={productPages.end}
                  onChange={productPages.setPage}
                  label={isTr ? "Menü ürünleri" : "Menu products"}
                />
              )}
            </>
          )}
        </section>

        <aside className="service-work-panel service-qr-cart-dock" aria-label={copy.cart}>
          <PublicCart {...publicCartProps} />
        </aside>
      </div>

      <div className="service-mobile-action-bar service-qr-mobile-action">
        <div>
          <span>{copy.cart}</span>
          <strong>
            {formatPrice(cartTotal + (Number(String(tipAmount).replace(",", ".")) || 0))}
          </strong>
        </div>
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          className="service-button service-button-primary"
        >
          <ShoppingBag aria-hidden="true" />
          {copy.cart}
          <span className="service-count-badge">{cartCount}</span>
        </button>
      </div>

      <Dialog
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        title={`${copy.cart} · ${cartCount} ${copy.itemCount}`}
        className="service-mobile-sheet service-qr-sheet"
      >
        <PublicCart {...publicCartProps} />
      </Dialog>
      <Dialog
        open={Boolean(detailItem)}
        onClose={() => setDetailItem(null)}
        title={detailItem?.name || copy.menu}
        className="qr-detail-dialog"
      >
        {detailItem && (
          <div className="qr-detail-content">
            <MenuPhoto
              src={detailItem.imageUrl}
              name={detailItem.name}
              className="menu-photo-detail"
            />
            <span className="qr-product-category">
              {categories.find((category) => category.id === detailItem.categoryId)?.name}
            </span>
            <p>
              {detailItem.description ||
                (isTr
                  ? "Ürün hakkında bilgi almak için garsonunuza danışabilirsiniz."
                  : "Ask your waiter for more information about this product.")}
            </p>
            <strong>{formatPrice(detailItem.price)}</strong>
            <button
              type="button"
              className="service-button service-button-quiet"
              onClick={() => setDetailItem(null)}
            >
              {copy.backToMenu}
            </button>
          </div>
        )}
      </Dialog>
      <footer className="service-qr-footer">
        <LegalLinks />
      </footer>
    </div>
  );
}
