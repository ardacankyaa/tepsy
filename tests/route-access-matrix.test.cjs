const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { allowedRolesForPath, isPublicPath } = require("../src/lib/security-policy.cjs");
const { canonicalRequestPath, policyRequestPath } = require("../src/lib/request-path.cjs");

const ROLES = ["ADMIN", "WAITER", "KITCHEN", "CASHIER"];
const ALL = ROLES;
const ADMIN = ["ADMIN"];
const PUBLIC = "public";
const IMAGE = `/api/public/menu-images/${"a".repeat(64)}.webp`;

// Every API route handler and staff screen, with the roles the gateway admits.
// A new route file fails the coverage test below until it is listed here.
const ROUTES = [
  ["/api/audit", "GET", ADMIN],
  ["/api/auth/change-password", "POST", PUBLIC],
  ["/api/auth/login", "POST", PUBLIC],
  ["/api/auth/logout", "POST", PUBLIC],
  ["/api/auth/recover", "POST", PUBLIC],
  ["/api/auth/restaurants", "GET", PUBLIC],
  ["/api/auth/restaurants", "POST", PUBLIC],
  ["/api/auth/status", "GET", PUBLIC],
  ["/api/backup", "GET", ADMIN],
  ["/api/backup/recovery", "GET", ADMIN],
  ["/api/backup/recovery", "POST", ADMIN],
  ["/api/categories", "GET", ALL],
  ["/api/categories", "POST", ADMIN],
  ["/api/categories", "PUT", ADMIN],
  ["/api/categories", "DELETE", ADMIN],
  ["/api/config", "GET", ALL],
  ["/api/config", "PUT", ADMIN],
  ["/api/devices", "GET", ADMIN],
  ["/api/devices", "PUT", ADMIN],
  ["/api/devices/payment/status", "GET", ADMIN],
  ["/api/devices/payment/status", "POST", ADMIN],
  ["/api/devices/printer/test", "POST", ADMIN],
  ["/api/floor-elements", "GET", ALL],
  ["/api/floor-elements", "PUT", ADMIN],
  ["/api/floor-plan/canvas", "GET", ALL],
  ["/api/floor-plan/canvas", "PUT", ADMIN],
  ["/api/menu-images", "POST", ADMIN],
  ["/api/menu-items", "GET", ALL],
  ["/api/menu-items", "POST", ADMIN],
  ["/api/menu-items", "PUT", ADMIN],
  ["/api/menu-items", "DELETE", ADMIN],
  ["/api/network-info", "GET", ALL],
  ["/api/network-info", "PUT", ADMIN],
  ["/api/orders", "GET", ALL],
  ["/api/orders", "POST", ["ADMIN", "WAITER", "CASHIER"]],
  ["/api/orders/[id]", "GET", ALL],
  ["/api/orders/[id]", "PATCH", ALL],
  ["/api/pos/payment", "POST", ["ADMIN", "CASHIER"]],
  ["/api/pos/payments", "GET", ["ADMIN", "CASHIER"]],
  ["/api/pos/payments/[id]", "GET", ["ADMIN", "CASHIER"]],
  ["/api/pos/refunds", "POST", ADMIN],
  ["/api/pos/shift", "GET", ["ADMIN", "CASHIER"]],
  ["/api/pos/shift", "POST", ["ADMIN", "CASHIER"]],
  ["/api/pos/shift", "PATCH", ["ADMIN", "CASHIER"]],
  ["/api/pos/terminal", "POST", ["ADMIN", "CASHIER"]],
  ["/api/print/receipt", "POST", ["ADMIN", "CASHIER"]],
  ["/api/public/menu", "GET", PUBLIC],
  ["/api/public/menu-images/[filename]", "GET", PUBLIC],
  ["/api/public/orders", "GET", PUBLIC],
  ["/api/public/orders", "POST", PUBLIC],
  ["/api/public/orders", "DELETE", PUBLIC],
  ["/api/public/service-requests", "POST", PUBLIC],
  ["/api/qr-requests", "GET", ["ADMIN", "WAITER"]],
  ["/api/qr-requests", "PATCH", ["ADMIN", "WAITER"]],
  ["/api/reports/z-report", "GET", ["ADMIN", "CASHIER"]],
  ["/api/reset", "POST", ADMIN],
  ["/api/service-requests", "GET", ["ADMIN", "WAITER"]],
  ["/api/service-requests", "PATCH", ["ADMIN", "WAITER"]],
  ["/api/setup", "POST", ADMIN],
  ["/api/setup/logo", "POST", ADMIN],
  ["/api/staff", "GET", ADMIN],
  ["/api/staff", "POST", ADMIN],
  ["/api/staff", "PUT", ADMIN],
  ["/api/staff", "DELETE", ADMIN],
  ["/api/tables", "GET", ALL],
  ["/api/tables", "POST", ADMIN],
  ["/api/tables", "PUT", ["ADMIN", "WAITER", "CASHIER"]],
  ["/api/tables", "DELETE", ADMIN],
  ["/api/tables/layout", "POST", ADMIN],
  ["/api/tables/layout", "PUT", ADMIN],
  ["/api/tables/qr", "POST", ADMIN],
  ["/", "GET", ADMIN],
  ["/admin", "GET", ADMIN],
  ["/admin/menu", "GET", ADMIN],
  ["/admin/tables", "GET", ADMIN],
  ["/admin/floorplan", "GET", ADMIN],
  ["/admin/reports", "GET", ["ADMIN", "CASHIER"]],
  ["/admin/settings", "GET", ADMIN],
  ["/order", "GET", ["ADMIN", "WAITER"]],
  ["/order/[tableId]", "GET", ["ADMIN", "WAITER"]],
  ["/kitchen", "GET", ["ADMIN", "KITCHEN"]],
  ["/pos", "GET", ["ADMIN", "CASHIER"]],
  ["/setup", "GET", ADMIN],
  ["/login", "GET", PUBLIC],
  ["/account-help", "GET", PUBLIC],
  ["/menu/[token]", "GET", PUBLIC],
];

