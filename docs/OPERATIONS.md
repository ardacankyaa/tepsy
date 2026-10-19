# Operations

## Install & Start

Requires Node.js 24+, npm and Python 3.8+.

```sh
npm run setup         # First-time installation
npm run start:local   # Start server
npm run stop:local    # Stop server
```

The launcher copies source into a private installation, installs dependencies, initializes new databases, applies additive upgrades and builds when source changes.

### Windows and local network access

Double-click [START.bat](../START.bat) in the source folder. The window stays open
to show startup errors or, after a successful start, the server's local network
addresses. It supports launcher options such as `START.bat --port 3010`.

Run `START.bat` again after changing or replacing the source project files. It checks
the installed version against those files, stops its own server if an update is
needed, installs changed dependencies, applies additive upgrades, builds and starts
the updated application. A separate `stop:local` command is unnecessary for updates.
Restaurant data and private settings are retained. With unchanged source files, the
running server is reused. This updates from the local project folder; it does not
download a release from the internet.

Other computers, phones and tablets on the same local network open the displayed
address, for example `http://192.168.1.50:3000`. The default bind address is
`0.0.0.0`; an explicit `TEPSY_BIND_HOST` or legacy `RESTOPOS_BIND_HOST` setting is
respected. If Windows Firewall blocks access, allow Node.js on Private networks.
Devices must be able to reach each other; guest Wi-Fi client isolation can prevent
this. Keep the server computer awake while using TEPSY. Closing the launcher window
leaves the server running; stop it with `npm run stop:local`.

This provides local network access. Access from outside the network requires a
separate hosting or remote-access configuration.

### Storage

| Platform | Directory                                 |
| -------- | ----------------------------------------- |
| Windows  | `%LOCALAPPDATA%/TEPSY/app`                |
| macOS    | `~/Library/Application Support/TEPSY/app` |
| Linux    | `~/.local/share/tepsy/app`                |

Demo uses sibling `demo/` directory. Run `npm run local:paths` for actual paths. Override with `TEPSY_LOCAL_DATA_HOME`.

### Demo

```sh
npm run demo       # Start demo (port 3001, loopback only)
npm run demo:stop  # Stop demo
```

Code `DEMO01`, owner password `TepsyDemo123!`, staff PIN `1234`.

### Development

```sh
npm ci && npx prisma generate
python3 scripts/initialize-sqlite.py --database prisma/dev.db
npm run db:push && npm run dev
```

## Account recovery and independent restaurants

The login page provides **Forgot password** / **Şifremi unuttum**. For an owner:

1. On the computer running the relevant restaurant, open `OWNER-RECOVERY.bat`
   from the project folder or that installation's folder. The project launcher
   targets the normal private installation; an installed restaurant's launcher
   targets that restaurant. To choose another installation explicitly, run
   `npm run owner:recovery -- --installation "C:/path/to/restaurant/app"`.
2. Copy the displayed one-use code into the recovery form on the server computer
   and choose a new password. The code expires after ten minutes. Keep it private.
3. Sign in with the new password. Old sessions are invalidated. Restaurant data
   is preserved. If the response is lost, try the new password before generating
   another recovery code.

The browser cannot generate the recovery proof itself. Access to the server's
private installation is required; there is no email password-reset service.
For a forgotten staff PIN, the owner assigns a new PIN in **Team**.

**Create a new restaurant** / **Yeni restoran oluştur** requires the current
owner's password (or a valid owner session) on the server computer. It starts a
fresh installation on another available port and opens its setup wizard. The
existing restaurant is retained. Each restaurant has separate database, sessions,
photos, device configuration, backups and a new signing secret; provider credentials
are not copied. New installations support staff access over the local network after
server-local setup. The original installation and legacy cookie names still work.

Independent installations live below the parent installation's
`.tepsy/restaurants/<id>/app`. Keep the resulting URL. After restarting the computer,
run `START.bat` inside that restaurant's own installation folder. From the parent
installation you can also run `node scripts/new-restaurant.cjs start <id>`.
Back up each restaurant separately; a restaurant's recovery ZIP does not include
the other installations. New restaurant creation is unavailable in demo mode.

## Configuration

Defaults work without `.env`. Copy [.env.example](../.env.example) to the private installation for overrides.

| Setting                     | Default               |
| --------------------------- | --------------------- |
| `PORT`                      | `3000`                |
| `TEPSY_ALLOWED_HOSTS`       | LAN IPs and localhost |
| `TEPSY_DATABASE_URL`        | `prisma/dev.db`       |
| `TEPSY_SESSION_SECRET`      | Auto-generated        |
| `TEPSY_DEVICES_CONFIG_PATH` | `.tepsy/devices.json` |
| `TEPSY_BACKUP_DIR`          | `.tepsy/backups`      |
| `TEPSY_MENU_IMAGE_DIR`      | `.tepsy/menu-images`  |

Legacy `RESTOPOS_` variables remain supported.

For optional TokenX Connect Cloud itemized bill export, see
[TokenX integration](TOKENX-INTEGRATION.md). Provider credentials stay in the private
installation's `.env`; device settings contain only the terminal ID and fiscal
category assignments. Include `terminal-transfers.db` next to the device configuration
in the consistent SQLite backup/recovery plan alongside restaurant data.

