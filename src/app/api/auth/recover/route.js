export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { hashCredential } from "@/lib/auth-local";
import { readAuthenticationBody } from "@/lib/authentication-body.mjs";
import { disconnectAllSockets, invalidateAuthConfigCache } from "@/lib/security-policy.cjs";
import {
  consumeRecoveryCode,
  isLocalRecoveryRequest,
  reserveRecoveryAttempt,
} from "@/lib/owner-recovery.cjs";

export async function POST(request) {
  if (!isLocalRecoveryRequest(request))
    return NextResponse.json(
      {
        error: "Şifre kurtarma yalnızca sunucu bilgisayarından kullanılabilir.",
        code: "recovery-local-only",
      },
      { status: 403 }
    );
  const attempt = reserveRecoveryAttempt();
  if (!attempt.allowed)
    return NextResponse.json(
      { error: "Çok fazla deneme. Bir süre sonra tekrar deneyin.", code: "recovery-rate-limited" },
      { status: 429, headers: { "Retry-After": String(attempt.retryAfter) } }
    );
  try {
    const body = await readAuthenticationBody(request);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.code !== "string" ||
      body.code.length > 128 ||
      typeof body.newPassword !== "string" ||
      body.newPassword.length < 8 ||
      body.newPassword.length > 128
    )
      return NextResponse.json(
        {
          error: "Kurtarma kodu ve 8-128 karakterlik yeni şifre gerekli.",
          code: "invalid-recovery-input",
        },
        { status: 400 }
      );
    const config = await prisma.restaurantConfig.findFirst();
    const success = await consumeRecoveryCode({
      code: body.code,
      passwordHash: config?.accessPasswordHash,
      update: async () => {
        const updated = await prisma.restaurantConfig.updateMany({
          where: { id: config.id, accessPasswordHash: config.accessPasswordHash },
          data: { accessPasswordHash: hashCredential(body.newPassword), authEnabled: true },
        });
        return updated.count === 1;
      },
    });
    if (!success)
      return NextResponse.json(
        {
          error:
            "Kurtarma kodu geçersiz veya süresi dolmuş. Sunucu bilgisayarından yeni kod oluşturun.",
          code: "invalid-recovery-code",
        },
        { status: 400 }
      );
    invalidateAuthConfigCache();
    disconnectAllSockets(global.io);
    return NextResponse.json({ success: true, redirectTo: "/login" });
  } catch (error) {
    if (error.code === "invalid-auth-body")
      return NextResponse.json(
        { error: "Kurtarma isteği geçersiz veya çok büyük.", code: error.code },
        { status: error.status }
      );
    if (error instanceof SyntaxError)
      return NextResponse.json(
        { error: "Geçersiz JSON isteği.", code: "invalid-recovery-input" },
        { status: 400 }
      );
    console.error("Owner password recovery failed:", error);
    return NextResponse.json(
      {
        error:
          "Şifre kurtarma tamamlanamadı. Yeni şifrenizle giriş yapmayı deneyin; gerekirse sunucu bilgisayarından yeni kod oluşturun.",
        code: "recovery-failed",
      },
      { status: 500 }
    );
  }
}
