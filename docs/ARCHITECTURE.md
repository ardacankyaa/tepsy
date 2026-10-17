# Architecture

## Runtime

`server.js` runs Next.js and Socket.IO in one Node process. It handles sessions, roles, hosts and request origins before API handling. Staff sessions last 12 hours; remembered owner devices last 30 days.

HTTP routes and Socket.IO share the canonical signed-cookie verifier. Logout stores
the cookie's SHA-256 fingerprint until expiry in `.tepsy/revoked-sessions.db` (or
the legacy `.restopos` state directory), and disconnects sockets for that session.
The private revocation store survives server restarts; it contains no raw cookies.
`TEPSY_SESSION_REVOCATION_PATH` / `RESTOPOS_SESSION_REVOCATION_PATH` can override it.
Include this state in recovery procedures, or rotate the session signing secret to
invalidate previous cookies when recovering without it.

One installation serves one restaurant. SQLite uses WAL and `synchronous=FULL` on local disk. Prisma covers tables, menu, orders, payments, shifts, staff and settings. Finance calculations use integer minor units.

## Screens

| Role        | Routes                                                           |
| ----------- | ---------------------------------------------------------------- |
| Owner/Admin | `/`, `/admin`, `/admin/{menu,tables,floorplan,reports,settings}` |
| Waiter      | `/order`, `/order/[tableId]`                                     |
| Kitchen     | `/kitchen`                                                       |
| Cashier     | `/pos`                                                           |
| Customer    | `/menu/[token]`                                                  |
| System      | `/setup`, `/login`, `/privacy`, `/terms`, `/cookies`             |

API routes: `src/app/api/`. Permission rules: `src/lib/security-policy.cjs`.

## Order Flow

Staff orders enter `PENDING`. QR orders enter `AWAITING_WAITER_APPROVAL` first. Preparation: `PREPARING` → `READY` → `DELIVERED` → `PAID`. The server validates quantities, availability and current prices.

Socket.IO refreshes staff screens in real-time. Guests poll token-scoped status. Order and payment request keys protect retries.
