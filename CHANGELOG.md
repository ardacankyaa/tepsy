# Changelog

## Unreleased

- Approving a QR request from the order screen now occupies its table, refuses archived tables and clears the pending request for other staff, matching the QR request panel.
- Equal shares, custom amounts and selected products share one checkout window. Optional tip editors start collapsed in checkout and QR carts, retaining entered amounts in their summaries.
- Checkout supports selecting specific order items and quantities, with server-calculated discounts, paid quantities, immutable item receipts and replay protection.
- Voluntary QR tip requests are confirmed at POS; collected tips remain separate from bill balances and are included in receipts, drawer reconciliation and reports.
- Floor elements have an exact angle control and stable independent rotation while editing and saving.
- Login offers local owner recovery with expiring single-use proof and staff PIN guidance.
- Owners can create independent restaurant installations without resetting existing data; instance cookies and configuration are isolated.
- Report currency controls stay available across date changes, pending requests and load failures, including unknown historical currency.
- Full backup settings distinguish loading, access denial and status errors, with safe retries that preserve completed operations and unsaved plans.
- POS additions always create their own pending kitchen ticket with persisted retry keys; legacy unkeyed item additions are refused.
- Currency is fixed after the first order or drawer activity. Historical report currencies are separated, including unknown legacy amounts.
- Administrator-only, externally confirmed refunds retain original receipts, enforce remaining refundable amounts and reconcile cash drawers and net collections.
- Critical order, cancellation, payment, discount and refund actions retain an actor and timestamp in the activity history.
- Owner-only full recovery ZIPs include financial history, images and device state, with checksum/integrity verification and restore into new folders only.
- Backup/history settings show scheduled backup results, failures and verified second copies. Existing JSON downloads are labelled as data exports.
- Backups follow active installation environment and explicit source/destination options on all supported platforms.
- Daily backup schedules honor custom backup directories; legacy paths remain supported.
- Formatting is confined to publishable source and never traverses runtime/QA data.
- Replaced the vulnerable development dependency chain; release verification now audits development packages too.
- Updated CSS tooling with retained dialog placement and utility styling; verified Next lint rules with the current ESLint runtime.
- Removed former sample business branding; existing restaurant identity and technical integrations are retained.

## 1.0.0 — October 2026

### Core

- Local restaurant workflow: floor → orders → kitchen → checkout
- Owner/staff permissions, QR approval, cash shifts, discounts and reports
- Equal/custom split payments with exact cent allocation and individual receipts
- Uploaded menu photos shared across staff and guest QR screens
- Business logo, workspace identity and transparent branding
- Verified SQLite backups, additive upgrades and protected reset

### Infrastructure

- Managed installation outside the source folder with isolated demo
- Shared authentication throttling across sign-in and password changes
- Atomic database publication with concurrent launcher serialization
- Kitchen/shift reconnect recovery and disconnect warnings
- Currency server confirmation and retained values on failed saves

### Fixes

- Fresh Windows SQLite creation with UTF-8 PowerShell output
- Phone/tablet login layout and short-screen setup accessibility
- Windows ESC/POS RAW delivery with acknowledged job IDs
- Printer preferences persistence and thermal receipt formatting
