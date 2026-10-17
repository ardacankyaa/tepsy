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
- Routine backups stored in `.tepsy/backups`, retaining 30 by default
- Optional daily task: `powershell -File scripts/register-daily-backup.ps1`
- **Always backup uploaded photos** (`.tepsy/menu-images`) alongside the database
- Logout revocations live separately in `.tepsy/revoked-sessions.db` (or the legacy
  `.restopos` directory). Back this up consistently with SQLite, including any
  `TEPSY_SESSION_REVOCATION_PATH` override. When restoring without this state,
  rotate the effective `TEPSY_SESSION_SECRET` / `RESTOPOS_SESSION_SECRET` (or the
  auto-generated `session-secret` file) before starting; this signs out all devices
  and prevents previously logged-out cookies from becoming usable again.

## Reset

Management → Reset (server computer only). Requires typing `TEPSY`. Creates a verified backup before clearing all data.
