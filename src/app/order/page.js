"use client";

import RestaurantIdentity from "@/components/RestaurantIdentity";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSocket } from "@/lib/socket-client";
import FloorPlanView from "@/components/FloorPlanView";
import { useApp } from "@/lib/AppContext";
import { Dialog, PageControls, ScrollPanel, usePages } from "@/components/ui/Workspace";
import {
  Bell,
  Check,
  CircleAlert,
  LayoutGrid,
  List,
  Search,
  UtensilsCrossed,
  Users,
  X,
} from "lucide-react";
import "@/styles/service.css";
import TableCalls from "@/components/TableCalls";

const REQUEST_COPY = {
  tr: {
    qrTitle: "QR sipariş istekleri",
    serviceTitle: "Servis çağrıları",
    empty: "Bekleyen istek yok.",
    approve: "Onayla",
    reject: "Reddet",
    resolve: "Tamamla",
    waiter: "Garson çağrısı",
    bill: "Hesap isteği",
    loading: "İstekler yenileniyor…",
    error: "İstek kuyruğu alınamadı.",
    retry: "Yenile",
    actionError: "İstek güncellenemedi. Liste yenilendi.",
    orderNote: "Sipariş notu",
    minutes: "dk",
  },
  en: {
    qrTitle: "QR order requests",
    serviceTitle: "Service calls",
    empty: "No pending requests.",
    approve: "Approve",
    reject: "Reject",
    resolve: "Resolve",
    waiter: "Waiter call",
    bill: "Bill request",
    loading: "Refreshing requests…",
    error: "The request queue could not be loaded.",
    retry: "Refresh",
    actionError: "The request could not be updated. The list was refreshed.",
    orderNote: "Order note",
    minutes: "min",
  },
};

