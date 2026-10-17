"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Check,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  Network,
  Plus,
  Printer,
  ReceiptText,
  RefreshCw,
  QrCode,
  Save,
  Trash2,
  UserRound,
  UsersRound,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import RestaurantLogoField from "@/components/RestaurantLogoField";
import { useApp } from "@/lib/AppContext";
import { ScrollPanel, LegalLinks } from "@/components/ui/Workspace";
import { settingsPageTranslations } from "@/lib/translations";

const EMPTY_CONFIG = {
  restaurantLogoUrl: null,
  restaurantName: "",
  ownerName: "",
  tagline: "",
  restaurantCode: "",
  currency: "₺",
  defaultLanguage: "tr",
  timeZone: "Europe/Istanbul",
  authEnabled: false,
  hasAccessPassword: false,
  qrOrderEnabled: false,
};

const EMPTY_DEVICES = {
  printer: {
    type: "BROWSER",
    host: "",
    port: "9100",
    printerName: "",
    charsPerLine: 42,
    cutPaper: true,
    openCashDrawer: false,
  },
  paymentTerminal: {
    type: "MANUAL",
    host: "",
    port: "",
    terminalId: "",
    categorySections: {},
    status: "UNCONFIGURED",
    message: "",
  },
  network: { qrBaseUrl: "" },
};

const inputClass =
  "h-11 min-w-0 w-full rounded-[var(--radius-control)] border border-[var(--control-border)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]";

function Field({ label, hint, children }) {
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className="text-[11px] font-bold text-[var(--text-secondary)]">{label}</span>
      {children}
      {hint && <span className="text-[10px] leading-4 text-[var(--text-muted)]">{hint}</span>}
    </label>
  );
}

function Panel({ id, icon: Icon, title, description, action, children }) {
  return (
    <section id={id} className="surface-panel flex min-h-0 scroll-mt-3 flex-col">
      <header className="flex min-h-[58px] items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-inset)] text-[var(--text-secondary)]">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">{description}</p>
          </div>
        </div>
        {action}
      </header>
      <ScrollPanel label={title}>
        <div className="p-3 sm:p-5">{children}</div>
      </ScrollPanel>
    </section>
  );
}

function Notice({ tone = "neutral", children }) {
  const styles = {
    neutral: "border-[var(--border)] bg-[var(--surface-inset)] text-[var(--text-secondary)]",
    success: "border-[var(--success-border)] bg-[var(--success-surface)] text-[var(--success)]",
    warning: "border-[var(--warning-border)] bg-[var(--warning-surface)] text-[var(--warning)]",
    danger: "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger)]",
  };
  return (
    <div
      className={`rounded-[var(--radius-control)] border px-3 py-2 text-[11px] leading-4 ${styles[tone]}`}
    >
      {children}
    </div>
  );
}

function normalizeDevices(value) {
  const data = value || {};
  const printer = data.printer || data.receiptPrinter || {};
  const terminal = data.paymentTerminal || data.terminal || {};
  const network = data.network || {};
  return {
    printer: {
      ...EMPTY_DEVICES.printer,
      ...printer,
      type:
        { TCP_ESC_POS: "TCP", WINDOWS_SPOOLER: "WINDOWS" }[printer.adapter] ||
        printer.type ||
        "BROWSER",
      port: String(printer.port ?? "9100"),
    },
    paymentTerminal: {
      ...EMPTY_DEVICES.paymentTerminal,
      ...terminal,
      type: terminal.adapter || terminal.type || "MANUAL",
      port: String(terminal.port ?? ""),
      categorySections: Object.fromEntries(
        (terminal.categorySections || []).map(({ category, sectionNo }) => [category, sectionNo])
      ),
    },
    network: { qrBaseUrl: String(network.qrBaseUrl || "") },
  };
}

function serializeDevices(value) {
  const printerAdapter =
    { TCP: "TCP_ESC_POS", WINDOWS: "WINDOWS_SPOOLER" }[value.printer.type] || "BROWSER";
  return {
    receiptPrinter: {
      enabled: printerAdapter !== "BROWSER",
      adapter: printerAdapter,
      charsPerLine: Number(value.printer.charsPerLine),
      cutPaper: value.printer.cutPaper,
      openCashDrawer: value.printer.openCashDrawer,
      ...(printerAdapter === "TCP_ESC_POS" && {
        host: value.printer.host,
        port: Number(value.printer.port || 9100),
      }),
      ...(printerAdapter === "WINDOWS_SPOOLER" && { printerName: value.printer.printerName }),
    },
    paymentTerminal: {
      enabled: value.paymentTerminal.type !== "MANUAL",
      adapter: ["NEXO_LOCAL", "TOKENX_CLOUD"].includes(value.paymentTerminal.type)
        ? value.paymentTerminal.type
        : "MANUAL",
      ...(value.paymentTerminal.type === "NEXO_LOCAL" && {
        host: value.paymentTerminal.host,
        port: Number(value.paymentTerminal.port || 20007),
      }),
      ...(value.paymentTerminal.type === "TOKENX_CLOUD" && {
        terminalId: value.paymentTerminal.terminalId,
        categorySections: Object.entries(value.paymentTerminal.categorySections || {}).map(
          ([category, sectionNo]) => ({ category, sectionNo })
        ),
      }),
    },
    network: {
      qrBaseUrl: String(value.network?.qrBaseUrl || "")
        .trim()
        .replace(/\/+$/, ""),
    },
  };
}

async function jsonOrEmpty(response) {
  return response.json().catch(() => ({}));
}

