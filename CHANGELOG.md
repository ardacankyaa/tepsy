# Changelog

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
