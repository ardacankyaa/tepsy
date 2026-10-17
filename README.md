# TEPSY

Local restaurant management: **tables → orders → kitchen → checkout**.

One Node.js server, one SQLite database. Staff use browsers on the local network; customers scan table QR codes. Turkish/English, light/dark themes, responsive layouts.

## Quick Start

Requires [Node.js 24+](https://nodejs.org/) and [Python 3.8+](https://www.python.org/).

Supported browsers: Chrome 111+, Firefox 128+ and Safari 16.4+.

On Windows, double-click [START.bat](START.bat). It sets up the local installation if
needed, starts TEPSY, opens the browser and shows addresses for other devices on
the same Wi-Fi or local network. Keep the server computer on during use.

Run `START.bat` again to apply changed project files. It automatically updates and
restarts the installed server when needed, retaining restaurant data and settings.

```sh
npm run demo          # Try the demo
npm run setup         # Set up your restaurant
npm run start:local   # Start the server
npm run stop:local    # Stop the server
```

Demo credentials: code `DEMO01`, owner password `TepsyDemo123!`, staff PIN `1234`.

## Features

| Area       | Details                                                      |
| ---------- | ------------------------------------------------------------ |
| Floor      | Sections, editable floor plan, live table status             |
| Orders     | Staff and QR ordering with waiter approval, kitchen workflow |
| Checkout   | Cash/card, split payments, receipts, discounts               |
| Operations | Cash shifts, reports, SQLite backups, protected reset        |
| Menu       | Product photos, business logo, multi-currency                |
| Access     | Owner/staff roles, remembered devices, session management    |

## Tech Stack

**Next.js 15 · React 18 · Tailwind CSS · Socket.IO · Prisma 5 · SQLite**

## Development

```sh
npm ci && npx prisma generate
python3 scripts/initialize-sqlite.py --database prisma/dev.db
npm run db:push && npm run dev
```

| Command                       | Purpose                     |
| ----------------------------- | --------------------------- |
| `npm run dev`                 | Development server          |
| `npm run build` / `npm start` | Production build and server |
| `npm test`                    | Unit tests                  |
| `npm run lint`                | ESLint check                |
| `npm run verify:release`      | Full release gate           |

## Project Structure

| Directory                   | Contents                               |
| --------------------------- | -------------------------------------- |
| `src/app`                   | Pages and API routes                   |
| `src/components`, `src/lib` | Shared UI and business logic           |
| `prisma`                    | Schema and migrations                  |
| `scripts`                   | Installation, backup and release tools |
| `tests`                     | Unit, integration and browser tests    |
| `docs`                      | Architecture and operations            |

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Operations](docs/OPERATIONS.md) · [Tests](tests/README.md)

Licensed under [MIT](LICENSE).