const concrete = (route) =>
  route
    .replace("[id]", "c0ffee12")
    .replace("[tableId]", "table-1")
    .replace("[token]", "ab12cd34")
    .replace("/api/public/menu-images/[filename]", IMAGE);

// Mirrors the gateway in server.js once setup is complete and passwords are enabled.
function gatewayDecision(target, method, role) {
  const pathname = canonicalRequestPath(target);
  if (pathname === null) return "rejected";
  if (isPublicPath(pathname, { isSetupCompleted: true })) return "allowed";
  if (!role) return "denied";
  return allowedRolesForPath(policyRequestPath(pathname), method).includes(role)
    ? "allowed"
    : "denied";
}

const encodeChar = (char, upper) => {
  const hex = char.charCodeAt(0).toString(16).padStart(2, "0");
  return `%${upper ? hex.toUpperCase() : hex}`;
};

// Spellings that Next.js routes to the same handler as `pathname`.
function equivalentSpellings(pathname) {
  const variants = new Set();
  for (let index = 0; index < pathname.length; index++) {
    if (pathname[index] === "/") continue;
    variants.add(
      pathname.slice(0, index) + encodeChar(pathname[index], index % 2) + pathname.slice(index + 1)
    );
  }
  variants.add(pathname.replace(/[^/]/g, (char) => encodeChar(char, true)));
  if (pathname !== "/") variants.add(`${pathname}/`);
  variants.add(`${pathname}?via=%2e%2e%2f`);
  return [...variants];
}

// Case changes may not route at all, but must never widen access.
function caseSpellings(pathname) {
  return [pathname.toUpperCase(), pathname.replace(/\/([a-z])/g, (_, c) => `/${c.toUpperCase()}`)];
}

// Spellings that could be routed differently and must be refused outright.
function ambiguousSpellings(pathname) {
  if (pathname === "/") return ["//", "/%2f", "/.", "/%2e%2e"];
  const last = pathname.lastIndexOf("/");
  const head = pathname.slice(0, last);
  const tail = pathname.slice(last + 1);
  return [
    `${head}%2f${tail}`,
    `${head}%2F${tail}`,
    `${head}%5c${tail}`,
    `${head}\\${tail}`,
    `${head}//${tail}`,
    `${head}/./${tail}`,
    `${head}/%2e/${tail}`,
    `${head}/x/../${tail}`,
    `${head}/x/%2e%2e/${tail}`,
    `${head}/%25${tail}`,
    `${pathname}%`,
    `${pathname}%g1`,
    `/${pathname}`,
  ];
}

