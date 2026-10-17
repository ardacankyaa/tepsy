const ALL_STAFF = ["ADMIN", "WAITER", "KITCHEN", "CASHIER"];

function decodeCookieValue(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return "";
  }
}

function allowedRolesForPath(pathname, method = "GET") {
  if (pathname === "/") return ["ADMIN"];
  if (pathname === "/admin/reports" && method === "GET") return ["ADMIN", "CASHIER"];
  if (pathname.startsWith("/admin")) return ["ADMIN"];
  if (pathname === "/order" || /^\/order\/[^/]+$/.test(pathname)) return ["ADMIN", "WAITER"];
  if (pathname.startsWith("/kitchen")) return ["ADMIN", "KITCHEN"];
  if (pathname.startsWith("/pos")) return ["ADMIN", "CASHIER"];
  if (
    pathname.startsWith("/api/staff") ||
    pathname.startsWith("/api/devices") ||
    pathname.startsWith("/api/reset") ||
    pathname.startsWith("/api/backup")
  )
    return ["ADMIN"];
  if (
    pathname.startsWith("/api/print") ||
    pathname.startsWith("/api/pos/payment") ||
    pathname.startsWith("/api/pos/shift") ||
    pathname === "/api/pos/terminal" ||
    pathname.startsWith("/api/reports")
  )
    return ["ADMIN", "CASHIER"];
  if (pathname.startsWith("/api/qr-requests")) return ["ADMIN", "WAITER"];
  if (pathname.startsWith("/api/service-requests")) return ["ADMIN", "WAITER"];
  if (pathname === "/setup" || pathname.startsWith("/api/setup")) return ["ADMIN"];
  if (pathname === "/api/config" && method !== "GET") return ["ADMIN"];
  if (pathname.startsWith("/api/tables/layout")) return ["ADMIN"];
  if (pathname.startsWith("/api/floor-plan/canvas") && !["GET", "HEAD", "OPTIONS"].includes(method))
    return ["ADMIN"];
  if (pathname.startsWith("/api/floor-elements") && method !== "GET") return ["ADMIN"];
  if (
    (pathname.startsWith("/api/categories") || pathname.startsWith("/api/menu-items")) &&
    method !== "GET"
  )
    return ["ADMIN"];
  if (pathname === "/api/tables" && ["POST", "DELETE"].includes(method)) return ["ADMIN"];
  if (pathname === "/api/tables" && method === "PUT") return ["ADMIN", "WAITER", "CASHIER"];
  if (pathname === "/api/orders" && method === "POST") return ["ADMIN", "WAITER", "CASHIER"];
  if (pathname.startsWith("/api/orders/") && method === "PATCH")
    return ["ADMIN", "WAITER", "KITCHEN", "CASHIER"];
  if (pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(method))
    return ["ADMIN"];
  return ALL_STAFF;
}

async function currentStaffSession(signedSession, lookup, credentialVersion) {
  if (!signedSession?.userId || !signedSession?.expiresAt || signedSession.expiresAt <= Date.now())
    return null;
  if (signedSession.userId === "owner") {
    return signedSession.role === "ADMIN" &&
      credentialVersion &&
      signedSession.credentialVersion === credentialVersion
      ? signedSession
      : null;
  }
  const staff = await lookup(signedSession.userId);
  if (!staff?.isActive || staff.role !== signedSession.role) return null;
  if (
    staff.updatedAt &&
    (!signedSession.issuedAt || new Date(staff.updatedAt).getTime() > signedSession.issuedAt)
  )
    return null;
  return signedSession;
}

function requiresLocalBootstrap(config, remoteAddress) {
  if (config?.authEnabled && config.accessPasswordHash) return false;
  return !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(String(remoteAddress || ""));
}

function canBootstrapPasswordChange(config) {
  return !config?.accessPasswordHash;
}

function canChangeOwnerPassword({ canBootstrap, knowsCurrent }) {
  return Boolean(canBootstrap || knowsCurrent);
}

function getSocketAuthorizationRevision() {
  return globalThis.__tepsySocketAuthorizationRevision || 0;
}

function invalidatePendingSocketAuthorization() {
  // Next bundles API modules separately from the CommonJS host. Keep the
  // revision in process state so both copies invalidate in-flight handshakes.
  globalThis.__tepsySocketAuthorizationRevision = getSocketAuthorizationRevision() + 1;
}

function disconnectStaffSockets(io, userId) {
  invalidatePendingSocketAuthorization();
  if (!io?.sockets?.sockets || !userId) return;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data?.session?.userId === userId) socket.disconnect(true);
  }
}

function disconnectAllSockets(io) {
  invalidatePendingSocketAuthorization();
  io?.disconnectSockets?.(true);
}

function disconnectSessionSockets(io, keys) {
  if (!io?.sockets?.sockets) return;
  const revoked = new Set(keys);
  for (const socket of io.sockets.sockets.values()) {
    if (revoked.has(socket.data?.sessionKey)) socket.disconnect(true);
  }
}

function scheduleSessionExpiryDisconnect(
  socket,
  { now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}
) {
  const expiresAt = Number(socket?.data?.session?.expiresAt);
  if (!Number.isFinite(expiresAt)) return () => {};

  let timer;
  let cancelled = false;
  const schedule = () => {
    if (cancelled) return;
    const remaining = Math.max(0, expiresAt - now());
    timer = setTimer(
      () => {
        if (cancelled) return;
        if (expiresAt <= now()) socket.disconnect(true);
        else schedule();
      },
      Math.min(remaining, 2_147_483_647)
    );
    timer?.unref?.();
  };
  const cleanup = () => {
    cancelled = true;
    clearTimer(timer);
  };
  schedule();
  socket.once?.("disconnect", cleanup);
  return cleanup;
}

function invalidateAuthConfigCache() {
  if (global.__tepsyAuthConfigCache) global.__tepsyAuthConfigCache.expiresAt = 0;
  if (global.__restoposAuthConfigCache) global.__restoposAuthConfigCache.expiresAt = 0;
}

module.exports = {
  allowedRolesForPath,
  canBootstrapPasswordChange,
  canChangeOwnerPassword,
  getSocketAuthorizationRevision,
  currentStaffSession,
  requiresLocalBootstrap,
  disconnectStaffSockets,
  disconnectAllSockets,
  disconnectSessionSockets,
  scheduleSessionExpiryDisconnect,
  invalidateAuthConfigCache,
  decodeCookieValue,
};
