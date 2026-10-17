"use client";

import RestaurantIdentity from "@/components/RestaurantIdentity";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CircleAlert,
  Clock3,
  CreditCard,
  LayoutDashboard,
  LayoutGrid,
  List,
  ReceiptText,
  UtensilsCrossed,
  Users,
} from "lucide-react";
import { useSocket } from "@/lib/socket-client";
import { useApp } from "@/lib/AppContext";
import { translations } from "@/lib/translations";
import FloorPlanView from "@/components/FloorPlanView";
import TableCalls from "@/components/TableCalls";
import { createDebouncedRefresh } from "@/lib/event-refresh.cjs";
import { Dialog, PageControls, ScrollPanel, usePages } from "@/components/ui/Workspace";
import "@/styles/service.css";

const STATUS_STYLES = {
  AVAILABLE: "service-status-available",
  OCCUPIED: "service-status-occupied",
  BILL_REQUESTED: "service-status-bill",
  CLEANING: "service-status-cleaning",
};

function OwnerTableDetails({
  selectedTable,
  orderItems,
  orderTotal,
  elapsedMinutes,
  copy,
  formatPrice,
  statusLabel,
  t,
}) {
  return (
    <div className="service-table-detail-content">
      <div className="service-inspector-heading">
        <div>
          <p className="service-eyebrow">{selectedTable.section}</p>
          <h2>{selectedTable.tableNumber}</h2>
          <TableCalls table={selectedTable} />
        </div>
        <span
          className={`service-status-label ${STATUS_STYLES[selectedTable.status] || STATUS_STYLES.CLEANING}`}
        >
          {statusLabel(selectedTable.status)}
        </span>
        <div className="service-inspector-meta">
          <span>
            <Users aria-hidden="true" />
            {copy.capacity} {selectedTable.capacity}
          </span>
          <span>
            <Clock3 aria-hidden="true" />
            {elapsedMinutes} {t("minuteShort")}
          </span>
        </div>
      </div>

      <div className="service-inspector-section-heading">
        <h3>{copy.order}</h3>
        <span>{orderItems.length}</span>
      </div>
      <ScrollPanel className="service-inspector-items" label={copy.order}>
        {orderItems.length === 0 ? (
          <div className="service-empty-inline">
            <ReceiptText aria-hidden="true" />
            <p>{copy.noItems}</p>
          </div>
        ) : (
          <div className="service-order-lines">
            {orderItems.map((item, index) => (
              <div key={item.id || `${item.orderId}-${index}`} className="service-order-line">
                <span className="service-line-quantity">{item.quantity}</span>
                <span className="service-line-name">
                  {item.menuItemName || item.menuItem?.name || t("item")}
                </span>
                <span className="service-line-price">
                  {formatPrice(Number(item.unitPrice || item.menuItem?.price || 0) * item.quantity)}
                </span>
              </div>
            ))}
          </div>
        )}
      </ScrollPanel>

      {selectedTable.status === "BILL_REQUESTED" && (
        <div className="service-alert" role="status">
          <CircleAlert aria-hidden="true" />
          <div>
            <strong>{copy.bill}</strong>
            <p>{copy.requestedCopy}</p>
          </div>
        </div>
      )}

      <div className="service-inspector-footer">
        <div className="service-total-row">
          <span>{copy.subtotal}</span>
          <strong>{formatPrice(orderTotal)}</strong>
        </div>
        <div className="service-total-row service-total-emphasis">
          <span>{copy.total}</span>
          <strong>{formatPrice(orderTotal)}</strong>
        </div>
        <div className="service-inspector-actions">
          <Link
            href={`/order/${selectedTable.id}`}
            className="service-button service-button-primary"
          >
            <UtensilsCrossed aria-hidden="true" />
            {copy.openOrder}
          </Link>
          <Link href="/pos" className="service-button service-button-positive">
            <CreditCard aria-hidden="true" />
            {copy.collect}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function SalonWorkspace({ editorMode = false }) {
  const { socket } = useSocket();
  const { lang, t, formatPrice } = useApp();
  const [tables, setTables] = useState([]);
  const [floorElements, setFloorElements] = useState([]);
  const [floorCanvases, setFloorCanvases] = useState({});
  const [activeSection, setActiveSection] = useState("");
  const [selectedTable, setSelectedTable] = useState(null);
  const [tableDetailOpen, setTableDetailOpen] = useState(false);
  const isLayoutMode = editorMode;
  const [editorDirty, setEditorDirty] = useState(false);
  const [tableView, setTableView] = useState("floorplan");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stats, setStats] = useState({
    totalTables: 0,
    occupiedTables: 0,
    availableTables: 0,
    billRequested: 0,
    activeOrders: 0,
    todayRevenue: 0,
  });

  const copy = translations[lang]?.homePage || translations.tr.homePage;
  const isTr = lang === "tr";

  const fetchData = useCallback(async () => {
    setError("");
    try {
      const [tablesRes, ordersRes, reportRes, elementsRes, canvasesRes] = await Promise.all([
        fetch("/api/tables", { cache: "no-store" }),
        fetch("/api/orders?activeOnly=true", { cache: "no-store" }),
        fetch("/api/reports/z-report?period=today", { cache: "no-store" }),
        fetch("/api/floor-elements", { cache: "no-store" }),
        fetch("/api/floor-plan/canvas", { cache: "no-store" }),
      ]);

      if (!tablesRes.ok || !ordersRes.ok || !reportRes.ok || !elementsRes.ok || !canvasesRes.ok) {
        throw new Error("Operational data could not be loaded");
      }

      const [nextTables, orders, report, nextElements, nextCanvases] = await Promise.all([
        tablesRes.json(),
        ordersRes.json(),
        reportRes.json(),
        elementsRes.json(),
        canvasesRes.json(),
      ]);
      const sections = Array.from(new Set(nextTables.map((table) => table.section)));
      const startInLayout = editorMode;
      const occupied = nextTables.filter((table) =>
        ["OCCUPIED", "BILL_REQUESTED"].includes(table.status)
      ).length;

      const initialTable =
        nextTables.find((table) => table.orders?.length && table.status === "BILL_REQUESTED") ||
        nextTables.find((table) => table.orders?.length && table.status === "OCCUPIED") ||
        nextTables.find((table) => table.status === "BILL_REQUESTED") ||
        nextTables.find((table) => table.status === "OCCUPIED") ||
        nextTables.find((table) => table.section === "İç Mekan") ||
        nextTables[0] ||
        null;
      setTables(nextTables);
      setFloorElements(Array.isArray(nextElements) ? nextElements : []);
      setFloorCanvases(
        Object.fromEntries(
          (Array.isArray(nextCanvases) ? nextCanvases : []).map((canvas) => [
            canvas.section,
            canvas,
          ])
        )
      );
      setActiveSection((current) => {
        if (startInLayout && current === "ALL") return sections[0] || "ALL";
        return current === "ALL" || sections.includes(current)
          ? current
          : initialTable?.section || sections[0] || "ALL";
      });
      setSelectedTable((current) => {
        if (current) return nextTables.find((table) => table.id === current.id) || null;
        return initialTable;
      });
      setStats({
        totalTables: nextTables.length,
        occupiedTables: occupied,
        availableTables: nextTables.filter((table) => table.status === "AVAILABLE").length,
        billRequested: nextTables.filter((table) => table.status === "BILL_REQUESTED").length,
        activeOrders: orders.length,
        todayRevenue: report?.summary?.totalRevenue || 0,
      });
    } catch (fetchError) {
      console.error(fetchError);
      setError(
        isTr ? "Canlı restoran verisi yüklenemedi." : "Live restaurant data could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }, [editorMode, isTr]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!socket) return;
    const handleUpdate = createDebouncedRefresh(() => fetchData(), 180);
    const events = [
      "connect",
      "service:request",
      "service:resolved",
      "table:bill_requested",
      "order:new",
      "order:update",
      "table:update",
      "table:layout_update",
      "payment:completed",
      "floor-elements:update",
      "floorplan:canvas_update",
    ];
    events.forEach((eventName) => socket.on(eventName, handleUpdate));
    window.addEventListener("service-requests:changed", handleUpdate);
    return () => {
      handleUpdate.dispose();
      events.forEach((eventName) => socket.off(eventName, handleUpdate));
      window.removeEventListener("service-requests:changed", handleUpdate);
    };
  }, [socket, fetchData]);

  const sections = useMemo(
    () =>
      Array.from(new Set(tables.map((table) => table.section))).sort((a, b) => {
        const priority = { "İç Mekan": 0, Bahçe: 1, Teras: 2 };
        return (priority[a] ?? 99) - (priority[b] ?? 99) || a.localeCompare(b, "tr");
      }),
    [tables]
  );

  const activeOrders = selectedTable?.orders || [];
  const orderItems = activeOrders.flatMap((order) =>
    (order.items || []).map((item) => ({ ...item, orderId: order.id }))
  );
  const orderTotal = activeOrders.reduce((sum, order) => sum + Number(order.totalPrice || 0), 0);
  const firstOrderAt = activeOrders
    .map((order) => new Date(order.createdAt).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  const elapsedMinutes = firstOrderAt
    ? Math.max(0, Math.floor((Date.now() - firstOrderAt) / 60000))
    : 0;
  const statusLabel = (status) =>
    ({
      AVAILABLE: copy.available,
      OCCUPIED: copy.occupied,
      BILL_REQUESTED: copy.bill,
      CLEANING: copy.cleaning,
    })[status] || status;

  const selectOwnerTable = (nextTable) => {
    setSelectedTable(nextTable);
    if (window.matchMedia("(max-width: 959px)").matches) setTableDetailOpen(true);
  };

  const visibleTables = useMemo(
    () =>
      tables.filter((table) => {
        const matchesSection = activeSection === "ALL" || table.section === activeSection;
        const matchesStatus = statusFilter === "ALL" || table.status === statusFilter;
        return matchesSection && matchesStatus;
      }),
    [tables, activeSection, statusFilter]
  );
  const tablePages = usePages(visibleTables, 8);

  const saveFloorLayout = async (elements) => {
    const response = await fetch("/api/floor-elements", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section: activeSection, elements }),
    });
    if (!response.ok) throw new Error("floor-elements-save-failed");
    await fetchData();
  };

  const addTableToLayout = async (draft) => {
    const response = await fetch("/api/tables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "table-create-failed");

    const createdTable = { ...result, orders: result.orders || [] };
    setTables((current) =>
      current.some((table) => table.id === createdTable.id)
        ? current.map((table) => (table.id === createdTable.id ? createdTable : table))
        : [...current, createdTable]
    );
    setStats((current) => ({
      ...current,
      totalTables: current.totalTables + 1,
      availableTables: current.availableTables + 1,
    }));
    return createdTable;
  };

  const sectionPages = usePages(sections, 1);

  const selectSection = (section) => {
    setActiveSection(section);
    setSelectedTable(null);
    setTableDetailOpen(false);
    tablePages.setPage(1);
  };

  return (
    <div className={`service-root owner-experience ${editorMode ? "floor-editor-page" : ""}`}>
      <header className="service-toolbar">
        <div className="service-toolbar-leading">
          <span className="service-brand-mark" aria-hidden="true">
            <RestaurantIdentity />
          </span>
          <div className="service-heading-copy">
            <h1>
              {editorMode
                ? isTr
                  ? "Kroki düzenleyici"
                  : "Floor plan editor"
                : isTr
                  ? "Günün salonu"
                  : "Today on the floor"}
            </h1>
            <p>
              {editorMode
                ? isTr
                  ? "Bölümü seçin, masaları yerleştirin ve kaydedin."
                  : "Choose a room, arrange tables and save."
                : isTr
                  ? "Masalar ve servis akışı"
                  : "Tables and service at a glance"}
            </p>
          </div>
        </div>
        <div className="service-toolbar-actions">
          {editorMode ? (
            <Link href="/admin" className="service-button">
              {isTr ? "Yönetime dön" : "Back to management"}
            </Link>
          ) : (
            <>
              <Link href="/order" className="service-button service-button-primary">
                <UtensilsCrossed aria-hidden="true" />
                {isTr ? "Sipariş al" : "Take an order"}
              </Link>
              <Link href="/pos" className="service-button service-button-quiet">
                <CreditCard aria-hidden="true" />
                {isTr ? "Ödemeler" : "Payments"}
              </Link>
            </>
          )}
        </div>
      </header>

      {!editorMode && (
        <section
          className="service-summary"
          aria-label={isTr ? "Canlı servis özeti" : "Live service summary"}
        >
          <div className="service-summary-item">
            <span>{isTr ? "Açık sipariş" : "Open orders"}</span>
            <strong>{stats.activeOrders}</strong>
          </div>
          <div className="service-summary-item">
            <span>{isTr ? "Hesap bekliyor" : "Bills waiting"}</span>
            <strong className="service-text-warning">{stats.billRequested}</strong>
          </div>
          <div className="service-summary-item">
            <span>{isTr ? "Dolu masa" : "Occupied tables"}</span>
            <strong>{stats.occupiedTables}</strong>
          </div>
          <div className="service-summary-item service-summary-revenue">
            <span>{isTr ? "Bugünkü ciro" : "Sales today"}</span>
            <strong>{formatPrice(stats.todayRevenue)}</strong>
          </div>
        </section>
      )}

      <div className={`service-owner-workspace ${isLayoutMode ? "is-editing" : ""}`}>
        <section className="service-work-panel service-floor-panel" aria-label={t("floorPlan")}>
          <div className="service-panel-heading">
            <div className="service-panel-title">
              <h2>{isLayoutMode ? copy.editLayout : isTr ? "Salon" : "Dining room"}</h2>
              <p>{isLayoutMode ? copy.layoutHint : copy.floorHint}</p>
            </div>
            <div className="service-view-controls">
              <div className="service-section-select">
                <label htmlFor="owner-section">{isTr ? "Bölüm" : "Section"}</label>
                <select
                  id="owner-section"
                  value={activeSection}
                  onChange={(event) => selectSection(event.target.value)}
                  disabled={isLayoutMode && (sections.length === 0 || editorDirty)}
                  title={
                    editorDirty
                      ? isTr
                        ? "Bölüm değiştirmeden önce kaydedin veya sıfırlayın."
                        : "Save or reset before changing rooms."
                      : undefined
                  }
                >
                  {!isLayoutMode && <option value="ALL">{t("allTables")}</option>}
                  {sections.map((section) => (
                    <option key={section} value={section}>
                      {section}
                    </option>
                  ))}
                </select>
              </div>
              {!isLayoutMode && (
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
              )}
            </div>
          </div>

          {!isLayoutMode && tableView === "list" && (
            <div className="service-list-filters">
              <label htmlFor="owner-status-filter">{isTr ? "Durum" : "Status"}</label>
              <select
                id="owner-status-filter"
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                  tablePages.setPage(1);
                }}
              >
                <option value="ALL">{isTr ? "Tüm masalar" : "All tables"}</option>
                <option value="AVAILABLE">{copy.available}</option>
                <option value="OCCUPIED">{copy.occupied}</option>
                <option value="BILL_REQUESTED">{copy.bill}</option>
                <option value="CLEANING">{copy.cleaning}</option>
              </select>
              <span className="service-filter-count">
                {tablePages.total} {isTr ? "masa" : "tables"}
              </span>
            </div>
          )}

          <div
            className={`service-floor-content ${isLayoutMode ? "service-floor-editing" : ""}`}
            aria-busy={loading}
          >
            {error ? (
              <div className="service-empty-state" role="alert">
                <CircleAlert aria-hidden="true" />
                <p>{error}</p>
                <button
                  type="button"
                  onClick={fetchData}
                  className="service-button service-button-quiet"
                >
                  {copy.retry}
                </button>
              </div>
            ) : loading ? (
              <div className="service-loading" role="status">
                {isTr ? "Salon verileri yükleniyor…" : "Loading service data…"}
              </div>
            ) : isLayoutMode ? (
              <div key={activeSection} className="service-plan-canvas">
                <FloorPlanView
                  tables={tables}
                  canvas={floorCanvases[activeSection]}
                  elements={floorElements.filter((element) => element.section === activeSection)}
                  section={activeSection}
                  isEditable
                  onDirtyChange={setEditorDirty}
                  showElementTools
                  onElementsChange={(next) =>
                    setFloorElements((current) => [
                      ...current.filter((element) => element.section !== activeSection),
                      ...next.map((element) => ({ ...element, section: activeSection })),
                    ])
                  }
                  selectedTableId={selectedTable?.id}
                  onSelectTable={setSelectedTable}
                  onSaveLayout={saveFloorLayout}
                  onAddTable={addTableToLayout}
                />
              </div>
            ) : tableView === "list" ? (
              <div className="service-table-list-wrap">
                {tablePages.total === 0 ? (
                  <div className="service-empty-state">
                    <p>
                      {isTr ? "Bu filtrelerle eşleşen masa yok." : "No tables match these filters."}
                    </p>
                  </div>
                ) : (
                  <ScrollPanel label={isTr ? "Masa listesi" : "Table list"}>
                    <ul
                      className="service-table-list"
                      aria-label={isTr ? "Masa listesi" : "Table list"}
                    >
                      {tablePages.items.map((table) => {
                        const isAvailable = table.status === "AVAILABLE";
                        const isBillRequested = table.status === "BILL_REQUESTED";
                        const openTotal = (table.orders || []).reduce(
                          (sum, order) => sum + Number(order.totalPrice || 0),
                          0
                        );
                        return (
                          <li key={table.id}>
                            <button
                              type="button"
                              onClick={() => selectOwnerTable(table)}
                              aria-pressed={selectedTable?.id === table.id}
                              className={`service-table-row ${selectedTable?.id === table.id ? "is-selected" : ""}`}
                            >
                              <span
                                className={`service-status-dot ${isAvailable ? "is-available" : isBillRequested ? "is-bill" : "is-occupied"}`}
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
                              <span
                                className={`service-status-label ${STATUS_STYLES[table.status] || STATUS_STYLES.CLEANING}`}
                              >
                                {statusLabel(table.status)}
                              </span>
                              {openTotal > 0 && (
                                <span className="service-table-total">
                                  {formatPrice(openTotal)}
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
            ) : activeSection === "ALL" ? (
              <div className="service-room-browser">
                {sectionPages.items.map((section) => (
                  <section key={section} className="service-plan-section" aria-label={section}>
                    <h3>{section}</h3>
                    <FloorPlanView
                      tables={tables}
                      canvas={floorCanvases[section]}
                      elements={floorElements.filter((element) => element.section === section)}
                      section={section}
                      selectedTableId={selectedTable?.id}
                      onSelectTable={selectOwnerTable}
                      showModeBar={false}
                    />
                  </section>
                ))}
                <PageControls
                  {...sectionPages}
                  onChange={sectionPages.setPage}
                  label={isTr ? "Bölümler" : "Rooms"}
                />
              </div>
            ) : (
              <div key={activeSection} className="service-plan-canvas">
                <FloorPlanView
                  tables={tables}
                  canvas={floorCanvases[activeSection]}
                  elements={floorElements.filter((element) => element.section === activeSection)}
                  section={activeSection}
                  selectedTableId={selectedTable?.id}
                  onSelectTable={selectOwnerTable}
                  showModeBar={false}
                />
              </div>
            )}
          </div>
        </section>

        {!isLayoutMode && (
          <aside
            className="service-work-panel service-inspector"
            aria-label={selectedTable?.tableNumber || (isTr ? "Masa ayrıntısı" : "Table details")}
          >
            {selectedTable ? (
              <OwnerTableDetails
                key={selectedTable.id}
                selectedTable={selectedTable}
                orderItems={orderItems}
                orderTotal={orderTotal}
                elapsedMinutes={elapsedMinutes}
                copy={copy}
                formatPrice={formatPrice}
                statusLabel={statusLabel}
                t={t}
              />
            ) : (
              <div className="service-inspector-empty">
                <span className="service-brand-mark" aria-hidden="true">
                  <LayoutDashboard />
                </span>
                <h2>{copy.selectTitle}</h2>
                <p>{copy.selectBody}</p>
                <div className="service-empty-meta">
                  <span>
                    {stats.totalTables} {t("table")}
                  </span>
                  <span>{activeSection === "ALL" ? t("allTables") : activeSection}</span>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
      {!isLayoutMode && selectedTable && (
        <Dialog
          open={tableDetailOpen}
          onClose={() => setTableDetailOpen(false)}
          title={selectedTable.tableNumber}
          className="service-mobile-sheet service-owner-sheet"
        >
          <OwnerTableDetails
            key={selectedTable.id}
            selectedTable={selectedTable}
            orderItems={orderItems}
            orderTotal={orderTotal}
            elapsedMinutes={elapsedMinutes}
            copy={copy}
            formatPrice={formatPrice}
            statusLabel={statusLabel}
            t={t}
          />
        </Dialog>
      )}
    </div>
  );
}
