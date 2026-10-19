# Testing

Requires Node.js 24+. Python examples use Windows `py`; use `python3` on Linux/CI. The source is JavaScript, with no separate TypeScript/typecheck target.

## Choose checks

| Change                        | Verification                                               |
| ----------------------------- | ---------------------------------------------------------- |
| Documentation                 | Links, paths and documented commands                       |
| Business rules                | Relevant Node tests; lint                                  |
| Backup or schema upgrade      | Python backup/migration tests against disposable copies    |
| API, auth, orders or payments | Production build and isolated integration                  |
| UI/layout/theme               | Relevant browser groups, including affected viewport sizes |

## Full release gate

`npm run format` and `npm run format:check` only visit publishable source files.
Private state, backups and QA output are never traversed or rewritten.

`backup-cli`, `runtime-config` and Python regressions cover configured/legacy
database paths, explicit backup options, verified copies and retained source data.
`lint-compat` verifies all four configured Next syntax rules against the installed
ESLint runtime. `product-branding` prevents former product identities from returning
to published UI copy while retaining technical compatibility identifiers.

`npm run verify:release` runs all checks and records the source fingerprint and evidence under `.tepsy/qa/`. The equivalent individual checks are:

```powershell
npm run format:check
npm run lint
npm run release:check
npm audit --audit-level=low
npm test
py -m unittest discover -s tests -p 'test_*.py'
npm run build
npm run test:managed
npm run test:integration
npm run test:accounts
```

[Integration](integration/README.md) starts its own disposable production server/database and runs real API, auth, Socket.IO and browser flows, followed by all fixture groups. Never point tests at live restaurant data.

## Browser groups

`product-payments` verifies floor angle entry/save/reload, selected product quantities,
QR tip prefill and the checkout payload at desktop and 320 px. `qr-menu` verifies
tip intent survives an ambiguous order retry. Integration exercises real selected
item payment, replay/overpayment prevention, immutable receipts and QR tip storage.

For focused fixtures, start a local server (`npm run dev`) and run:

```powershell
npm run test:ui -- pos-theme
```

Without a group, `npm run test:ui` runs all groups. Current groups: `theme`, `editor`, `interactions`, `payments`, `supplement`, `reset`, `pos-floorplan`, `pos-theme`, `workflow-fixes`, `cart-layout`, `qr-menu`, `qr-management`, `layout-audit`, `split-payments`, `menu-photos`, `responsive`, `device-ux`, `final-layout`, `brand-layout`, `theme-audit`, `locale-icon`, `mobile-onboarding`, `devices-printing`, `realtime-recovery`, `currency-save`.

The old standalone smoke/UI snippets were superseded by isolated integration. Demo seeding is tested on a separate QA database and refuses the configured restaurant database.

`workflow-fixes` checks language persistence, owner-only administrator controls, round table labels, service notifications and receipt prices on mobile and print layouts. Integration also verifies the real QR call → waiter approval → checkout flow.

`cart-layout` checks staff/QR cart prices and quantity controls at 320–1440px, plus centered square and round table names.

`qr-menu` checks Turkish search, categories, product details, order limits, safe retries, approval/withdrawal races, service success/errors/cooldown, languages, load recovery and phone/tablet/desktop layouts.

`qr-management` checks QR generation, preview without changing app origin/theme, address changes, independent saving, automatic addresses, missing networks and server errors. Integration verifies the actual protected address API and a real management-generated QR menu.

`layout-audit` measures search icon spacing, button text/icon collisions, clipped controls, checkout rows and cart prices across 255 views on 17 routes, dialogs and checkout states. It covers 320–1440px, Turkish/light and English/dark, long names and large amounts; browser exceptions fail the check.

`font-fallback` checks kitchen controls, the floor editor header and menu dialog actions at 320–1024px in Turkish and English with a wider fallback font and increased letter spacing. It catches controls that fit only with one operating system's default font.

`split-payments` checks equal-share rounding/advance, custom mixed cash/card installments, manual-card cancellation, per-payment receipts, totals, refresh/completed-table history and reprints. Integration verifies immutable receipt snapshots, multi-order grouping, role restrictions and printer output.

`menu-photos` checks upload/save/reload, shared waiter/QR/POS photos, image failure/removal and phone/desktop layouts. Integration validates genuine normalized file uploads, bounded/invalid requests, public reads, role restrictions and restart persistence; files use a disposable image directory.

[fixture.cjs](browser/fixture.cjs) supplies 150 tables, 300 menu items and 30 tickets; writes are intercepted. Responsive coverage spans 13 routes and 9 widths (320–1440px). Results are ignored under `.tepsy/qa/`.

Chrome is the default. Set `TEPSY_BROWSER` to another installed Playwright channel, or run `npx playwright install chromium` and select `chromium`.

Focused fixtures accept `TEPSY_UI_URL` (localhost only), `TEPSY_UI_COOKIE` for a protected owner session, and `TEPSY_UI_OUTPUT`. Legacy `RESTOPOS_*` variables remain supported. Keep cookies private; integration supplies its own ephemeral session.

Actual POS/printer hardware, Safari and legal compliance require separate validation.

`device-ux` verifies touch targets, form readability, visible list heights and dialog/cart/payment action reachability across 121 phone, tablet and short landscape scenes. It uses disposable data and Chrome touch emulation.

`final-layout` checks 216 intermediate breakpoint/short-landscape scenes with valid long table, section and product names and large prices; kitchen status/time and panel text must stay inside their containers. Shared measurements live in `layout-measure.cjs`.

`brand-layout` checks PNG loading and theme colors across 48 route/viewport/theme scenes, the single sidebar wordmark with restaurant name below, and mobile navigation branding.

