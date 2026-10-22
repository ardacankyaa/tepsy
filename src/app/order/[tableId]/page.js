"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSocket } from "@/lib/socket-client";
import soundEngine from "@/lib/sound.mjs";
import { useApp } from "@/lib/AppContext";
import {
  clearOrderAttempt,
  isDefinitiveOrderRejection,
  orderRejectionMessage,
  restoreOrderAttempt,
  restoreOrCreateOrderAttempt,
} from "@/lib/order-idempotency.mjs";
import FloorPlanView from "@/components/FloorPlanView";
import MenuPhoto from "@/components/ui/MenuPhoto";
import { Dialog, PageControls, ScrollPanel, usePages } from "@/components/ui/Workspace";
import {
  ArrowLeft,
  BellRing,
  Check,
  CircleAlert,
  MapPinned,
  Minus,
  Plus,
  Search,
  Send,
  ShoppingCart,
  X,
} from "lucide-react";
import "@/styles/service.css";

function OrderCart({
  activeOrders,
  cart,
  cartTotal,
  formatPrice,
  isSubmitting,
  lang,
  orderNotes,
  onClear,
  onNoteChange,
  onSubmit,
  onUpdateQuantity,
  orderAttempt,
  orderAttemptReady,
  t,
}) {
  const isTr = lang === "tr";
  const orderNoteId = useId();
  const activeTotal = activeOrders.reduce((sum, order) => sum + Number(order.totalPrice || 0), 0);
  const itemName = (item) => item.menuItemName || item.menuItem?.name || item.name || t("item");

  return (
    <div className="service-order-cart-content">
      <div className="service-cart-heading">
        <div>
          <h2>{t("cart")}</h2>
          <p>{isTr ? "Gönderilmiş sipariş ve yeni taslak" : "Sent orders and the new draft"}</p>
        </div>
        {cart.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            disabled={Boolean(orderAttempt) || isSubmitting}
            className="service-text-button"
          >
            {t("clear")}
          </button>
        )}
      </div>

      {activeOrders.length > 0 && (
        <section
          className="service-sent-orders"
          aria-label={isTr ? "Gönderilmiş siparişler" : "Sent orders"}
        >
          <div className="service-cart-section-heading">
            <h3>{isTr ? "Gönderildi" : "Sent"}</h3>
            <span>{activeOrders.length}</span>
          </div>
          <ScrollPanel
            className="service-sent-order-scroll"
            label={isTr ? "Gönderilmiş sipariş satırları" : "Sent order lines"}
          >
            {activeOrders.map((order) => {
              const orderLines = (order.items || []).map((item, index) => ({
                ...item,
                key: item.id || `${order.id}-${index}`,
              }));
              return (
                <div key={order.id} className="service-sent-order">
                  <div className="service-sent-order-meta">
                    <span className="service-status-label service-status-sent">
                      {{
                        AWAITING_WAITER_APPROVAL: isTr
                          ? "Garson onayı bekliyor"
                          : "Awaiting waiter approval",
                        PENDING: isTr ? "Bekliyor" : "Pending",
                        PREPARING: isTr ? "Hazırlanıyor" : "Preparing",
                        READY: isTr ? "Hazır" : "Ready",
                        DELIVERED: isTr ? "Teslim edildi" : "Delivered",
                        PAID: isTr ? "Ödendi" : "Paid",
                        CANCELLED: isTr ? "İptal edildi" : "Cancelled",
                      }[order.status] || (isTr ? "Gönderildi" : "Sent")}
                    </span>
                    {order.createdAt && (
                      <time dateTime={order.createdAt}>
                        {new Date(order.createdAt).toLocaleTimeString(isTr ? "tr-TR" : "en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    )}
                    <strong>{formatPrice(Number(order.totalPrice || 0))}</strong>
                  </div>
                  <div className="service-order-lines service-order-lines-readonly">
                    {orderLines.map((item) => (
                      <div key={item.key} className="service-order-line">
                        <span className="service-line-quantity">{item.quantity}</span>
                        <span className="service-line-name">
                          {itemName(item)}
                          {item.notes && <small>{item.notes}</small>}
                        </span>
                        <span className="service-line-price">
                          {formatPrice(
                            Number(item.unitPrice || item.menuItem?.price || 0) *
                              Number(item.quantity || 0)
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                  {order.notes && (
                    <p className="service-sent-note">
                      <strong>{isTr ? "Not" : "Note"}:</strong> {order.notes}
                    </p>
                  )}
                </div>
              );
            })}
          </ScrollPanel>
          <div className="service-sent-total">
            <span>{isTr ? "Açık hesap" : "Open bill"}</span>
            <strong>{formatPrice(activeTotal)}</strong>
          </div>
        </section>
      )}

      <section
        className="service-draft-section"
        aria-label={isTr ? "Yeni sipariş taslağı" : "New order draft"}
      >
        <div className="service-cart-section-heading">
          <h3>{isTr ? "Yeni eklenecekler" : "New items"}</h3>
          <span>{cart.reduce((sum, item) => sum + item.quantity, 0)}</span>
        </div>
        <ScrollPanel
          className="service-draft-scroll"
          label={isTr ? "Taslak sipariş satırları" : "Draft order lines"}
        >
          {cart.length === 0 ? (
            <div className="service-empty-inline">
              <ShoppingCart aria-hidden="true" />
              <p>{t("cartEmpty")}</p>
            </div>
          ) : (
            <div className="service-order-lines">
              {cart.map((item) => (
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
                      disabled={Boolean(orderAttempt) || isSubmitting}
                      onClick={() => onUpdateQuantity(item.id, -1)}
                      aria-label={`${item.name} ${isTr ? "azalt" : "decrease"}`}
                    >
                      <Minus aria-hidden="true" />
                    </button>
                    <span aria-live="polite">{item.quantity}</span>
                    <button
                      type="button"
                      disabled={Boolean(orderAttempt) || isSubmitting}
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
      </section>

      <div className="service-cart-footer">
        <label className="service-note-label" htmlFor={orderNoteId}>
          {isTr ? "Sipariş notu" : "Order note"}
          <span>{isTr ? "İsteğe bağlı" : "Optional"}</span>
        </label>
        <textarea
          id={orderNoteId}
          value={orderNotes}
          onChange={(event) => onNoteChange(event.target.value)}
          disabled={Boolean(orderAttempt) || isSubmitting || !orderAttemptReady}
          rows={2}
          placeholder={isTr ? "Mutfağa iletilecek not" : "Note for the kitchen"}
        />
        {orderAttempt && (
          <p className="service-action-hint" role="status">
            {isTr
              ? "Sipariş sonucu doğrulanamadı. Aynı taslağı yeniden gönderin; içeriği kilitli."
              : "The order result could not be confirmed. Retry the same draft; its contents are locked."}
          </p>
        )}
        <div className="service-total-row service-total-emphasis">
          <span>{isTr ? "Toplam" : "Total"}</span>
          <strong>{formatPrice(activeTotal + cartTotal)}</strong>
        </div>
        <button
          type="button"
          onClick={onSubmit}
          disabled={(!orderAttempt && cart.length === 0) || isSubmitting || !orderAttemptReady}
          className="service-button service-button-primary service-submit-order"
        >
          {isSubmitting ? (
            <span className="service-spinner" aria-hidden="true" />
          ) : (
            <Send aria-hidden="true" />
          )}
          {isSubmitting
            ? t("submitting")
            : orderAttempt
              ? isTr
                ? "Siparişi yeniden dene"
                : "Retry same order"
              : t("submitOrderToKitchen")}
        </button>
        {isSubmitting && (
          <p className="service-action-hint" role="status">
            {isTr ? "Sipariş mutfağa iletiliyor…" : "Sending order to the kitchen…"}
          </p>
        )}
      </div>
    </div>
  );
}

export default function TableOrderPage() {
  const params = useParams();
  const router = useRouter();
  const tableId = typeof params?.tableId === "string" ? params.tableId : "";
  const { socket } = useSocket();
  const { t, formatPrice, lang } = useApp();
  const isTr = lang === "tr";

  const [table, setTable] = useState(null);
  const [allTables, setAllTables] = useState([]);
  const [floorElements, setFloorElements] = useState([]);
  const [floorSection, setFloorSection] = useState("");
  const [categories, setCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [cart, setCart] = useState([]);
  const [orderNotes, setOrderNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderAttempt, setOrderAttempt] = useState(null);
  const [orderAttemptReady, setOrderAttemptReady] = useState(false);
  const orderAttemptRef = useRef(null);
  const [activeOrders, setActiveOrders] = useState([]);
  const [billRequested, setBillRequested] = useState(false);
  const [notification, setNotification] = useState(null);
  const [dataError, setDataError] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [pendingTableId, setPendingTableId] = useState("");
  const loadRequestRef = useRef(0);
  const notificationTimeoutRef = useRef(null);
  const orderAttemptStorageKey = `tepsy:order-attempt:staff:${tableId}`;

  const showNotification = useCallback((message, tone = "success") => {
    setNotification({ message, tone });
    window.clearTimeout(notificationTimeoutRef.current);
    if (tone === "success") {
      notificationTimeoutRef.current = window.setTimeout(() => setNotification(null), 3600);
    }
  }, []);

  const loadData = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setDataLoading(true);
    try {
      const [tableRes, catRes, itemsRes, ordersRes, elementsRes] = await Promise.all([
        fetch("/api/tables", { cache: "no-store" }),
        fetch("/api/categories", { cache: "no-store" }),
        fetch("/api/menu-items?availableOnly=true", { cache: "no-store" }),
        fetch(`/api/orders?tableId=${encodeURIComponent(tableId)}&activeOnly=true`, {
          cache: "no-store",
        }),
        fetch("/api/floor-elements", { cache: "no-store" }),
      ]);
      if (requestId !== loadRequestRef.current) return;
      if (![tableRes, catRes, itemsRes, ordersRes, elementsRes].every((response) => response.ok)) {
        throw new Error("Order data could not be refreshed");
      }

      const [tables, nextCategories, nextItems, nextOrders, elements] = await Promise.all([
        tableRes.json(),
        catRes.json(),
        itemsRes.json(),
        ordersRes.json(),
        elementsRes.json(),
      ]);
      if (requestId !== loadRequestRef.current) return;
      setAllTables(Array.isArray(tables) ? tables : []);
      const currentTable =
        (Array.isArray(tables) ? tables : []).find((item) => item.id === tableId) || null;
      setTable(currentTable);
      setFloorSection((current) => current || currentTable?.section || tables[0]?.section || "");
      setBillRequested(currentTable?.status === "BILL_REQUESTED");
      setCategories(Array.isArray(nextCategories) ? nextCategories : []);
      setMenuItems(Array.isArray(nextItems) ? nextItems : []);
      setActiveOrders(Array.isArray(nextOrders) ? nextOrders : []);
      setFloorElements(Array.isArray(elements) ? elements : []);
      setDataError(false);
    } catch (error) {
      console.error("Order data could not be loaded:", error);
      if (requestId === loadRequestRef.current) {
        setDataError(true);
        showNotification(
          isTr
            ? "Sipariş verileri yenilenemedi. Tekrar deneyin."
            : "Order data could not be refreshed. Try again.",
          "error"
        );
      }
    } finally {
      if (requestId === loadRequestRef.current) setDataLoading(false);
    }
  }, [tableId, isTr, showNotification]);

  useEffect(() => {
    setOrderAttemptReady(false);
    const attempt = restoreOrderAttempt(orderAttemptStorageKey, "tableId", tableId);
    orderAttemptRef.current = attempt;
    setOrderAttempt(attempt);
    setOrderAttemptReady(true);
  }, [orderAttemptStorageKey, tableId]);

  useEffect(() => {
    if (!orderAttempt) return;
    const payload = JSON.parse(orderAttempt.body);
    const restoredItems = (Array.isArray(payload.items) ? payload.items : []).map((entry) => {
      const item = menuItems.find((candidate) => candidate.id === entry.menuItemId);
      return {
        ...(item || {
          id: entry.menuItemId,
          name: entry.menuItemName || (isTr ? "Ürün" : "Item"),
          price: 0,
        }),
        quantity: entry.quantity,
        notes: entry.notes || "",
      };
    });
    setCart(restoredItems);
    setOrderNotes(payload.notes || "");
  }, [isTr, menuItems, orderAttempt]);

  useEffect(() => {
    loadData();
    return () => {
      loadRequestRef.current += 1;
      window.clearTimeout(notificationTimeoutRef.current);
    };
  }, [loadData]);

  useEffect(() => {
    setIsConnected(Boolean(socket?.connected));
    if (!socket) return;
    const handleConnect = () => setIsConnected(true);
    const handleDisconnect = () => setIsConnected(false);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    const handleUpdate = () => loadData();
    const handleOrderUpdate = (order) => {
      if (order.tableId === tableId) {
        loadData();
        if (order.status === "READY") {
          soundEngine.playReady();
          showNotification(`🎉 ${t("readyAction")}`);
        }
      }
    };
    socket.on("order:new", handleUpdate);
    socket.on("order:update", handleOrderUpdate);
    socket.on("table:update", handleUpdate);
    socket.on("payment:completed", handleUpdate);
    socket.on("floor-elements:update", handleUpdate);
    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("order:new", handleUpdate);
      socket.off("order:update", handleOrderUpdate);
      socket.off("table:update", handleUpdate);
      socket.off("payment:completed", handleUpdate);
      socket.off("floor-elements:update", handleUpdate);
    };
  }, [socket, tableId, loadData, showNotification, t]);

  const addToCart = (item) => {
    if (orderAttemptRef.current || !orderAttemptReady) return;
    setCart((current) => {
      const existing = current.find((entry) => entry.id === item.id);
      if (existing)
        return current.map((entry) =>
          entry.id === item.id ? { ...entry, quantity: entry.quantity + 1 } : entry
        );
      return [...current, { ...item, quantity: 1, notes: "" }];
    });
  };

  const updateQuantity = (itemId, delta) => {
    if (orderAttemptRef.current || !orderAttemptReady) return;
    setCart((current) =>
      current.flatMap((item) => {
        if (item.id !== itemId) return [item];
        const quantity = item.quantity + delta;
        return quantity <= 0 ? [] : [{ ...item, quantity }];
      })
    );
  };

  const clearDraft = () => {
    if (orderAttemptRef.current) return;
    setCart([]);
    setOrderNotes("");
  };

  const cartTotal = cart.reduce((sum, item) => sum + Number(item.price || 0) * item.quantity, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const activeTotal = activeOrders.reduce((sum, order) => sum + Number(order.totalPrice || 0), 0);
  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase(isTr ? "tr-TR" : "en-US");
    return menuItems.filter((item) => {
      const matchesCategory = selectedCategory === "ALL" || item.categoryId === selectedCategory;
      const matchesName =
        !query ||
        String(item.name || "")
          .toLocaleLowerCase(isTr ? "tr-TR" : "en-US")
          .includes(query);
      return matchesCategory && matchesName;
    });
  }, [menuItems, selectedCategory, searchQuery, isTr]);
  const productPages = usePages(filteredItems, 9);
  const floorSections = Array.from(new Set(allTables.map((item) => item.section))).sort((a, b) =>
    a.localeCompare(b, isTr ? "tr" : "en")
  );
  const tableName = table?.tableNumber || "—";
  const statusText =
    table?.status === "AVAILABLE"
      ? isTr
        ? "Boş"
        : "Available"
      : table?.status === "BILL_REQUESTED"
        ? t("billRequested")
        : table?.status === "CLEANING"
          ? isTr
            ? "Temizlikte"
            : "Cleaning"
          : isTr
            ? "Dolu"
            : "Occupied";

  const requestTableSwitch = (nextId) => {
    if (orderAttemptRef.current) {
      showNotification(
        isTr
          ? "Sipariş sonucu doğrulanana kadar masa değiştirilemez."
          : "The table cannot change until this order is confirmed.",
        "error"
      );
      return;
    }
    if (!nextId || nextId === tableId) {
      setTablePickerOpen(false);
      return;
    }
    setTablePickerOpen(false);
    if (cart.length > 0 || orderNotes.trim()) {
      setPendingTableId(nextId);
      return;
    }
    router.push(`/order/${nextId}`);
  };

  const confirmTableSwitch = () => {
    if (!pendingTableId || orderAttemptRef.current) return;
    clearDraft();
    setPendingTableId("");
    router.push(`/order/${pendingTableId}`);
  };

  const submitOrder = async () => {
    if (isSubmitting || !orderAttemptReady) return;
    const existingAttempt = orderAttemptRef.current;
    if (!existingAttempt && cart.length === 0) return;
    const payload = {
      tableId,
      items: cart.map((item) => ({
        menuItemId: item.id,
        quantity: item.quantity,
        notes: item.notes || null,
      })),
      notes: orderNotes || null,
    };
    const attempt =
      existingAttempt ||
      restoreOrCreateOrderAttempt(orderAttemptStorageKey, payload, "tableId", tableId);
    if (!attempt) {
      showNotification(
        isTr
          ? "Tarayıcı oturumu güvenli yeniden deneme için kaydedilemedi."
          : "The browser session could not save a safe retry.",
        "error"
      );
      return;
    }
    orderAttemptRef.current = attempt;
    setOrderAttempt(attempt);
    setIsSubmitting(true);
    setNotification(null);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: attempt.body,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        // An archived table is checked after replay lookup, so no order exists for this key.
        if (isDefinitiveOrderRejection(response.status) || result.code === "archived-table") {
          clearOrderAttempt(orderAttemptStorageKey);
          orderAttemptRef.current = null;
          setOrderAttempt(null);
        }
        const error = new Error(
          result.error || `Order request failed with status ${response.status}`
        );
        error.code = result.code;
        throw error;
      }
      clearOrderAttempt(orderAttemptStorageKey);
      orderAttemptRef.current = null;
      setOrderAttempt(null);
      clearDraft();
      soundEngine.playNewOrder();
      showNotification(t("orderSent"));
      setCartOpen(false);
      await loadData();
    } catch (error) {
      console.error(error);
      showNotification(
        orderRejectionMessage(error.code, isTr) ||
          (orderAttemptRef.current
            ? isTr
              ? "Sipariş sonucu doğrulanamadı. Aynı taslağı yeniden gönderin; içeriği kilitli."
              : "The order result could not be confirmed. Retry the same draft; its contents are locked."
            : isTr
              ? "Sipariş gönderilemedi; taslak ve not korundu."
              : "Order could not be sent; the draft and note are still here."),
        "error"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const requestBill = async () => {
    if (billRequested || activeOrders.length === 0) return;
    try {
      const response = await fetch("/api/tables", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: tableId, status: "BILL_REQUESTED" }),
      });
      if (!response.ok) throw new Error(`Bill request failed with status ${response.status}`);
      setBillRequested(true);
      soundEngine.playBillRequested();
      showNotification(t("billReqSent"));
    } catch (error) {
      console.error(error);
      showNotification(
        isTr ? "Hesap talebi gönderilemedi." : "Bill request could not be sent.",
        "error"
      );
    }
  };

  const orderCartProps = {
    activeOrders,
    cart,
    cartTotal,
    formatPrice,
    isSubmitting,
    lang,
    orderAttempt,
    orderAttemptReady,
    orderNotes,
    onClear: clearDraft,
    onNoteChange: setOrderNotes,
    onSubmit: submitOrder,
    onUpdateQuantity: updateQuantity,
    t,
  };

  return (
    <div className="service-root waiter-experience waiter-order-experience">
      <header className="service-toolbar service-order-toolbar">
        <div className="service-toolbar-leading">
          <button
            type="button"
            onClick={() => router.push("/order")}
            aria-label={t("back")}
            className="service-icon-button"
          >
            <ArrowLeft aria-hidden="true" />
          </button>
          <div className="service-heading-copy">
            <p className="service-eyebrow">{table?.section || (isTr ? "Salon" : "Dining room")}</p>
            <h1>{tableName}</h1>
          </div>
          <span
            className={`service-status-label ${table?.status === "BILL_REQUESTED" ? "service-status-bill" : table?.status === "AVAILABLE" ? "service-status-available" : "service-status-occupied"}`}
          >
            {statusText}
          </span>
        </div>
        <div className="service-toolbar-actions">
          <span
            className={`service-connection ${isConnected ? "is-connected" : "is-disconnected"}`}
            role="status"
          >
            <i aria-hidden="true" />
            {isConnected ? (isTr ? "Canlı" : "Live") : isTr ? "Bağlantı yok" : "Offline"}
          </span>
          <button
            type="button"
            onClick={() => setTablePickerOpen(true)}
            className="service-button service-button-quiet"
          >
            <MapPinned aria-hidden="true" />
            {isTr ? "Masa değiştir" : "Change table"}
          </button>
          {activeOrders.length > 0 && (
            <button
              type="button"
              onClick={requestBill}
              disabled={billRequested}
              className={`service-button ${billRequested ? "service-button-selected" : "service-button-quiet"}`}
            >
              <BellRing aria-hidden="true" />
              {billRequested ? t("billRequested") : t("requestBill")}
            </button>
          )}
        </div>
      </header>

      {notification && (
        <div
          className={`service-notice ${notification.tone === "error" ? "is-error" : "is-success"}`}
          role={notification.tone === "error" ? "alert" : "status"}
        >
          {notification.tone === "error" ? (
            <CircleAlert aria-hidden="true" />
          ) : (
            <Check aria-hidden="true" />
          )}
          <p>{notification.message}</p>
          <button
            type="button"
            onClick={() => setNotification(null)}
            aria-label={isTr ? "Bildirimi kapat" : "Dismiss notice"}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="service-order-workspace">
        <section
          className="service-work-panel service-products-panel"
          aria-label={t("allProducts")}
        >
          <div className="service-products-tools">
            <label className="service-search-field" htmlFor="order-product-search">
              <Search aria-hidden="true" />
              <input
                id="order-product-search"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  productPages.setPage(1);
                }}
                placeholder={t("searchItem")}
                autoComplete="off"
              />
            </label>
            <label className="service-category-picker" htmlFor="order-product-category">
              <span>{isTr ? "Kategori" : "Category"}</span>
              <select
                id="order-product-category"
                value={selectedCategory}
                onChange={(event) => {
                  setSelectedCategory(event.target.value);
                  productPages.setPage(1);
                }}
              >
                <option value="ALL">{t("allProducts")}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="service-products-heading">
            <div>
              <h2>
                {selectedCategory === "ALL"
                  ? t("allProducts")
                  : categories.find((category) => category.id === selectedCategory)?.name ||
                    t("allProducts")}
              </h2>
              <p>
                {isTr ? "Eklemek için ürüne dokunun" : "Choose a product to add it to the draft"}
              </p>
            </div>
            <span className="service-result-count">
              {filteredItems.length} {isTr ? "ürün" : "products"}
            </span>
          </div>

          {dataError && (
            <div className="service-inline-error" role="alert">
              <span>
                {isTr
                  ? "Menü ve masa verisi yenilenemedi."
                  : "Table and menu data could not be refreshed."}
              </span>
              <button type="button" onClick={loadData} className="service-text-button">
                {isTr ? "Yeniden dene" : "Retry"}
              </button>
            </div>
          )}

          {dataLoading ? (
            <div className="service-loading" role="status">
              {isTr ? "Menü ve masa bilgileri yükleniyor…" : "Loading menu and table information…"}
            </div>
          ) : !table ? (
            <div className="service-empty-state">
              <CircleAlert aria-hidden="true" />
              <p>
                {isTr
                  ? "Bu masa bulunamadı. Masa listesine dönün."
                  : "This table could not be found. Return to the table list."}
              </p>
              <button
                type="button"
                onClick={() => router.push("/order")}
                className="service-button service-button-quiet"
              >
                {isTr ? "Masaları aç" : "Open tables"}
              </button>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="service-empty-state">
              <p>
                {isTr ? "Aramanızla eşleşen ürün bulunamadı." : "No products match your search."}
              </p>
            </div>
          ) : (
            <ScrollPanel
              className="service-product-scroll"
              label={isTr ? "Ürün sonuçları" : "Product results"}
            >
              <div className="service-products-grid" aria-live="polite" aria-busy={isSubmitting}>
                {productPages.items.map((item) => {
                  const quantity = cart.find((entry) => entry.id === item.id)?.quantity || 0;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={Boolean(orderAttempt) || isSubmitting || !orderAttemptReady}
                      onClick={() => addToCart(item)}
                      className="service-product-tile"
                      aria-label={`${item.name}, ${formatPrice(item.price)}${quantity ? `, ${quantity} ${isTr ? "sepetinizde" : "in draft"}` : ""}`}
                    >
                      <MenuPhoto
                        src={item.imageUrl}
                        name={item.name}
                        className="menu-photo-waiter"
                      />
                      <span className="service-product-copy">
                        <strong>{item.name}</strong>
                        <span>
                          {item.category?.name ||
                            categories.find((category) => category.id === item.categoryId)?.name ||
                            ""}
                        </span>
                      </span>
                      <span className="service-product-price">{formatPrice(item.price)}</span>
                      <span className="service-product-add">
                        <Plus aria-hidden="true" />
                        {quantity > 0 && <b>{quantity}</b>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </ScrollPanel>
          )}
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
        </section>

        <aside className="service-work-panel service-order-dock" aria-label={t("cart")}>
          <OrderCart {...orderCartProps} />
        </aside>
      </div>

      <div className="service-mobile-action-bar">
        <div>
          <span>{isTr ? "Taslak" : "Draft"}</span>
          <strong>{formatPrice(activeTotal + cartTotal)}</strong>
        </div>
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          className="service-button service-button-primary"
        >
          <ShoppingCart aria-hidden="true" />
          {isTr ? "Adisyonu aç" : "Open order"}
          <span className="service-count-badge">{cartCount}</span>
        </button>
      </div>

      <Dialog
        open={tablePickerOpen}
        onClose={() => setTablePickerOpen(false)}
        title={isTr ? "Masa seç" : "Choose a table"}
        className="service-picker-dialog"
      >
        <div className="service-picker-tools">
          <label className="service-category-picker" htmlFor="order-floor-section">
            <span>{isTr ? "Bölüm" : "Section"}</span>
            <select
              id="order-floor-section"
              value={floorSection}
              onChange={(event) => setFloorSection(event.target.value)}
            >
              {floorSections.map((section) => (
                <option key={section} value={section}>
                  {section}
                </option>
              ))}
            </select>
          </label>
          <label className="service-category-picker" htmlFor="order-direct-table">
            <span>{isTr ? "Masa listesi" : "Table list"}</span>
            <select
              id="order-direct-table"
              value={tableId}
              onChange={(event) => requestTableSwitch(event.target.value)}
            >
              {allTables.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.tableNumber} · {item.section}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="service-picker-plan">
          {floorSection && (
            <FloorPlanView
              tables={allTables}
              elements={floorElements.filter((element) => element.section === floorSection)}
              section={floorSection}
              selectedTableId={tableId}
              onSelectTable={(nextTable) => requestTableSwitch(nextTable.id)}
            />
          )}
        </div>
      </Dialog>

      <Dialog
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        title={`${tableName} · ${t("cart")}`}
        className="service-mobile-sheet"
      >
        <OrderCart {...orderCartProps} />
      </Dialog>

      <Dialog
        open={Boolean(pendingTableId)}
        onClose={() => setPendingTableId("")}
        title={isTr ? "Taslak başka masaya geçmeyecek" : "The draft belongs to this table"}
        className="service-confirm-dialog"
      >
        <p className="service-confirm-copy">
          {isTr
            ? `Masa ${tableName} için gönderilmemiş ürün ve not var. Geçiş yaparsanız taslak silinir.`
            : `There are unsent items or a note for table ${tableName}. Switching will discard this draft.`}
        </p>
        <div className="service-dialog-actions">
          <button
            type="button"
            onClick={() => setPendingTableId("")}
            className="service-button service-button-quiet"
          >
            {isTr ? "Masa seçimine dön" : "Stay on this table"}
          </button>
          <button
            type="button"
            onClick={confirmTableSwitch}
            className="service-button service-button-danger"
          >
            {isTr ? "Taslağı sil ve geç" : "Discard draft and switch"}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
