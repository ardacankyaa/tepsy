const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("formatting visits published source without traversing private or inaccessible directories", async () => {
  const { sourceFormatFiles, formatSource } = require("../scripts/format-source.cjs");
  const qa = path.resolve(".tepsy/qa");
  fs.mkdirSync(qa, { recursive: true });
  const root = fs.mkdtempSync(path.join(qa, "format-source-"));
  try {
    for (const file of [
      "src/page.js",
      ".tepsy/qa/private.json",
      "node_modules/private.json",
      ".env",
    ]) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(
        path.join(root, file),
        file.endsWith("page.js") ? "const value=1;\n" : "private unchanged"
      );
    }
    assert.deepEqual(await sourceFormatFiles(root), ["src/page.js"]);
    assert.deepEqual(await formatSource(root, false), ["src/page.js"]);
    assert.deepEqual(await formatSource(root, true), ["src/page.js"]);
    assert.deepEqual(await formatSource(root, false), []);
    assert.equal(
      fs.readFileSync(path.join(root, ".tepsy/qa/private.json"), "utf8"),
      "private unchanged"
    );
  } finally {
    assert.ok(root.startsWith(qa + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
