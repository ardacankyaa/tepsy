"use client";

import { useApp } from "@/lib/AppContext";

export default function TableCalls({ table }) {
  const { lang } = useApp();
  const calls = table.serviceRequests || [];
  if (!calls.length) return null;
  return (
    <span className="table-call-label">
      {[
        ...new Set(
          calls.map((call) =>
            call.type === "BILL"
              ? lang === "tr"
                ? "Hesap istendi"
                : "Bill requested"
              : lang === "tr"
                ? "Garson çağrısı"
                : "Waiter call"
          )
        ),
      ].join(" · ")}
    </span>
  );
}
