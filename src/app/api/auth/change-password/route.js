export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  credentialSessionVersion,
  hashCredential,
  sessionFromRequest,
  verifyCredential,
} from "@/lib/auth-local";
import {
  canBootstrapPasswordChange,
  canChangeOwnerPassword,
  currentStaffSession,
  disconnectAllSockets,
  invalidateAuthConfigCache,
} from "@/lib/security-policy.cjs";

import { reserveAccountAttempt, reserveAuthenticationAttempt } from "@/lib/auth-throttle.cjs";
import { readAuthenticationBody } from "@/lib/authentication-body.mjs";
import { trustedClientAddress } from "@/lib/trusted-client.cjs";

export async function POST(request) {
  try {
    const body = await readAuthenticationBody(request);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      ["currentPassword", "newPassword"].some(
        (field) =>
          body[field] !== undefined && (typeof body[field] !== "string" || body[field].length > 128)
      )
    )
      return NextResponse.json({ error: "Şifre bilgileri geçersiz." }, { status: 400 });
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (newPassword.length < 8 || newPassword.length > 128) {
      return NextResponse.json({ error: "Şifre 8-128 karakter arasında olmalı." }, { status: 400 });
    }

    const config = await prisma.restaurantConfig.findFirst();
    if (!config) return NextResponse.json({ error: "Restoran ayarı bulunamadı." }, { status: 404 });
    const signedSession = sessionFromRequest(request);
    const canBootstrap = canBootstrapPasswordChange(config);
    const clientIp = trustedClientAddress(request);
    const isLoopback =
      clientIp === "::1" || clientIp === "127.0.0.1" || clientIp === "::ffff:127.0.0.1";
    if (canBootstrap && !isLoopback) {
      return NextResponse.json(
        { error: "İlk yönetici şifresi yalnızca sunucu bilgisayarından belirlenebilir." },
        { status: 403 }
      );
    }
    const attempt = canBootstrap ? null : reserveAuthenticationAttempt(request);
    // Owner password guesses here count against the same owner lockout as login.
    const account = attempt?.allowed ? reserveAccountAttempt("owner") : attempt;
    if (attempt && (!attempt.allowed || !account.allowed)) {
      const retryAfter = attempt.allowed ? account.retryAfter : attempt.retryAfter;
      return NextResponse.json(
        { error: "Çok fazla başarısız deneme. Bir süre sonra tekrar deneyin." },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }
    const session = await currentStaffSession(
      signedSession,
      (id) =>
        prisma.staffUser.findUnique({
          where: { id },
          select: { id: true, role: true, isActive: true, updatedAt: true },
        }),
      credentialSessionVersion(config.accessPasswordHash)
    );
    const knowsCurrent =
      config.accessPasswordHash && verifyCredential(currentPassword, config.accessPasswordHash);
    if (!canChangeOwnerPassword({ canBootstrap, knowsCurrent })) {
      return NextResponse.json({ error: "Mevcut şifre doğrulanamadı." }, { status: 401 });
    }

    const newPasswordHash = hashCredential(newPassword);
    const updated = await prisma.restaurantConfig.updateMany({
      where: { id: config.id, accessPasswordHash: config.accessPasswordHash },
      data: { accessPasswordHash: newPasswordHash, authEnabled: true },
    });
    if (updated.count !== 1)
      return NextResponse.json(
        { error: "Şifre başka bir işlemde değişti. Güncel şifreyle yeniden deneyin." },
        { status: 409 }
      );
    attempt?.complete(true);
    account?.complete(true);
    invalidateAuthConfigCache();
    disconnectAllSockets(global.io);
    const identity = {
      userId: session?.userId || "owner",
      name: session?.name || config.ownerName || "İşletme Sahibi",
      role: session?.role || "ADMIN",
    };
    if (identity.userId === "owner")
      identity.credentialVersion = credentialSessionVersion(newPasswordHash);
    const response = NextResponse.json({ success: true });
    response.cookies.set(SESSION_COOKIE, createSessionToken(identity), {
      httpOnly: true,
      sameSite: "lax",
      secure: request.headers.get("x-forwarded-proto") === "https",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    if (error.code === "invalid-auth-body")
      return NextResponse.json(
        { error: "Şifre isteği geçersiz veya çok büyük." },
        { status: error.status }
      );
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "Geçersiz JSON isteği." }, { status: 400 });
    console.error("Password update failed:", error);
    return NextResponse.json({ error: "Şifre güncellenemedi." }, { status: 500 });
  }
}
