"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, Edit2, Trash2, FolderPlus } from "lucide-react";
import MenuPhoto from "@/components/ui/MenuPhoto";
import MenuPhotoEditor from "@/components/ui/MenuPhotoEditor";
import { useApp } from "@/lib/AppContext";
import {
  Dialog,
  PageControls,
  ScrollPanel,
  SearchInput,
  usePages,
} from "@/components/ui/Workspace";

export default function AdminMenuPage() {
  const { t, lang, formatPrice, currency } = useApp();
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [quickName, setQuickName] = useState("");
  const [quickPrice, setQuickPrice] = useState("");
  const [quickCategory, setQuickCategory] = useState("");
  const [quickImage, setQuickImage] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [edit, setEdit] = useState({});
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const filtered = items.filter(
    (item) =>
      (selectedCategory === "ALL" || item.categoryId === selectedCategory) &&
      item.name.toLocaleLowerCase(lang).includes(search.toLocaleLowerCase(lang))
  );
  const pages = usePages(filtered, 8);
  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([fetch("/api/menu-items"), fetch("/api/categories")]);
      if (!a.ok || !b.ok)
        throw new Error(
          lang === "tr"
            ? "Menü yüklenemedi. Yeniden deneyin."
            : "Menu could not be loaded. Try again."
        );
      const [rows, cats] = await Promise.all([a.json(), b.json()]);
      setItems(rows);
      setCategories(cats);
      setQuickCategory((old) => old || cats[0]?.id || "");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [lang]);
  useEffect(() => {
    load();
  }, [load]);
  async function mutate(url, method, body, onSuccess) {
    if (busy || photoBusy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          result.error ||
            (lang === "tr" ? "Değişiklik kaydedilemedi." : "Changes could not be saved.")
        );
      onSuccess?.();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function add(e) {
    e.preventDefault();
    mutate(
      "/api/menu-items",
      "POST",
      {
        name: quickName.trim(),
        price: Number(quickPrice),
        categoryId: quickCategory,
        imageUrl: quickImage.trim() || null,
        isAvailable: true,
      },
      () => {
        setQuickName("");
        setQuickPrice("");
        setQuickImage("");
      }
    );
  }
  function save(e) {
    e.preventDefault();
    mutate(
      "/api/menu-items",
      "PUT",
      {
        id: edit.id,
        name: edit.name.trim(),
        price: Number(edit.price),
        categoryId: edit.categoryId,
        description: edit.description?.trim() || null,
        imageUrl: edit.imageUrl?.trim() || null,
        isAvailable: edit.isAvailable,
      },
      () => setEditingItem(null)
    );
  }
  function open(item) {
    if (busy || photoBusy) return;
    setEditingItem(item);
    setEdit({
      id: item.id,
      name: item.name,
      price: item.price,
      categoryId: item.categoryId,
      description: item.description || "",
      imageUrl: item.imageUrl || "",
      isAvailable: item.isAvailable,
    });
  }
  const field = (label, node) => (
    <label className="form-field">
      {label}
      {node}
    </label>
  );
  return (
    <div className="admin-experience">
      <header className="admin-page-header">
        <div>
          <h1>{t("menuManagementTitle")}</h1>
          <p>
            {items.length} {t("item")} · {categories.length} {t("category")}
          </p>
        </div>
        <button
          className="secondary-action px-4 inline-flex items-center gap-2"
          onClick={() => setCategoryOpen(true)}
        >
          <FolderPlus size={18} />
          {t("newCategory")}
        </button>
      </header>
      {error && (
        <div
          role="alert"
          className="rounded-xl bg-[var(--danger-surface)] text-[var(--danger)] p-3 text-sm flex justify-between gap-3"
        >
          {error}
          <button
            onClick={() => {
              setError("");
              load();
            }}
          >
            {lang === "tr" ? "Yeniden dene" : "Retry"}
          </button>
        </div>
      )}
      <div className="menu-management-layout">
        <section className="surface-panel flex flex-col min-h-0 min-w-0" aria-label={t("item")}>
          <div className="admin-toolbar !rounded-none border-b border-[var(--border)]">
            <label className="menu-search-field flex-1">
              {t("searchItem")}
              <SearchInput
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  pages.setPage(1);
                }}
                placeholder={lang === "tr" ? "Ürün adı…" : "Product name…"}
              />
            </label>
            <label>
              {t("category")}
              <select
                value={selectedCategory}
                onChange={(e) => {
                  setSelectedCategory(e.target.value);
                  pages.setPage(1);
                }}
              >
                <option value="ALL">
                  {t("allTab")} ({items.length})
                </option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({items.filter((item) => item.categoryId === c.id).length})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ScrollPanel label={t("item")}>
            {loading ? (
              <p role="status" className="p-6">
                {lang === "tr" ? "Menü yükleniyor…" : "Loading menu…"}
              </p>
            ) : filtered.length === 0 ? (
              <p className="empty-state m-4">
                {lang === "tr"
                  ? "Bu filtreyle ürün bulunamadı. Aramayı değiştirin veya ürün ekleyin."
                  : "No products match. Change the search or add a product."}
              </p>
            ) : (
              <table className="admin-table menu-items-table">
                <thead>
                  <tr>
                    <th>{t("item")}</th>
                    <th>{t("price")}</th>
                    <th>{t("status")}</th>
                    <th className="text-right">{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <MenuPhoto
                          src={item.imageUrl}
                          name={item.name}
                          className="menu-photo-admin"
                        />
                        <strong>{item.name}</strong>
                        <p className="description">{item.category?.name}</p>
                        {item.description && <p className="description">{item.description}</p>}
                      </td>
                      <td className="whitespace-nowrap">{formatPrice(item.price)}</td>
                      <td>
                        <button
                          disabled={busy || photoBusy}
                          aria-label={
                            item.name + " · " + (item.isAvailable ? t("inStock") : t("soldOut"))
                          }
                          aria-pressed={item.isAvailable}
                          className="status-chip min-h-11"
                          onClick={() =>
                            mutate("/api/menu-items", "PUT", {
                              id: item.id,
                              name: item.name,
                              price: item.price,
                              isAvailable: !item.isAvailable,
                            })
                          }
                        >
                          {item.isAvailable ? t("inStock") : t("soldOut")}
                        </button>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="icon-action"
                            onClick={() => open(item)}
                            aria-label={item.name + " · " + t("edit")}
                          >
                            <Edit2 size={17} />
                          </button>
                          <button
                            className="icon-action"
                            disabled={busy || photoBusy}
                            aria-label={item.name + " · " + t("delete")}
                            onClick={() => {
                              if (confirm(t("deleteItemConfirm")))
                                mutate(
                                  "/api/menu-items?id=" + encodeURIComponent(item.id),
                                  "DELETE"
                                );
                            }}
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ScrollPanel>
          <PageControls {...pages} onChange={pages.setPage} label={t("item")} />
        </section>
        <aside className="surface-panel menu-add-panel">
          <h2 className="text-xl font-semibold p-5 border-b border-[var(--border)]">
            {t("quickAdd")}
          </h2>
          <ScrollPanel label={t("quickAdd")}>
            <form onSubmit={add} className="form-stack p-5">
              {field(
                t("itemName"),
                <input required value={quickName} onChange={(e) => setQuickName(e.target.value)} />
              )}
              {field(
                t("price") + " (" + currency + ")",
                <input
                  required
                  type="number"
                  min="0"
                  step=".01"
                  value={quickPrice}
                  onChange={(e) => setQuickPrice(e.target.value)}
                />
              )}
              {field(
                t("category"),
                <select
                  required
                  value={quickCategory}
                  onChange={(e) => setQuickCategory(e.target.value)}
                >
                  <option value="" disabled>
                    {t("category")}
                  </option>
                  {categories.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              <MenuPhotoEditor
                value={quickImage}
                onChange={setQuickImage}
                onBusyChange={setPhotoBusy}
                disabled={busy || photoBusy}
                lang={lang}
                name={quickName}
              />
              <button
                disabled={busy || photoBusy || !categories.length}
                className="primary-action px-4 flex items-center justify-center gap-2"
              >
                <Plus size={18} />
                {busy ? (lang === "tr" ? "Kaydediliyor…" : "Saving…") : t("add")}
              </button>
              {!categories.length && (
                <p className="text-sm text-[var(--text-secondary)]">
                  {lang === "tr" ? "Önce bir kategori oluşturun." : "Create a category first."}
                </p>
              )}
            </form>
          </ScrollPanel>
        </aside>
      </div>
      <Dialog open={!!editingItem} onClose={() => setEditingItem(null)} title={t("editItem")}>
        <form className="form-stack" onSubmit={save}>
          {field(
            t("itemName"),
            <input
              required
              value={edit.name || ""}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            {field(
              t("price") + " (" + currency + ")",
              <input
                required
                type="number"
                min="0"
                step=".01"
                value={edit.price ?? ""}
                onChange={(e) => setEdit({ ...edit, price: e.target.value })}
              />
            )}
            {field(
              t("category"),
              <select
                required
                value={edit.categoryId || ""}
                onChange={(e) => setEdit({ ...edit, categoryId: e.target.value })}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {field(
            t("description"),
            <textarea
              rows={3}
              value={edit.description || ""}
              onChange={(e) => setEdit({ ...edit, description: e.target.value })}
            />
          )}
          <MenuPhotoEditor
            value={edit.imageUrl}
            onChange={(imageUrl) => setEdit((current) => ({ ...current, imageUrl }))}
            onBusyChange={setPhotoBusy}
            disabled={busy || photoBusy}
            lang={lang}
            name={edit.name}
          />
          <label className="flex items-center gap-3 min-h-11">
            <input
              type="checkbox"
              checked={!!edit.isAvailable}
              onChange={(e) => setEdit({ ...edit, isAvailable: e.target.checked })}
            />
            {t("inStock")}
          </label>
          {error && (
            <p role="alert" className="text-[var(--danger)]">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="button" className="secondary-action" onClick={() => setEditingItem(null)}>
              {t("cancel")}
            </button>
            <button className="primary-action" disabled={busy || photoBusy}>
              {t("saveChanges")}
            </button>
          </div>
        </form>
      </Dialog>
      <Dialog open={categoryOpen} onClose={() => setCategoryOpen(false)} title={t("newCategory")}>
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            mutate(
              "/api/categories",
              "POST",
              { name: newCatName.trim(), icon: "Coffee", sortOrder: categories.length + 1 },
              () => {
                setCategoryOpen(false);
                setNewCatName("");
              }
            );
          }}
        >
          {field(
            t("categoryName"),
            <input required value={newCatName} onChange={(e) => setNewCatName(e.target.value)} />
          )}
          {error && (
            <p role="alert" className="text-[var(--danger)]">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="secondary-action"
              onClick={() => setCategoryOpen(false)}
            >
              {t("cancel")}
            </button>
            <button disabled={busy || photoBusy} className="primary-action">
              {t("add")}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
