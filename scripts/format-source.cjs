const fs = require("node:fs");
const path = require("node:path");
const prettier = require("prettier");
const { releaseFiles } = require("./release-files.cjs");

async function sourceFormatFiles(root) {
  const files = [];
  for (const file of releaseFiles(root)) {
    const info = await prettier.getFileInfo(path.join(root, file));
    if (info.inferredParser) files.push(file);
  }
  return files;
}

async function formatSource(root, write) {
  const changed = [];
  for (const file of await sourceFormatFiles(root)) {
    const absolute = path.join(root, file);
    const original = fs.readFileSync(absolute, "utf8");
    const options = { ...(await prettier.resolveConfig(absolute)), filepath: absolute };
    const formatted = await prettier.format(original, options);
    if (original === formatted) continue;
    changed.push(file);
    if (write) fs.writeFileSync(absolute, formatted);
  }
  return changed;
}

if (require.main === module) {
  const write = process.argv.includes("--write");
  formatSource(path.resolve(__dirname, ".."), write)
    .then((changed) => {
      for (const file of changed)
        console.log(`${write ? "Formatted" : "Needs formatting"}: ${file}`);
      console.log(`${write ? "Format" : "Format check"}: ${changed.length} changed source files.`);
      if (!write && changed.length) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { sourceFormatFiles, formatSource };