function RequestPanel({
  actionError,
  busyKey,
  copy,
  empty,
  error,
  icon: Icon,
  isLoading,
  items,
  lang,
  onAction,
  onPageChange,
  onRetry,
  page,
  pageCount,
  requestType,
  retryLabel,
  title,
  total,
  start,
  end,
  t,
}) {
  const isTr = lang === "tr";
  return (
    <section className="service-work-panel service-request-panel" aria-label={title}>
      <div className="service-request-heading">
        <div className="service-request-title">
          <span>
            <Icon aria-hidden="true" />
          </span>
          <div>
            <h2>{title}</h2>
            <p>
              {total} {isTr ? "bekleyen" : "waiting"}
            </p>
          </div>
        </div>
        <span className="service-request-count">{total}</span>
      </div>
      {error && (
        <div className="service-inline-error" role="alert">
          <span>{copy.error}</span>
          <button type="button" onClick={onRetry} className="service-text-button">
            {retryLabel}
          </button>
        </div>
      )}
      {actionError && (
        <p className="service-inline-error" role="alert">
          {copy.actionError}
        </p>
      )}
      {isLoading ? (
        <div className="service-loading" role="status">
          {copy.loading}
        </div>
      ) : total === 0 ? (
        <div className="service-empty-inline">
          <Check aria-hidden="true" />
          <p>{empty}</p>
        </div>
      ) : (
        <ScrollPanel className="service-request-scroll" label={title}>
          <div className="service-request-list">
            {items.map((request) => {
              const key = `${requestType === "qr" ? "/api/qr-requests" : "/api/service-requests"}:${request.id}`;
              const isBusy = busyKey === key;
              if (requestType === "qr") {
                const quantity =
                  request.items?.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || 0;
                return (
                  <article key={request.id} className="service-request-item service-qr-request">
                    <div className="service-request-item-top">
                      <div>
                        <h3>{request.tableLabel || t("table")}</h3>
                        <time dateTime={request.submittedAt || undefined}>
                          {request.submittedAt
                            ? new Date(request.submittedAt).toLocaleTimeString(
                                isTr ? "tr-TR" : "en-US",
                                { hour: "2-digit", minute: "2-digit" }
                              )
                            : "—"}
                        </time>
                      </div>
                      <span className="service-request-quantity">
                        {quantity} {isTr ? "ürün" : "items"}
                      </span>
                    </div>
                    {request.items?.length > 0 && (
                      <ul className="service-qr-items">
                        {request.items.map((item, index) => (
                          <li key={`${request.id}-${item.menuItemId || index}`}>
                            <span>{item.menuItemName || item.name}</span>
                            <strong>×{item.quantity}</strong>
                          </li>
                        ))}
                      </ul>
                    )}
                    {request.orderNotes && (
                      <p className="service-request-note">
                        <strong>{copy.orderNote}:</strong> {request.orderNotes}
                      </p>
                    )}
                    <div className="service-request-actions">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onAction("/api/qr-requests", request.id, "APPROVE")}
                        className="service-button service-button-positive"
                      >
                        {isBusy ? (
                          <span className="service-spinner" aria-hidden="true" />
                        ) : (
                          <Check aria-hidden="true" />
                        )}
                        {copy.approve}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onAction("/api/qr-requests", request.id, "REJECT")}
                        className="service-button service-button-quiet"
                      >
                        <X aria-hidden="true" />
                        {copy.reject}
                      </button>
                    </div>
                  </article>
                );
              }
              return (
                <article key={request.id} className="service-request-item service-service-request">
                  <div className="service-request-item-top">
                    <div>
                      <h3>{request.tableLabel || t("table")}</h3>
                      <p>{request.type === "BILL" ? copy.bill : copy.waiter}</p>
                      <time dateTime={request.submittedAt || undefined}>
                        {request.submittedAt
                          ? new Date(request.submittedAt).toLocaleTimeString(
                              isTr ? "tr-TR" : "en-US",
                              { hour: "2-digit", minute: "2-digit" }
                            )
                          : "—"}
                      </time>
                    </div>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => onAction("/api/service-requests", request.id, "RESOLVE")}
                      className="service-button service-button-quiet"
                    >
                      {isBusy ? (
                        <span className="service-spinner" aria-hidden="true" />
                      ) : (
                        <Check aria-hidden="true" />
                      )}
                      {copy.resolve}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </ScrollPanel>
      )}
      {pageCount > 1 && (
        <PageControls
          page={page}
          pageCount={pageCount}
          total={total}
          start={start}
          end={end}
          onChange={onPageChange}
          label={title}
        />
      )}
    </section>
  );
}

export default function OrderTableSelectPage() {
  const router = useRouter();
  const { socket } = useSocket();
  const { t, lang, formatPrice } = useApp();
  const isTr = lang === "tr";
  const requestCopy = REQUEST_COPY[lang] || REQUEST_COPY.tr;
  const [tables, setTables] = useState([]);
  const [floorElements, setFloorElements] = useState([]);
  const [floorCanvases, setFloorCanvases] = useState({});
  const [selectedSection, setSelectedSection] = useState("");
  const [tableView, setTableView] = useState("floorplan");
  const [tableQuery, setTableQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [tableError, setTableError] = useState(false);
  const [qrRequests, setQrRequests] = useState([]);
  const [serviceRequests, setServiceRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [requestsError, setRequestsError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [requestBusy, setRequestBusy] = useState("");
  const [requestsDialogOpen, setRequestsDialogOpen] = useState(false);
  const [requestTab, setRequestTab] = useState("qr");

  const fetchTables = useCallback(async () => {
    setTableError(false);
    try {
      const [res, elementsRes, canvasesRes] = await Promise.all([
        fetch("/api/tables", { cache: "no-store" }),
        fetch("/api/floor-elements", { cache: "no-store" }),
        fetch("/api/floor-plan/canvas", { cache: "no-store" }),
      ]);
      if (!res.ok || !elementsRes.ok || !canvasesRes.ok) throw new Error("tables-unavailable");
      const [data, elements, canvases] = await Promise.all([
        res.json(),
        elementsRes.json(),
        canvasesRes.json(),
      ]);
      setTables(Array.isArray(data) ? data : []);
      setFloorElements(Array.isArray(elements) ? elements : []);
      setFloorCanvases(
        Object.fromEntries(
          (Array.isArray(canvases) ? canvases : []).map((canvas) => [canvas.section, canvas])
        )
      );
      const nextSections = Array.from(new Set(data.map((table) => table.section)));
      setSelectedSection((current) =>
        current === "ALL" || nextSections.includes(current)
          ? current
          : current || nextSections[0] || "ALL"
      );
    } catch (error) {
      console.error("Table data could not be loaded:", error);
      setTableError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRequestQueues = useCallback(async () => {
    try {
      const [qrResponse, serviceResponse] = await Promise.all([
        fetch("/api/qr-requests", { cache: "no-store" }),
        fetch("/api/service-requests", { cache: "no-store" }),
      ]);
      if (!qrResponse.ok || !serviceResponse.ok) throw new Error("request-queue-unavailable");
      const [qrData, serviceData] = await Promise.all([qrResponse.json(), serviceResponse.json()]);
      setQrRequests(Array.isArray(qrData) ? qrData : []);
      setServiceRequests(Array.isArray(serviceData) ? serviceData : []);
      setRequestsError(false);
    } catch (error) {
      console.error("İstek kuyrukları alınamadı:", error);
      setRequestsError(true);
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  useEffect(() => {
    fetchRequestQueues();
    const poll = window.setInterval(fetchRequestQueues, 15000);
    return () => window.clearInterval(poll);
  }, [fetchRequestQueues]);

  useEffect(() => {
    if (!socket) return;
    const handleTableUpdate = () => fetchTables();
    const tableEvents = [
      "connect",
      "service:request",
      "service:resolved",
      "table:bill_requested",
      "table:update",
      "table:layout_update",
      "order:new",
      "payment:completed",
      "floor-elements:update",
      "floorplan:canvas_update",
    ];
    tableEvents.forEach((eventName) => socket.on(eventName, handleTableUpdate));

    let refreshTimer;
    const refreshRequests = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(fetchRequestQueues, 180);
    };
    const requestEvents = [
      "connect",
      "qr:request",
      "qr:reviewed",
      "service:request",
      "service:resolved",
    ];
    requestEvents.forEach((eventName) => socket.on(eventName, refreshRequests));
    const refreshAll = () => {
      handleTableUpdate();
      refreshRequests();
    };
    window.addEventListener("service-requests:changed", refreshAll);
    return () => {
      tableEvents.forEach((eventName) => socket.off(eventName, handleTableUpdate));
      requestEvents.forEach((eventName) => socket.off(eventName, refreshRequests));
      window.removeEventListener("service-requests:changed", refreshAll);
      window.clearTimeout(refreshTimer);
    };
  }, [socket, fetchTables, fetchRequestQueues]);

  const updateRequest = async (endpoint, id, action) => {
    const requestKey = `${endpoint}:${id}`;
    setRequestBusy(requestKey);
    setRequestsError(false);
    setActionError(false);
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (!response.ok) throw new Error("request-update-failed");
      await fetchRequestQueues();
      fetchTables();
      window.dispatchEvent(new Event("service-requests:changed"));
    } catch (error) {
      console.error("İstek güncellenemedi:", error);
      setActionError(true);
      await fetchRequestQueues();
    } finally {
      setRequestBusy("");
    }
  };

  const sections = useMemo(
    () =>
      Array.from(new Set(tables.map((table) => table.section))).sort((a, b) =>
        a.localeCompare(b, isTr ? "tr" : "en")
      ),
    [tables, isTr]
  );
  const filteredTables = useMemo(() => {
    const query = tableQuery.trim().toLocaleLowerCase(isTr ? "tr-TR" : "en-US");
    return tables.filter((table) => {
      const matchesSection = selectedSection === "ALL" || table.section === selectedSection;
      const matchesStatus = statusFilter === "ALL" || table.status === statusFilter;
      const matchesQuery =
        !query ||
        String(table.tableNumber || "")
          .toLocaleLowerCase(isTr ? "tr-TR" : "en-US")
          .includes(query);
      return matchesSection && matchesStatus && matchesQuery;
    });
  }, [tables, selectedSection, statusFilter, tableQuery, isTr]);
  const tablePages = usePages(filteredTables, 8);
  const qrPages = usePages(qrRequests, 4);
  const servicePages = usePages(serviceRequests, 5);

  const handleSelectTable = (table) => router.push(`/order/${table.id}`);
  const statusName = (status) =>
    ({
      AVAILABLE: isTr ? "Boş" : "Available",
      OCCUPIED: isTr ? "Dolu" : "Occupied",
      BILL_REQUESTED: isTr ? "Hesap istendi" : "Bill requested",
      CLEANING: isTr ? "Temizlikte" : "Cleaning",
    })[status] || status;

  return (
    <div className="service-root waiter-experience">
      <header className="service-toolbar">
        <div className="service-toolbar-leading">
          <span className="service-brand-mark" aria-hidden="true">
            <RestaurantIdentity />
          </span>
          <div className="service-heading-copy">
            <h1>{t("selectOrderTable")}</h1>
            <p>{isTr ? "Masayı seçin, servisi takip edin" : "Choose a table and follow service"}</p>
          </div>
        </div>
        <div className="service-toolbar-actions">
          <span className="service-table-total-count">
            {tables.length} {t("totalTables")}
          </span>
          <div
            className="service-segmented"
            role="group"
            aria-label={isTr ? "Masa görünümü" : "Table view"}
          >
            <button
              type="button"
              onClick={() => setTableView("floorplan")}
              aria-pressed={tableView === "floorplan"}
            >
              <LayoutGrid aria-hidden="true" />
              <span>{isTr ? "Kroki" : "Floor plan"}</span>
            </button>
            <button
              type="button"
              onClick={() => setTableView("list")}
              aria-pressed={tableView === "list"}
            >
              <List aria-hidden="true" />
              <span>{isTr ? "Liste" : "List"}</span>
            </button>
          </div>
          <button
            type="button"
            className="service-button service-button-quiet service-mobile-queue-trigger"
            onClick={() => setRequestsDialogOpen(true)}
            aria-haspopup="dialog"
          >
            <Bell aria-hidden="true" />
            {isTr ? "İstekler" : "Requests"}
            <span className="service-count-badge">
              {qrRequests.length + serviceRequests.length}
            </span>
          </button>
        </div>
      </header>

      <section
        className="service-summary service-waiter-summary"
        aria-label={isTr ? "Masa durumu" : "Table status"}
      >
        <div className="service-summary-item">
          <span>{isTr ? "Boş" : "Available"}</span>
          <strong>{tables.filter((table) => table.status === "AVAILABLE").length}</strong>
        </div>
        <div className="service-summary-item">
          <span>{isTr ? "Dolu" : "Occupied"}</span>
          <strong>{tables.filter((table) => table.status === "OCCUPIED").length}</strong>
        </div>
        <div className="service-summary-item">
          <span>{isTr ? "Hesap istendi" : "Bill requested"}</span>
          <strong className="service-text-warning">
            {tables.filter((table) => table.status === "BILL_REQUESTED").length}
          </strong>
        </div>
        <div className="service-summary-item">
          <span>{isTr ? "Bekleyen QR" : "Pending QR"}</span>
          <strong>{qrRequests.length}</strong>
        </div>
      </section>

      <div className="service-waiter-workspace">
        <section
          className="service-work-panel service-table-select-panel"
          aria-label={t("floorPlan")}
        >
          <div className="service-panel-heading">
            <div className="service-panel-title">
              <h2>{isTr ? "Masa seçimi" : "Choose a table"}</h2>
              <p>
                {isTr ? "Masa ve duruma göre filtreleyin" : "Filter tables by section and status"}
              </p>
            </div>
            <div className="service-view-controls service-table-filters">
              <label className="service-section-select" htmlFor="waiter-section">
                <span>{isTr ? "Bölüm" : "Section"}</span>
                <select
                  id="waiter-section"
                  value={selectedSection}
                  onChange={(event) => {
                    setSelectedSection(event.target.value);
                    tablePages.setPage(1);
                  }}
                >
                  <option value="ALL">{isTr ? "Tüm bölümler" : "All sections"}</option>
                  {sections.map((section) => (
                    <option key={section} value={section}>
                      {section}
                    </option>
                  ))}
                </select>
              </label>
              <label className="service-section-select" htmlFor="waiter-status">
                <span>{isTr ? "Durum" : "Status"}</span>
                <select
                  id="waiter-status"
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value);
                    tablePages.setPage(1);
                  }}
                >
                  <option value="ALL">{isTr ? "Tümü" : "All"}</option>
                  <option value="AVAILABLE">{statusName("AVAILABLE")}</option>
                  <option value="OCCUPIED">{statusName("OCCUPIED")}</option>
                  <option value="BILL_REQUESTED">{statusName("BILL_REQUESTED")}</option>
                  <option value="CLEANING">{statusName("CLEANING")}</option>
                </select>
              </label>
            </div>
          </div>

          <div className="service-list-filters">
            <label className="service-search-field" htmlFor="waiter-table-search">
              <Search aria-hidden="true" />
              <input
                id="waiter-table-search"
                value={tableQuery}
                onChange={(event) => {
                  setTableQuery(event.target.value);
                  tablePages.setPage(1);
                }}
                placeholder={isTr ? "Masa ara" : "Search tables"}
                autoComplete="off"
              />
            </label>
            <span className="service-filter-count">
              {filteredTables.length} {isTr ? "sonuç" : "results"}
            </span>
          </div>

          <div className="service-table-select-content" aria-busy={loading}>
            {tableError ? (
              <div className="service-empty-state" role="alert">
                <CircleAlert aria-hidden="true" />
                <p>{isTr ? "Masa verisi yüklenemedi." : "Table data could not be loaded."}</p>
                <button
                  type="button"
                  onClick={fetchTables}
                  className="service-button service-button-quiet"
                >
                  {requestCopy.retry}
                </button>
              </div>
            ) : loading ? (
              <div className="service-loading" role="status">
                {isTr ? "Masalar yükleniyor…" : "Loading tables…"}
              </div>
            ) : tableView === "list" ? (
              <div className="service-table-list-wrap">
                {tablePages.total === 0 ? (
                  <div className="service-empty-state">
                    <p>{isTr ? "Eşleşen masa bulunamadı." : "No matching tables."}</p>
                  </div>
                ) : (
                  <ScrollPanel label={isTr ? "Masa listesi" : "Table list"}>
                    <ul
                      className="service-table-list"
                      aria-label={isTr ? "Masa listesi" : "Table list"}
                    >
                      {tablePages.items.map((table) => {
                        const status =
                          table.status === "AVAILABLE"
                            ? "available"
                            : table.status === "BILL_REQUESTED"
                              ? "bill"
                              : table.status === "CLEANING"
                                ? "cleaning"
                                : "occupied";
                        const total = (table.orders || []).reduce(
                          (sum, order) => sum + Number(order.totalPrice || 0),
                          0
                        );
                        return (
                          <li key={table.id}>
                            <button
                              type="button"
                              onClick={() => handleSelectTable(table)}
                              className="service-table-row"
                            >
                              <span
                                className={`service-status-dot is-${status}`}
                                aria-hidden="true"
                              />
                              <span className="service-table-main">
                                <strong>{table.tableNumber}</strong>
                                <span>{table.section}</span>
                              </span>
                              <TableCalls table={table} />
                              <span className="service-table-capacity">
                                <Users aria-hidden="true" />
                                {table.capacity || 4}
                              </span>
                              <span className={`service-status-label service-status-${status}`}>
                                {statusName(table.status)}
                              </span>
                              {total > 0 && (
                                <span className="service-table-total">
                                  {isTr ? "Toplam" : "Total"}: {formatPrice(total)}
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </ScrollPanel>
                )}
                {tablePages.pageCount > 1 && (
                  <PageControls
                    page={tablePages.page}
                    pageCount={tablePages.pageCount}
                    total={tablePages.total}
                    start={tablePages.start}
                    end={tablePages.end}
                    onChange={tablePages.setPage}
                    label={isTr ? "Masa listesi" : "Table list"}
                  />
                )}
              </div>
            ) : selectedSection === "ALL" ? (
              <div className="service-multi-plan service-waiter-multi-plan">
                {sections.map((section) => (
                  <section key={section} className="service-plan-section" aria-label={section}>
                    <h3>{section}</h3>
                    <FloorPlanView
                      canvas={floorCanvases[section]}
                      tables={filteredTables}
                      elements={floorElements.filter((element) => element.section === section)}
                      section={section}
                      onSelectTable={handleSelectTable}
                      showModeBar={false}
                    />
                  </section>
                ))}
                {sections.length === 0 && (
                  <div className="service-empty-state">
                    <p>{isTr ? "Henüz masa eklenmemiş." : "No tables have been added yet."}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="service-plan-canvas">
                <FloorPlanView
                  canvas={floorCanvases[selectedSection]}
                  tables={filteredTables}
                  elements={floorElements.filter((element) => element.section === selectedSection)}
                  section={selectedSection}
                  onSelectTable={handleSelectTable}
                />
              </div>
            )}
          </div>
        </section>

        <section
          className="service-request-queues"
          aria-label={isTr ? "Bekleyen istekler" : "Pending requests"}
        >
          <RequestPanel
            actionError={actionError}
            busyKey={requestBusy}
            copy={requestCopy}
            empty={requestCopy.empty}
            error={requestsError}
            icon={UtensilsCrossed}
            isLoading={requestsLoading}
            items={qrPages.items}
            lang={lang}
            onAction={updateRequest}
            onPageChange={qrPages.setPage}
            onRetry={fetchRequestQueues}
            page={qrPages.page}
            pageCount={qrPages.pageCount}
            requestType="qr"
            retryLabel={requestCopy.retry}
            title={requestCopy.qrTitle}
            total={qrPages.total}
            start={qrPages.start}
            end={qrPages.end}
            t={t}
          />
          <RequestPanel
            actionError={actionError}
            busyKey={requestBusy}
            copy={requestCopy}
            empty={requestCopy.empty}
            error={requestsError}
            icon={Bell}
            isLoading={requestsLoading}
            items={servicePages.items}
            lang={lang}
            onAction={updateRequest}
            onPageChange={servicePages.setPage}
            onRetry={fetchRequestQueues}
            page={servicePages.page}
            pageCount={servicePages.pageCount}
            requestType="service"
            retryLabel={requestCopy.retry}
            title={requestCopy.serviceTitle}
            total={servicePages.total}
            start={servicePages.start}
            end={servicePages.end}
            t={t}
          />
        </section>
      </div>

      <Dialog
        open={requestsDialogOpen}
        onClose={() => setRequestsDialogOpen(false)}
        title={isTr ? "Bekleyen istekler" : "Pending requests"}
        className="service-mobile-sheet service-request-sheet"
      >
        <div
          className="service-request-dialog-tabs"
          role="group"
          aria-label={isTr ? "İstek türü" : "Request type"}
        >
          <button
            type="button"
            onClick={() => setRequestTab("qr")}
            aria-pressed={requestTab === "qr"}
          >
            {requestCopy.qrTitle}
            <span>{qrRequests.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setRequestTab("service")}
            aria-pressed={requestTab === "service"}
          >
            {requestCopy.serviceTitle}
            <span>{serviceRequests.length}</span>
          </button>
        </div>
        <div className="service-request-dialog-content">
          {requestTab === "qr" ? (
            <RequestPanel
              actionError={actionError}
              busyKey={requestBusy}
              copy={requestCopy}
              empty={requestCopy.empty}
              error={requestsError}
              icon={UtensilsCrossed}
              isLoading={requestsLoading}
              items={qrPages.items}
              lang={lang}
              onAction={updateRequest}
              onPageChange={qrPages.setPage}
              onRetry={fetchRequestQueues}
              page={qrPages.page}
              pageCount={qrPages.pageCount}
              requestType="qr"
              retryLabel={requestCopy.retry}
              title={requestCopy.qrTitle}
              total={qrPages.total}
              start={qrPages.start}
              end={qrPages.end}
              t={t}
            />
          ) : (
            <RequestPanel
              actionError={actionError}
              busyKey={requestBusy}
              copy={requestCopy}
              empty={requestCopy.empty}
              error={requestsError}
              icon={Bell}
              isLoading={requestsLoading}
              items={servicePages.items}
              lang={lang}
              onAction={updateRequest}
              onPageChange={servicePages.setPage}
              onRetry={fetchRequestQueues}
              page={servicePages.page}
              pageCount={servicePages.pageCount}
              requestType="service"
              retryLabel={requestCopy.retry}
              title={requestCopy.serviceTitle}
              total={servicePages.total}
              start={servicePages.start}
              end={servicePages.end}
              t={t}
            />
          )}
        </div>
      </Dialog>
    </div>
  );
}
