import { NextResponse } from "next/server";

const CLIENT_ERROR_CODES = new Set([
  "BROWSER_FALLBACK_REQUIRED",
  "PRINTER_DISABLED",
  "UNSUPPORTED_PLATFORM",
  "ADAPTER_NOT_IMPLEMENTED",
  "MANUAL_CONFIRMATION_REQUIRED",
]);

export function deviceErrorResponse(error, fallbackMessage = "Cihaz işlemi tamamlanamadı.") {
  const code = error?.code || "DEVICE_ERROR";
  const status = CLIENT_ERROR_CODES.has(code) ? 409 : 503;
  return NextResponse.json(
    {
      success: false,
      accepted: false,
      code,
      error: error?.message || fallbackMessage,
    },
    { status }
  );
}
