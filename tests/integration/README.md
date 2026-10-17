# Production integration

Run `npm run build`, then `npm run test:integration`. Browser prerequisites and the release gate are in [../README.md](../README.md).

To select fixture groups, use `npm run test:integration -- workflow-fixes`. Real API and browser flows still run; only the fixture groups are filtered.

Each run creates `.tepsy/qa/integration-*` with a fresh schema database, separate secret/device configuration and a production server on a free port. It stops its child server on completion or failure. It never connects to an existing server or uses seed data.

## Real flows

- Setup, owner bootstrap, role access and revoked/expired sessions
- Socket routing/expiry; trusted prices and validated quantities
- Concurrent order replay and conflicting payloads; historical product/category snapshots
- QR approval/status isolation, kitchen preparation and delivery
- Cash/manual card settlement, terminal failure atomicity, payment replay and shift/report totals
- Real browser staff/cart/QR workflows, navigation/logout and persistence after restart

Then all fixture groups run against the same isolated server with API writes intercepted. The owner cookie travels only through child environment variables. The runner verifies that the original database, device config and session-secret contents did not change.

Results, server logs, screenshots and HTML remain in the ignored run directory; fixture evidence is under `fixtures/`. Credentials are generated for each run and excluded from evidence.
