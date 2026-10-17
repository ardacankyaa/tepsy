import { NextResponse } from "next/server";
import { LEGACY_SESSION_COOKIE, SESSION_COOKIE, verifySessionToken } from "@/lib/auth-local";
import { revokeSessionToken, sessionTokenKey } from "@/lib/session-revocation.cjs";
import { disconnectSessionSockets } from "@/lib/security-policy.cjs";

export async function POST(request) {
  try {
    const keys = [];
    for (const name of [SESSION_COOKIE, LEGACY_SESSION_COOKIE]) {
      const token = request.cookies?.get?.(name)?.value;
      const session = token ? verifySessionToken(token) : null;
      if (session) {
        revokeSessionToken(token, session.expiresAt);
        keys.push(sessionTokenKey(token));
      }
    }
    disconnectSessionSockets(global.io, keys);
  } catch {
    return NextResponse.json(
      { error: "Oturum güvenli şekilde kapatılamadı. Yeniden deneyin." },
      { status: 503 }
    );
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(LEGACY_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
