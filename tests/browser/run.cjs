const { spawnSync } = require("node:child_process");
const path = require("node:path");

const checks = [
  "theme",
  "editor",
  "interactions",
  "payments",
  "supplement",
  "reset",
  "pos-floorplan",
  "pos-theme",
  "workflow-fixes",
  "cart-layout",
  "qr-menu",
  "qr-management",
  "layout-audit",
  "font-fallback",
  "split-payments",
  "menu-photos",
  "responsive",
  "device-ux",
  "final-layout",
  "brand-layout",
  "theme-audit",
  "locale-icon",
  "mobile-onboarding",
  "devices-printing",
  "tokenx",
  "realtime-recovery",
  "currency-save",
];
const requested = process.argv.slice(2);
const selected = requested.length ? requested : checks;
for (const name of selected) {
  if (!checks.includes(name))
    throw new Error(`Unknown check: ${name}. Available: ${checks.join(", ")}`);
  console.log(`\nBrowser check: ${name}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, `${name}.cjs`)], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
