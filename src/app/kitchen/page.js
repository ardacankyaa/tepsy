"use client";

import RestaurantIdentity from "@/components/RestaurantIdentity";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSocket } from "@/lib/socket-client";
import soundEngine from "@/lib/sound.mjs";
import { useApp } from "@/lib/AppContext";
import { PageControls, ScrollPanel, usePages } from "@/components/ui/Workspace";
import "@/styles/operations.css";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  CheckCircle2,
  ChefHat,
  Clock,
  Maximize2,
  Minimize2,
  Play,
  TicketCheck,
} from "lucide-react";

const KITCHEN_PAGE_SIZE = 6;

export default function KitchenKDSPage() {
  const { socket } = useSocket();
  const { t, lang } = useApp();
  const [orders, setOrders] = useState([]);
  const [filterTab, setFilterTab] = useState("ACTIVE");
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [newTicketIds, setNewTicketIds] = useState([]);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyOrderIds, setBusyOrderIds] = useState([]);
  const [mobilePane, setMobilePane] = useState("tickets");
  const orderSnapshotRef = useRef([]);
  const initializedOrdersRef = useRef(false);
  const fetchRequestRef = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/status", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (active) setRole(payload?.session?.role || null);
      })
      .catch(() => {
        if (active) setRole(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    setFullscreenError("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen)
        await document.documentElement.requestFullscreen();
      else throw new Error("fullscreen-unsupported");
    } catch {
      setFullscreenError(
        lang === "tr"
          ? "Tam ekran bu tarayıcıda kullanılamıyor."
          : "Full screen is unavailable in this browser."
      );
    }
  };

  const fetchOrders = useCallback(async () => {
    const requestId = ++fetchRequestRef.current;
    try {
      const response = await fetch("/api/orders?activeOnly=true", { cache: "no-store" });
      if (!response.ok) throw new Error(`kitchen-orders-${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("kitchen-orders-invalid-response");
      if (requestId !== fetchRequestRef.current) return;

      const previousIds = new Set(orderSnapshotRef.current.map((order) => order.id));
      if (initializedOrdersRef.current) {
        const addedIds = data
          .filter((order) => !previousIds.has(order.id))
          .map((order) => order.id);
        if (addedIds.length) {
          setNewTicketIds((current) => Array.from(new Set([...current, ...addedIds])));
        }
      }
      orderSnapshotRef.current = data;
      initializedOrdersRef.current = true;
      setOrders(data);
      setLoadError("");
    } catch (error) {
      if (requestId !== fetchRequestRef.current) return;
      console.error("Mutfak siparişleri alınamadı:", error);
      setLoadError(
        lang === "tr"
          ? "Siparişler alınamadı. Bağlantınızı kontrol edip yeniden deneyin."
          : "Orders could not be loaded. Check the connection and try again."
      );
    } finally {
      if (requestId === fetchRequestRef.current) setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    fetchOrders();
    return () => {
      fetchRequestRef.current += 1;
    };
  }, [fetchOrders]);

  useEffect(() => {
    if (!socket) return;

    const handleNewOrder = () => {
      fetchOrders();
      soundEngine.playNewOrder();
    };
    const handleOrderUpdate = () => fetchOrders();

    socket.on("connect", handleOrderUpdate);
    socket.on("order:new", handleNewOrder);
    socket.on("order:update", handleOrderUpdate);
    socket.on("payment:completed", handleOrderUpdate);

    return () => {
      socket.off("connect", handleOrderUpdate);
      socket.off("order:new", handleNewOrder);
      socket.off("order:update", handleOrderUpdate);
      socket.off("payment:completed", handleOrderUpdate);
    };
  }, [socket, fetchOrders]);

  const updateOrderStatus = async (orderId, newStatus) => {
    if (busyOrderIds.includes(orderId)) return;
    if (newStatus === "DELIVERED" && role !== "ADMIN") {
      setActionError(
        lang === "tr"
          ? "Bu geçiş için yönetici yetkisi gerekir."
          : "Administrator access is required for this transition."
      );
      return;
    }
    const previousOrder = orders.find((order) => order.id === orderId);
    if (!previousOrder) return;
    setBusyOrderIds((current) => [...current, orderId]);
    setActionError("");
    setOrders((previous) =>
      previous.map((order) => {
        if (order.id !== orderId) return order;
        const updatedItems = order.items?.map((item) => ({
          ...item,
          status: newStatus === "READY" || newStatus === "DELIVERED" ? "READY" : item.status,
        }));
        return { ...order, status: newStatus, items: updatedItems };
      })
    );

    try {
      const response = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!response.ok) throw new Error(`order-status-${response.status}`);
      if (newStatus === "READY") soundEngine.playReady();
    } catch (error) {
      console.error("Sipariş durumu kaydedilemedi:", error);
      setOrders((current) =>
        current.map((order) => (order.id === orderId ? previousOrder : order))
      );
      setSelectedOrderId(orderId);
      setActionError(
        lang === "tr"
          ? "Sipariş durumu kaydedilemedi. Değişiklik geri alındı."
          : "Order status could not be saved. The change was reverted."
      );
      fetchOrders();
    } finally {
      setBusyOrderIds((current) => current.filter((id) => id !== orderId));
    }
  };

  const updateItemStatus = async (orderId, itemId, currentStatus) => {
    if (busyOrderIds.includes(orderId)) return;
    const nextStatus = currentStatus === "READY" ? "PENDING" : "READY";
    const previousOrder = orders.find((order) => order.id === orderId);
    if (!previousOrder) return;
    setBusyOrderIds((current) => [...current, orderId]);
    setActionError("");
    setOrders((previous) =>
      previous.map((order) =>
        order.id === orderId
          ? {
              ...order,
              items: order.items?.map((item) =>
                item.id === itemId ? { ...item, status: nextStatus } : item
              ),
            }
          : order
      )
    );

    try {
      const response = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemStatusUpdate: { itemId, expectedStatus: currentStatus, status: nextStatus },
        }),
      });
      if (!response.ok) throw new Error(`order-item-status-${response.status}`);
    } catch (error) {
      console.error("Sipariş kalem durumu kaydedilemedi:", error);
      setOrders((current) =>
        current.map((order) => (order.id === orderId ? previousOrder : order))
      );
      setActionError(
        lang === "tr"
          ? "Ürün durumu kaydedilemedi. Değişiklik geri alındı."
          : "Item status could not be saved. The change was reverted."
      );
      fetchOrders();
    } finally {
      setBusyOrderIds((current) => current.filter((id) => id !== orderId));
    }
  };

  const getElapsedMinutes = (dateString) => {
    const createdAt = new Date(dateString).getTime();
    if (!Number.isFinite(createdAt)) return 0;
    return Math.max(0, Math.floor((currentTime - createdAt) / 60000));
  };

  const getElapsedSeconds = (dateString) => {
    const createdAt = new Date(dateString).getTime();
    if (!Number.isFinite(createdAt)) return 0;
    return Math.max(0, Math.floor(((currentTime - createdAt) % 60000) / 1000));
  };

  const filteredOrders = orders.filter((order) => {
    if (filterTab === "ACTIVE") return order.status === "PENDING" || order.status === "PREPARING";
    if (filterTab === "READY") return order.status === "READY";
    return order.status !== "PAID" && order.status !== "CANCELLED";
  });
  const pages = usePages(filteredOrders, KITCHEN_PAGE_SIZE);
  const setPage = pages.setPage;
  const selectedOrder = filteredOrders.find((order) => order.id === selectedOrderId) || null;

  useEffect(() => {
    setPage(1);
  }, [filterTab, setPage]);

  useEffect(() => {
    if (!filteredOrders.length) {
      if (selectedOrderId !== null) setSelectedOrderId(null);
      return;
    }
    if (!filteredOrders.some((order) => order.id === selectedOrderId)) {
      setSelectedOrderId(filteredOrders[0].id);
    }
  }, [filteredOrders, selectedOrderId]);

  const activeOrders = orders.filter(
    (order) => order.status === "PENDING" || order.status === "PREPARING"
  );
  const activeCount = activeOrders.length;
  const readyCount = orders.filter((order) => order.status === "READY").length;
  const allCount = orders.filter(
    (order) => order.status !== "PAID" && order.status !== "CANCELLED"
  ).length;
  const activeWaits = activeOrders.map((order) => getElapsedMinutes(order.createdAt));
  const overdueCount = activeWaits.filter((minutes) => minutes >= 10).length;
  const oldestWait = activeWaits.length ? Math.max(...activeWaits) : 0;
  const visibleIds = new Set(pages.items.map((order) => order.id));
  const pendingNewIds = newTicketIds.filter((id) =>
    filteredOrders.some((order) => order.id === id)
  );
  const newTicketsOutsidePage = pendingNewIds.filter((id) => !visibleIds.has(id)).length;
  const canMarkDelivered = role === "ADMIN";
  const labels =
    lang === "tr"
      ? {
          active: "Aktif bilet",
          overdue: "10 dk üzeri",
          oldest: "En uzun bekleme",
          enter: "Tam ekrana geç",
          exit: "Tam ekrandan çık",
          list: "Bilet kuyruğu",
          detail: "Seçili bilet",
          emptyDetail: "Ayrıntıları görmek için bir bilet seçin.",
          back: "Bilet listesine dön",
          ticket: "Bilet",
          ticketCount: (count) => `${count} ürün`,
          elapsed: "Geçen süre",
          newTickets: (count) => `${count} yeni bilet başka sayfada`,
          openNew: "Yeni bilete git",
          orderNote: "Sipariş notu",
          itemNote: "Ürün notu",
          status: "Durum",
          pending: "Bekliyor",
          preparing: "Hazırlanıyor",
          ready: "Hazır",
          delivered: "Teslim edildi",
          markReady: "Hazır olarak işaretle",
          markPreparing: "Hazırlığa başla",
          markDelivered: "Teslim edildi olarak işaretle",
        }
      : {
          active: "Active tickets",
          overdue: "Over 10 min",
          oldest: "Longest wait",
          enter: "Enter full screen",
          exit: "Exit full screen",
          list: "Ticket queue",
          detail: "Selected ticket",
          emptyDetail: "Select a ticket to see its details.",
          back: "Return to ticket list",
          ticket: "Ticket",
          ticketCount: (count) => `${count} items`,
          elapsed: "Elapsed time",
          newTickets: (count) => `${count} new tickets on another page`,
          openNew: "Go to new ticket",
          orderNote: "Order note",
          itemNote: "Item note",
          status: "Status",
          pending: "Pending",
          preparing: "Preparing",
          ready: "Ready",
          delivered: "Delivered",
          markReady: "Mark ready",
          markPreparing: "Start preparation",
          markDelivered: "Mark delivered",
        };

  const statusLabel = (status) =>
    ({
      PENDING: labels.pending,
      PREPARING: labels.preparing,
      READY: labels.ready,
      DELIVERED: labels.delivered,
    })[status] || status;

  const ticketTabs = [
    { id: "ACTIVE", label: t("pendingOrdersTab"), count: activeCount },
    { id: "READY", label: t("readyTab"), count: readyCount },
    { id: "ALL", label: t("allTab"), count: allCount },
  ];

  const handleTabKeyDown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = ticketTabs.findIndex((tab) => tab.id === filterTab);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? ticketTabs.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + ticketTabs.length) %
            ticketTabs.length;
    const next = ticketTabs[nextIndex];
    setFilterTab(next.id);
    document.getElementById(`kds-tab-${next.id}`)?.focus();
  };

  const openNewestTicket = () => {
    const nextTicket = [...pendingNewIds]
      .reverse()
      .find((id) => filteredOrders.some((order) => order.id === id));
    const nextIndex = filteredOrders.findIndex((order) => order.id === nextTicket);
    if (nextIndex < 0) return;
    pages.setPage(Math.floor(nextIndex / KITCHEN_PAGE_SIZE) + 1);
    setSelectedOrderId(nextTicket);
    setNewTicketIds((current) => current.filter((id) => !pendingNewIds.includes(id)));
    setMobilePane("detail");
  };

  const selectedElapsedMinutes = selectedOrder ? getElapsedMinutes(selectedOrder.createdAt) : 0;
  const selectedElapsedSeconds = selectedOrder ? getElapsedSeconds(selectedOrder.createdAt) : 0;
  const selectedIsUrgent =
    selectedElapsedMinutes >= 10 &&
    selectedOrder?.status !== "READY" &&
    selectedOrder?.status !== "DELIVERED";

  return (
    <div className={`operations-kds ${isFullscreen ? "is-fullscreen" : ""}`}>
      <header className="kds-toolbar">
        <div className="kds-brand">
          <span className="kds-brand-icon">
            <RestaurantIdentity />
          </span>
          <div>
            <p className="kds-eyebrow">{lang === "tr" ? "Mutfak" : "Kitchen"}</p>
            <h1>{t("kitchenScreenTitle")}</h1>
          </div>
        </div>

        <div
          className="kds-tabs"
          role="tablist"
          aria-label={lang === "tr" ? "Sipariş durumu" : "Order status"}
          onKeyDown={handleTabKeyDown}
        >
          {ticketTabs.map((tab) => (
            <button
              id={`kds-tab-${tab.id}`}
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filterTab === tab.id}
              aria-controls="kds-ticket-panel"
              tabIndex={filterTab === tab.id ? 0 : -1}
              className={filterTab === tab.id ? "is-selected" : ""}
              onClick={() => setFilterTab(tab.id)}
            >
              <span>{tab.label}</span>
              <span className="kds-tab-count">{tab.count}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={toggleFullscreen}
          aria-pressed={isFullscreen}
          className="kds-fullscreen-button"
        >
          {isFullscreen ? (
            <Minimize2 size={18} aria-hidden="true" />
          ) : (
            <Maximize2 size={18} aria-hidden="true" />
          )}
          <span>{isFullscreen ? labels.exit : labels.enter}</span>
        </button>
      </header>

      <section
        className="kds-metrics"
        aria-label={lang === "tr" ? "Mutfak bekleme ölçümleri" : "Kitchen wait metrics"}
      >
        <div className="kds-metric">
          <span>{labels.active}</span>
          <strong>{activeCount}</strong>
        </div>
        <div className={`kds-metric ${overdueCount ? "is-overdue" : ""}`}>
          <span>{labels.overdue}</span>
          <strong data-testid="kds-overdue-count">{overdueCount}</strong>
        </div>
        <div className="kds-metric">
          <span>{labels.oldest}</span>
          <strong data-testid="kds-oldest-wait">
            {oldestWait} {t("minuteShort")}
          </strong>
        </div>
      </section>

      {fullscreenError && (
        <p role="status" className="kds-inline-status">
          {fullscreenError}
        </p>
      )}
      {actionError && (
        <p role="alert" className="kds-inline-error">
          <AlertCircle size={18} aria-hidden="true" />
          {actionError}
        </p>
      )}
      {!loading && !loadError && newTicketsOutsidePage > 0 && (
        <div className="kds-new-tickets" role="status">
          <span>
            <TicketCheck size={17} aria-hidden="true" />
            {labels.newTickets(newTicketsOutsidePage)}
          </span>
          <button type="button" onClick={openNewestTicket}>
            {labels.openNew}
          </button>
        </div>
      )}

      <div className="kds-workspace" data-mobile-pane={mobilePane}>
        {loading ? (
          <div className="kds-empty-state" role="status">
            <Clock size={24} aria-hidden="true" />
            <p>{lang === "tr" ? "Mutfak yükleniyor…" : "Loading kitchen…"}</p>
          </div>
        ) : loadError ? (
          <div className="kds-empty-state">
            <AlertCircle size={24} aria-hidden="true" />
            <p>
              {lang === "tr"
                ? "Sipariş kuyruğu kullanılamıyor."
                : "The ticket queue is unavailable."}
              <button type="button" onClick={fetchOrders}>
                {lang === "tr" ? "Yeniden dene" : "Try again"}
              </button>
            </p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="kds-empty-state">
            <ChefHat size={28} aria-hidden="true" />
            <p>{t("noKitchenOrders")}</p>
            <span>
              {lang === "tr"
                ? "Yeni siparişler bu hatta anlık düşer."
                : "New orders appear here as they arrive."}
            </span>
          </div>
        ) : (
          <>
            <section className="kds-ticket-list" aria-labelledby="kds-ticket-list-title">
              <div className="kds-panel-heading">
                <div>
                  <h2 id="kds-ticket-list-title">{labels.list}</h2>
                  <span>
                    {filteredOrders.length} {lang === "tr" ? "bilet" : "tickets"}
                  </span>
                </div>
                <button
                  type="button"
                  className="kds-mobile-back"
                  onClick={() => setMobilePane("tickets")}
                >
                  <ArrowLeft size={17} aria-hidden="true" />
                  {labels.list}
                </button>
              </div>
              <div
                id="kds-ticket-panel"
                role="tabpanel"
                aria-labelledby={`kds-tab-${filterTab}`}
                className="kds-ticket-grid"
              >
                {pages.items.map((order) => {
                  const elapsed = getElapsedMinutes(order.createdAt);
                  const urgent =
                    elapsed >= 10 && order.status !== "READY" && order.status !== "DELIVERED";
                  const statusClass = order.status.toLowerCase();
                  return (
                    <button
                      key={order.id}
                      type="button"
                      className={`kds-ticket-card ${selectedOrderId === order.id ? "is-selected" : ""} ${urgent ? "is-overdue" : ""}`}
                      aria-pressed={selectedOrderId === order.id}
                      onClick={() => {
                        setSelectedOrderId(order.id);
                        setMobilePane("detail");
                      }}
                    >
                      <span className="kds-ticket-card-top">
                        <strong>{order.table?.tableNumber || "?"}</strong>
                        <span className={`kds-status-chip ${statusClass}`}>
                          {statusLabel(order.status)}
                        </span>
                      </span>
                      <span className="kds-ticket-card-meta">
                        <span>
                          {order.table?.section || (lang === "tr" ? "İç Mekan" : "Dining room")}
                        </span>
                        <span className={urgent ? "is-overdue-text" : ""}>
                          <Clock size={14} aria-hidden="true" />
                          {elapsed} {t("minuteShort")}
                        </span>
                      </span>
                      <span className="kds-ticket-card-summary">
                        <span>{labels.ticketCount(order.items?.length || 0)}</span>
                        <span>
                          {order.items?.[0]?.menuItemName ||
                            order.items?.[0]?.menuItem?.name ||
                            (lang === "tr" ? "Ürün yok" : "No items")}
                          {(order.items?.length || 0) > 1 ? ` +${order.items.length - 1}` : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {pages.pageCount > 1 && (
                <PageControls
                  page={pages.page}
                  pageCount={pages.pageCount}
                  total={pages.total}
                  start={pages.start}
                  end={pages.end}
                  onChange={pages.setPage}
                  label={labels.list}
                />
              )}
            </section>

            <section className="kds-ticket-detail" aria-labelledby="kds-detail-title">
              <div className="kds-panel-heading">
                <div>
                  <h2 id="kds-detail-title">{labels.detail}</h2>
                  <span>
                    {selectedOrder ? statusLabel(selectedOrder.status) : labels.emptyDetail}
                  </span>
                </div>
                <button
                  type="button"
                  className="kds-mobile-back"
                  onClick={() => setMobilePane("tickets")}
                >
                  <ArrowLeft size={17} aria-hidden="true" />
                  {labels.back}
                </button>
              </div>
              {selectedOrder ? (
                <>
                  <div className={`kds-detail-summary ${selectedIsUrgent ? "is-overdue" : ""}`}>
                    <div className="kds-detail-table">
                      <span className="kds-detail-table-number">
                        {selectedOrder.table?.tableNumber || "?"}
                      </span>
                      <span>
                        {selectedOrder.table?.section ||
                          (lang === "tr" ? "İç Mekan" : "Dining room")}
                      </span>
                    </div>
                    <div
                      className="kds-detail-time"
                      aria-label={`${labels.elapsed}: ${selectedElapsedMinutes} ${lang === "tr" ? "dakika" : "minutes"}`}
                    >
                      <Clock size={20} aria-hidden="true" />
                      <strong>
                        {String(selectedElapsedMinutes).padStart(2, "0")}:
                        {String(selectedElapsedSeconds).padStart(2, "0")}
                      </strong>
                      <span>{labels.elapsed}</span>
                    </div>
                    <span className={`kds-status-chip ${selectedOrder.status.toLowerCase()}`}>
                      {statusLabel(selectedOrder.status)}
                    </span>
                  </div>

                  <ScrollPanel
                    className="kds-detail-scroll"
                    label={`${labels.ticket} ${selectedOrder.table?.tableNumber || "?"}`}
                  >
                    <div className="kds-detail-content">
                      {selectedOrder.notes && (
                        <section className="kds-order-note">
                          <h3>
                            <AlertCircle size={17} aria-hidden="true" />
                            {labels.orderNote}
                          </h3>
                          <p>{selectedOrder.notes}</p>
                        </section>
                      )}
                      <div className="kds-item-list">
                        {(selectedOrder.items || []).map((item) => {
                          const isReady = item.status === "READY";
                          const name =
                            item.menuItemName ||
                            item.menuItem?.name ||
                            (lang === "tr" ? "Ürün" : "Item");
                          return (
                            <button
                              type="button"
                              key={item.id}
                              onClick={() =>
                                updateItemStatus(selectedOrder.id, item.id, item.status)
                              }
                              disabled={
                                busyOrderIds.includes(selectedOrder.id) ||
                                selectedOrder.status === "DELIVERED" ||
                                !["PENDING", "PREPARING", "READY"].includes(item.status)
                              }
                              aria-pressed={isReady}
                              aria-label={`${name}, ${statusLabel(item.status)}`}
                              className={`kds-item-row ${isReady ? "is-ready" : ""}`}
                            >
                              <span className="kds-item-quantity">{item.quantity}</span>
                              <span className="kds-item-copy">
                                <strong>{name}</strong>
                                {item.notes && (
                                  <span className="kds-item-note">
                                    <b>{labels.itemNote}:</b> {item.notes}
                                  </span>
                                )}
                              </span>
                              <span className={`kds-item-check ${isReady ? "is-ready" : ""}`}>
                                <Check size={18} aria-hidden="true" />
                              </span>
                            </button>
                          );
                        })}
                        {!(selectedOrder.items || []).length && (
                          <p className="kds-no-items">
                            {lang === "tr" ? "Bu bilette ürün yok." : "This ticket has no items."}
                          </p>
                        )}
                      </div>
                    </div>
                  </ScrollPanel>

                  <div className="kds-ticket-actions">
                    {selectedOrder.status === "PENDING" && (
                      <button
                        type="button"
                        onClick={() => updateOrderStatus(selectedOrder.id, "PREPARING")}
                        disabled={busyOrderIds.includes(selectedOrder.id)}
                        className="kds-primary-action"
                      >
                        <Play size={18} fill="currentColor" aria-hidden="true" />
                        {t("preparingAction")}
                      </button>
                    )}
                    {selectedOrder.status === "PREPARING" && (
                      <button
                        type="button"
                        onClick={() => updateOrderStatus(selectedOrder.id, "READY")}
                        disabled={busyOrderIds.includes(selectedOrder.id)}
                        className="kds-ready-action"
                      >
                        <CheckCircle2 size={19} aria-hidden="true" />
                        {t("readyAction")}
                      </button>
                    )}
                    {canMarkDelivered && selectedOrder.status === "READY" && (
                      <button
                        type="button"
                        onClick={() => updateOrderStatus(selectedOrder.id, "DELIVERED")}
                        disabled={busyOrderIds.includes(selectedOrder.id)}
                        className="kds-delivered-action"
                      >
                        <CheckCheck size={19} aria-hidden="true" />
                        {t("deliveredAction")}
                      </button>
                    )}
                    {selectedOrder.status === "READY" && !canMarkDelivered && (
                      <p className="kds-ready-hint">
                        <CheckCircle2 size={17} aria-hidden="true" />
                        {lang === "tr"
                          ? "Sipariş hazır. Garson tarafından teslim alınabilir."
                          : "Order is ready for the server to collect."}
                      </p>
                    )}
                    {selectedOrder.status === "DELIVERED" && (
                      <p className="kds-ready-hint">
                        <CheckCheck size={17} aria-hidden="true" />
                        {lang === "tr" ? "Sipariş teslim edildi." : "Order delivered."}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <div className="kds-empty-detail">
                  <TicketCheck size={28} aria-hidden="true" />
                  <p>{labels.emptyDetail}</p>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
