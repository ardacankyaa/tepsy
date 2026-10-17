"use client";

import { useEffect } from "react";
import FloorPlanView from "@/components/FloorPlanView";
import { PageControls, usePages } from "@/components/ui/Workspace";

const TABLE_PAGE_SIZE = 12;

export default function PosTableSelector({
  lang,
  tables,
  selectedSection,
  selectedTable,
  setSelectedTable,
  floorElements,
  floorCanvases,
  tableView,
  onTableViewChange,
  loading = false,
  error = "",
  mobileActive = true,
  onSelect,
}) {
  const sectionTables = tables.filter((table) => table.section === selectedSection);
  const pages = usePages(sectionTables, TABLE_PAGE_SIZE);
  const setTablePage = pages.setPage;

  useEffect(() => {
    setTablePage(1);
  }, [selectedSection, setTablePage]);

  const labels =
    lang === "en"
      ? {
          title: "Tables",
          loading: "Loading tables…",
          empty: "There are no tables in this section.",
          retry: "Try again",
          available: "Available",
          occupied: "Occupied",
          billRequested: "Bill requested",
          floorPlan: "Dining room floor plan",
          planView: "Floor plan",
          listView: "List",
        }
      : {
          title: "Masalar",
          loading: "Masalar yükleniyor…",
          empty: "Bu bölümde masa yok.",
          retry: "Yeniden dene",
          available: "Boş",
          occupied: "Dolu",
          billRequested: "Hesap istendi",
          floorPlan: "Salon krokisi",
          planView: "Kroki",
          listView: "Liste",
        };

  const selectTable = (table) => {
    if (onSelect) onSelect(table);
    else setSelectedTable(table);
  };

  const tableStatus = (table) => {
    if (table.status === "AVAILABLE") return { label: labels.available, tone: "available" };
    if (table.status === "BILL_REQUESTED")
      return { label: labels.billRequested, tone: "bill-requested" };
    return { label: labels.occupied, tone: "occupied" };
  };

  return (
    <section
      className="pos-table-selector"
      data-mobile-active={mobileActive ? "true" : "false"}
      data-table-view={tableView}
      aria-labelledby="pos-table-selector-title"
    >
      <header className="pos-section-heading">
        <div>
          <h2 id="pos-table-selector-title">{labels.title}</h2>
          <span>{selectedSection || "—"}</span>
        </div>
        <div className="pos-section-heading-actions">
          <span className="pos-section-table-count">
            {sectionTables.length} {lang === "en" ? "tables" : "masa"}
          </span>
          <div
            className="pos-table-view-toggle"
            role="group"
            aria-label={lang === "en" ? "Table selection view" : "Masa seçme görünümü"}
          >
            <button
              type="button"
              aria-pressed={tableView === "floorplan"}
              onClick={() => onTableViewChange("floorplan")}
            >
              {labels.planView}
            </button>
            <button
              type="button"
              aria-pressed={tableView === "list"}
              onClick={() => onTableViewChange("list")}
            >
              {labels.listView}
            </button>
          </div>
        </div>
      </header>

      <div className="pos-mobile-table-list">
        {loading ? (
          <div className="pos-list-state" role="status">
            {labels.loading}
          </div>
        ) : error ? (
          <div className="pos-list-state is-error" role="alert">
            {error}
          </div>
        ) : sectionTables.length === 0 ? (
          <div className="pos-list-state">{labels.empty}</div>
        ) : (
          <div className="pos-table-card-grid">
            {pages.items.map((table) => {
              const status = tableStatus(table);
              return (
                <button
                  key={table.id}
                  type="button"
                  onClick={() => selectTable(table)}
                  aria-pressed={selectedTable?.id === table.id}
                  className={`pos-table-card ${status.tone} ${selectedTable?.id === table.id ? "is-selected" : ""}`}
                >
                  <strong>{table.tableNumber}</strong>
                  <span className="pos-table-card-status">
                    <i aria-hidden="true" />
                    {status.label}
                  </span>
                  {table.orders?.length > 0 && (
                    <span className="pos-table-open-count">
                      {table.orders.length} {lang === "en" ? "open bills" : "açık hesap"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {pages.pageCount > 1 && (
          <PageControls
            page={pages.page}
            pageCount={pages.pageCount}
            total={pages.total}
            start={pages.start}
            end={pages.end}
            onChange={pages.setPage}
            label={
              lang === "en" ? `${selectedSection} table pages` : `${selectedSection} masa sayfaları`
            }
          />
        )}
      </div>

      <div className="pos-floorplan-panel" aria-label={labels.floorPlan}>
        {loading ? (
          <div className="pos-list-state" role="status">
            {labels.loading}
          </div>
        ) : error ? (
          <div className="pos-list-state is-error" role="alert">
            {error}
          </div>
        ) : (
          <FloorPlanView
            canvas={floorCanvases?.[selectedSection]}
            tables={tables}
            elements={floorElements.filter((element) => element.section === selectedSection)}
            section={selectedSection}
            isEditable={false}
            selectedTableId={selectedTable?.id}
            onSelectTable={selectTable}
          />
        )}
      </div>
    </section>
  );
}
