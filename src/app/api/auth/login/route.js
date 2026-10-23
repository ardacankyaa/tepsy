export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  REMEMBERED_SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  credentialSessionVersion,
  normalizeRestaurantCode,
  rejectUnknownCredential,
  roleHome,
  verifyCredential,
} from "@/lib/auth-local";

import {
  loginAccountKey,
  reserveAccountAttempt,
  reserveAuthenticationAttempt,
} from "@/lib/auth-throttle.cjs";
import { readAuthenticationBody } from "@/lib/authentication-body.mjs";

export async function POST(request) {
  try {
    const body = await readAuthenticationBody(request);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      ["restaurantCode", "password", "pin", "username"].some(
        (field) =>
          body[field] !== undefined && (typeof body[field] !== "string" || body[field].length > 128)
      ) ||
      (body.rememberDevice !== undefined && typeof body.rememberDevice !== "boolean")
    )
      return NextResponse.json({ error: "Giriş bilgileri geçersiz." }, { status: 400 });
    const restaurantCode = normalizeRestaurantCode(body.restaurantCode);
    const credential = String(body.password || body.pin || "");
    const username = String(body.username || "").trim();
    const attempt = reserveAuthenticationAttempt(request);
    const account = attempt.allowed ? reserveAccountAttempt(loginAccountKey(username)) : attempt;
    if (!attempt.allowed || !account.allowed) {
      const retryAfter = attempt.allowed ? account.retryAfter : attempt.retryAfter;
      return NextResponse.json(
        { error: "Çok fazla başarısız deneme. Bir süre sonra tekrar deneyin." },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfter) },
        }
      );
    }
    const config = await prisma.restaurantConfig.findFirst();

    if (!config || !config.authEnabled || !config.accessPasswordHash) {
      return NextResponse.json(
        { error: "Güvenli giriş henüz etkinleştirilmedi." },
        { status: 409 }
      );
    }
    if (restaurantCode !== config.restaurantCode) {
      rejectUnknownCredential(credential);
      return NextResponse.json({ error: "Giriş bilgileri hatalı." }, { status: 401 });
    }

    // Every outcome performs at least one full credential hash, so timing does not
    // reveal whether a staff name exists.
    let identity = null;
    if (!username) {
      if (verifyCredential(credential, config.accessPasswordHash))
        identity = { userId: "owner", name: config.ownerName || "İşletme Sahibi", role: "ADMIN" };
    } else {
      const users = await prisma.staffUser.findMany({ where: { isActive: true } });
      const candidates = users.filter(
        (candidate) =>
          candidate.name.toLocaleLowerCase("tr-TR") === username.toLocaleLowerCase("tr-TR")
      );
      if (!candidates.length) rejectUnknownCredential(credential);
      let user = null;
      for (const candidate of candidates) {
        if (verifyCredential(credential, candidate.pinHash) && !user) user = candidate;
      }
      if (user) identity = { userId: user.id, name: user.name, role: user.role };
    }

    if (!identity) {
      return NextResponse.json({ error: "Giriş bilgileri hatalı." }, { status: 401 });
    }

    attempt.complete(true);
    account.complete(true);
    const rememberDevice = identity.userId === "owner" && body.rememberDevice === true;

    const response = NextResponse.json({
      success: true,
      session: identity,
      redirectTo: roleHome(identity.role),
    });
    const token = createSessionToken({
      ...identity,
      rememberDevice,
      ...(identity.userId === "owner"
        ? { credentialVersion: credentialSessionVersion(config.accessPasswordHash) }
        : {}),
    });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.headers.get("x-forwarded-proto") === "https",
      path: "/",
      maxAge: rememberDevice ? REMEMBERED_SESSION_MAX_AGE_SECONDS : SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    if (error.code === "invalid-auth-body")
      return NextResponse.json(
        { error: "Giriş isteği geçersiz veya çok büyük." },
        { status: error.status }
      );
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "Geçersiz JSON isteği." }, { status: 400 });
    console.error("Local login failed:", error);
    return NextResponse.json({ error: "Oturum açılamadı." }, { status: 500 });
  }
}
