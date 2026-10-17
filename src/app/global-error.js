"use client";
import { useEffect } from "react";
export default function GlobalError({ reset }) {
  useEffect(() => {
    try {
      const saved = localStorage.getItem("tepsy_theme") || localStorage.getItem("restopos_theme");
      const cookie = document.cookie.match(
        /(?:^|;\s*)(?:tepsy_theme|restopos_theme)=(dark|light)(?:;|$)/
      )?.[1];
      document.documentElement.dataset.theme = (saved || cookie) === "dark" ? "dark" : "light";
    } catch {
      /* Storage may be unavailable; the light fallback remains readable. */
    }
  }, []);
  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        <style>{`body{font-family:system-ui,sans-serif;margin:0;background:#f5f5f7;color:#1d1d1f;color-scheme:light}.error-retry{min-height:44px;padding:10px 20px;border-radius:12px;border:1px solid #0066cc;background:#0066cc;color:#fff;cursor:pointer;font:inherit}html[data-theme="dark"] body{background:#17181c;color:#f5f5f7;color-scheme:dark}html[data-theme="dark"] .error-retry{background:#8cc2ff;border-color:#8cc2ff;color:#0a2342}.error-retry:focus-visible{outline:3px solid #0066cc;outline-offset:3px}`}</style>
      </head>
      <body>
        <main
          style={{ maxWidth: 520, padding: 32, margin: "12vh auto", overflowWrap: "anywhere" }}
          role="alert"
        >
          <h1>TEPSY</h1>
          <p>
            Uygulama yüklenemedi. Yeniden deneyin. / The application could not load. Please try
            again.
          </p>
          <button className="error-retry" type="button" onClick={reset}>
            Yeniden dene / Try again
          </button>
        </main>
      </body>
    </html>
  );
}
