# Security Policy

## Supported versions

Security fixes are made on the `main` branch and included in the next release.
Run `START.bat` again (or `npm run start:local`) to apply them to an existing
installation; restaurant data and settings are retained.

| Version | Supported |
| ------- | --------- |
| 1.1.x   | Yes       |

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
  increasing backoff for staff PINs and the owner password (see
  [Sign-in lockout](#sign-in-lockout)), equal hashing work for unknown accounts,
  bounded request bodies, and host/origin checks for state-changing requests.
- Server-authoritative prices, replay-protected orders and payments, and
  historical item snapshots on orders and receipts.
- Unguessable per-table QR tokens; QR orders require waiter approval.
- Content Security Policy and related browser security headers.

Physical payment terminals, printers and bank integrations need separate
validation in each installation.

## Sign-in lockout

Each client address may make eight sign-in or owner password attempts per 15
minutes. In addition, ten failed guesses against one staff name or the owner, from
any number of devices, lock that account with backoff from one to fifteen minutes.

The lockout must slow guessing a four-digit PIN from many addresses without letting
one device lock everyone else out. It therefore stays global, but refuses only
devices that have themselves failed against the locked account:

- A device without a failed guess of its own always gets to check its credential.
  If that guess is wrong, it counts, extends the lock and the device is refused from
  then on. An attacker rotating addresses gains at most one guess per new address
  while the lock lasts, and all addresses in one IPv6 /64 count as one device.
- A successful sign-in forgives only that device's own failed guesses.
- Only guesses that reach a credential check count. A wrong restaurant code counts
  against the client address quota only, because the code is shown publicly.
- The server computer's own loopback address (`127.0.0.1`, `::1`) is exempt
  from the account lockout, so the owner can always sign in there. Its address
  quota still applies. Other `127.x.x.x` aliases count as ordinary devices.
- Owner recovery, an owner password change and a staff PIN reset clear the lockout
  for that account. Restarting TEPSY clears all sign-in limits.

TEPSY 1.1.1 counted wrong restaurant codes toward the account and refused every
device while an account was locked. Anyone who could reach TEPSY could keep the
owner or a staff member from signing in by repeating a few requests; only a restart
cleared it. 1.1.2 fixes this.
