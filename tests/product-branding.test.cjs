const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { releaseFiles } = require("../scripts/release-files.cjs");

test("published product copy contains TEPSY identity without former product branding", () => {
  const files = releaseFiles(process.cwd()).filter(
    (file) =>
      /^(src\/|public\/|docs\/|prisma\/|README\.md$)/.test(file) &&
      /\.(js|jsx|mjs|cjs|css|md|prisma|json)$/.test(file)
  );
  const formerIdentity = /(?<![.\w])(?:RestoPOS|Rimvo)(?![_:\w-])|Gurme (?:Kafe|Cafe)/i;
  const found = files.filter((file) =>
    formerIdentity.test(fs.readFileSync(path.resolve(file), "utf8"))
  );
  assert.deepEqual(
    found,
    [],
    "legacy protocol identifiers may remain, but product branding must be TEPSY"
  );
});
