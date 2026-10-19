# Changelog

## Unreleased

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
