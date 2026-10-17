const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

test("backup CLI reads installation .env, keeps explicit overrides and preserves both databases", () => {
  const qa = path.resolve(".tepsy/qa");
  fs.mkdirSync(qa, { recursive: true });
  const root = fs.mkdtempSync(path.join(qa, "backup-cli-"));
  try {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^(TEPSY|RESTOPOS)_/.test(key)) delete env[key];
    const python = process.platform === "win32" ? "py" : "python3";
    const script = path.resolve("scripts/backup.cjs");
    const database = path.join(root, "configured #1.db");
    const ordinary = path.join(root, "prisma/dev.db");
    const setup = spawnSync(
      python,
      [
        "-c",
        "import pathlib,sqlite3,sys; p=pathlib.Path(sys.argv[1]); p.parent.mkdir(parents=True,exist_ok=True); c=sqlite3.connect(p); c.execute('CREATE TABLE marker(value TEXT)'); c.execute('INSERT INTO marker VALUES (?)',(sys.argv[2],)); c.commit(); c.close()",
        database,
        "configured",
      ],
      { env, encoding: "utf8", windowsHide: true }
    );
    assert.equal(setup.status, 0, setup.stderr);
    const second = spawnSync(
      python,
      [
        "-c",
        "import pathlib,sqlite3,sys; p=pathlib.Path(sys.argv[1]); p.parent.mkdir(parents=True,exist_ok=True); c=sqlite3.connect(p); c.execute('CREATE TABLE marker(value TEXT)'); c.execute(\"INSERT INTO marker VALUES ('ordinary')\"); c.commit(); c.close()",
        ordinary,
      ],
      { env, encoding: "utf8", windowsHide: true }
    );
    assert.equal(second.status, 0, second.stderr);
    fs.writeFileSync(
      path.join(root, ".env"),
      `TEPSY_DATABASE_URL=${pathToFileURL(database).href}\nTEPSY_BACKUP_DIR=custom backups\n`
    );
    const before = [database, ordinary].map((file) => fs.readFileSync(file));
    for (const [args, marker, folder] of [
      [[], "configured", "custom backups"],
      [["--source", ordinary, "--dest-dir", "explicit backups"], "ordinary", "explicit backups"],
    ]) {
      const run = spawnSync(process.execPath, [script, ...args], {
        cwd: root,
        env,
        encoding: "utf8",
        windowsHide: true,
      });
      assert.equal(run.status, 0, run.stderr);
      const filename = run.stdout.trim();
      assert.equal(path.dirname(filename), path.join(root, folder));
      const read = spawnSync(
        python,
        [
          "-c",
          "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(c.execute('SELECT value FROM marker').fetchone()[0]); c.close()",
          filename,
        ],
        { env, encoding: "utf8", windowsHide: true }
      );
      assert.equal(read.status, 0, read.stderr);
      assert.equal(read.stdout.trim(), marker);
    }
    [database, ordinary].forEach((file, index) =>
      assert.deepEqual(fs.readFileSync(file), before[index])
    );
  } finally {
    assert.ok(root.startsWith(qa + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
