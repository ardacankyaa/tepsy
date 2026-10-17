"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BellRing } from "lucide-react";
import { useApp } from "@/lib/AppContext";
import { useSocket } from "@/lib/socket-client";
import soundEngine from "@/lib/sound.mjs";
import { Dialog } from "@/components/ui/Workspace";

export default function ServiceNotifications({ enabled }) {
  const { lang } = useApp();
  const { socket } = useSocket();
  const tr = lang === "tr";
  const [calls, setCalls] = useState([]);
  const [qrCount, setQrCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let version = 0;
    const refresh = async () => {
      const current = ++version;
      try {
        const responses = await Promise.all([
          fetch("/api/service-requests", { cache: "no-store" }),
          fetch("/api/qr-requests", { cache: "no-store" }),
        ]);
        if (responses.some((response) => !response.ok)) throw new Error("requests-unavailable");
        const [services, orders] = await Promise.all(responses.map((response) => response.json()));
        if (!active || current !== version) return;
        setCalls(Array.isArray(services) ? services : []);
        setQrCount(Array.isArray(orders) ? orders.length : 0);
        setError(false);
      } catch {
        if (active && current === version) setError(true);
      }
    };
    const notify = () => {
      soundEngine.playBillRequested();
      refresh();
    };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    socket?.on("service:request", notify);
    socket?.on("qr:request", notify);
    ["connect", "service:resolved", "qr:reviewed"].forEach((event) => socket?.on(event, refresh));
    window.addEventListener("service-requests:changed", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      socket?.off("service:request", notify);
      socket?.off("qr:request", notify);
      ["connect", "service:resolved", "qr:reviewed"].forEach((event) =>
        socket?.off(event, refresh)
      );
      window.removeEventListener("service-requests:changed", refresh);
    };
  }, [enabled, socket]);

  async function resolve(call) {
    setBusy(call.id);
    try {
      const response = await fetch("/api/service-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: call.id, action: "RESOLVE" }),
      });
      if (!response.ok) throw new Error("resolve-failed");
      setCalls((current) => current.filter((item) => item.id !== call.id));
      window.dispatchEvent(new Event("service-requests:changed"));
    } catch {
      setError(true);
    } finally {
      setBusy("");
    }
  }

  if (!enabled) return null;
  const total = calls.length + qrCount;
  const title = tr ? "Bekleyen istekler" : "Pending requests";
  return (
    <>
      <div className="service-notification-summary" aria-live="polite" aria-atomic="true">
        {(total > 0 || error) && (
          <button
            type="button"
            className="service-notification-trigger"
            onClick={() => setOpen(true)}
            aria-label={`${title}: ${total}${error ? (tr ? ", liste güncellenemedi" : ", refresh failed") : ""}`}
          >
            <BellRing size={19} aria-hidden="true" />
            <span>{tr ? "İstekler" : "Requests"}</span>
            <strong>{total || "!"}</strong>
          </button>
        )}
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        className="service-notification-dialog"
      >
        {error && (
          <p role="alert">
            {tr
              ? "İstekler güncellenemedi. Bağlantıyı kontrol edin; liste yeniden denenecek."
              : "Requests could not be updated. Check your connection; the list will retry."}
          </p>
        )}
        {calls.map((call) => (
          <article className="service-notification-call" key={call.id}>
            <div>
              <strong>{call.tableLabel}</strong>
              <p>
                {call.type === "BILL"
                  ? tr
                    ? "Hesap istendi"
                    : "Bill requested"
                  : tr
                    ? "Garson çağrısı"
                    : "Waiter call"}
              </p>
            </div>
            <button
              type="button"
              disabled={Boolean(busy)}
              className="primary-action"
              onClick={() => resolve(call)}
            >
              {call.type === "BILL"
                ? tr
                  ? "Kasaya ilet"
                  : "Send to checkout"
                : tr
                  ? "İlgilenildi"
                  : "Resolved"}
            </button>
          </article>
        ))}
        {qrCount > 0 && (
          <p>
            {qrCount} {tr ? "QR siparişi onay bekliyor." : "QR orders awaiting approval."}
          </p>
        )}
        {total === 0 && !error && <p>{tr ? "Bekleyen istek yok." : "No pending requests."}</p>}
        <Link
          href="/order"
          className="secondary-action service-notification-link"
          onClick={() => setOpen(false)}
        >
          {tr ? "Tüm istekleri aç" : "Open all requests"}
        </Link>
      </Dialog>
    </>
  );
}
