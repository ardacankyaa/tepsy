"use client";

import { useState } from "react";
import RestaurantLogoField from "@/components/RestaurantLogoField";
import { normalizeSetupCredentials } from "@/lib/setup-credentials.cjs";
import Link from "next/link";
import { useApp } from "@/lib/AppContext";
import { ScrollPanel } from "@/components/ui/Workspace";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Plus,
  Store,
  Table as TableIcon,
  Trash2,
  UtensilsCrossed,
  Wand2,
} from "lucide-react";

const MAX_TABLES_PER_SECTION = 20;

const sampleCategories = [
  {
    name: "Sıcak Kahveler",
    items: [
      { name: "Espresso", price: 65, description: "Geleneksel yoğun İtalyan espressosu" },
      { name: "Türk Kahvesi", price: 55, description: "Közde ağır ateşte pişirilmiş taze kahve" },
      { name: "Filtre Kahve", price: 75, description: "Taze çekilmiş %100 Arabica çekirdek" },
      { name: "Caffe Latte", price: 85, description: "Kremamsı süt köpüğü ve taze espresso" },
      { name: "Cappuccino", price: 85, description: "Eşit oranda espresso, süt ve yoğun köpük" },
    ],
  },
  {
    name: "Soğuk İçecekler",
    items: [
      { name: "Iced Latte", price: 95, description: "Buzlu süt ve taze çift shot espresso" },
      { name: "Ev Yapımı Limonata", price: 75, description: "Taze nane ve sıkma limon ferahlığı" },
      { name: "Cold Brew", price: 105, description: "18 saat soğuk demlenmiş özel kahve" },
    ],
  },
  {
    name: "Tatlılar & Fırın",
    items: [
      { name: "San Sebastian Cheesecake", price: 140, description: "Belçika çikolatası sosu ile" },
      { name: "Tiramisu", price: 120, description: "Özel mascarpone peynirli İtalyan klasiği" },
      {
        name: "Tereyağlı Kruvasan",
        price: 80,
        description: "Fransız usulü çıtır kat kat kruvasan",
      },
    ],
  },
  {
    name: "Yemekler & Atıştırmalık",
    items: [
      {
        name: "Özel Burger",
        price: 240,
        description: "180gr dana köfte, cheddar, patates kızartması",
      },
      { name: "Tavuklu Sezar Salata", price: 180, description: "Izgara tavuk, kruton ve parmesan" },
      { name: "Club Sandwich", price: 160, description: "Kaşar, hindi füme, domates ve patates" },
    ],
  },
];

