const fs = require("fs");
const path = require("path");
const {
  resolveRuntimeConfig,
  validateSessionSecret,
  resolveStateFile,
} = require("./scripts/runtime-config.cjs");

const environmentPath = path.resolve(process.cwd(), ".env");
let runtimeConfig;
try {
  if (fs.existsSync(environmentPath)) process.loadEnvFile(environmentPath);
  runtimeConfig = resolveRuntimeConfig(process.env, process.cwd());
} catch (error) {
  console.error("Startup configuration failed:", error);
  throw error;
}

const productionMode =
  process.argv.includes("--production") || process.env.NODE_ENV === "production";
if (productionMode) process.env.NODE_ENV = "production";

const { createServer } = require("http");
const next = require("next");
const { Server } = require("socket.io");
const os = require("os");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const {
  allowedRolesForPath,
  currentStaffSession,
  requiresLocalBootstrap,
  scheduleSessionExpiryDisconnect,
  decodeCookieValue,
  getSocketAuthorizationRevision,
} = require("./src/lib/security-policy.cjs");
const { credentialSessionVersion } = require("./src/lib/owner-auth-version.cjs");
const { selectLocalIPv4 } = require("./src/lib/network-address.cjs");
const { createBootstrapAccessResponse } = require("./src/lib/bootstrap-required-response.cjs");
const { canAccessInitialSetup } = require("./src/lib/setup-policy.cjs");
const { isLegalPath } = require("./src/lib/legal-paths.cjs");
const { isAllowedRequestHost } = require("./src/lib/request-host.cjs");
const { sessionTokenKey } = require("./src/lib/session-revocation.cjs");
const { verifySessionToken: verifyLocalSession } = require("./src/lib/session-token.cjs");

const localStateDirectory = path.join(process.cwd(), ".tepsy");
fs.mkdirSync(localStateDirectory, { recursive: true });

const sessionSecretPath = resolveStateFile("session-secret");
if (!process.env.TEPSY_SESSION_SECRET && !process.env.RESTOPOS_SESSION_SECRET) {
  if (!fs.existsSync(sessionSecretPath)) {
    fs.writeFileSync(sessionSecretPath, crypto.randomBytes(48).toString("hex"), {
      encoding: "utf8",
      mode: 0o600,
    });
  }
  process.env.TEPSY_SESSION_SECRET = fs.readFileSync(sessionSecretPath, "utf8").trim();
  process.env.RESTOPOS_SESSION_SECRET = process.env.TEPSY_SESSION_SECRET;
} else if (!process.env.TEPSY_SESSION_SECRET) {
  process.env.TEPSY_SESSION_SECRET = process.env.RESTOPOS_SESSION_SECRET;
} else if (!process.env.RESTOPOS_SESSION_SECRET) {
  process.env.RESTOPOS_SESSION_SECRET = process.env.TEPSY_SESSION_SECRET;
}
try {
  validateSessionSecret(process.env.TEPSY_SESSION_SECRET);
} catch (error) {
  console.error("Startup configuration failed:", error);
  throw error;
}

// Shared Prisma client for the CommonJS server environment.
const databaseUrl = "file:" + runtimeConfig.databasePath.replaceAll("\\", "/");
const prisma = global.prisma || new PrismaClient({ datasources: { db: { url: databaseUrl } } });
global.prisma = prisma;

const authConfigCache = global.__tepsyAuthConfigCache ||
  global.__restoposAuthConfigCache || { value: null, expiresAt: 0 };
global.__tepsyAuthConfigCache = authConfigCache;
global.__restoposAuthConfigCache = authConfigCache;

async function getAuthConfig() {
  if (authConfigCache.expiresAt > Date.now()) return authConfigCache.value;
  const config = await prisma.restaurantConfig.findFirst({
    select: { authEnabled: true, accessPasswordHash: true, isSetupCompleted: true },
  });
  authConfigCache.value = config;
  authConfigCache.expiresAt = Date.now() + 3000;
  return config;
}

function readCookie(cookieHeader, name) {
  const match = String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return match ? decodeCookieValue(match.slice(name.length + 1)) : "";
}

function isPublicPath(pathname, config) {
  return (
    pathname === "/login" ||
    pathname === "/account-help" ||
    isLegalPath(pathname) ||
    /^\/menu\/[^/]+$/.test(pathname) ||
    pathname === "/api/public/menu" ||
    /^\/api\/public\/menu-images\/[a-f0-9]{64}\.webp$/.test(pathname) ||
    pathname === "/api/public/orders" ||
    pathname === "/api/public/service-requests" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth") ||
    ((pathname === "/setup" || pathname.startsWith("/api/setup")) && !config?.isSetupCompleted) ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.png" ||
    [
      "/apple-icon.png",
      "/manifest.webmanifest",
      "/brand/logo.png",
      "/brand/mark.png",
      "/brand/app-192.png",
      "/brand/app-512.png",
    ].includes(pathname)
  );
}

function hasTrustedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const cookieNames = require("./src/lib/session-cookies.cjs").sessionCookieNames();
const dev = !productionMode;
const hostname = runtimeConfig.host;
const port = runtimeConfig.port;
const allowedHosts = String(process.env.TEPSY_ALLOWED_HOSTS || "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

function getLocalIpAddress() {
  return selectLocalIPv4(os.networkInterfaces());
}

async function prepareDatabase() {
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
  await prisma.$queryRawUnsafe("PRAGMA synchronous = FULL;");
  await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 5000;");
  await prisma.$queryRawUnsafe("PRAGMA foreign_keys = ON;");
}

let server = null;
let io = null;
let shutdownPromise = null;
let stopRecoveryScheduler;

async function shutdown(reason) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    console.log(`Shutting down after ${reason}.`);
    stopRecoveryScheduler?.();
    try {
      if (io) {
        await new Promise((resolve) => io.close(resolve));
      } else if (server?.listening) {
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
    } catch (error) {
      console.error("HTTP server shutdown failed:", error);
    }
    try {
      await prisma.$disconnect();
    } catch (error) {
      console.error("Database disconnect failed:", error);
    }
  })();
  return shutdownPromise;
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

async function startServer() {
  await prepareDatabase();
  await app.prepare();
  if (shutdownPromise) return;

  server = createServer(async (req, res) => {
    let releaseWrite = () => {};
    try {
      if (!isAllowedRequestHost(req.headers.host, allowedHosts)) {
        res.statusCode = 421;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Unrecognized Host");
        return;
      }
      // Set performance headers
      res.setHeader("X-DNS-Prefetch-Control", "on");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.setHeader("Referrer-Policy", "same-origin");
      res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' ws: wss:"
      );

      const requestUrl = new URL(req.url, `http://${req.headers.host || `localhost:${port}`}`);
      const pathname = requestUrl.pathname;
      // Older browsers may request this URL before streamed metadata arrives.
      if (pathname === "/favicon.ico") req.url = "/icon.png";
      req.headers["x-tepsy-client-ip"] = req.socket.remoteAddress || "";
      req.headers["x-restopos-client-ip"] = req.headers["x-tepsy-client-ip"];
      const isMutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      if (isMutation && !hasTrustedOrigin(req)) {
        res.statusCode = 403;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "Request origin could not be verified." }));
        return;
      }
      const backupManagement =
        pathname === "/api/backup/recovery" &&
        (requestUrl.searchParams.get("action") || "create") === "create";
      if (isMutation && !backupManagement) {
        if (globalThis.__tepsyRecoveryRunning) {
          res.statusCode = 503;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Retry-After", "3");
          res.end(
            JSON.stringify({
              error: "Yedekleme sürüyor; aynı isteği kısa süre sonra yeniden deneyin.",
            })
          );
          return;
        }
        globalThis.__tepsyActiveWrites = (globalThis.__tepsyActiveWrites || 0) + 1;
        let released = false;
        releaseWrite = () => {
          if (!released) {
            released = true;
            globalThis.__tepsyActiveWrites--;
          }
        };
        res.once("finish", releaseWrite);
      }
      const config = await getAuthConfig();
      if (pathname === "/" && !config?.accessPasswordHash) {
        res.statusCode = 302;
        res.setHeader("Location", "/login");
        res.setHeader("Cache-Control", "no-store");
        res.end();
        return;
      }
      const isInitialSetupPath = pathname === "/setup" || pathname.startsWith("/api/setup");
      if (isInitialSetupPath && !canAccessInitialSetup(config, req.socket.remoteAddress)) {
        const isApi = pathname.startsWith("/api/");
        const error = "Initial setup can only be performed from the TEPSY server computer.";
        res.statusCode = 403;
        res.setHeader(
          "Content-Type",
          isApi ? "application/json; charset=utf-8" : "text/plain; charset=utf-8"
        );
        res.setHeader("Cache-Control", "no-store");
        if (req.method !== "HEAD") {
          res.end(isApi ? JSON.stringify({ error }) : `${error} http://localhost:${port}/setup`);
        } else {
          res.end();
        }
        return;
      }
      if (
        requiresLocalBootstrap(config, req.socket.remoteAddress) &&
        !isPublicPath(pathname, config)
      ) {
        const bootstrapResponse = createBootstrapAccessResponse({
          isApi: pathname.startsWith("/api/"),
          port,
        });
        res.statusCode = 403;
        res.setHeader("Content-Type", bootstrapResponse.contentType);
        res.setHeader("Cache-Control", "no-store");
        if (req.method !== "HEAD") res.end(bootstrapResponse.body);
        else res.end();
        return;
      }
      if (config?.authEnabled && config?.accessPasswordHash && !isPublicPath(pathname, config)) {
        const sessionCookie =
          readCookie(req.headers.cookie, cookieNames.current) ||
          readCookie(req.headers.cookie, cookieNames.legacy);
        const signed = verifyLocalSession(sessionCookie);
        const session = await currentStaffSession(
          signed,
          (id) =>
            prisma.staffUser.findUnique({
              where: { id },
              select: { id: true, role: true, isActive: true, updatedAt: true },
            }),
          credentialSessionVersion(config.accessPasswordHash)
        );
        const requiredRoles = allowedRolesForPath(pathname, req.method);
        if (!session || !requiredRoles.includes(session.role)) {
          if (pathname.startsWith("/api/")) {
            res.statusCode = session ? 403 : 401;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: session ? "Forbidden." : "Authentication required." }));
            return;
          }
          res.statusCode = 302;
          const roleHome = { ADMIN: "/", WAITER: "/order", KITCHEN: "/kitchen", CASHIER: "/pos" };
          res.setHeader("Location", session ? roleHome[session.role] || "/login" : "/login");
          res.end();
          return;
        }
      }
      await handle(req, res);
    } catch (err) {
      console.error("Request failed:", err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    } finally {
      releaseWrite();
    }
  });

  // Socket.IO real-time server
  io = new Server(server, {
    allowRequest: (req, callback) =>
      callback(null, isAllowedRequestHost(req.headers.host, allowedHosts) && hasTrustedOrigin(req)),
    serveClient: false,
    pingTimeout: 15000,
    pingInterval: 8000,
    transports: ["websocket", "polling"],
    perMessageDeflate: {
      threshold: 1024,
    },
  });

  global.io = io;

  io.use(async (socket, next) => {
    try {
      socket.data.authorizationRevision = getSocketAuthorizationRevision();
      const config = await getAuthConfig();
      if (socket.data.authorizationRevision !== getSocketAuthorizationRevision())
        return next(new Error("unauthorized"));
      if (requiresLocalBootstrap(config, socket.handshake.address))
        return next(new Error("bootstrap-required"));
      if (!config?.authEnabled || !config?.accessPasswordHash) return next();
      const sessionCookie =
        readCookie(socket.handshake.headers.cookie, cookieNames.current) ||
        readCookie(socket.handshake.headers.cookie, cookieNames.legacy);
      const signed = verifyLocalSession(sessionCookie);
      const session = await currentStaffSession(
        signed,
        (id) =>
          prisma.staffUser.findUnique({
            where: { id },
            select: { id: true, role: true, isActive: true, updatedAt: true },
          }),
        credentialSessionVersion(config.accessPasswordHash)
      );
      if (!session || socket.data.authorizationRevision !== getSocketAuthorizationRevision())
        return next(new Error("unauthorized"));
      socket.data.session = session;
      socket.data.sessionKey = sessionTokenKey(sessionCookie);
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  // Clients only receive server-validated API events; they cannot emit events.
  io.on("connection", (socket) => {
    // Access changes also invalidate handshakes not yet present in the
    // connected-socket map, including a formerly unauthenticated local socket.
    if (socket.data.authorizationRevision !== getSocketAuthorizationRevision()) {
      socket.disconnect(true);
      return;
    }
    // Logout can occur while the asynchronous handshake is still pending.
    // Check again after the socket is registered, before joining any staff room.
    if (socket.data.session) {
      const cookie =
        readCookie(socket.handshake.headers.cookie, cookieNames.current) ||
        readCookie(socket.handshake.headers.cookie, cookieNames.legacy);
      if (!verifyLocalSession(cookie)) {
        socket.disconnect(true);
        return;
      }
    }
    socket.join(`role:${socket.data.session?.role || "ADMIN"}`);
    scheduleSessionExpiryDisconnect(socket);
  });

  server.on("error", (error) => {
    if (!server.listening) return;
    console.error("HTTP server error:", error);
    process.exitCode = 1;
    void shutdown("HTTP server error");
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, hostname);
  });

  stopRecoveryScheduler = require("./src/lib/recovery.cjs").startRecoveryScheduler();
  const localIp = getLocalIpAddress();
  console.log(`\nTEPSY v1.0.0`);
  console.log(`  Local:  http://localhost:${port}`);
  if (hostname === "0.0.0.0" || hostname === "::")
    console.log(`  LAN:    http://${localIp}:${port}\n`);
}

startServer().catch(async (error) => {
  if (shutdownPromise) return;
  console.error("Server startup failed:", error);
  process.exitCode = 1;
  await shutdown("startup failure");
});
