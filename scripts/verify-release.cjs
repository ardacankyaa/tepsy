const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { sourceHash } = require("./release-files.cjs");

const root = path.resolve(__dirname, "..");
const timestamp = new Date().toISOString();
const directory = path.join(root, ".tepsy", "qa", `release-${timestamp.replace(/[:.]/g, "-")}`);
fs.mkdirSync(directory, { recursive: true });
const result = {
  version: require("../package.json").version,
  startedAt: timestamp,
  sourceHash: sourceHash(root),
  checks: [],
  passed: false,
};
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this gate with npm run verify:release.");
const commands = [
  ["release files", process.execPath, ["scripts/check-release.cjs"]],
  ["format", process.execPath, [npmCli, "run", "format:check"]],
  ["lint", process.execPath, [npmCli, "run", "lint"]],
  ["Node tests", process.execPath, [npmCli, "test"]],
  [
    "Python backup/migration",
    process.platform === "win32" ? "py" : "python3",
    ["-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"],
  ],
  ["production dependencies", process.execPath, [npmCli, "audit", "--audit-level=low"]],
  ["production build", process.execPath, [npmCli, "run", "build"]],
  ["managed demo installation", process.execPath, [npmCli, "run", "test:managed"]],
  ["isolated API/browser integration", process.execPath, [npmCli, "run", "test:integration"]],
  [
    "account recovery and independent restaurant",
    process.execPath,
    [npmCli, "run", "test:accounts"],
  ],
];
try {
  for (const [name, executable, args] of commands) {
    console.log(`\nRelease gate: ${name}`);
    const check = spawnSync(executable, args, {
      cwd: root,
      env: process.env,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
    fs.writeFileSync(
      path.join(directory, `${result.checks.length + 1}.log`),
      (check.stdout || "") + (check.stderr || "")
    );
    process.stdout.write(check.stdout || "");
    process.stderr.write(check.stderr || "");
    result.checks.push({ name, passed: check.status === 0 && !check.error });
    if (check.error || check.status !== 0)
      throw check.error || new Error(`${name} failed (${check.status})`);
  }
  if (sourceHash(root) !== result.sourceHash)
    throw new Error("Source changed while verification was running. Repeat the release gate.");
  result.passed = true;
} catch (error) {
  result.error = error.message;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  result.completedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(directory, "verification.json"),
    JSON.stringify(result, null, 2) + "\n"
  );
  fs.writeFileSync(
    path.join(root, ".tepsy", "qa", "release-latest.json"),
    JSON.stringify(result, null, 2) + "\n"
  );
  console.log(`Release evidence: ${path.join(directory, "verification.json")}`);
}