test("every API route handler is listed in the access matrix", () => {
  const root = path.resolve(__dirname, "../src/app/api");
  const found = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name === "route.js") {
        const route = "/api/" + path.relative(root, directory).split(path.sep).join("/");
        const source = fs.readFileSync(file, "utf8");
        for (const [, method] of source.matchAll(/^export (?:async )?function ([A-Z]+)\b/gm))
          found.push(`${route} ${method}`);
      }
    }
  };
  walk(root);
  const listed = ROUTES.filter(([route]) => route.startsWith("/api/")).map(
    ([route, method]) => `${route} ${method}`
  );
  assert.deepEqual([...found].sort(), [...listed].sort());
});

test("every route admits exactly its roles under every equivalent spelling", () => {
  let checks = 0;
  for (const [route, method, expected] of ROUTES) {
    const pathname = concrete(route);
    for (const target of [pathname, ...equivalentSpellings(pathname)]) {
      for (const role of [...ROLES, null]) {
        const want =
          expected === PUBLIC || (role && expected.includes(role)) ? "allowed" : "denied";
        assert.equal(
          gatewayDecision(target, method, role),
          want,
          `${method} ${target} as ${role || "anonymous"}`
        );
        checks++;
      }
    }
  }
  assert.ok(checks > 5000);
});

test("case variants never admit a role the canonical route refuses", () => {
  for (const [route, method, expected] of ROUTES) {
    const pathname = concrete(route);
    for (const target of caseSpellings(pathname)) {
      for (const role of [...ROLES, null]) {
        if (expected === PUBLIC || (role && expected.includes(role))) continue;
        assert.notEqual(
          gatewayDecision(target, method, role),
          "allowed",
          `${method} ${target} as ${role || "anonymous"}`
        );
      }
    }
  }
});

test("encoded separators, dot segments and malformed escapes are refused for every route", () => {
  for (const [route, method] of ROUTES) {
    for (const target of ambiguousSpellings(concrete(route))) {
      for (const role of [...ROLES, null])
        assert.equal(gatewayDecision(target, method, role), "rejected", `${method} ${target}`);
    }
  }
});

// Handler-level guards behind the gateway and the roles each one admits at most.
const LEGACY_GUARDS = [
  [/actor\.role !== "ADMIN"/, ADMIN],
  [/authorizePaymentAccess\(request, prisma\)/, ["ADMIN", "CASHIER"]],
  [/authorizeCashier\(request, prisma\)/, ["ADMIN", "CASHIER"]],
  [/await owner\(request\)/, ADMIN],
  [/await authorize\(request\)/, ADMIN],
  [/session\?\.role !== "ADMIN"/, ADMIN],
];

function handlerGuardRoles(source, method) {
  const start = source.search(new RegExp(`^export async function ${method}\\(`, "m"));
  if (start < 0) return null;
  const next = source.slice(start + 1).search(/^export /m);
  const body = next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
  const guard = body.match(/requireStaffRole\(\w+, prisma, (\[[^\]]*\])\)/);
  if (guard) return JSON.parse(guard[1]);
  for (const [pattern, roles] of LEGACY_GUARDS) if (pattern.test(body)) return roles;
  return null;
}

test("every role-restricted API handler checks the session role itself", () => {
  for (const [route, method, expected] of ROUTES) {
    if (!route.startsWith("/api/") || expected === PUBLIC || expected === ALL) continue;
    const file = path.resolve(__dirname, `../src/app${route}/route.js`);
    const roles = handlerGuardRoles(fs.readFileSync(file, "utf8"), method);
    assert.ok(roles, `${method} ${route} has no handler-level role check`);
    for (const role of roles)
      assert.ok(expected.includes(role), `${method} ${route} handler admits ${role}`);
  }
});

test("reported encoded admin paths are denied to kitchen, waiter and cashier staff", () => {
  for (const target of [
    "/api/%62ackup",
    "/api/%61udit",
    "/api/%64evices",
    "/api/%73taff",
    "/api/%72eset",
    "/%61dmin/settings",
    "/%41DMIN/settings",
  ]) {
    for (const role of ["WAITER", "KITCHEN", "CASHIER"])
      assert.equal(gatewayDecision(target, "GET", role), "denied", `${target} as ${role}`);
    assert.equal(gatewayDecision(target, "GET", "ADMIN"), "allowed", target);
  }
  for (const role of ["WAITER", "KITCHEN"])
    assert.equal(gatewayDecision("/api/%72eports/z-report", "GET", role), "denied");
  assert.equal(gatewayDecision("/api/%72eports/z-report", "GET", "CASHIER"), "allowed");
});
