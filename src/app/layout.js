import "./globals.css";
import "@/styles/preferences.css";
import "@/styles/device.css";
import "@/styles/restaurant-identity.css";
import { cookies } from "next/headers";
import { Suspense } from "react";
import Navbar from "@/components/Navbar";
import { AppProvider, SkipLink } from "@/lib/AppContext";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export async function generateMetadata() {
  const cookieStore = await cookies();
  const en =
    (cookieStore.get("tepsy_lang")?.value || cookieStore.get("restopos_lang")?.value) === "en";
  const description = en
    ? "Local restaurant orders, kitchen, checkout and table QR menu."
    : "Restoran ve kafeler için yerel sipariş, mutfak, kasa ve masa QR menüsü.";
  return {
    applicationName: "TEPSY",
    title: en ? "TEPSY | Restaurant management" : "TEPSY | Restoran yönetimi",
    description,
    robots: { index: false, follow: false },
    icons: {
      icon: [{ url: "/icon.png?v=transparent-tab-3", type: "image/png", sizes: "32x32" }],
      apple: [{ url: "/apple-icon.png", type: "image/png", sizes: "180x180" }],
      shortcut: [{ url: "/icon.png?v=transparent-tab-3", type: "image/png", sizes: "32x32" }],
    },
    openGraph: { type: "website", title: "TEPSY", description },
  };
}

export default async function RootLayout({ children }) {
  const cookieStore = await cookies();
  const langCookie =
    cookieStore.get("tepsy_lang")?.value || cookieStore.get("restopos_lang")?.value;
  const initialLang = langCookie === "en" ? "en" : "tr";
  const themeCookie =
    cookieStore.get("tepsy_theme")?.value || cookieStore.get("restopos_theme")?.value;
  const initialTheme = themeCookie === "dark" ? "dark" : "light";
  return (
    <html lang={initialLang} data-theme={initialTheme} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('tepsy_theme')||localStorage.getItem('restopos_theme')||document.documentElement.dataset.theme;document.documentElement.dataset.theme=t==='dark'?'dark':'light'}catch(e){}",
          }}
        />
      </head>
      <body className="app-shell antialiased">
        <AppProvider initialLang={initialLang}>
          <Navbar />
          <SkipLink />
          <main id="main-content" tabIndex={-1}>
            <Suspense
              fallback={
                <div role="status">
                  {initialLang === "tr" ? "Sayfa yükleniyor…" : "Loading page…"}
                </div>
              }
            >
              {children}
            </Suspense>
          </main>
        </AppProvider>
      </body>
    </html>
  );
}
