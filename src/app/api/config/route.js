export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import {
  credentialSessionVersion,
  normalizeRestaurantCode,
  sessionFromRequest,
} from "@/lib/auth-local";
import { normalizeRestaurantLogoUrl } from "@/lib/restaurant-logo.cjs";
import { isValidTimeZone } from "@/lib/time-zone.cjs";
import {
  currentStaffSession,
  disconnectAllSockets,
  invalidateAuthConfigCache,
} from "@/lib/security-policy.cjs";

const publicConfig = ({ accessPasswordHash, ...config }) => ({
  ...config,
  hasAccessPassword: Boolean(accessPasswordHash),
});

export async function GET() {
  try {
    const config = await prisma.restaurantConfig.findFirst();
    if (!config) {
      return NextResponse.json({
        restaurantName: "Restoranım",
        restaurantLogoUrl: null,
        tagline: "Lezzetin ve Kalitenin Buluştuğu Yer",
        restaurantCode: "TEPSY",
        currency: "₺",
        defaultLanguage: "tr",
        timeZone: "Europe/Istanbul",
        authEnabled: false,
        qrOrderEnabled: false,
        isSetupCompleted: false,
        hasAccessPassword: false,
      });
    }
    return NextResponse.json(publicConfig(config));
  } catch (error) {
    console.error("Config fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch config" }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      return NextResponse.json({ error: "Ayar bilgileri geçersiz." }, { status: 400 });
    const {
      restaurantName,
      ownerName,
      tagline,
      restaurantCode,
      currency,
      defaultLanguage,
      timeZone,
      authEnabled,
      qrOrderEnabled,
    } = body;
    for (const [field, limit] of [
      ["restaurantName", 100],
      ["ownerName", 100],
      ["tagline", 180],
      ["restaurantCode", 32],
    ]) {
      if (
        body[field] !== undefined &&
        (typeof body[field] !== "string" || body[field].trim().length > limit)
      )
        return NextResponse.json({ error: "Restoran kimlik bilgileri geçersiz." }, { status: 400 });
    }
    const restaurantLogoUrl = normalizeRestaurantLogoUrl(body.restaurantLogoUrl);
    const normalizedCode =
      restaurantCode !== undefined ? normalizeRestaurantCode(restaurantCode) : undefined;
    if (restaurantCode !== undefined && !normalizedCode.trim())
      return NextResponse.json({ error: "Restoran kodu geçersiz." }, { status: 400 });

    let config = await prisma.restaurantConfig.findFirst();
    const authChanged = authEnabled !== undefined && authEnabled !== Boolean(config?.authEnabled);
    if (config?.accessPasswordHash && authChanged) {
      const actor = await currentStaffSession(
        sessionFromRequest(request),
        (id) => prisma.staffUser.findUnique({ where: { id } }),
        credentialSessionVersion(config.accessPasswordHash)
      );
      if (actor?.userId !== "owner")
        return NextResponse.json(
          { error: "Giriş korumasını yalnızca restoran sahibi değiştirebilir." },
          { status: 403 }
        );
    }
    if (authEnabled === true && !config?.accessPasswordHash) {
      return NextResponse.json(
        { error: "Giriş korumasını açmadan önce yönetici şifresi belirleyin." },
        { status: 400 }
      );
    }
    if (
      restaurantName !== undefined &&
      (!String(restaurantName).trim() || String(restaurantName).length > 100)
    ) {
      return NextResponse.json({ error: "Restoran adı geçersiz." }, { status: 400 });
    }
    if (defaultLanguage !== undefined && !["tr", "en"].includes(defaultLanguage)) {
      return NextResponse.json({ error: "Dil seçimi geçersiz." }, { status: 400 });
    }
    if (currency !== undefined && !["₺", "$", "€", "£"].includes(currency)) {
      return NextResponse.json({ error: "Para birimi geçersiz." }, { status: 400 });
    }
    if (timeZone !== undefined && !isValidTimeZone(timeZone)) {
      return NextResponse.json({ error: "Saat dilimi geçersiz." }, { status: 400 });
    }
    if (qrOrderEnabled !== undefined && typeof qrOrderEnabled !== "boolean") {
      return NextResponse.json({ error: "QR sipariş ayarı geçersiz." }, { status: 400 });
    }
    if (authEnabled !== undefined && typeof authEnabled !== "boolean") {
      return NextResponse.json({ error: "Giriş koruması ayarı geçersiz." }, { status: 400 });
    }
    if (!config) {
      config = await prisma.restaurantConfig.create({
        data: {
          restaurantName: String(restaurantName || "Restoranım").trim(),
          restaurantLogoUrl: restaurantLogoUrl || null,
          ownerName: String(ownerName || "")
            .trim()
            .slice(0, 100),
          tagline: String(tagline || "")
            .trim()
            .slice(0, 180),
          restaurantCode: normalizedCode || "TEPSY",
          currency: currency || "₺",
          defaultLanguage: defaultLanguage || "tr",
          timeZone: timeZone || "Europe/Istanbul",
          qrOrderEnabled: Boolean(qrOrderEnabled),
          authEnabled: Boolean(authEnabled),
        },
      });
    } else {
      config = await prisma.restaurantConfig.update({
        where: { id: config.id },
        data: {
          ...(restaurantName && { restaurantName: String(restaurantName).trim() }),
          ...(restaurantLogoUrl !== undefined && { restaurantLogoUrl }),
          ...(ownerName !== undefined && { ownerName: String(ownerName).trim().slice(0, 100) }),
          ...(tagline !== undefined && { tagline: String(tagline).trim().slice(0, 180) }),
          ...(normalizedCode && { restaurantCode: normalizedCode }),
          ...(currency && { currency }),
          ...(defaultLanguage && { defaultLanguage }),
          ...(timeZone && { timeZone }),
          ...(qrOrderEnabled !== undefined && { qrOrderEnabled }),
          ...(authEnabled !== undefined && { authEnabled: Boolean(authEnabled) }),
        },
      });
    }

    if (global.io) {
      global.io.emit("config:update", publicConfig(config));
    }
    if (authChanged) {
      invalidateAuthConfigCache();
      disconnectAllSockets(global.io);
    }

    return NextResponse.json(publicConfig(config));
  } catch (error) {
    if (error?.status === 400) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "Geçersiz JSON." }, { status: 400 });
    console.error("Config update error:", error);
    return NextResponse.json({ error: "Failed to update config" }, { status: 500 });
  }
}
