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

One installation serves one restaurant. SQLite uses WAL and `synchronous=FULL` on local disk. The schema comes from `prisma/schema.prisma`; new databases are created from it and existing ones are upgraded additively by `scripts/migrate-tepsy.py`, not by Prisma Migrate (see [Schema baseline](OPERATIONS.md#schema-baseline-and-prismamigrations)). Prisma covers tables, menu, orders, payments, shifts, staff and settings. Finance calculations use integer minor units.

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

The gateway evaluates roles on the decoded request path that Next.js routes
(`src/lib/request-path.cjs`). Paths with malformed escapes, encoded `/` or ``,
dot segments or repeated slashes are refused with 400. Role-restricted API
handlers also verify the current staff role themselves (`src/lib/route-access.mjs`,
`src/lib/payment-access.mjs`), so they do not depend on the gateway alone.

`server.js` replaces client-supplied `x-tepsy-client-ip` / `x-restopos-client-ip`
headers with the TCP peer and a random per-process proof. Throttling, owner
recovery and local-only routes trust the address only with that proof
(`src/lib/trusted-client.cjs`); without it they treat the client as remote.

## Order Flow

Staff orders enter `PENDING`. QR orders enter `AWAITING_WAITER_APPROVAL` first. Preparation: `PREPARING` → `READY` → `DELIVERED` → `PAID`. The server validates quantities, availability and current prices.

Socket.IO refreshes staff screens in real-time. Guests poll token-scoped status. Order and payment request keys protect retries.

POS additions always use the keyed order POST route, even when the table already
has open orders. Each addition is a separate pending kitchen ticket. Legacy
`addItems` PATCH calls are refused; they must not hide new work inside READY or
DELIVERED tickets. The client retains an uncertain request across refreshes.

Currency changes are serialized with financial writes and refused once orders,
payments or cash shifts exist. Reports filter historical collections using their
immutable receipt currency; missing legacy currency stays explicitly unknown.
Product sales retain their order-date basis and do not represent physical returns.

Refunds are separate append-only ledger records, linked to a canonical immutable
payment receipt and an open cash shift. They do not reopen paid orders or erase
payments. An administrator confirms that the external refund is complete, supplies
a reason and retries with the same key. Cash refunds reduce expected drawer cash;
net collection reports subtract refunds by their own recording date. Product
returns/inventory and bank refund execution are outside this flow.

AuditEvent stores the actor, timestamp, entity and bounded details of order,
cancellation, payment/discount, refund and backup-management actions. It is exposed
only to administrators, with bounded cursor pagination. Business ledger writes and
their audit events commit in the same transaction.