`brand-layout` also checks 20 custom restaurant logo scenes, missing-image fallback, matching header fonts and identity frames. Real integration covers optional setup logo, atomic owner credentials, remembered cookie, settings logo upload/save/reload/removal, roles and invalid logo addresses.

`theme-audit` checks visible text contrast in 68 persisted light/dark phone/desktop route scenes, including the kitchen ready action. It records findings and browser errors and fails if either remains. Logo artwork and print paper retain their intended rendering.

`locale-icon` validates PNG bytes/content types for tab icons and the legacy favicon URL, TR/EN switching and persistence, localized browser title/skip link, QR language changes and layout across 106 scenes.

`mobile-onboarding` checks 40 owner/staff/fresh-login and setup validation-error scenes with long business names, phones, tablets, short landscape and keyboard-height proxies. It asserts controls remain reachable and the form does not collapse.

`devices-printing` verifies printer preferences survive save/test, browser test receipts, reachable versus failed terminal status, phone/tablet controls in both languages/themes and 70-item 58 mm/A4 PDFs. Device unit tests send actual ESC/POS bytes to a local receiver and exercise native Windows rejection of a missing printer queue; they do not claim physical paper output or bank approval.

## TokenX bill export

`tokenx` verifies TokenX fiscal category settings, retained mappings, 320/768px
layouts, automatic bill export before the manual card dialog, failed export
blocking, and confirmation without a second export. Provider responses are fixture
data; this does not certify physical hardware. `tokenx.test.mjs` covers actual
payload construction, provider HTTP contracts, SQLite reservations, concurrent
attempts, uncertain-response reconciliation and stale-account rejection.
See [TokenX setup and limitations](../docs/TOKENX-INTEGRATION.md).

## Security regressions

`socket-authorization-race.test.cjs` covers a staff access change or owner password
change while a Socket.IO handshake is pending, including the interval before
registration and initial local bootstrap. Independent API/host module copies must
share invalidation state. `session-logout.test.mjs` also covers revoked cookies,
late connections and isolation between devices.

`public-request-body.test.mjs` exercises actual public route handlers with oversized
and chunked JSON, verifies cancellation before database work, accepts a full QR
cart, and checks a stalled input deadline. Login remains limited to 16 KiB; public
JSON mutations are limited to 32 KiB. Real integration verifies HTTP 413 for both
declared-length and chunked requests.

`cash-shift-route.test.mjs` checks negative derived drawer differences on close,
history and replay while negative cash counts and payments remain forbidden.
Integration concurrently sends checkout retries, independent full-payment requests,
and checkout versus shift close; it checks persisted ledger rows, receipts and
closing snapshots.

## Managed local install

Operations regressions additionally cover new POS tickets on delivered accounts,
real lost-response retries without duplicates, financial currency locking,
historical currency separation, administrator-only partial refunds, concurrent
and replayed refund attempts, preserved original receipts, audited actors, cash
drawer reconciliation, desktop/mobile recovery controls and a real ZIP recovery
roundtrip. Due automatic backups must resume after restart and verify the second
copy. All records live in the integration runner's disposable installation.

`config-currency`, `extra-order`, `refund-shift`, `refunds` and `report-currency`
cover the corresponding business rules. Python `test_recovery.py` checks the
archive inventory and actual restored data, missing/corrupt payloads, path traversal
and refusal to overwrite existing installations. Migration tests preserve legacy
order and shift records while adding refund/audit tables and closing snapshots.

`npm run test:managed` creates a fresh demo installation under a disposable `.tepsy/qa/managed-demo-*` directory. It verifies dependency installation, schema and seed, production build/start, owner/staff login, demo cookie isolation for HTTP and Socket.IO, guest QR access, restart without reseeding or rebuilding, retained owner session and owned process shutdown. It also checks a fresh real installation with the default database after relocating the build: no demo data and a working login/setup entry. Logs and `results.json` stay in that QA directory. CI runs this check on Windows and Ubuntu.

`realtime-recovery` uses the actual Socket.IO client against an intercepted synthetic Engine.IO peer. It checks missed kitchen orders after reconnect, delayed disconnect warnings, shared cash-shift open/close events, reconnect refresh and recovery from a shift conflict. API writes remain intercepted.

`currency-save` checks rejected/offline/malformed saves keep the actual currency, pending saves lock controls, confirmed saves persist after reload, and a 320px phone can display the error without horizontal overflow.

`report-currency` keeps historical and current currencies selectable across date
changes, loading and failed reports. It checks EUR/unknown separation and returning
to current-currency collections in Turkish and English at 320px.

`recovery-status` distinguishes loading, access denial and unavailable backup
status. It checks safe GET-only retries after offline/malformed/failed responses,
preserved plan drafts, successful operations despite failed status refreshes, and
Turkish/English phone layouts.

`login-help` checks owner/staff recovery guidance, password confirmation, uncertain
responses, separate-restaurant request retries and resume, unsafe URL rejection,
and narrow/short phone layouts in Turkish and English.

`test:accounts` runs a disposable parent installation and a real independent child.
It checks local CLI recovery, changed credentials and expired sessions, single-use
proof, idempotent child creation, fresh data/secrets/cookies, parent-data retention
and child restart. Real restaurant credentials and databases are never targeted.

The managed install also exercises two concurrent cold/warm launchers, legacy runtime metadata recovery, IPv6-only readiness and refusal to reuse another installation's occupied port. Fresh database schema/seed publication is staged; interrupted work does not replace an existing database. Unit tests cover lifecycle lock ownership and error-preserving cleanup.

It also simulates an older installed release while the server is running. Starting
again must replace its source, rebuild and restart automatically without a manual
stop; table/order records, the signing secret and the owner's session must survive.
