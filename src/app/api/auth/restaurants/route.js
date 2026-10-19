export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { sessionFromRequest, credentialSessionVersion, verifyCredential } from "@/lib/auth-local";
import { isLoopbackAddress } from "@/lib/setup-policy.cjs";
import { reserveAuthenticationAttempt } from "@/lib/auth-throttle.cjs";
import { readAuthenticationBody } from "@/lib/authentication-body.mjs";
import installations from "@/lib/restaurant-installations.cjs";

function response(body, status = 200, headers = {}) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
function localOnly(request) {
  return (
    process.env.TEPSY_DEMO_MODE !== "1" &&
    isLoopbackAddress(request.headers.get("x-tepsy-client-ip"))
  );
}
export async function GET(request) {
  if (!localOnly(request))
    return response(
      { error: "Ayrı restoran kurulumu yalnızca sunucu bilgisayarında kullanılabilir." },
      403
    );
  try {
    const state = installations.installationStatus(
      process.cwd(),
      new URL(request.url).searchParams.get("id")
    );
    return state ? response(state) : response({ error: "Kurulum bulunamadı." }, 404);
  } catch {
    return response({ error: "Kurulum durumu okunamadı." }, 500);
  }
}
export async function POST(request) {
  if (!localOnly(request))
    return response(
      { error: "Ayrı restoran kurulumu yalnızca sunucu bilgisayarında kullanılabilir." },
      403
    );
  const attempt = reserveAuthenticationAttempt(request);
  if (!attempt.allowed)
    return response({ error: "Çok fazla deneme. Bir süre sonra tekrar deneyin." }, 429, {
      "Retry-After": String(attempt.retryAfter),
    });
  try {
    const body = await readAuthenticationBody(request);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.idempotencyKey !== "string" ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(body.idempotencyKey) ||
      (body.ownerPassword !== undefined &&
        (typeof body.ownerPassword !== "string" || body.ownerPassword.length > 128))
    )
      return response({ error: "Kurulum isteği geçersiz." }, 400);
    const config = await prisma.restaurantConfig.findFirst();
    if (!config?.isSetupCompleted || !config.authEnabled || !config.accessPasswordHash)
      return response({ error: "Önce bu kurulumdaki restoran kurulumunu tamamlayın." }, 409);
    const ownerVersion = credentialSessionVersion(config.accessPasswordHash);
    if (
      !installations.hasOwnerProof(config, body.ownerPassword, sessionFromRequest(request), {
        ownerVersion,
        verifyPassword: verifyCredential,
      })
    )
      return response({ error: "Mevcut restoranın işletme sahibi şifresi gerekli." }, 401);
    const state = installations.reserveInstallation(
      process.cwd(),
      body.idempotencyKey,
      ownerVersion
    );
    attempt.complete(true);
    return response(state, 202);
  } catch (error) {
    if (error.code === "invalid-auth-body" || error instanceof SyntaxError)
      return response({ error: "Kurulum isteği geçersiz veya çok büyük." }, error.status || 400);
    console.error("Independent restaurant request failed:", error);
    return response(
      {
        error: "Kurulum başlatılamadı. Mevcut restoranınız korunuyor; aynı istekle tekrar deneyin.",
      },
      409
    );
  }
}
