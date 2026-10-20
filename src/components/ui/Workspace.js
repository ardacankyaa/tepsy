"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { paginate } from "@/lib/pagination.mjs";
import { useApp } from "@/lib/AppContext";

export function usePages(rows, pageSize = 12) {
  const [requestedPage, setPage] = useState(1);
  const result = paginate(rows, requestedPage, pageSize);
  useEffect(() => {
    if (requestedPage !== result.page) setPage(result.page);
  }, [requestedPage, result.page]);
  return { ...result, setPage };
}

export function SearchInput(props) {
  return (
    <span className="workspace-search-control">
      <Search aria-hidden="true" />
      <input type="search" {...props} />
    </span>
  );
}

export function PageControls({ page, pageCount, total, start, end, onChange, label = "" }) {
  const { lang } = useApp();
  return (
    <nav
      className="page-controls"
      aria-label={label || (lang === "tr" ? "Kayıt sayfaları" : "Result pages")}
    >
      <span className="page-range" aria-live="polite">
        {start}–{end} / {total}
      </span>
      <div className="page-controls-actions">
        <button
          type="button"
          className="icon-action"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label={`${label} ${lang === "tr" ? "Önceki sayfa" : "Previous page"}`}
        >
          <ChevronLeft size={18} />
        </button>
        <label className="page-select">
          <span className="sr-only">{lang === "tr" ? "Sayfaya git" : "Go to page"}</span>
          <select value={page} onChange={(e) => onChange(Number(e.target.value))}>
            {Array.from({ length: pageCount }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1} / {pageCount}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="icon-action"
          disabled={page >= pageCount}
          onClick={() => onChange(page + 1)}
          aria-label={`${label} ${lang === "tr" ? "Sonraki sayfa" : "Next page"}`}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </nav>
  );
}

export function ScrollPanel({ children, className = "", label = "", ...props }) {
  const { lang } = useApp();
  const ref = useRef(null);
  const [edges, setEdges] = useState({ top: true, bottom: true });
  const measure = () => {
    const el = ref.current;
    if (el)
      setEdges({
        top: el.scrollTop <= 1,
        bottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 2,
      });
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    measure();
    return () => observer.disconnect();
  }, [children]);
  function move(direction) {
    const el = ref.current;
    if (el)
      el.scrollBy({
        top: direction * el.clientHeight * 0.8,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  }
  return (
    <div className={`scroll-panel ${className}`} {...props}>
      <div
        ref={ref}
        className="scroll-panel-content"
        tabIndex={0}
        role="region"
        aria-label={label || (lang === "tr" ? "İçerik" : "Content")}
        onScroll={measure}
      >
        <div>{children}</div>
      </div>
      {!(edges.top && edges.bottom) && (
        <div className="scroll-panel-controls">
          <button type="button" onClick={() => move(-1)} disabled={edges.top}>
            <ArrowUp size={16} />
            {lang === "tr" ? "Yukarı" : "Up"}
          </button>
          <span>{label}</span>
          <button type="button" onClick={() => move(1)} disabled={edges.bottom}>
            {lang === "tr" ? "Aşağı" : "Down"}
            <ArrowDown size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

export function Dialog({ open, onClose, title, children, footer, className = "" }) {
  const ref = useRef(null);
  const titleId = useId();
  const { lang } = useApp();
  useEffect(() => {
    const el = ref.current;
    if (!open) {
      if (el.open) el.close();
      return;
    }
    const previous = document.activeElement;
    if (!el.open) el.showModal();
    return () => {
      if (el.open) el.close();
      if (previous?.isConnected) previous.focus?.();
    };
  }, [open]);
  function containTab(event) {
    if (event.key !== "Tab") return;
    const controls = Array.from(
      ref.current.querySelectorAll(
        "a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]"
      )
    ).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first) {
      event.preventDefault();
      ref.current.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      className={`workspace-dialog ${className}`}
      aria-labelledby={titleId}
      onKeyDown={containTab}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
    >
      <header className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-action"
          type="button"
          onClick={onClose}
          aria-label={lang === "tr" ? "Pencereyi kapat" : "Close dialog"}
        >
          <X size={20} />
        </button>
      </header>
      <div className="dialog-content">{children}</div>
      {footer && <footer className="dialog-footer">{footer}</footer>}
    </dialog>
  );
}

export function LegalLinks() {
  const { lang } = useApp();
  return (
    <nav
      className="legal-links"
      aria-label={lang === "tr" ? "Yasal bilgiler" : "Legal information"}
    >
      <Link href="/privacy">{lang === "tr" ? "Gizlilik" : "Privacy"}</Link>
      <Link href="/terms">{lang === "tr" ? "Kullanım şartları" : "Terms"}</Link>
      <Link href="/cookies">{lang === "tr" ? "Çerezler" : "Cookies"}</Link>
    </nav>
  );
}