export default function SetupWizardPage() {
  const { t, lang } = useApp();
  const isTr = lang === "tr";
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [restaurantName, setRestaurantName] = useState("Restoranım");
  const [restaurantCode, setRestaurantCode] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [ownerPasswordConfirm, setOwnerPasswordConfirm] = useState("");
  const [restaurantLogoUrl, setRestaurantLogoUrl] = useState(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState("₺");
  const [sections, setSections] = useState(() =>
    isTr
      ? [
          { name: "İç Mekan", tableCount: 6 },
          { name: "Bahçe", tableCount: 4 },
          { name: "Teras", tableCount: 4 },
        ]
      : [
          { name: "Dining room", tableCount: 6 },
          { name: "Garden", tableCount: 4 },
          { name: "Terrace", tableCount: 4 },
        ]
  );
  const [menuType, setMenuType] = useState("TEMPLATE");

  const handleAddSection = () => {
    setSections((current) => [
      ...current,
      { name: `${isTr ? "Bölüm" : "Section"} ${current.length + 1}`, tableCount: 4 },
    ]);
  };

  const handleRemoveSection = (index) => {
    setSections((current) =>
      current.length <= 1 ? current : current.filter((_, itemIndex) => itemIndex !== index)
    );
  };

  const handleUpdateSection = (index, field, value) => {
    setSections((current) =>
      current.map((section, itemIndex) =>
        itemIndex === index ? { ...section, [field]: value } : section
      )
    );
  };

  const getSectionError = () => {
    if (sections.some((section) => !String(section.name).trim())) {
      return isTr ? "Her bölüm için bir ad girin." : "Enter a name for each section.";
    }
    if (
      sections.some((section) => {
        const count = Number(section.tableCount);
        return !Number.isInteger(count) || count < 1 || count > MAX_TABLES_PER_SECTION;
      })
    ) {
      return isTr
        ? "Her bölümde 1 ile 20 arasında masa olmalı. Masa sayısı bölüm başına en fazla 20 olabilir."
        : "Each section must have 1 to 20 tables. The limit is 20 tables per section.";
    }
    return "";
  };

  const handleNext = () => {
    setErrorMessage("");
    if (step === 1) {
      const credentials = normalizeSetupCredentials({
        restaurantCode,
        ownerPassword,
        ownerPasswordConfirm,
      });
      if (!restaurantName.trim() || credentials.error) {
        setErrorMessage(
          isTr
            ? credentials.error || "İşletme adını girin."
            : "Enter a restaurant name and a 2–32 character code. Use matching passwords of 8–128 characters."
        );
        return;
      }
    }
    if (step === 2) {
      const sectionError = getSectionError();
      if (sectionError) {
        setErrorMessage(sectionError);
        return;
      }
    }
    setStep((current) => Math.min(3, current + 1));
  };

  const handleCompleteSetup = async () => {
    const sectionError = getSectionError();
    if (sectionError) {
      setErrorMessage(sectionError);
      setStep(2);
      return;
    }

    setLoading(true);
    setErrorMessage("");
    try {
      const payload = {
        restaurantName,
        restaurantCode,
        ownerPassword,
        ownerPasswordConfirm,
        restaurantLogoUrl,
        currency: selectedCurrency,
        sections: sections.map((section) => ({
          name: section.name.trim(),
          tableCount: Number.parseInt(section.tableCount, 10),
        })),
        categories: menuType === "TEMPLATE" ? sampleCategories : [],
      };

      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        window.location.href = "/login?setup=complete";
      } else {
        const data = await response.json().catch(() => ({}));
        setErrorMessage(
          isTr
            ? data.error || "Kurulum tamamlanamadı."
            : response.status === 409
              ? "Setup cannot run because restaurant data is already configured."
              : "Setup could not be completed. Check the details and try again."
        );
      }
    } catch (error) {
      console.error(error);
      setErrorMessage(
        isTr ? "Bağlantı hatası oluştu." : "A connection error prevented setup from completing."
      );
    } finally {
      setLoading(false);
    }
  };

  const stepTitle =
    step === 1
      ? isTr
        ? "İşletme bilgileri"
        : "Restaurant details"
      : step === 2
        ? isTr
          ? "Salon ve masalar"
          : "Sections and tables"
        : isTr
          ? "Menü seçimi"
          : "Menu choice";
  const StepIcon = step === 1 ? Store : step === 2 ? TableIcon : UtensilsCrossed;

  return (
    <div className="setup-wizard flex h-[calc(100dvh-var(--header-height))] w-full items-center justify-center overflow-hidden bg-[var(--canvas)] p-3 sm:p-6">
      <section className="setup-wizard-card flex h-full max-h-[min(760px,calc(100dvh-2rem))] min-h-0 w-full max-w-3xl flex-col overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--surface)] shadow-xs">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--border)] px-5 py-4 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-[var(--accent-soft)] text-[var(--accent)]">
              <Wand2 size={21} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="page-title">{t("setupWizardTitle")}</h1>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{stepTitle}</p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {t("step")} {step}/3
            </p>
            <div
              className="mt-2 flex justify-end gap-1.5"
              role="img"
              aria-label={isTr ? `3 adımdan ${step}. adım` : `Step ${step} of 3`}
            >
              {[1, 2, 3].map((item) => (
                <span
                  key={item}
                  className={`h-1.5 w-6 rounded-full ${item <= step ? "bg-[var(--accent)]" : "bg-[var(--surface-strong)]"}`}
                />
              ))}
            </div>
          </div>
        </header>

        {errorMessage && (
          <div
            role="alert"
            aria-live="assertive"
            className="mx-5 mt-4 flex shrink-0 items-start gap-2 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-surface)] px-3 py-2.5 text-sm text-[var(--danger)] sm:mx-7"
          >
            <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}

        <ScrollPanel className="min-h-0 px-5 sm:px-7" label={stepTitle}>
          {step === 1 && (
            <section className="space-y-7 py-6" aria-labelledby="setup-step-title">
              <div>
                <div className="mb-4 flex items-center gap-3">
                  <StepIcon size={20} className="text-[var(--accent)]" aria-hidden="true" />
                  <h2
                    id="setup-step-title"
                    className="text-xl font-semibold text-[var(--text-primary)]"
                  >
                    {t("restaurantName")}
                  </h2>
                </div>
                <label className="form-field">
                  <span>{t("restaurantName")}</span>
                  <input
                    type="text"
                    value={restaurantName}
                    onChange={(event) => setRestaurantName(event.target.value)}
                    placeholder={isTr ? "Örn: İşletmenizin adı" : "Example: Your restaurant name"}
                  />
                </label>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  {t("restaurantNameHint")}
                </p>
              </div>

              <RestaurantLogoField
                value={restaurantLogoUrl}
                onChange={setRestaurantLogoUrl}
                lang={lang}
                setup
                onBusyChange={setLogoUploading}
                disabled={loading}
              />
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                  {isTr ? "İşletme sahibi girişi" : "Owner sign-in"}
                </h2>
                <label className="form-field">
                  <span>{isTr ? "Restoran kodu" : "Restaurant code"}</span>
                  <input
                    name="restaurantCode"
                    value={restaurantCode}
                    onChange={(event) =>
                      setRestaurantCode(event.target.value.toLocaleUpperCase("tr-TR"))
                    }
                    autoCapitalize="characters"
                    autoComplete="organization"
                    maxLength={32}
                    placeholder={isTr ? "Örn: GURME01" : "Example: GURME01"}
                    required
                  />
                </label>
                <p className="text-sm text-[var(--text-secondary)]">
                  {isTr
                    ? "Bu kodu ve şifreyi giriş yaparken kullanacaksınız."
                    : "Use this code and password when signing in."}
                </p>
                <label className="form-field">
                  <span>{isTr ? "İşletme sahibi şifresi" : "Owner password"}</span>
                  <input
                    name="ownerPassword"
                    type="password"
                    value={ownerPassword}
                    onChange={(event) => setOwnerPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    required
                  />
                </label>
                <label className="form-field">
                  <span>{isTr ? "Şifreyi tekrar girin" : "Confirm password"}</span>
                  <input
                    name="ownerPasswordConfirm"
                    type="password"
                    value={ownerPasswordConfirm}
                    onChange={(event) => setOwnerPasswordConfirm(event.target.value)}
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    required
                  />
                </label>
                <p className="text-sm text-[var(--text-secondary)]">
                  {isTr
                    ? "En az 8 karakter kullanın. Kurulum tamamlandığında güvenli giriş etkinleşir."
                    : "Use at least 8 characters. Setup enables secure sign-in."}
                </p>
              </div>
              <fieldset className="form-field">
                <legend>{t("selectCurrency")}</legend>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {["₺", "$", "€", "£"].map((currency) => (
                    <label key={currency} className="relative cursor-pointer">
                      <input
                        className="peer sr-only"
                        type="radio"
                        name="setup-currency"
                        value={currency}
                        aria-label={
                          isTr
                            ? currency === "₺"
                              ? "Türk lirası"
                              : currency === "$"
                                ? "ABD doları"
                                : currency === "€"
                                  ? "Euro"
                                  : "İngiliz sterlini"
                            : currency === "₺"
                              ? "Turkish lira"
                              : currency === "$"
                                ? "US dollar"
                                : currency === "€"
                                  ? "Euro"
                                  : "British pound"
                        }
                        checked={selectedCurrency === currency}
                        onChange={() => setSelectedCurrency(currency)}
                      />
                      <span className="flex min-h-12 items-center justify-center rounded-xl border border-[var(--control-border)] bg-[var(--surface)] text-lg font-semibold text-[var(--text-primary)] transition-colors peer-checked:border-[var(--accent)] peer-checked:bg-[var(--accent-soft)] peer-checked:text-[var(--accent)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--accent)]">
                        {currency}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </section>
          )}

          {step === 2 && (
            <section className="space-y-5 py-6" aria-labelledby="setup-step-title">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="mb-2 flex items-center gap-3">
                    <StepIcon size={20} className="text-[var(--accent)]" aria-hidden="true" />
                    <h2
                      id="setup-step-title"
                      className="text-xl font-semibold text-[var(--text-primary)]"
                    >
                      {t("venueSectionsAndCounts")}
                    </h2>
                  </div>
                  <p className="max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
                    {isTr
                      ? "İlk kurulumda her bölüm için en fazla 20 masa oluşturulur. Bu toplam masa sınırı değildir; daha sonra Masa Yönetimi veya Kroki ekranından masa ekleyebilirsiniz."
                      : "The initial setup creates up to 20 tables per section. This is not a limit on the restaurant’s total tables; add more later from Table Management or the Floor Plan."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddSection}
                  className="secondary-action inline-flex min-h-11 items-center gap-2 px-3 text-sm font-semibold"
                >
                  <Plus size={17} aria-hidden="true" />
                  {t("addSection")}
                </button>
              </div>

              <div className="space-y-3">
                {sections.map((section, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-1 items-end gap-3 rounded-[16px] bg-[var(--surface-inset)] p-4 sm:grid-cols-[minmax(0,1fr)_160px_44px]"
                  >
                    <label className="form-field">
                      <span>{isTr ? `Bölüm ${index + 1} adı` : `Section ${index + 1} name`}</span>
                      <input
                        type="text"
                        required
                        value={section.name}
                        onChange={(event) => handleUpdateSection(index, "name", event.target.value)}
                      />
                    </label>
                    <label className="form-field">
                      <span>
                        {isTr
                          ? `Masa sayısı (en fazla ${MAX_TABLES_PER_SECTION})`
                          : `Number of tables (up to ${MAX_TABLES_PER_SECTION})`}
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={MAX_TABLES_PER_SECTION}
                        step={1}
                        required
                        value={section.tableCount}
                        onChange={(event) =>
                          handleUpdateSection(index, "tableCount", event.target.value)
                        }
                      />
                    </label>
                    {sections.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => handleRemoveSection(index)}
                        className="icon-action justify-self-end text-[var(--danger)]"
                        aria-label={
                          isTr
                            ? `${section.name || `Bölüm ${index + 1}`} bölümünü kaldır`
                            : `Remove ${section.name || `section ${index + 1}`}`
                        }
                        title={t("delete")}
                      >
                        <Trash2 size={17} aria-hidden="true" />
                      </button>
                    ) : (
                      <span aria-hidden="true" />
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="space-y-5 py-6" aria-labelledby="setup-step-title">
              <div>
                <div className="mb-2 flex items-center gap-3">
                  <StepIcon size={20} className="text-[var(--accent)]" aria-hidden="true" />
                  <h2
                    id="setup-step-title"
                    className="text-xl font-semibold text-[var(--text-primary)]"
                  >
                    {t("initialMenuSelection")}
                  </h2>
                </div>
                <p className="text-sm text-[var(--text-secondary)]">
                  {isTr
                    ? "Örnek menüyü kullanın veya boş bir menüyle başlayın."
                    : "Use the sample menu or start with a blank menu."}
                </p>
              </div>

              <fieldset className="space-y-3">
                <legend className="sr-only">{t("initialMenuSelection")}</legend>
                <label className="block cursor-pointer">
                  <input
                    className="peer sr-only"
                    type="radio"
                    name="setup-menu"
                    value="TEMPLATE"
                    checked={menuType === "TEMPLATE"}
                    onChange={() => setMenuType("TEMPLATE")}
                  />
                  <span className="block rounded-[18px] border border-[var(--control-border)] bg-[var(--surface)] p-4 transition-colors peer-checked:border-[var(--accent)] peer-checked:bg-[var(--accent-soft)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--accent)]">
                    <span className="block text-base font-semibold text-[var(--text-primary)]">
                      {t("loadSampleMenu")}
                    </span>
                    <span className="mt-1 block text-sm leading-6 text-[var(--text-secondary)]">
                      {t("loadSampleMenuHint")}
                    </span>
                  </span>
                </label>
                <label className="block cursor-pointer">
                  <input
                    className="peer sr-only"
                    type="radio"
                    name="setup-menu"
                    value="BLANK"
                    checked={menuType === "BLANK"}
                    onChange={() => setMenuType("BLANK")}
                  />
                  <span className="block rounded-[18px] border border-[var(--control-border)] bg-[var(--surface)] p-4 transition-colors peer-checked:border-[var(--accent)] peer-checked:bg-[var(--accent-soft)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--accent)]">
                    <span className="block text-base font-semibold text-[var(--text-primary)]">
                      {t("startBlankMenu")}
                    </span>
                    <span className="mt-1 block text-sm leading-6 text-[var(--text-secondary)]">
                      {t("startBlankMenuHint")}
                    </span>
                  </span>
                </label>
              </fieldset>
            </section>
          )}
        </ScrollPanel>

        <p className="shrink-0 px-5 pb-3 text-xs leading-5 text-[var(--text-secondary)] sm:px-7">
          {isTr ? (
            <>
              İşletme ve personel bilgileri ile kurulum verileri, bu sistemi kullanan işletmenin
              sunucusunda işlenir.{" "}
              <Link href="/privacy" className="font-semibold text-[var(--accent)] underline">
                Gizlilik ayrıntıları
              </Link>
            </>
          ) : (
            <>
              Business and staff information, along with setup data, is processed on the server
              operated by the restaurant using this system.{" "}
              <Link href="/privacy" className="font-semibold text-[var(--accent)] underline">
                Privacy details
              </Link>
            </>
          )}
        </p>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-4 sm:px-7">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => {
                setErrorMessage("");
                setStep((current) => current - 1);
              }}
              className="secondary-action inline-flex min-h-12 items-center gap-2 px-4 text-sm font-semibold"
            >
              <ArrowLeft size={17} aria-hidden="true" />
              <span>{t("back")}</span>
            </button>
          ) : (
            <span />
          )}

          {step < 3 ? (
            <button
              type="button"
              onClick={handleNext}
              disabled={logoUploading}
              className="primary-action inline-flex min-h-12 items-center gap-2 px-5 text-sm font-semibold"
            >
              <span>{t("next")}</span>
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCompleteSetup}
              disabled={loading || logoUploading}
              className="primary-action inline-flex min-h-12 items-center gap-2 px-5 text-sm font-semibold disabled:opacity-50"
            >
              <Check size={17} aria-hidden="true" />
              <span>{loading ? t("settingUp") : t("completeSetup")}</span>
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
