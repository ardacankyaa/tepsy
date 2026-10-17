"use client";

import { createContext, useContext, useState, useEffect, useRef } from "react";
import { translations } from "@/lib/translations";
import { usePathname } from "next/navigation";

import currencySave from "./currency-save.cjs";

const AppContext = createContext();

export function AppProvider({ children, initialLang = "tr" }) {
  const pathname = usePathname();
  const [lang, setLangState] = useState(initialLang === "en" ? "en" : "tr");
  const [currency, setCurrencyState] = useState("₺");
  const [currencySaving, setCurrencySaving] = useState(false);
  const [currencyError, setCurrencyError] = useState("");
  const currencySavePending = useRef(false);
  const [restaurantLogoUrl, setRestaurantLogoUrl] = useState(null);
  const [restaurantName, setRestaurantName] = useState("TEPSY");
  const [restaurantTagline, setRestaurantTagline] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [restaurantCode, setRestaurantCode] = useState("TEPSY");
  const configRequestVersion = useRef(0);

  useEffect(() => {
    const requestVersion = ++configRequestVersion.current;
    const controller = new AbortController();
    const savedLang = localStorage.getItem("tepsy_lang") || localStorage.getItem("restopos_lang");
    const cookieParts = document.cookie.split(";").map((part) => part.trim());
    const cookieLang = (
      cookieParts.find((part) => part.startsWith("tepsy_lang=")) ||
      cookieParts.find((part) => part.startsWith("restopos_lang="))
    )?.split("=")[1];
    const savedPreference = savedLang || cookieLang;
    const hasLanguagePreference = savedPreference === "tr" || savedPreference === "en";
    if (hasLanguagePreference) {
      setLangState(savedPreference);
    }

    const savedCurr = localStorage.getItem("tepsy_curr") || localStorage.getItem("restopos_curr");
    if (savedCurr) {
      setCurrencyState(savedCurr);
    }

    if (
      pathname.startsWith("/menu/") ||
      ["/privacy", "/terms", "/cookies", "/login"].includes(pathname)
    )
      return;

    const loadConfig = async () => {
      try {
        const res = await fetch("/api/config", { signal: controller.signal });
        if (!res.ok) throw new Error(`config-load-${res.status}`);
        const data = await res.json();
        if (controller.signal.aborted || requestVersion !== configRequestVersion.current) return;

        if (data.currency) {
          setCurrencyState(data.currency);
          localStorage.setItem("tepsy_curr", data.currency);
          localStorage.setItem("restopos_curr", data.currency);
        }
        if (data.restaurantName) setRestaurantName(data.restaurantName);
        setRestaurantLogoUrl(data.restaurantLogoUrl || null);
        if (data.tagline) setRestaurantTagline(data.tagline);
        if (data.ownerName) setOwnerName(data.ownerName);
        if (data.restaurantCode) setRestaurantCode(data.restaurantCode);
        const storedLang =
          localStorage.getItem("tepsy_lang") || localStorage.getItem("restopos_lang");
        const cookieHasLang = document.cookie.split(";").some((part) => {
          const trimmed = part.trim();
          return trimmed.startsWith("tepsy_lang=") || trimmed.startsWith("restopos_lang=");
        });
        if (
          !hasLanguagePreference &&
          !storedLang &&
          !cookieHasLang &&
          ["tr", "en"].includes(data.defaultLanguage)
        ) {
          setLangState(data.defaultLanguage);
        }
      } catch {
        // Configuration can be unavailable while the service starts or is offline.
      }
    };

    loadConfig();
    return () => {
      controller.abort();
      if (requestVersion === configRequestVersion.current) configRequestVersion.current += 1;
    };
  }, [pathname]);

  useEffect(() => {
    document.documentElement.lang = lang;
    if (!["/privacy", "/terms", "/cookies"].includes(pathname))
      document.title =
        lang === "en" ? "TEPSY | Restaurant management" : "TEPSY | Restoran yönetimi";
  }, [lang, pathname]);

  const setLang = (newLang) => {
    if (newLang !== "tr" && newLang !== "en") return;
    setLangState(newLang);
    localStorage.setItem("tepsy_lang", newLang);
    localStorage.setItem("restopos_lang", newLang);
    document.cookie = `tepsy_lang=${newLang}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.cookie = `restopos_lang=${newLang}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = newLang;
  };

  const setCurrency = async (newCurr) => {
    if (currencySavePending.current) return false;
    currencySavePending.current = true;
    configRequestVersion.current += 1;
    setCurrencySaving(true);
    setCurrencyError("");
    try {
      const savedCurrency = await currencySave.saveCurrency(fetch, newCurr);
      configRequestVersion.current += 1;
      setCurrencyState(savedCurrency);
      try {
        localStorage.setItem("tepsy_curr", savedCurrency);
        localStorage.setItem("restopos_curr", savedCurrency);
      } catch {
        /* The server value remains authoritative when local storage is unavailable. */
      }
      return true;
    } catch {
      setCurrencyError("currency-save-failed");
      return false;
    } finally {
      currencySavePending.current = false;
      setCurrencySaving(false);
    }
  };

  const applyConfig = (config) => {
    if (config.defaultLanguage) setLang(config.defaultLanguage);
    if (config.currency) {
      setCurrencyState(config.currency);
      localStorage.setItem("tepsy_curr", config.currency);
      localStorage.setItem("restopos_curr", config.currency);
    }
    if (config.restaurantName) setRestaurantName(config.restaurantName);
    if (config.restaurantLogoUrl !== undefined) setRestaurantLogoUrl(config.restaurantLogoUrl);
    if (config.tagline !== undefined) setRestaurantTagline(config.tagline);
    if (config.ownerName !== undefined) setOwnerName(config.ownerName);
    if (config.restaurantCode) setRestaurantCode(config.restaurantCode);
  };

  const t = (key) => {
    return translations[lang]?.[key] || translations["tr"]?.[key] || key;
  };

  const formatPrice = (amount) => {
    const num = Number(amount) || 0;
    const formattedNum = num.toLocaleString(lang === "tr" ? "tr-TR" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    if (currency === "$" || currency === "£" || currency === "€") {
      return `${currency}${formattedNum}`;
    }
    return `${formattedNum} ${currency}`;
  };

  return (
    <AppContext.Provider
      value={{
        lang,
        setLang,
        currency,
        setCurrency,
        currencySaving,
        currencyError,
        applyConfig,
        restaurantName,
        restaurantLogoUrl,
        restaurantTagline,
        ownerName,
        restaurantCode,
        t,
        formatPrice,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}

export function SkipLink() {
  const { lang } = useApp();
  return (
    <a className="skip-link" href="#main-content">
      {lang === "tr" ? "İçeriğe geç" : "Skip to content"}
    </a>
  );
}
