"use client";
import BrandLogo from "@/components/BrandLogo";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  UtensilsCrossed,
  ChefHat,
  MonitorCheck,
  LayoutDashboard,
  Settings,
  LogOut,
  Menu,
  Map,
  BookOpen,
  BarChart3,
  SlidersHorizontal,
  Sun,
  Moon,
} from "lucide-react";
import { useSocket } from "@/lib/socket-client";
import { useApp } from "@/lib/AppContext";
import soundEngine from "@/lib/sound.mjs";
import { Dialog, LegalLinks } from "@/components/ui/Workspace";
import ServiceNotifications from "@/components/ServiceNotifications";

export default function Navbar() {
  const pathname = usePathname();
  if (
    ["/login", "/account-help", "/setup", "/privacy", "/terms", "/cookies"].includes(pathname) ||
    pathname.startsWith("/menu/")
  )
    return null;
  return <Navigation pathname={pathname} />;
}
function Navigation({ pathname }) {
  const { lang, setLang, t, restaurantName } = useApp();
  const { isConnected, isReconnectFailed } = useSocket();
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sound, setSound] = useState(true);
  const [opaque, setOpaque] = useState(false);
  const [preferences, setPreferences] = useState(false);
  const [theme, setTheme] = useState("light");
  const [time, setTime] = useState("");
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((d) => {
        if (alive) {
          setSession(d.session || null);
          setReady(true);
        }
      })
      .catch(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [pathname]);
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    setSound(localStorage.getItem("soundEnabled") !== "false");
    setOpaque(
      localStorage.getItem("tepsy_opaque") === "true" ||
        localStorage.getItem("restopos_opaque") === "true"
    );
  }, []);
  useEffect(() => {
    document.documentElement.dataset.opaque = String(opaque);
  }, [opaque]);
  useEffect(() => {
    const update = () =>
      setTime(
        new Date().toLocaleTimeString(lang === "tr" ? "tr-TR" : "en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
    update();
    const timer = setInterval(update, 30000);
    return () => clearInterval(timer);
  }, [lang]);
  const words =
    lang === "tr"
      ? {
          home: "Salon",
          orders: "Sipariş",
          kitchen: "Mutfak",
          pos: "Kasa",
          admin: "Yönetim",
          menu: "Menü",
          reports: "Raporlar",
          settings: "Ayarlar",
        }
      : {
          home: "Floor",
          orders: "Orders",
          kitchen: "Kitchen",
          pos: "Checkout",
          admin: "Management",
          menu: "Menu",
          reports: "Reports",
          settings: "Settings",
        };
  const role = session?.role || "ADMIN";
  const home = { ADMIN: "/", WAITER: "/order", KITCHEN: "/kitchen", CASHIER: "/pos" }[role] || "/";
  const all = [
    ["/", words.home, Map],
    ["/order", words.orders, UtensilsCrossed],
    ["/kitchen", words.kitchen, ChefHat],
    ["/pos", words.pos, MonitorCheck],
    ["/admin", words.admin, LayoutDashboard],
    ["/admin/menu", words.menu, BookOpen],
    ["/admin/reports", words.reports, BarChart3],
    ["/admin/settings", words.settings, Settings],
  ];
  const links = ready ? all.filter(([path]) => role === "ADMIN" || path === home) : [];
  const active = ([path]) =>
    pathname === path ||
    (path === "/admin" && pathname === "/admin/floorplan") ||
    (path === "/order" && pathname.startsWith("/order/"));
  const title =
    all.find(active)?.[1] ||
    (pathname === "/admin/tables" ? (lang === "tr" ? "Masalar" : "Tables") : words.admin);
  const nav = (
    <nav className="nav-links" aria-label={t("primaryNavigation")}>
      {links.map((item) => {
        const [path, label, Icon] = item;
        return (
          <Link
            key={path}
            href={path}
            className="nav-link"
            aria-current={active(item) ? "page" : undefined}
            onClick={() => setMenu(false)}
          >
            <Icon size={20} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
  const preferencesLabel = lang === "tr" ? "Görünüm ve tercihler" : "Appearance and preferences";
  function chooseTheme(value) {
    setTheme(value);
    document.documentElement.dataset.theme = value;
    try {
      localStorage.setItem("tepsy_theme", value);
      localStorage.setItem("restopos_theme", value);
      document.cookie = `tepsy_theme=${value};path=/;max-age=31536000;SameSite=Lax`;
      document.cookie = `restopos_theme=${value};path=/;max-age=31536000;SameSite=Lax`;
    } catch {
      /* Theme still applies when storage is unavailable. */
    }
  }
  const preferenceButton = (
    <button
      className="preferences-trigger secondary-action"
      onClick={() => {
        setMenu(false);
        setPreferences(true);
      }}
    >
      <SlidersHorizontal size={18} />
      {preferencesLabel}
    </button>
  );
  async function logout() {
    const res = await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    if (res?.ok) window.location.href = "/login";
  }
  return (
    <div className="app-navigation" data-compact={role === "KITCHEN" || role === "CASHIER"}>
      <aside className="app-sidebar">
        <Link
          href={home}
          className="nav-brand"
          aria-label={lang === "tr" ? "TEPSY ana ekranı" : "TEPSY home screen"}
        >
          <BrandLogo full />
          <small className="nav-brand-restaurant">{restaurantName}</small>
        </Link>
        {nav}
        <div className="sidebar-bottom">
          {preferenceButton}
          <LegalLinks />
          <span className="sidebar-role">
            {session?.name || (lang === "tr" ? "Yerel çalışma alanı" : "Local workspace")}
          </span>
          {session && (
            <button className="secondary-action logout-action" onClick={logout}>
              <LogOut size={16} />
              {t("logout")}
            </button>
          )}
        </div>
      </aside>
      <header className="workspace-topbar">
        <div className="topbar-heading">
          <button
            className="icon-action navigation-toggle"
            onClick={() => setMenu(true)}
            aria-label={lang === "tr" ? "Gezinmeyi aç" : "Open navigation"}
          >
            <Menu size={20} />
          </button>
          <span className="topbar-title">{title}</span>
          <span className="topbar-restaurant">{restaurantName}</span>
        </div>
        <div className="nav-tools">
          <ServiceNotifications enabled={ready && ["ADMIN", "WAITER"].includes(role)} />
          <time aria-label={lang === "tr" ? "Saat" : "Time"}>{time}</time>
        </div>
      </header>
      <Dialog
        open={menu}
        onClose={() => setMenu(false)}
        title={lang === "tr" ? "Çalışma alanı" : "Workspace"}
        className="navigation-dialog"
      >
        <Link
          href={home}
          className="nav-brand"
          aria-label={lang === "tr" ? "TEPSY ana ekranı" : "TEPSY home screen"}
        >
          <BrandLogo full />
          <small className="nav-brand-restaurant">{restaurantName}</small>
        </Link>
        {nav}
        {preferenceButton}
        <LegalLinks />
        {session && (
          <button className="secondary-action logout-action" onClick={logout}>
            <LogOut size={16} />
            {t("logout")}
          </button>
        )}
      </Dialog>
      {isReconnectFailed && (
        <div className="connection-warning" role="status">
          {lang === "tr"
            ? "Bağlantı kesildi. Veriler güncel olmayabilir."
            : "Disconnected. Information may be out of date."}
        </div>
      )}
      <Dialog
        open={preferences}
        onClose={() => setPreferences(false)}
        title={preferencesLabel}
        className="preferences-dialog"
      >
        <div className="preference-group">
          <h3>{lang === "tr" ? "Görünüm" : "Appearance"}</h3>
          <div
            className="theme-options"
            role="group"
            aria-label={lang === "tr" ? "Renk teması" : "Color theme"}
          >
            <button aria-pressed={theme === "light"} onClick={() => chooseTheme("light")}>
              <Sun size={22} />
              {lang === "tr" ? "Açık" : "Light"}
            </button>
            <button aria-pressed={theme === "dark"} onClick={() => chooseTheme("dark")}>
              <Moon size={22} />
              {lang === "tr" ? "Koyu" : "Dark"}
            </button>
          </div>
        </div>
        <div className="preference-row">
          <span>{lang === "tr" ? "Dil" : "Language"}</span>
          <div className="nav-language">
            {["tr", "en"].map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                aria-pressed={lang === l}
                aria-label={l === "tr" ? "Türkçe" : "English"}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <label className="preference-row">
          <span>{lang === "tr" ? "Bildirim sesleri" : "Notification sounds"}</span>
          <input
            type="checkbox"
            checked={sound}
            onChange={(event) => {
              const next = event.target.checked;
              setSound(next);
              localStorage.setItem("soundEnabled", String(next));
              if (next) soundEngine.playReady();
            }}
          />
        </label>
        <label className="preference-row">
          <span>{lang === "tr" ? "Saydamlığı azalt" : "Reduce transparency"}</span>
          <input
            type="checkbox"
            checked={opaque}
            onChange={(event) => {
              const next = event.target.checked;
              setOpaque(next);
              localStorage.setItem("tepsy_opaque", String(next));
              localStorage.setItem("restopos_opaque", String(next));
            }}
          />
        </label>
        <div className="preference-row nav-connection" data-connected={isConnected} role="status">
          <span>{lang === "tr" ? "Sunucu bağlantısı" : "Server connection"}</span>
          <span>
            <span className="nav-connection-dot" />
            {isConnected
              ? t("online")
              : isReconnectFailed
                ? lang === "tr"
                  ? "Bağlantı kesildi"
                  : "Disconnected"
                : t("connecting")}
          </span>
        </div>
      </Dialog>
    </div>
  );
}