export default function SettingsPage() {
  const { lang, applyConfig } = useApp();
  const c = settingsPageTranslations[lang] || settingsPageTranslations.tr;
  const roles = Object.entries(c.roles);
  const [config, setConfig] = useState(EMPTY_CONFIG);
  const [devices, setDevices] = useState(EMPTY_DEVICES);
  const [staff, setStaff] = useState([]);
  const [deviceCategories, setDeviceCategories] = useState([]);
  const [fiscalSections, setFiscalSections] = useState([]);
  const [canManageAdmins, setCanManageAdmins] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState("");
  const [logoBusy, setLogoBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [staffDraft, setStaffDraft] = useState({ name: "", role: "WAITER", pin: "" });
  const [staffForm, setStaffForm] = useState(false);
  const [passwords, setPasswords] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showPasswords, setShowPasswords] = useState(false);
  const [networkAddress, setNetworkAddress] = useState("");
  const [addressCopied, setAddressCopied] = useState(false);
  const [qrAddressBusy, setQrAddressBusy] = useState(false);
  const [qrAddressNotice, setQrAddressNotice] = useState(null);

  const notify = (tone, message) => {
    setNotice({ tone, message });
    window.clearTimeout(window.__settingsNotice);
    window.__settingsNotice = window.setTimeout(() => setNotice(null), 4500);
  };

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const responses = await Promise.all([
        fetch("/api/config", { cache: "no-store" }),
        fetch("/api/staff", { cache: "no-store" }),
        fetch("/api/devices", { cache: "no-store" }),
        fetch("/api/auth/status", { cache: "no-store" }),
      ]);
      if (responses.some((response) => !response.ok)) throw new Error("settings-unavailable");
      const [configData, staffData, deviceData, authData] = await Promise.all(
        responses.map(jsonOrEmpty)
      );
      setCanManageAdmins(authData.session?.userId === "owner" || !authData.authEnabled);
      setConfig({ ...EMPTY_CONFIG, ...(configData.config || configData) });
      setStaff(Array.isArray(staffData) ? staffData : staffData.staff || []);
      setDevices(normalizeDevices(deviceData.config || deviceData.devices || deviceData));
    } catch (error) {
      console.error(error);
      setLoadError(c.loadError);
    } finally {
      setLoading(false);
    }
  }, [c.loadError]);

  useEffect(() => {
    loadSettings();
    fetch("/api/categories", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((data) =>
        setDeviceCategories(Array.isArray(data) ? data.map((category) => category.name) : [])
      )
      .catch(() => {});
    fetch("/api/network-info")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => data?.baseUrl && setNetworkAddress(data.baseUrl))
      .catch(() => {});
    return () => window.clearTimeout(window.__settingsNotice);
  }, [loadSettings]);

  const saveConfig = async () => {
    if (logoBusy) return;
    setBusy("config");
    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await jsonOrEmpty(response);
      if (!response.ok) throw new Error(data.error || data.message || c.configSaveError);
      if (Object.keys(data).length)
        setConfig((current) => ({ ...current, ...(data.config || data) }));
      applyConfig({ ...config, ...(data.config || data) });
      notify("success", c.configSaved);
    } catch (error) {
      notify("danger", error.message);
    } finally {
      setBusy("");
    }
  };

  const saveDevices = async () => {
    if (qrAddressBusy) return;
    setBusy("devices");
    try {
      const response = await fetch("/api/devices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serializeDevices(devices)),
      });
      const data = await jsonOrEmpty(response);
      if (!response.ok) throw new Error(data.error || data.message || c.deviceSaveError);
      if (Object.keys(data).length)
        setDevices(normalizeDevices(data.config || data.devices || data));
      const networkResponse = await fetch("/api/network-info", { cache: "no-store" });
      if (networkResponse.ok) {
        const networkData = await jsonOrEmpty(networkResponse);
        setNetworkAddress(networkData.baseUrl || "");
      }
      notify("success", c.devicesSaved);
    } catch (error) {
      notify("danger", error.message);
    } finally {
      setBusy("");
    }
  };

  const saveQrAddress = async (value = devices.network.qrBaseUrl) => {
    if (qrAddressBusy || busy) return;
    setQrAddressBusy(true);
    setQrAddressNotice(null);
    try {
      const response = await fetch("/api/network-info", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrBaseUrl: value }),
      });
      const data = await jsonOrEmpty(response);
      if (!response.ok)
        throw new Error(
          data.error ||
            (lang === "tr" ? "QR adresi kaydedilemedi." : "The QR address could not be saved.")
        );
      setDevices((current) => ({ ...current, network: { qrBaseUrl: data.qrBaseUrl || "" } }));
      setNetworkAddress(data.baseUrl || "");
      setQrAddressNotice({
        tone: "success",
        message:
          lang === "tr"
            ? "QR adresi kaydedildi. Masalar bölümünden QR kodunu açabilirsiniz."
            : "QR address saved. Open a QR code in the Tables section.",
      });
    } catch (error) {
      setQrAddressNotice({ tone: "danger", message: error.message });
    } finally {
      setQrAddressBusy(false);
    }
  };

  const copyNetworkAddress = async () => {
    if (!networkAddress) return;
    try {
      await navigator.clipboard.writeText(networkAddress);
      setAddressCopied(true);
      window.setTimeout(() => setAddressCopied(false), 1800);
    } catch {
      notify(
        "danger",
        lang === "tr" ? "Adres panoya kopyalanamadı." : "Could not copy the address."
      );
    }
  };

  const printBrowserTestReceipt = () => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0";
    document.body.appendChild(frame);
    const receipt = frame.contentDocument;
    receipt.open();
    receipt.write(
      "<!doctype html><html><head><title>TEPSY Test</title><style>body{font:14px ui-monospace,monospace;width:280px;margin:20px auto;color:#111}h1{font-size:18px;text-align:center;margin:0 0 4px}p{text-align:center;margin:3px 0}.line{border-top:1px dashed #111;margin:14px 0}.row{display:flex;justify-content:space-between}</style></head><body></body></html>"
    );
    receipt.close();
    const body = receipt.body;
    const title = receipt.createElement("h1");
    title.textContent = config.restaurantName || "TEPSY";
    const subtitle = receipt.createElement("p");
    subtitle.textContent = lang === "tr" ? "TEST FİŞİ" : "TEST RECEIPT";
    const date = receipt.createElement("p");
    date.textContent = new Date().toLocaleString(lang === "tr" ? "tr-TR" : "en-US");
    const line = receipt.createElement("div");
    line.className = "line";
    const row = receipt.createElement("div");
    row.className = "row";
    row.innerHTML = `<span>TEPSY</span><strong>OK</strong>`;
    const footer = receipt.createElement("p");
    footer.textContent =
      lang === "tr" ? "Tarayıcı yazdırma bağlantısı çalışıyor." : "Browser printing is working.";
    body.append(title, subtitle, date, line, row, footer);
    window.setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      window.setTimeout(() => frame.remove(), 1500);
    }, 50);
  };

  const testDevice = async (device) => {
    if (qrAddressBusy || busy) return;
    setBusy(`test-${device}`);
    try {
      if (device === "printer" && devices.printer.type === "BROWSER") {
        printBrowserTestReceipt();
        notify("success", c.browserPrintOpened);
        return;
      }
      const saved = await fetch("/api/devices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serializeDevices(devices)),
      });
      if (!saved.ok) {
        const result = await jsonOrEmpty(saved);
        throw new Error(result.error || c.deviceTestError);
      }
      const response = await fetch(
        device === "printer" ? "/api/devices/printer/test" : "/api/devices/payment/status",
        { method: "POST" }
      );
      const data = await jsonOrEmpty(response);
      if (!response.ok || data.success === false)
        throw new Error(data.error || data.message || c.deviceTestError);
      const terminal = data.status || {};
      if (device === "paymentTerminal" && Array.isArray(terminal.sections))
        setFiscalSections(terminal.sections);
      const message =
        data.message ||
        terminal.message ||
        (device === "printer" ? c.printerQueued : c.terminalRead);
      notify(terminal.implemented === false ? "warning" : "success", message);
      if (device === "paymentTerminal")
        setDevices((value) => ({
          ...value,
          paymentTerminal: {
            ...value.paymentTerminal,
            status: terminal.canTransferBasket
              ? "TRANSFER_READY"
              : terminal.canInitiatePayment
                ? "CONNECTED"
                : terminal.connected
                  ? "REACHABLE"
                  : terminal.implemented
                    ? "READY"
                    : "UNSUPPORTED",
            message,
          },
        }));
    } catch (error) {
      notify("danger", error.message);
      if (device === "paymentTerminal")
        setDevices((current) => ({
          ...current,
          paymentTerminal: { ...current.paymentTerminal, status: "ERROR", message: error.message },
        }));
    } finally {
      setBusy("");
    }
  };

  const exportBackup = async () => {
    setBusy("backup");
    try {
      const response = await fetch("/api/backup", { cache: "no-store" });
      if (!response.ok) throw new Error(c.backupError);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tepsy-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      notify("success", c.backupSaved);
    } catch (error) {
      notify("danger", error.message || c.backupError);
    } finally {
      setBusy("");
    }
  };

  const addStaff = async (event) => {
    event.preventDefault();
    if (!staffDraft.name.trim() || staffDraft.pin.length < 4)
      return notify("warning", c.staffValidation);
    setBusy("staff-add");
    try {
      const response = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(staffDraft),
      });
      const data = await jsonOrEmpty(response);
      if (!response.ok) throw new Error(data.error || data.message || c.staffAddError);
      setStaff((value) => [...value, data.staff || data]);
      setStaffDraft({ name: "", role: "WAITER", pin: "" });
      setStaffForm(false);
      notify("success", c.staffAdded);
    } catch (error) {
      notify("danger", error.message);
    } finally {
      setBusy("");
    }
  };

  const updateStaff = async (member, role) => {
    setBusy(`staff-${member.id}`);
    try {
      const response = await fetch("/api/staff", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: member.id, role }),
      });
      const data = await jsonOrEmpty(response);
      if (!response.ok) throw new Error(data.error || data.message || c.staffUpdateError);
      setStaff((value) => value.map((item) => (item.id === member.id ? data.staff || data : item)));
      notify("success", c.staffUpdated);
    } catch (error) {
      notify("danger", error.message);
    } finally {
      setBusy("");
    }
  };

  const removeStaff = async (member) => {
    if (!window.confirm(lang === "tr" ? `${member.name} ${c.removeConfirm}` : c.removeConfirm))
      return;
    setBusy(`staff-${member.id}`);
    try {
      const response = await fetch(`/api/staff?id=${encodeURIComponent(member.id)}`, {
        method: "DELETE",
      });
      const data = await jsonOrEmpty(response);
      if (!response.ok) throw new Error(data.error || data.message || c.staffRemoveError);
      setStaff((value) => value.filter((item) => item.id !== member.id));
      notify("success", c.staffRemoved);
    } catch (error) {
      notify("danger", error.message);
    } finally {
      setBusy("");
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    if (passwords.newPassword.length < 8 || passwords.newPassword !== passwords.confirmPassword)
      return notify("warning", c.passwordValidation);
    setBusy("password");
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwords.currentPassword,
          newPassword: passwords.newPassword,
        }),
      });
      const data = await jsonOrEmpty(response);
      if (!response.ok) throw new Error(data.error || data.message || c.passwordError);
      setPasswords({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setConfig((current) => ({ ...current, authEnabled: true, hasAccessPassword: true }));
      notify("success", c.passwordChanged);
    } catch (error) {
      notify("danger", error.message);
    } finally {
      setBusy("");
    }
  };

  const [activeSection, setActiveSection] = useState("business-identity");
  useEffect(() => {
    const readHash = () => {
      const id = window.location.hash.slice(1);
      if (["business-identity", "local-access", "staff-roles", "device-settings"].includes(id))
        setActiveSection(id);
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []);
  const terminalStatus = useMemo(() => {
    if (devices.paymentTerminal.type === "MANUAL") return ["neutral", c.manualStatus];
    if (devices.paymentTerminal.status === "TRANSFER_READY")
      return ["success", lang === "en" ? "Bill transfer ready" : "Adisyon aktarımı hazır"];
    if (["CONNECTED", "READY"].includes(devices.paymentTerminal.status))
      return ["success", c.connected];
    if (devices.paymentTerminal.status === "REACHABLE") return ["warning", c.reachable];
    if (["ERROR", "UNSUPPORTED"].includes(devices.paymentTerminal.status))
      return ["danger", c.disconnected];
    return ["warning", c.notTested];
  }, [devices.paymentTerminal, c, lang]);

  if (loading)
    return (
      <div
        className="settings-experience app-canvas flex items-center justify-center"
        aria-busy="true"
      >
        <div role="status" className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          {c.loading}
        </div>
      </div>
    );

  if (loadError)
    return (
      <div className="settings-experience app-canvas flex items-center justify-center p-4">
        <div className="surface-panel max-w-md p-6 text-center" role="alert">
          <AlertTriangle className="mx-auto h-7 w-7 text-[var(--danger)]" />
          <h1 className="mt-3 font-semibold">{c.settingsFailed}</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{loadError}</p>
          <button
            onClick={loadSettings}
            className="secondary-action mt-4 inline-flex items-center gap-2 px-4 text-sm font-semibold"
          >
            <RefreshCw className="h-4 w-4" />
            {c.retry}
          </button>
        </div>
      </div>
    );

  return (
    <div className="settings-experience admin-experience">
      <div className="flex h-full min-h-0 w-full flex-col gap-4">
        <header className="admin-page-header">
          <div>
            <h1 className="text-xl font-semibold tracking-[-0.02em]">{c.settings}</h1>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{c.subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="status-chip text-[10px] font-bold">
              <Check className="h-3 w-3 text-[var(--success)]" />
              {devices.paymentTerminal.type === "TOKENX_CLOUD"
                ? lang === "en"
                  ? "TokenX · Cloud"
                  : "TokenX · Bulut"
                : c.freeLocal}
            </span>
            <a
              href="#device-settings"
              onClick={() => setActiveSection("device-settings")}
              className="secondary-action inline-flex min-h-11 items-center gap-2 px-3 text-xs font-bold"
            >
              <Printer className="h-4 w-4" />
              {c.deviceJump}
            </a>
            <button
              onClick={saveConfig}
              disabled={busy === "config" || logoBusy}
              className="primary-action inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-4 text-xs font-bold disabled:opacity-50"
            >
              {busy === "config" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {c.saveGeneral}
            </button>
          </div>
        </header>
        {notice && (
          <div role="status" aria-live="polite" className="shrink-0">
            <Notice tone={notice.tone}>{notice.message}</Notice>
          </div>
        )}
        <div className="settings-workspace">
          <nav
            className="settings-section-nav shrink-0"
            aria-label={lang === "tr" ? "Ayar bölümleri" : "Settings sections"}
          >
            <button
              type="button"
              aria-pressed={activeSection === "business-identity"}
              onClick={() => setActiveSection("business-identity")}
            >
              {lang === "tr" ? "İşletme" : "Business"}
            </button>
            <button
              type="button"
              aria-pressed={activeSection === "local-access"}
              onClick={() => setActiveSection("local-access")}
            >
              {lang === "tr" ? "Erişim" : "Access"}
            </button>
            <button
              type="button"
              aria-pressed={activeSection === "staff-roles"}
              onClick={() => setActiveSection("staff-roles")}
            >
              {lang === "tr" ? "Ekip" : "Team"}
            </button>
            <button
              type="button"
              aria-pressed={activeSection === "device-settings"}
              onClick={() => setActiveSection("device-settings")}
            >
              {lang === "tr" ? "QR ve cihazlar" : "QR & devices"}
            </button>
          </nav>

          <div className="settings-panels" data-section={activeSection}>
            <div className="grid content-start gap-3">
              <Panel
                id="business-identity"
                icon={Building2}
                title={c.businessIdentity}
                description={c.businessDesc}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <RestaurantLogoField
                    value={config.restaurantLogoUrl}
                    onChange={(restaurantLogoUrl) =>
                      setConfig((current) => ({ ...current, restaurantLogoUrl }))
                    }
                    lang={lang}
                    disabled={busy === "config"}
                    onBusyChange={setLogoBusy}
                  />
                  <Field label={c.restaurantName}>
                    <input
                      className={inputClass}
                      value={config.restaurantName}
                      onChange={(e) => setConfig({ ...config, restaurantName: e.target.value })}
                      placeholder={c.restaurantName}
                    />
                  </Field>
                  <Field label={c.owner}>
                    <input
                      className={inputClass}
                      value={config.ownerName}
                      onChange={(e) => setConfig({ ...config, ownerName: e.target.value })}
                      placeholder={c.ownerPlaceholder}
                    />
                  </Field>
                  <Field label={c.tagline}>
                    <input
                      className={inputClass}
                      value={config.tagline}
                      onChange={(e) => setConfig({ ...config, tagline: e.target.value })}
                      placeholder={c.taglinePlaceholder}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label={c.currency}>
                      <select
                        className={inputClass}
                        value={config.currency}
                        onChange={(e) => setConfig({ ...config, currency: e.target.value })}
                      >
                        <option value="₺">₺ {c.turkishLira}</option>
                        <option value="€">€ {c.euro}</option>
                        <option value="$">$ {c.dollar}</option>
                        <option value="£">£ {c.pound}</option>
                      </select>
                    </Field>
                    <Field label={c.language}>
                      <select
                        className={inputClass}
                        value={config.defaultLanguage}
                        onChange={(e) => setConfig({ ...config, defaultLanguage: e.target.value })}
                      >
                        <option value="tr">Türkçe</option>
                        <option value="en">English</option>
                      </select>
                    </Field>
                  </div>
                  <Field label={c.timeZone}>
                    <select
                      className={inputClass}
                      value={config.timeZone}
                      onChange={(e) => setConfig({ ...config, timeZone: e.target.value })}
                    >
                      <option value="Europe/Istanbul">{c.istanbulTime}</option>
                      <option value="UTC">{c.utcTime}</option>
                    </select>
                  </Field>
                  <label className="flex min-h-12 items-start gap-3 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-inset)] p-3">
                    <input
                      type="checkbox"
                      checked={!!config.qrOrderEnabled}
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          qrOrderEnabled: event.target.checked,
                        }))
                      }
                      className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                    />
                    <span>
                      <span className="block text-xs font-semibold text-[var(--text-primary)]">
                        {c.qrOrdering}
                      </span>
                      <span className="mt-1 block text-[10px] leading-4 text-[var(--text-muted)]">
                        {c.qrOrderingHint}
                      </span>
                    </span>
                  </label>
                </div>
              </Panel>

              <Panel
                id="local-access"
                icon={LockKeyhole}
                title={c.localAccess}
                description={c.localAccessDesc}
              >
                <div className="grid gap-4">
                  <Notice
                    tone={config.authEnabled && config.hasAccessPassword ? "success" : "danger"}
                  >
                    <strong>
                      {config.authEnabled && config.hasAccessPassword
                        ? c.authProtected
                        : c.authUnprotected}
                      .
                    </strong>{" "}
                    {config.hasAccessPassword ? c.networkSafety : c.authSetupHint}
                  </Notice>
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                    <Field label={c.restaurantCode} hint={c.codeHint}>
                      <input
                        className={inputClass}
                        value={config.restaurantCode}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            restaurantCode: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""),
                          })
                        }
                        placeholder="RESTO-01"
                      />
                    </Field>
                    <label
                      className={`flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-inset)] px-3 ${config.hasAccessPassword ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                    >
                      <input
                        type="checkbox"
                        checked={!!config.authEnabled}
                        disabled={!config.hasAccessPassword}
                        onChange={(e) => setConfig({ ...config, authEnabled: e.target.checked })}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                      <span className="text-xs font-semibold">{c.loginProtection}</span>
                    </label>
                  </div>
                  <div className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-inset)] p-3">
                    <div className="flex items-start gap-3">
                      <Network className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold">
                          {lang === "tr" ? "Bu ağdaki erişim adresi" : "Address on this network"}
                        </div>
                        <code className="mt-1 block break-all text-xs text-[var(--text-secondary)]">
                          {networkAddress ||
                            (lang === "tr"
                              ? "Ağ adresi bulunamadı"
                              : "Network address unavailable")}
                        </code>
                        <p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">
                          {c.localAddressHint}{" "}
                          {lang === "tr"
                            ? "Telefonlar aynı Wi-Fi ağında olmalı; yönlendirici güvenlik duvarı erişime izin vermelidir."
                            : "Phones must use the same Wi-Fi; the router firewall must allow access."}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={copyNetworkAddress}
                            disabled={!networkAddress}
                            className="secondary-action inline-flex min-h-9 items-center gap-1.5 px-2.5 text-[10px] font-semibold disabled:opacity-50"
                          >
                            {addressCopied ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                            {addressCopied
                              ? lang === "tr"
                                ? "Kopyalandı"
                                : "Copied"
                              : lang === "tr"
                                ? "Adresi kopyala"
                                : "Copy address"}
                          </button>
                          {networkAddress && (
                            <a
                              href={networkAddress}
                              target="_blank"
                              rel="noreferrer"
                              className="secondary-action inline-flex min-h-9 items-center gap-1.5 px-2.5 text-[10px] font-semibold"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              {lang === "tr" ? "Adresi aç ve dene" : "Open and test"}
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <form
                    onSubmit={changePassword}
                    className="grid gap-2 border-t border-[var(--border)] pt-3"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-xs font-semibold">{c.changeAdminPassword}</h3>
                        <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                          {c.passwordHidden}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowPasswords(!showPasswords)}
                        className="secondary-action flex h-10 w-10 items-center justify-center"
                        aria-label={c.passwordVisibility}
                      >
                        {showPasswords ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <input
                        aria-label={c.currentPassword}
                        type={showPasswords ? "text" : "password"}
                        autoComplete="current-password"
                        className={inputClass}
                        value={passwords.currentPassword}
                        onChange={(e) =>
                          setPasswords({ ...passwords, currentPassword: e.target.value })
                        }
                        placeholder={c.currentPassword}
                      />
                      <input
                        aria-label={c.newPassword}
                        type={showPasswords ? "text" : "password"}
                        autoComplete="new-password"
                        className={inputClass}
                        value={passwords.newPassword}
                        onChange={(e) =>
                          setPasswords({ ...passwords, newPassword: e.target.value })
                        }
                        placeholder={c.newPassword}
                      />
                      <input
                        aria-label={c.repeatPassword}
                        type={showPasswords ? "text" : "password"}
                        autoComplete="new-password"
                        className={inputClass}
                        value={passwords.confirmPassword}
                        onChange={(e) =>
                          setPasswords({ ...passwords, confirmPassword: e.target.value })
                        }
                        placeholder={c.repeatPassword}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={busy === "password"}
                      className="secondary-action justify-self-end px-4 text-xs font-semibold disabled:opacity-50"
                    >
                      {busy === "password" ? c.changing : c.changePassword}
                    </button>
                  </form>
                </div>
              </Panel>
            </div>

            <div className="grid content-start gap-3">
              <Panel
                id="staff-roles"
                icon={UsersRound}
                title={c.staffRoles}
                description={c.staffDesc}
                action={
                  <button
                    onClick={() => setStaffForm(!staffForm)}
                    className="secondary-action inline-flex items-center gap-1.5 px-3 text-[11px] font-bold"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {c.staff}
                  </button>
                }
              >
                <div className="flex h-full min-h-0 flex-col gap-3">
                  <p className="text-xs text-[var(--text-secondary)]">
                    {lang === "tr"
                      ? "Personel adı, rolü ve PIN özeti erişim yönetimi için işletmenin sunucusunda tutulur."
                      : "Staff names, roles and PIN hashes are stored on the restaurant server for access management."}{" "}
                    <a href="/privacy" className="underline">
                      {lang === "tr" ? "Veri kullanımı" : "Data use"}
                    </a>
                  </p>
                  {staffForm && (
                    <form
                      onSubmit={addStaff}
                      className="grid shrink-0 gap-2 rounded-[var(--radius-control)] border border-[var(--accent)] bg-[var(--accent-soft)] p-3 sm:grid-cols-[1fr_.8fr_.65fr_auto] sm:items-end"
                    >
                      <Field label={c.fullName}>
                        <input
                          className={inputClass}
                          value={staffDraft.name}
                          onChange={(e) => setStaffDraft({ ...staffDraft, name: e.target.value })}
                          placeholder={c.staffName}
                          autoFocus
                        />
                      </Field>
                      <Field label={c.role}>
                        <select
                          className={inputClass}
                          value={staffDraft.role}
                          onChange={(e) => setStaffDraft({ ...staffDraft, role: e.target.value })}
                        >
                          {roles.map(([value, label]) => (
                            <option
                              key={value}
                              value={value}
                              disabled={value === "ADMIN" && !canManageAdmins}
                            >
                              {label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label={c.temporaryPin}>
                        <input
                          className={inputClass}
                          value={staffDraft.pin}
                          onChange={(e) =>
                            setStaffDraft({
                              ...staffDraft,
                              pin: e.target.value.replace(/\D/g, "").slice(0, 8),
                            })
                          }
                          type="password"
                          inputMode="numeric"
                          autoComplete="new-password"
                          placeholder="4–8"
                        />
                      </Field>
                      <div className="flex gap-1.5">
                        <button
                          type="submit"
                          disabled={busy === "staff-add"}
                          className="primary-action flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)]"
                          aria-label={c.addStaff}
                        >
                          {busy === "staff-add" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setStaffForm(false)}
                          className="secondary-action flex h-11 w-11 items-center justify-center"
                          aria-label={c.cancel}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </form>
                  )}
                  <div className="min-h-28 rounded-[var(--radius-control)] border border-[var(--border)]">
                    {staff.length === 0 ? (
                      <div className="flex min-h-28 flex-col items-center justify-center gap-2 p-4">
                        <UserRound className="h-5 w-5 text-[var(--text-muted)]" />
                        <p className="text-xs text-[var(--text-muted)]">{c.noStaff}</p>
                      </div>
                    ) : (
                      staff.map((member) => (
                        <div
                          key={member.id}
                          className="grid min-h-[58px] grid-cols-[minmax(0,1fr)_120px_40px] items-center gap-2 border-b border-[var(--border)] px-3 last:border-b-0"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-xs font-semibold">{member.name}</div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                              <KeyRound className="h-3 w-3" />
                              {c.pinProtected} · {member.isActive === false ? c.inactive : c.active}
                            </div>
                          </div>
                          <select
                            aria-label={`${member.name} · ${c.role}`}
                            className="h-9 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-inset)] px-2 text-[11px]"
                            value={member.role}
                            disabled={
                              busy === `staff-${member.id}` ||
                              (!canManageAdmins && member.role === "ADMIN")
                            }
                            onChange={(e) => updateStaff(member, e.target.value)}
                          >
                            {roles.map(([value, label]) => (
                              <option
                                key={value}
                                value={value}
                                disabled={value === "ADMIN" && !canManageAdmins}
                              >
                                {label}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => removeStaff(member)}
                            disabled={
                              busy === `staff-${member.id}` ||
                              (!canManageAdmins && member.role === "ADMIN")
                            }
                            className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--danger-surface)] hover:text-[var(--danger)]"
                            aria-label={`${member.name} · ${c.removeStaff}`}
                          >
                            {busy === `staff-${member.id}` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {roles.map(([value, label]) => (
                      <span key={value} className="status-chip text-[9px] font-bold">
                        {label}: {staff.filter((item) => item.role === value).length}
                      </span>
                    ))}
                  </div>
                </div>
              </Panel>

              <Panel
                id="device-settings"
                icon={Zap}
                title={c.devicesTitle}
                description={c.devicesDesc}
                action={
                  <button
                    onClick={saveDevices}
                    disabled={busy === "devices" || qrAddressBusy}
                    className="primary-action inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-[11px] font-bold disabled:opacity-50"
                  >
                    {busy === "devices" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    {c.save}
                  </button>
                }
              >
                <Notice tone="neutral">
                  <strong>{c.connectionStepsLead}</strong> {c.connectionSteps}
                </Notice>
                <section
                  className="mt-3 rounded-[var(--radius-control)] border border-[var(--accent)] bg-[var(--accent-soft)] p-3"
                  aria-labelledby="qr-address-title"
                >
                  <div className="flex items-start gap-3">
                    <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-strong)]" />
                    <div className="min-w-0 flex-1">
                      <h3 id="qr-address-title" className="text-xs font-bold">
                        {lang === "tr" ? "Masa QR menü adresi" : "Table QR menu address"}
                      </h3>
                      <p className="mt-1 text-[10px] leading-4 text-[var(--text-secondary)]">
                        {lang === "tr"
                          ? "Boş bırakıldığında uygulama yerel IP adresini bulur. Farklı bir adres gerekiyorsa tam adresi girin; örnek: http://192.168.1.20:3000"
                          : "Leave blank to discover this device's local IP. Enter a full address only if you need an override; for example: http://192.168.1.20:3000"}
                      </p>
                      <div className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <Field
                          label={lang === "tr" ? "İsteğe bağlı adres" : "Optional address override"}
                        >
                          <input
                            type="url"
                            inputMode="url"
                            className={inputClass}
                            value={devices.network.qrBaseUrl}
                            onChange={(event) =>
                              setDevices((current) => ({
                                ...current,
                                network: { ...current.network, qrBaseUrl: event.target.value },
                              }))
                            }
                            placeholder="http://192.168.1.20:3000"
                          />
                        </Field>
                        <div className="flex flex-wrap items-end gap-2">
                          {networkAddress ? (
                            <>
                              <button
                                type="button"
                                onClick={copyNetworkAddress}
                                className="secondary-action inline-flex min-h-11 items-center gap-1.5 px-3 text-[10px] font-semibold"
                              >
                                {addressCopied ? (
                                  <Check className="h-3.5 w-3.5" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                                {addressCopied
                                  ? lang === "tr"
                                    ? "Kopyalandı"
                                    : "Copied"
                                  : lang === "tr"
                                    ? "Kopyala"
                                    : "Copy"}
                              </button>
                              <Link
                                href="/admin/tables"
                                className="secondary-action inline-flex min-h-11 items-center gap-1.5 px-3 text-[10px] font-semibold"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                {lang === "tr" ? "Masalar ve QR" : "Tables & QR"}
                              </Link>
                            </>
                          ) : (
                            <span className="pb-2 text-[10px] text-[var(--danger)]">
                              {lang === "tr"
                                ? "Ağ adresi henüz bulunamadı"
                                : "Network address not available yet"}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => saveQrAddress()}
                          disabled={qrAddressBusy || Boolean(busy)}
                          className="primary-action inline-flex min-h-11 items-center gap-2 px-3 text-xs font-semibold disabled:opacity-50"
                        >
                          {qrAddressBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                          {lang === "tr" ? "QR adresini kaydet" : "Save QR address"}
                        </button>
                        <button
                          type="button"
                          onClick={() => saveQrAddress("")}
                          disabled={qrAddressBusy || Boolean(busy)}
                          className="secondary-action inline-flex min-h-11 items-center gap-2 px-3 text-xs font-semibold disabled:opacity-50"
                        >
                          <RefreshCw className="h-4 w-4" />
                          {lang === "tr" ? "Otomatik adresi kullan" : "Use automatic address"}
                        </button>
                      </div>
                      {qrAddressNotice && (
                        <div
                          className="mt-3"
                          role={qrAddressNotice.tone === "danger" ? "alert" : "status"}
                        >
                          <Notice tone={qrAddressNotice.tone}>{qrAddressNotice.message}</Notice>
                        </div>
                      )}
                      <p className="mt-2 text-[10px] leading-4 text-[var(--text-muted)]">
                        {lang === "tr"
                          ? "localhost yalnızca bu bilgisayardaki önizleme içindir. Telefon QR kodunda yukarıdaki ağ adresi kullanılır."
                          : "localhost is only for previewing on this computer. Phone QR codes use the network address above."}
                      </p>
                      <p className="mt-2 text-[10px] leading-4 text-[var(--text-muted)]">
                        {lang === "tr"
                          ? "QR kodu telefonda denemek için aynı Wi-Fi ağına bağlanın. Güvenlik duvarı veya misafir ağı erişimi engelleyebilir."
                          : "Use a phone on the same Wi-Fi to test the QR link. A firewall or guest network may block access."}
                      </p>
                    </div>
                  </div>
                </section>
                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                  <div className="grid content-start gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-semibold">
                        <Printer className="h-4 w-4 text-[var(--accent)]" />
                        {c.receiptPrinter}
                      </div>
                      <button
                        onClick={() => testDevice("printer")}
                        disabled={busy === "test-printer" || qrAddressBusy}
                        className="secondary-action inline-flex min-h-9 items-center gap-1.5 px-2.5 text-[10px] font-bold"
                      >
                        {busy === "test-printer" ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <ReceiptText className="h-3 w-3" />
                        )}
                        {c.testReceipt}
                      </button>
                    </div>
                    <Field label={c.connectionMethod}>
                      <select
                        className={inputClass}
                        value={devices.printer.type}
                        onChange={(e) =>
                          setDevices({
                            ...devices,
                            printer: { ...devices.printer, type: e.target.value },
                          })
                        }
                      >
                        <option value="BROWSER">{c.browserPrint}</option>
                        <option value="TCP">{c.tcpPrint}</option>
                        <option value="WINDOWS">{c.windowsQueue}</option>
                      </select>
                    </Field>
                    {devices.printer.type === "TCP" && (
                      <div className="grid grid-cols-[1fr_90px] gap-2">
                        <Field label={c.printerIp}>
                          <input
                            className={inputClass}
                            value={devices.printer.host}
                            onChange={(e) =>
                              setDevices({
                                ...devices,
                                printer: { ...devices.printer, host: e.target.value },
                              })
                            }
                            placeholder="192.168.1.50"
                          />
                        </Field>
                        <Field label={c.port}>
                          <input
                            className={inputClass}
                            inputMode="numeric"
                            value={devices.printer.port}
                            onChange={(e) =>
                              setDevices({
                                ...devices,
                                printer: {
                                  ...devices.printer,
                                  port: e.target.value.replace(/\D/g, ""),
                                },
                              })
                            }
                            placeholder="9100"
                          />
                        </Field>
                      </div>
                    )}
                    {devices.printer.type === "WINDOWS" && (
                      <Field label={c.windowsPrinterName} hint={c.windowsPrinterHint}>
                        <input
                          className={inputClass}
                          value={devices.printer.printerName}
                          onChange={(e) =>
                            setDevices({
                              ...devices,
                              printer: { ...devices.printer, printerName: e.target.value },
                            })
                          }
                          placeholder="EPSON TM-T20III"
                        />
                      </Field>
                    )}
                    {devices.printer.type !== "BROWSER" && (
                      <div className="grid min-w-0 gap-3">
                        <Field
                          label={
                            lang === "tr" ? "Satır genişliği (karakter)" : "Characters per line"
                          }
                          hint={
                            lang === "tr"
                              ? "Yazıcı modeline göre ayarlayın. 58 mm için genellikle 32, 80 mm için 42 veya 48 karakter kullanılır."
                              : "Match your printer model. Common values are 32 for 58 mm, and 42 or 48 for 80 mm."
                          }
                        >
                          <input
                            type="number"
                            min="24"
                            max="64"
                            step="1"
                            className={inputClass}
                            value={devices.printer.charsPerLine}
                            onChange={(event) =>
                              setDevices((current) => ({
                                ...current,
                                printer: { ...current.printer, charsPerLine: event.target.value },
                              }))
                            }
                          />
                        </Field>
                        <label className="flex min-h-11 items-center gap-3 text-xs">
                          <input
                            type="checkbox"
                            checked={devices.printer.cutPaper}
                            onChange={(event) =>
                              setDevices((current) => ({
                                ...current,
                                printer: { ...current.printer, cutPaper: event.target.checked },
                              }))
                            }
                          />
                          <span>
                            {lang === "tr"
                              ? "Fiş sonunda kâğıdı kes (kesicili yazıcı)"
                              : "Cut paper after receipt (printer with cutter)"}
                          </span>
                        </label>
                        <label className="flex min-h-11 items-center gap-3 text-xs">
                          <input
                            type="checkbox"
                            checked={devices.printer.openCashDrawer}
                            onChange={(event) =>
                              setDevices((current) => ({
                                ...current,
                                printer: {
                                  ...current.printer,
                                  openCashDrawer: event.target.checked,
                                },
                              }))
                            }
                          />
                          <span>
                            {lang === "tr"
                              ? "Fiş gönderilince bağlı para çekmecesini aç"
                              : "Open connected cash drawer when sending receipt"}
                          </span>
                        </label>
                        <Notice>
                          {lang === "tr"
                            ? "Sunucu yazdırması ESC/POS destekli fiş yazıcısı gerektirir. Diğer yazıcılarda tarayıcıdan yazdırmayı kullanın."
                            : "Server printing requires an ESC/POS receipt printer. Use browser printing for other printers."}
                        </Notice>
                      </div>
                    )}
                    {devices.printer.type === "BROWSER" && <Notice>{c.browserPrintHint}</Notice>}
                  </div>
                  <div className="grid content-start gap-3 border-t border-[var(--border)] pt-4 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-semibold">
                        <Wifi className="h-4 w-4 text-[var(--accent)]" />
                        {c.paymentTerminal}
                      </div>
                      <span
                        className={`status-chip text-[9px] font-bold ${terminalStatus[0] === "success" ? "!border-[var(--success-border)] !bg-[var(--success-surface)] !text-[var(--success)]" : terminalStatus[0] === "danger" ? "!border-[var(--danger-border)] !bg-[var(--danger-surface)] !text-[var(--danger)]" : ""}`}
                      >
                        {terminalStatus[1]}
                      </span>
                    </div>
                    <Field label={c.integration}>
                      <select
                        className={inputClass}
                        value={devices.paymentTerminal.type}
                        onChange={(e) =>
                          setDevices({
                            ...devices,
                            paymentTerminal: {
                              ...devices.paymentTerminal,
                              type: e.target.value,
                              status: "UNCONFIGURED",
                              message: "",
                            },
                          })
                        }
                      >
                        <option value="MANUAL">{c.manualPayment}</option>
                        <option value="NEXO_LOCAL">{c.nexoLocal}</option>
                        <option value="TOKENX_CLOUD">
                          TokenX Connect Cloud ·{" "}
                          {lang === "en" ? "Bill transfer" : "Adisyon aktarımı"}
                        </option>
                      </select>
                    </Field>
                    {devices.paymentTerminal.type === "NEXO_LOCAL" && (
                      <div className="grid grid-cols-[1fr_90px] gap-2">
                        <Field label={c.terminalIp}>
                          <input
                            className={inputClass}
                            value={devices.paymentTerminal.host}
                            onChange={(e) =>
                              setDevices({
                                ...devices,
                                paymentTerminal: {
                                  ...devices.paymentTerminal,
                                  host: e.target.value,
                                },
                              })
                            }
                            placeholder="192.168.1.60"
                          />
                        </Field>
                        <Field label={c.port}>
                          <input
                            className={inputClass}
                            inputMode="numeric"
                            value={devices.paymentTerminal.port}
                            onChange={(e) =>
                              setDevices({
                                ...devices,
                                paymentTerminal: {
                                  ...devices.paymentTerminal,
                                  port: e.target.value.replace(/\D/g, ""),
                                },
                              })
                            }
                            placeholder="20007"
                          />
                        </Field>
                      </div>
                    )}
                    {devices.paymentTerminal.type === "TOKENX_CLOUD" && (
                      <div className="grid min-w-0 gap-3">
                        <Field
                          label={lang === "en" ? "Terminal fiscal ID" : "Cihaz mali numarası"}
                          hint="AV… / AT…"
                        >
                          <input
                            className={inputClass}
                            value={devices.paymentTerminal.terminalId}
                            onChange={(e) =>
                              setDevices((value) => ({
                                ...value,
                                paymentTerminal: {
                                  ...value.paymentTerminal,
                                  terminalId: e.target.value,
                                  status: "UNCONFIGURED",
                                },
                              }))
                            }
                          />
                        </Field>
                        <p className="text-[11px] text-[var(--text-secondary)]">
                          {lang === "en"
                            ? "Fetch the terminal departments, then match every menu category. Tax rates come from the terminal."
                            : "Önce cihaz kısımlarını alın, ardından her menü kategorisini eşleştirin. KDV oranları cihazdan alınır."}
                        </p>
                        {[
                          ...new Set([
                            ...deviceCategories,
                            ...Object.keys(devices.paymentTerminal.categorySections || {}),
                          ]),
                        ].map((category) => (
                          <Field key={category} label={category}>
                            <select
                              className={inputClass}
                              value={devices.paymentTerminal.categorySections?.[category] || ""}
                              onChange={(e) =>
                                setDevices((value) => {
                                  const mappings = { ...value.paymentTerminal.categorySections };
                                  if (e.target.value) mappings[category] = Number(e.target.value);
                                  else delete mappings[category];
                                  return {
                                    ...value,
                                    paymentTerminal: {
                                      ...value.paymentTerminal,
                                      categorySections: mappings,
                                    },
                                  };
                                })
                              }
                            >
                              <option value="">
                                {lang === "en"
                                  ? "Select terminal department"
                                  : "Cihaz kısmını seçin"}
                              </option>
                              {!fiscalSections.some(
                                (section) =>
                                  section.sectionNo ===
                                  devices.paymentTerminal.categorySections?.[category]
                              ) &&
                                devices.paymentTerminal.categorySections?.[category] && (
                                  <option
                                    value={devices.paymentTerminal.categorySections[category]}
                                  >
                                    {devices.paymentTerminal.categorySections[category]}
                                  </option>
                                )}
                              {fiscalSections.map((section) => (
                                <option key={section.sectionNo} value={section.sectionNo}>
                                  {section.sectionNo} · {section.name} · %{section.taxPercent / 100}
                                </option>
                              ))}
                            </select>
                          </Field>
                        ))}
                        <Notice>
                          {lang === "en"
                            ? "The full TRY bill is sent automatically when you select card payment. Complete payment on the terminal and confirm it in TEPSY. Partial payments are not supported by this transfer yet. The provider account must be configured on the server."
                            : "Kart tahsilatını seçtiğinizde tam TL adisyon otomatik aktarılır. Ödemeyi cihazda tamamlayıp TEPSY'de doğrulayın. Bu aktarım henüz parçalı tahsilatı desteklemez. Sağlayıcı hesabı sunucuda tanımlanmalıdır."}
                        </Notice>
                      </div>
                    )}
                    {devices.paymentTerminal.type === "MANUAL" ? (
                      <Notice>{c.manualPaymentHint}</Notice>
                    ) : (
                      <>
                        {devices.paymentTerminal.type === "NEXO_LOCAL" && (
                          <Notice tone="warning">{c.terminalWarning}</Notice>
                        )}
                        <button
                          onClick={() => testDevice("paymentTerminal")}
                          disabled={busy === "test-paymentTerminal" || qrAddressBusy}
                          className="secondary-action inline-flex items-center justify-center gap-2 text-xs font-semibold"
                        >
                          {busy === "test-paymentTerminal" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Zap className="h-4 w-4" />
                          )}
                          {devices.paymentTerminal.type === "TOKENX_CLOUD"
                            ? lang === "en"
                              ? "Fetch terminal departments"
                              : "Cihaz kısımlarını al"
                            : c.testConnection}
                        </button>
                      </>
                    )}
                    {devices.paymentTerminal.message && (
                      <p className="text-[10px] text-[var(--text-muted)]">
                        {devices.paymentTerminal.message}
                      </p>
                    )}
                  </div>
                </div>
                <LegalLinks />
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Download className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                    <div>
                      <div className="text-[11px] font-semibold">{c.backup}</div>
                      <div className="max-w-xl text-[9px] leading-4 text-[var(--text-muted)]">
                        {c.backupHint}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={exportBackup}
                    disabled={busy === "backup"}
                    className="secondary-action inline-flex min-h-9 shrink-0 items-center gap-1.5 px-3 text-[10px] font-bold disabled:opacity-50"
                  >
                    {busy === "backup" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                    {busy === "backup" ? c.exporting : c.exportBackup}
                  </button>
                </div>
              </Panel>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