## Database Upgrade

Stop the server first. `npm run start:local` runs upgrades automatically. Manual upgrade:

```sh
npm ci && npx prisma generate
python3 scripts/migrate-tepsy.py --database prisma/dev.db
npm run build && npm start
```

Never use `db:push --accept-data-loss` on restaurant data.

## Backup & Recovery

```sh
npm run db:backup                                            # Backup
python3 scripts/sqlite-restore.py --backup <file> --target <new.db>  # Restore
```

- Backups use SQLite's consistent backup API with integrity verification
- Run `npm run db:backup` from the active installation. It reads its `.env`,
  database URL and backup-directory overrides, including legacy variables.
  Explicit options take precedence:
  `npm run db:backup -- --source "C:/TEPSY/data/restaurant.db" --dest-dir "C:/TEPSY/backups"`.
- Python 3.8+ is selected automatically on Windows, macOS and Linux. The optional
  Windows daily task uses the same database and backup-directory configuration.
- Routine backups stored in `.tepsy/backups`, retaining 30 by default
- Optional daily task: `powershell -File scripts/register-daily-backup.ps1`
- **Always backup uploaded photos** (`.tepsy/menu-images`) alongside the database
- Logout revocations live separately in `.tepsy/revoked-sessions.db` (or the legacy
  `.restopos` directory). Back this up consistently with SQLite, including any
  `TEPSY_SESSION_REVOCATION_PATH` override. When restoring without this state,
  rotate the effective `TEPSY_SESSION_SECRET` / `RESTOPOS_SESSION_SECRET` (or the
  auto-generated `session-secret` file) before starting; this signs out all devices
  and prevents previously logged-out cookies from becoming usable again.

## Recovery and financial corrections

### Full recovery backups

Settings → **Backup & history** (Turkish: **Yedek ve geçmiş**) provides full ZIP
backups, verification uploads, automatic backup plans and activity history. Full
backup management requires the owner on the server computer. JSON export remains
available for inspecting data; it is not a standalone recovery archive.

The ZIP contains a consistent SQLite copy (including shifts, immutable receipts,
refunds, audit events and floor-plan dimensions), uploaded photos, device settings
and existing terminal-transfer/session-revocation stores. SHA-256 inventory,
SQLite integrity and foreign keys are checked before success. New mutations are
briefly refused with HTTP 503 while existing writes drain and the snapshot is
created; retry the same keyed order/payment request. Reads remain available.

The archive contains private restaurant data and credential hashes. Keep it
private. Raw `.env` integration credentials and session signing secrets are not
exported. Preserve integration credentials separately in secure storage and
reconfigure them when recovering. New installation sessions require a new login.

Automatic full backups are opt-in and run while TEPSY is running. Choose an
interval of 1–168 hours (default 24) and, optionally, a different absolute folder
for a second copy. Both copies are verified; copy failures are shown separately
from a successful local backup. An overdue plan resumes on startup, with a
15-minute failure retry delay. The latest 30 local recovery ZIPs are retained;
external copies are never automatically deleted. For protection from disk failure,
choose a second location on a different physical disk or managed external storage.

Restore only into a **new** private installation folder. Existing installations
are never overwritten:

```powershell
py scripts/recovery-bundle.py verify --archive "D:/Backups/tepsy-recovery.zip"
py scripts/recovery-bundle.py restore --archive "D:/Backups/tepsy-recovery.zip" --target "C:/TEPSY-recovered/app"
```

On macOS/Linux use `python3`. Stop the old instance, set `TEPSY_LOCAL_DATA_HOME` to
the new parent folder (here `C:/TEPSY-recovered`) and run `npm run start:local`
from the source project. The launcher installs code/dependencies alongside the
restored data and applies verified additive upgrades. Sign in again and check
photos, receipts, device settings and reports before switching devices to it.
Do not copy the old session signing secret; the new one invalidates old cookies.
Restored device addresses may need adjustment on another network.

### Refunds and corrections

POS → Payment history → **Refund / correction** records an externally completed
refund. Administrators only; an open cash shift, a reason and explicit external
confirmation are required. Amounts cannot exceed the unrefunded receipt balance.
Cash refunds also require sufficient recorded drawer cash. Original receipts are
immutable, paid orders remain closed, and refunds have their own actor/date/reason.
If the result is uncertain, reopen the same receipt and retry the saved request;
never execute the external refund a second time. Current and historical currencies
must match the cash drawer; unknown legacy currency requires manual reconciliation.

### Business currency

Choose currency before creating orders or opening the first shift. Financial
activity permanently locks the currency for that installation, including closed
history, to avoid reinterpreting existing prices. Reports separate historical
currencies without conversion; unknown legacy amounts have an explicit separate
selection. Refunds reduce net collections by recording date, while product
quantity breakdowns continue to describe original order-date sales.

### Protected reset

Management → Reset (server computer only). Requires typing `TEPSY`. Creates a verified backup before clearing all data.
