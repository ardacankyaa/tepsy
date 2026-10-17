const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { releaseFiles } = require("./release-files.cjs");

function checkRelease(root) {
  const errors = [];
  for (const file of releaseFiles(root).filter((name) => name.endsWith(".md"))) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].replace(/^<|>$/g, "").split("#")[0];
      if (!target || /^(https?:|mailto:|app:|codex:|\/)/i.test(target)) continue;
      const destination = path.resolve(root, path.dirname(file), decodeURIComponent(target));
      if (!fs.existsSync(destination)) errors.push(`${file}: broken link ${target}`);
    }
  }
  const tracked = spawnSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (tracked.status === 0) {
    for (const file of tracked.stdout.split("\0").filter(Boolean)) {
      if (
        /(^|\/)(\.tepsy|\.restopos|node_modules|\.next)(\/|$)|\.(db|sqlite|sqlite3)(-|$)|(^|\/)\.env($|\.)/.test(
          file
        ) &&
        file !== ".env.example"
      )
        errors.push(`Private/runtime file tracked: ${file}`);
    }
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  for (const group of ["dependencies", "devDependencies"]) {
    for (const [name, version] of Object.entries(pkg[group] || {})) {
      if (lock.packages[""][group]?.[name] !== version) errors.push(`Lock file drift: ${name}`);
    }
  }
  return errors;
}

if (require.main === module) {
  const errors = checkRelease(path.resolve(__dirname, ".."));
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else console.log("Release files, documentation links and dependency lock are consistent.");
}

module.exports = { checkRelease };
