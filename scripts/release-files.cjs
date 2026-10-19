const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const directories = ["src", "public", "prisma", "scripts", "tests", "docs", ".github"];
const rootFiles = [
  ".env.example",
  ".gitattributes",
  ".gitignore",
  "AGENTS.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "DESIGN.md",
  "PRODUCT.md",
  "README.md",
  "SECURITY.md",
  ".prettierrc.json",
  ".prettierignore",
  "LICENSE",
  "package.json",
  "package-lock.json",
  "server.js",
  "SETUP.bat",
  "START.bat",
  "OWNER-RECOVERY.bat",
  "DEMO.bat",
  "STOP.bat",
  ".nvmrc",
  "eslint.config.mjs",
  "jsconfig.json",
  "next.config.mjs",
  "postcss.config.js",
  "tailwind.config.js",
];
const extensions = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".sql",
  ".prisma",
  ".toml",
  ".ps1",
  ".bat",
  ".json",
  ".md",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".ico",
  ".yml",
  ".yaml",
  ".py",
]);
const blocked = new Set([
  "node_modules",
  ".next",
  ".tepsy",
  ".restopos",
  ".git",
  "__pycache__",
  ".tmp-backup",
  "dist",
  "test-results",
  "playwright-report",
]);

function releaseFiles(root) {
  const files = [];
  function visit(relative) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) return;
    const info = fs.lstatSync(absolute);
    if (info.isSymbolicLink()) throw new Error(`Release cannot include symlinks: ${relative}`);
    if (info.isDirectory()) {
      if (blocked.has(path.basename(relative))) return;
      for (const name of fs.readdirSync(absolute).sort()) visit(path.join(relative, name));
    } else if (
      rootFiles.includes(relative) ||
      (extensions.has(path.extname(relative)) && !path.basename(relative).startsWith(".env"))
    ) {
      files.push(relative.replaceAll(path.sep, "/"));
    }
  }
  rootFiles.forEach(visit);
  directories.forEach(visit);
  return files.sort();
}

function sourceHash(root) {
  const hash = crypto.createHash("sha256");
  for (const file of releaseFiles(root).filter((name) => !name.endsWith(".md"))) {
    hash.update(file + "\0");
    hash.update(fs.readFileSync(path.join(root, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

module.exports = { releaseFiles, sourceHash };
