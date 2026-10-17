const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { releaseFiles, sourceHash } = require("../scripts/release-files.cjs");

test("release includes source and migrations while excluding runtime data, databases and secrets", () => {
  const qaRoot = path.resolve(".tepsy/qa");
  fs.mkdirSync(qaRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(qaRoot, "release-files-"));
  assert.ok(root.startsWith(qaRoot + path.sep), "Invalid release test cleanup path");
  try {
    const forbidden = [
      ".env",
      "prisma/dev.db",
      "prisma/dev.db-wal",
      ".tepsy/devices.json",
      "node_modules/example/index.js",
      "scripts/__pycache__/tool.py",
      "tests/.tmp-backup/config.json",
    ];
    for (const file of [
      "package.json",
      ".env.example",
      "src/app/page.js",
      "prisma/schema.prisma",
      "prisma/migrations/v1/migration.sql",
      ...forbidden,
    ]) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), "{}");
    }
    const files = releaseFiles(root);
    for (const name of ["src/app/page.js", "prisma/migrations/v1/migration.sql", ".env.example"])
      assert.ok(files.includes(name));
    for (const name of forbidden)
      assert.ok(!files.includes(name), `private file included: ${name}`);
    const original = sourceHash(root);
    fs.writeFileSync(path.join(root, ".env"), "changed private secret");
    assert.equal(sourceHash(root), original);
    fs.writeFileSync(path.join(root, "src/app/page.js"), "changed source");
    assert.notEqual(sourceHash(root), original);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
