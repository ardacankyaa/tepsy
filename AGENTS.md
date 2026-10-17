# TEPSY project instructions

## Goal

Keep the restaurant workflow reliable: table → order → kitchen → checkout.

## Boundaries

- The live database is `prisma/dev.db` inside the active installation. Tests use disposable databases.
- Existing installations use verified backups and additive upgrades, not `db:push` or `--accept-data-loss`.
- Preserve legacy `RESTOPOS_` environment variables, cookies, storage keys and `.restopos` compatibility.
- Keep restaurant data, backups, credentials and device files outside version control.
- Order prices are authoritative on the server. Preserve replay protection and historical snapshots.
- Manual card entry records external payment. The terminal adapter cannot approve bank transactions.
- Shared UI uses semantic theme tokens. See `src/app/globals.css` for design conventions.

## Architecture

`server.js` hosts Next.js, authentication and Socket.IO together. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for runtime, roles and order flow. See [docs/OPERATIONS.md](docs/OPERATIONS.md) for storage, backup and reset.

## Done

Verify changes with the relevant checks in [tests/README.md](tests/README.md).
