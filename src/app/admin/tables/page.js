"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/AppContext";
import {
  Dialog,
  PageControls,
  ScrollPanel,
  SearchInput,
  usePages,
} from "@/components/ui/Workspace";
import {
  ArrowLeft,
  Check,
  Circle,
  Copy,
  ExternalLink,
  List,
  Map,
  Network,
  Pencil,
  Plus,
  QrCode,
  RectangleHorizontal,
  Save,
  Square,
  Trash2,
} from "lucide-react";
import QRCode from "qrcode";

const PAGE_SIZE = 12;

function isUsableQrBaseUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      ["http:", "https:"].includes(url.protocol) &&
      Boolean(host) &&
      host !== "localhost" &&
      host !== "0.0.0.0" &&
      host !== "::1" &&
      host !== "[::1]" &&
      !host.startsWith("127.")
    );
  } catch {
    return false;
  }
}

async function responseError(response, fallback) {
  try {
    const data = await response.json();
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

export default function AdminTablesPage() {
  const { t, lang } = useApp();
  const isTr = lang === "tr";
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState("grid");
  const [qrModalTable, setQrModalTable] = useState(null);
  const [qrModalUrl, setQrModalUrl] = useState("");
  const [qrModalTarget, setQrModalTarget] = useState("");
  const [qrPreviewPath, setQrPreviewPath] = useState("");
  const [qrBusy, setQrBusy] = useState(false);
  const [qrError, setQrError] = useState("");
  const [addressCopied, setAddressCopied] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTable, setNewTable] = useState({
    tableNumber: "",
    section: isTr ? "İç Mekan" : "Dining room",
    capacity: 4,
    shape: "SQUARE",
  });
  const [editingTable, setEditingTable] = useState(null);
  const [editFormData, setEditFormData] = useState({
    id: "",
    tableNumber: "",
    section: "",
    capacity: 4,
    shape: "SQUARE",
    width: 85,
    height: 85,
  });
  const [archivingTable, setArchivingTable] = useState(null);
  const [mutationError, setMutationError] = useState("");

  const fetchData = useCallback(
    async (showLoading = false) => {
      if (showLoading) setLoading(true);
      setLoadError("");
      try {
        const [tablesResponse, networkResponse] = await Promise.all([
          fetch("/api/tables"),
          fetch("/api/network-info").catch(() => null),
        ]);
        if (!tablesResponse.ok) {
          throw new Error(
            isTr
              ? await responseError(tablesResponse, "Masalar yüklenemedi.")
              : "Tables could not be loaded."
          );
        }
        setTables(await tablesResponse.json());
        if (networkResponse?.ok) {
          const networkData = await networkResponse.json();
          setBaseUrl(
            isUsableQrBaseUrl(networkData.baseUrl) ? networkData.baseUrl.replace(/\/+$/, "") : ""
          );
        } else {
          setBaseUrl("");
        }
      } catch (error) {
        console.error(error);
        setLoadError(
          error.message || (isTr ? "Masalar yüklenemedi." : "Tables could not be loaded.")
        );
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [isTr]
  );

  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  const filteredTables = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase(isTr ? "tr-TR" : "en-US");
    if (!query) return tables;
    return tables.filter((table) =>
      [table.tableNumber, table.section, table.capacity, table.shape].some((value) =>
        String(value ?? "")
          .toLocaleLowerCase(isTr ? "tr-TR" : "en-US")
          .includes(query)
      )
    );
  }, [isTr, searchQuery, tables]);
  const pages = usePages(filteredTables, PAGE_SIZE);

  const openQrModal = async (table) => {
    if (qrBusy) return;
    setQrModalTable(table);
    setQrBusy(true);
    setQrError("");
    setQrModalUrl("");
    setQrModalTarget("");
    setQrPreviewPath("");
    setAddressCopied(false);
    try {
      const [response, networkResponse] = await Promise.all([
        fetch("/api/tables/qr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tableId: table.id }),
        }),
        fetch("/api/network-info", { cache: "no-store" }).catch(() => null),
      ]);
      if (!response.ok)
        throw new Error(
          isTr
            ? await responseError(response, "QR kodu oluşturulamadı.")
            : "The QR code could not be created."
        );
      const { path } = await response.json();
      if (typeof path !== "string" || !/^\/menu\/[a-f0-9]{48}$/.test(path))
        throw new Error(
          isTr ? "Masa menü bağlantısı geçersiz." : "The table menu link is invalid."
        );
      setQrPreviewPath(path);
      const network = networkResponse?.ok ? await networkResponse.json().catch(() => ({})) : {};
      const address = isUsableQrBaseUrl(network.baseUrl) ? network.baseUrl.replace(/\/+$/, "") : "";
      setBaseUrl(address);
      if (!address) {
        setQrError(
          isTr
            ? "Telefonlar için ağ adresi bulunamadı. Menüyü bu bilgisayarda açabilir veya QR adresini ayarlayabilirsiniz."
            : "No network address is available for phones. Preview the menu on this computer or set the QR address."
        );
        return;
      }
      const orderUrl = new URL(path, `${address}/`);
      const qrDataUrl = await QRCode.toDataURL(orderUrl.href, { width: 260, margin: 1 });
      setQrModalUrl(qrDataUrl);
      setQrModalTarget(orderUrl.href);
    } catch (error) {
      console.error(error);
      setQrError(
        error.message ||
          (isTr
            ? "QR kodu hazırlanamadı. Tekrar deneyin."
            : "The QR code could not be prepared. Try again.")
      );
    } finally {
      setQrBusy(false);
    }
  };

  const printQr = () => {
    if (!qrModalTable || !qrModalUrl || !isUsableQrBaseUrl(baseUrl) || !qrModalTarget) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setQrError(
        isTr
          ? "Yazdırma penceresi açılamadı. Açılır pencerelere izin verin."
          : "The print window could not open. Allow pop-up windows and try again."
      );
      return;
    }
    printWindow.document.write(
      '<!doctype html><html><head><meta charset="utf-8"><title>QR Menu</title><style>@page{size:A4;margin:20mm}body{font-family:Arial,sans-serif;text-align:center;padding-top:35mm}h1{font-size:28pt}p{font-size:14pt}img{width:70mm;height:70mm}</style></head><body><h1 id="table"></h1><p id="section"></p><img id="qr" alt="QR menu"><p>Menüyü açmak için QR kodu tarayın / Scan for the menu</p></body></html>'
    );
    printWindow.document.getElementById("table").textContent = qrModalTable.tableNumber;
    printWindow.document.getElementById("section").textContent = qrModalTable.section;
    printWindow.document.getElementById("qr").src = qrModalUrl;
    printWindow.document.getElementById("qr").setAttribute("data-target", qrModalTarget);
    printWindow.document.close();
    printWindow.document.getElementById("qr").onload = () => printWindow.print();
  };

  const copyAddress = async (value) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setAddressCopied(true);
      window.setTimeout(() => setAddressCopied(false), 1800);
    } catch (error) {
      console.error(error);
      setQrError(isTr ? "Adres panoya kopyalanamadı." : "Could not copy the address.");
    }
  };

  const handleAddTable = async (event) => {
    event.preventDefault();
    if (!newTable.tableNumber.trim() || !newTable.section.trim()) return;
    setMutationError("");
    try {
      const response = await fetch("/api/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableNumber: newTable.tableNumber.trim(),
          section: newTable.section.trim(),
          capacity: Number(newTable.capacity) || 4,
          shape: newTable.shape || "SQUARE",
          posX: 30,
          posY: 30,
        }),
      });
      if (!response.ok) {
        setMutationError(
          isTr
            ? await responseError(response, "Masa eklenemedi.")
            : "The table could not be added. Check the details and try again."
        );
        return;
      }
      setShowAddModal(false);
      setNewTable({
        tableNumber: "",
        section: isTr ? "İç Mekan" : "Dining room",
        capacity: 4,
        shape: "SQUARE",
      });
      await fetchData();
    } catch (error) {
      console.error(error);
      setMutationError(
        isTr
          ? "Bağlantı hatası. Masa eklenemedi."
          : "A connection error prevented the table from being added."
      );
    }
  };

  const openEditModal = (table) => {
    setMutationError("");
    setEditingTable(table);
    setEditFormData({
      id: table.id,
      tableNumber: table.tableNumber,
      section: table.section,
      capacity: table.capacity || 4,
      shape: table.shape || "SQUARE",
      width: table.width || 85,
      height: table.height || 85,
    });
  };

  const handleSaveEdit = async (event) => {
    event.preventDefault();
    if (!editFormData.tableNumber.trim() || !editFormData.section.trim()) return;
    setMutationError("");
    try {
      const response = await fetch("/api/tables", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editFormData.id,
          tableNumber: editFormData.tableNumber.trim(),
          section: editFormData.section.trim(),
          capacity: Number(editFormData.capacity) || 4,
          shape: editFormData.shape,
          width: Number(editFormData.width),
          height: Number(editFormData.height),
        }),
      });
      if (!response.ok) {
        setMutationError(
          isTr
            ? await responseError(response, "Masa değişiklikleri kaydedilemedi.")
            : "Table changes could not be saved. Check your access and try again."
        );
        return;
      }
      setEditingTable(null);
      await fetchData();
    } catch (error) {
      console.error(error);
      setMutationError(
        isTr
          ? "Bağlantı hatası. Masa değişiklikleri kaydedilemedi."
          : "A connection error prevented the table changes from being saved."
      );
    }
  };

  const archiveTable = async () => {
    if (!archivingTable) return;
    setMutationError("");
    try {
      const response = await fetch(`/api/tables?id=${archivingTable.id}`, { method: "DELETE" });
      if (!response.ok) {
        setMutationError(
          isTr
            ? await responseError(
                response,
                "Masa arşivlenemedi. Açık hesabı olan masa arşivlenemez."
              )
            : "The table could not be archived. Close its open bill and try again."
        );
        return;
      }
      setArchivingTable(null);
      await fetchData();
    } catch (error) {
      console.error(error);
      setMutationError(
        isTr
          ? "Bağlantı hatası. Masa arşivlenemedi."
          : "A connection error prevented the table from being archived."
      );
    }
  };

  const openAddModal = () => {
    setMutationError("");
    setShowAddModal(true);
  };

  const getShapeInfo = (shape) => {
    if (shape === "ROUND") return { label: t("round"), Icon: Circle };
    if (shape === "RECTANGLE") return { label: t("rectangle"), Icon: RectangleHorizontal };
    return { label: t("square"), Icon: Square };
  };

  const renderTableActions = (table) => (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => openQrModal(table)}
        disabled={qrBusy}
        aria-label={`${t("qrMenu")}: ${table.tableNumber}`}
        className="secondary-action inline-flex min-h-10 items-center gap-1.5 px-2.5 text-xs font-semibold disabled:cursor-not-allowed"
      >
        <QrCode size={16} />
        <span>{t("qrMenu")}</span>
      </button>
      <button
        type="button"
        onClick={() => openEditModal(table)}
        className="icon-action"
        aria-label={`${t("edit")}: ${table.tableNumber}`}
        title={t("edit")}
      >
        <Pencil size={17} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => {
          setMutationError("");
          setArchivingTable(table);
        }}
        className="icon-action text-[var(--danger)]"
        aria-label={`${isTr ? "Masayı arşivle" : "Archive table"}: ${table.tableNumber}`}
        title={isTr ? "Masayı arşivle" : "Archive table"}
      >
        <Trash2 size={17} aria-hidden="true" />
      </button>
    </div>
  );

  return (
    <div className="admin-experience table-management-experience w-full overflow-hidden bg-[var(--canvas)]">
      <header className="admin-page-header">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/admin"
            className="icon-action"
            aria-label={isTr ? "Yönetim paneline dön" : "Back to administration"}
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </Link>
          <div className="min-w-0">
            <h1 className="page-title">{t("tableManagementTitle")}</h1>
            <p>
              {tables.length} {t("table")}
              {tables.length === 1 ? "" : isTr ? "" : "s"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/floorplan"
            className="secondary-action inline-flex min-h-11 items-center gap-2 px-3 text-sm font-semibold"
          >
            <Map size={17} aria-hidden="true" />
            <span>{t("floorPlan")}</span>
          </Link>
          <button
            type="button"
            onClick={openAddModal}
            className="primary-action inline-flex min-h-11 items-center gap-2 px-4 text-sm font-semibold"
          >
            <Plus size={18} aria-hidden="true" />
            <span>{t("addNewTable")}</span>
          </button>
        </div>
      </header>

      <section
        className="table-qr-address flex shrink-0 flex-col gap-3 rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        aria-label={isTr ? "QR menü adresi" : "QR menu address"}
      >
        <div className="flex min-w-0 items-start gap-3">
          <Network className="mt-1 h-5 w-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {isTr ? "Telefonlardan erişim adresi" : "Phone access address"}
            </p>
            <code className="mt-1 block break-all text-sm text-[var(--text-secondary)]">
              {baseUrl ||
                (isTr ? "Kullanılabilir ağ adresi bulunamadı" : "No usable network address found")}
            </code>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {isTr
                ? "QR basmadan önce adresi doğrulayın. Telefon aynı Wi-Fi ağında olmalı."
                : "Verify the address before printing. Phones must be on the same Wi-Fi network."}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {baseUrl ? (
            <>
              <button
                type="button"
                onClick={() => copyAddress(baseUrl)}
                className="secondary-action inline-flex min-h-11 items-center gap-2 px-3 text-sm font-semibold"
                aria-live="polite"
              >
                {addressCopied ? (
                  <Check size={17} aria-hidden="true" />
                ) : (
                  <Copy size={17} aria-hidden="true" />
                )}
                {addressCopied
                  ? isTr
                    ? "Kopyalandı"
                    : "Copied"
                  : isTr
                    ? "Adresi kopyala"
                    : "Copy address"}
              </button>
            </>
          ) : null}
          <Link
            href="/admin/settings#device-settings"
            className="primary-action inline-flex min-h-11 items-center px-3 text-sm font-semibold"
          >
            {isTr ? "QR adresini ayarla" : "Set QR address"}
          </Link>
        </div>
      </section>

      {loadError && (
        <p
          role="alert"
          className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-surface)] px-4 py-3 text-sm text-[var(--danger)]"
        >
          {loadError}
        </p>
      )}
      {qrError && !qrModalTable && (
        <p
          role="alert"
          className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-surface)] px-4 py-3 text-sm text-[var(--danger)]"
        >
          {qrError}
        </p>
      )}

      <section
        className="surface-panel flex min-h-0 flex-1 flex-col"
        aria-labelledby="table-list-title"
      >
        <div className="admin-toolbar shrink-0 rounded-none border-b border-[var(--border)]">
          <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
            <h2
              id="table-list-title"
              className="mr-auto pb-1 text-lg font-semibold text-[var(--text-primary)]"
            >
              {isTr ? "Salon masaları" : "Dining tables"}
            </h2>
            <label className="form-field table-search-field w-full max-w-md flex-1">
              <span>{isTr ? "Masalarda ara" : "Search tables"}</span>
              <SearchInput
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  pages.setPage(1);
                }}
                placeholder={isTr ? "Masa numarası veya bölüm" : "Table number or section"}
              />
            </label>
            <div
              className="segmented-control"
              role="group"
              aria-label={isTr ? "Masa görünümü" : "Table view"}
            >
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                aria-pressed={viewMode === "grid"}
                className="px-3 text-sm"
              >
                {isTr ? "Izgara" : "Grid"}
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                aria-pressed={viewMode === "list"}
                className="inline-flex items-center gap-1.5 px-3 text-sm"
              >
                <List size={16} aria-hidden="true" />
                {isTr ? "Liste" : "List"}
              </button>
            </div>
          </div>
          <p className="shrink-0 text-sm text-[var(--text-secondary)]" aria-live="polite">
            {pages.total} {isTr ? "sonuç" : "results"}
          </p>
        </div>

        {loading ? (
          <div className="empty-state m-4 text-sm" role="status">
            {isTr ? "Masalar yükleniyor…" : "Loading tables…"}
          </div>
        ) : filteredTables.length === 0 ? (
          <div className="empty-state m-4 text-sm" role="status">
            {tables.length === 0
              ? isTr
                ? "Henüz masa yok. İlk masayı ekleyerek başlayın."
                : "No tables yet. Add your first table to get started."
              : isTr
                ? "Bu aramayla eşleşen masa bulunamadı."
                : "No tables match this search."}
          </div>
        ) : (
          <ScrollPanel className="min-h-0 px-4" label={isTr ? "Masa listesi" : "Table list"}>
            {viewMode === "grid" ? (
              <ul className="grid grid-cols-1 gap-2 py-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {pages.items.map((table) => {
                  const { label: shapeLabel, Icon: ShapeIcon } = getShapeInfo(table.shape);
                  return (
                    <li
                      key={table.id}
                      className="flex min-h-[116px] min-w-0 flex-col justify-between rounded-[16px] bg-[var(--surface)] px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-lg font-semibold text-[var(--text-primary)]">
                            {table.tableNumber}
                          </h3>
                          <p className="truncate text-sm text-[var(--text-secondary)]">
                            {table.section}
                          </p>
                        </div>
                        <div className="grid shrink-0 justify-items-end gap-1 text-xs text-[var(--text-secondary)]">
                          <span>
                            {table.capacity}{" "}
                            {t("capacity").toLocaleLowerCase(isTr ? "tr-TR" : "en-US")}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <ShapeIcon size={14} aria-hidden="true" />
                            {shapeLabel} · {table.width || 85} × {table.height || 85}
                          </span>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-end border-t border-[var(--border)] pt-2">
                        {renderTableActions(table)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="overflow-x-auto py-4">
                <table className="admin-table min-w-[680px]">
                  <caption className="sr-only">
                    {isTr ? "Masalar ve masa işlemleri" : "Tables and table actions"}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{isTr ? "Masa" : "Table"}</th>
                      <th scope="col">{t("section")}</th>
                      <th scope="col">{t("capacity")}</th>
                      <th scope="col">{t("geometry")}</th>
                      <th scope="col" className="text-right">
                        {isTr ? "İşlemler" : "Actions"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pages.items.map((table) => {
                      const { label: shapeLabel, Icon: ShapeIcon } = getShapeInfo(table.shape);
                      return (
                        <tr key={table.id}>
                          <th scope="row" className="font-semibold text-[var(--text-primary)]">
                            {table.tableNumber}
                          </th>
                          <td>{table.section}</td>
                          <td>{table.capacity}</td>
                          <td>
                            <span className="inline-flex items-center gap-2">
                              <ShapeIcon size={16} aria-hidden="true" />
                              {shapeLabel}, {table.width || 85} × {table.height || 85}
                            </span>
                          </td>
                          <td>
                            <div className="row-actions">{renderTableActions(table)}</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </ScrollPanel>
        )}

        {!loading && pages.pageCount > 1 && (
          <PageControls
            page={pages.page}
            pageCount={pages.pageCount}
            total={pages.total}
            start={pages.start}
            end={pages.end}
            onChange={pages.setPage}
            label={isTr ? "Masa sayfaları" : "Table pages"}
          />
        )}
      </section>

      <Dialog
        open={Boolean(editingTable)}
        onClose={() => {
          setEditingTable(null);
          setMutationError("");
        }}
        title={`${t("editTable")}${editingTable ? ` · ${editingTable.tableNumber}` : ""}`}
      >
        <form onSubmit={handleSaveEdit} className="form-stack">
          {mutationError && (
            <p
              role="alert"
              className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-surface)] px-3 py-2 text-sm text-[var(--danger)]"
            >
              {mutationError}
            </p>
          )}
          <label className="form-field">
            <span>{t("tableNameOrNumber")}</span>
            <input
              autoFocus
              required
              type="text"
              value={editFormData.tableNumber}
              onChange={(event) =>
                setEditFormData((current) => ({ ...current, tableNumber: event.target.value }))
              }
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="form-field">
              <span>{t("section")}</span>
              <input
                required
                type="text"
                value={editFormData.section}
                onChange={(event) =>
                  setEditFormData((current) => ({ ...current, section: event.target.value }))
                }
              />
            </label>
            <label className="form-field">
              <span>{t("capacity")}</span>
              <input
                type="number"
                min={1}
                max={30}
                value={editFormData.capacity}
                onChange={(event) =>
                  setEditFormData((current) => ({ ...current, capacity: event.target.value }))
                }
              />
            </label>
          </div>
          <fieldset className="form-field">
            <legend>{t("geometry")}</legend>
            <div className="segmented-control mt-2" role="group" aria-label={t("geometry")}>
              {[
                ["SQUARE", t("square"), Square],
                ["ROUND", t("round"), Circle],
                ["RECTANGLE", t("rectangle"), RectangleHorizontal],
              ].map(([shape, label, Icon]) => (
                <button
                  key={shape}
                  type="button"
                  onClick={() => setEditFormData((current) => ({ ...current, shape }))}
                  aria-pressed={editFormData.shape === shape}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 px-2 text-sm"
                >
                  <Icon size={16} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="form-field">
              <span>{isTr ? "Genişlik" : "Width"}</span>
              <input
                required
                type="number"
                min={40}
                max={480}
                step={1}
                value={editFormData.width}
                onChange={(event) =>
                  setEditFormData((current) => ({ ...current, width: event.target.value }))
                }
              />
            </label>
            <label className="form-field">
              <span>{isTr ? "Derinlik" : "Depth"}</span>
              <input
                required
                type="number"
                min={40}
                max={480}
                step={1}
                value={editFormData.height}
                onChange={(event) =>
                  setEditFormData((current) => ({ ...current, height: event.target.value }))
                }
              />
            </label>
          </div>
          <div className="form-actions">
            <button
              type="button"
              onClick={() => setEditingTable(null)}
              className="secondary-action"
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              className="primary-action inline-flex items-center justify-center gap-2"
            >
              <Save size={17} aria-hidden="true" />
              {t("saveChanges")}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(archivingTable)}
        onClose={() => {
          setArchivingTable(null);
          setMutationError("");
        }}
        title={isTr ? "Masayı arşivle" : "Archive table"}
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            {isTr
              ? `${archivingTable?.tableNumber || ""} masası arşivlenecek. Açık hesabı varsa işlem reddedilir.`
              : `${archivingTable?.tableNumber || ""} will be archived. The server will reject this if the table has an open bill.`}
          </p>
          {mutationError && (
            <p
              role="alert"
              className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-surface)] px-3 py-2 text-sm text-[var(--danger)]"
            >
              {mutationError}
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              onClick={() => setArchivingTable(null)}
              className="secondary-action"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={archiveTable}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-surface)] px-4 font-semibold text-[var(--danger)]"
            >
              <Trash2 size={17} aria-hidden="true" />
              {isTr ? "Arşivle" : "Archive"}
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setMutationError("");
        }}
        title={t("addNewTable")}
      >
        <form onSubmit={handleAddTable} className="form-stack">
          {mutationError && (
            <p
              role="alert"
              className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-surface)] px-3 py-2 text-sm text-[var(--danger)]"
            >
              {mutationError}
            </p>
          )}
          <label className="form-field">
            <span>{t("tableNameOrNumber")}</span>
            <input
              autoFocus
              required
              type="text"
              placeholder={isTr ? "Örn: İ-15 / Bahçe-3" : "Example: I-15 / Garden-3"}
              value={newTable.tableNumber}
              onChange={(event) =>
                setNewTable((current) => ({ ...current, tableNumber: event.target.value }))
              }
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="form-field">
              <span>{t("section")}</span>
              <input
                required
                type="text"
                value={newTable.section}
                onChange={(event) =>
                  setNewTable((current) => ({ ...current, section: event.target.value }))
                }
              />
            </label>
            <label className="form-field">
              <span>{t("capacity")}</span>
              <input
                type="number"
                min={1}
                max={30}
                value={newTable.capacity}
                onChange={(event) =>
                  setNewTable((current) => ({ ...current, capacity: event.target.value }))
                }
              />
            </label>
          </div>
          <div className="form-actions">
            <button
              type="button"
              onClick={() => setShowAddModal(false)}
              className="secondary-action"
            >
              {t("cancel")}
            </button>
            <button type="submit" className="primary-action">
              {t("saveTable")}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(qrModalTable)}
        onClose={() => {
          setQrModalTable(null);
          setQrError("");
        }}
        title={
          qrModalTable
            ? `${qrModalTable.tableNumber} · ${qrModalTable.section}`
            : isTr
              ? "QR menü"
              : "QR menu"
        }
        className="max-w-[440px]"
      >
        {qrModalTable && (
          <div className="space-y-4 text-center">
            {qrError && (
              <p
                role="alert"
                className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-surface)] px-3 py-2 text-left text-sm text-[var(--danger)]"
              >
                {qrError}
              </p>
            )}
            {qrBusy && (
              <p role="status" className="text-sm text-[var(--text-secondary)]">
                {isTr ? "QR kodu hazırlanıyor…" : "Preparing QR code…"}
              </p>
            )}
            {qrModalUrl && (
              <div className="mx-auto inline-block rounded-2xl bg-white p-3">
                <img
                  src={qrModalUrl}
                  width={208}
                  height={208}
                  alt={
                    isTr
                      ? `${qrModalTable.tableNumber} masası QR menü kodu`
                      : `QR menu code for table ${qrModalTable.tableNumber}`
                  }
                  className="h-52 w-52"
                />
              </div>
            )}
            <p className="text-sm text-[var(--text-secondary)]">{t("qrInstructions")}</p>
            {qrPreviewPath && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-3 text-left">
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  {isTr ? "QR bağlantısı" : "QR destination"}
                </p>
                <code className="mt-2 block break-all text-sm text-[var(--text-secondary)]">
                  {qrModalTarget ||
                    (isTr
                      ? "Telefon adresi henüz ayarlanmadı"
                      : "Phone address is not configured yet")}
                </code>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => copyAddress(qrModalTarget)}
                    disabled={!qrModalTarget}
                    className="secondary-action inline-flex min-h-11 items-center justify-center gap-2 px-2 text-sm font-semibold"
                    aria-live="polite"
                  >
                    {addressCopied ? (
                      <Check size={17} aria-hidden="true" />
                    ) : (
                      <Copy size={17} aria-hidden="true" />
                    )}
                    {addressCopied
                      ? isTr
                        ? "Kopyalandı"
                        : "Copied"
                      : isTr
                        ? "Bağlantıyı kopyala"
                        : "Copy link"}
                  </button>
                  <a
                    href={qrPreviewPath}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="secondary-action inline-flex min-h-11 items-center justify-center gap-2 px-2 text-sm font-semibold"
                  >
                    <ExternalLink size={17} aria-hidden="true" />
                    {isTr ? "Bağlantıyı aç" : "Open link"}
                  </a>
                </div>
              </div>
            )}
            <Link
              href="/admin/settings#device-settings"
              className="secondary-action inline-flex min-h-11 w-full items-center justify-center px-3 text-sm font-semibold"
            >
              {isTr ? "QR adresini ayarla" : "Set QR address"}
            </Link>
            <button
              type="button"
              onClick={printQr}
              disabled={qrBusy || !qrModalUrl || !isUsableQrBaseUrl(baseUrl) || !qrModalTarget}
              className="primary-action inline-flex min-h-12 w-full items-center justify-center px-4 text-sm font-semibold disabled:opacity-50"
            >
              {isTr ? "QR kodunu A4 yazdır" : "Print QR on A4"}
            </button>
          </div>
        )}
      </Dialog>
    </div>
  );
}
