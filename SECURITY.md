# Security Policy

## Supported versions

Security fixes are made on the `main` branch and included in the next release.
Run `START.bat` again (or `npm run start:local`) to apply them to an existing
installation; restaurant data and settings are retained.

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/ardacankyaa/tepsy/security/advisories/new),
not in public issues. Include the affected version or commit, steps to reproduce
and the expected impact. Never attach real restaurant databases, backups,
`.env` files, session cookies or device configuration.

You will receive an acknowledgement, and confirmed issues are fixed with a
regression test before disclosure.

## Deployment model

TEPSY is designed for a trusted local network:

- Staff and QR guests connect over plain HTTP on the LAN, which does not encrypt
  traffic. Use a protected Wi-Fi network and keep guests on a network that
  cannot reach other business devices where possible.
- Do not expose TEPSY to the internet directly. Internet access requires HTTPS
  through a reverse proxy or tunnel, `TEPSY_ALLOWED_HOSTS`, and separate review of
  that setup. Initial setup runs only on the server computer, and owner recovery
  codes are generated there with `OWNER-RECOVERY.bat`.
- Keep `.env`, `.tepsy/`, `prisma/dev.db`, backups and recovery archives private.
  They contain the session secret, credentials, device settings and financial
  records.
- Manual card entry records a payment taken on an external terminal. TEPSY does
  not approve, initiate or verify bank transactions.

## Built-in protections

- Signed, expiring session cookies with server-side revocation on logout, staff
  access changes and owner password changes, applied to HTTP and Socket.IO.
- Role-based access for owner, administrator, waiter, kitchen and cashier routes.
- Login and recovery throttling per client address, a per-account lockout with
  increasing backoff for staff PINs and the owner password, equal hashing work
  for unknown accounts, bounded request bodies, and host/origin checks for
  state-changing requests.
- Server-authoritative prices, replay-protected orders and payments, and
  historical item snapshots on orders and receipts.
- Unguessable per-table QR tokens; QR orders require waiter approval.
- Content Security Policy and related browser security headers.

Physical payment terminals, printers and bank integrations need separate
validation in each installation.
