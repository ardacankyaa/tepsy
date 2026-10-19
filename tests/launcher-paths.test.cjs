const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const paths = require("../scripts/local-paths.cjs");
const { spawnSync } = require("node:child_process");

test("an installed restaurant can run its own launcher without copying over itself", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tepsy-self-launch-"));
  try {
    const app = path.join(directory, "app");
    fs.mkdirSync(path.join(app, "scripts"), { recursive: true });
    const scripts = path.resolve(__dirname, "../scripts");
    for (const name of fs.readdirSync(scripts).filter((name) => name.endsWith(".cjs")))
      fs.copyFileSync(path.join(scripts, name), path.join(app, "scripts", name));
    fs.writeFileSync(path.join(app, "keep-private.txt"), "retained");
    fs.writeFileSync(
      path.join(app, ".managed-install.json"),
      JSON.stringify({ mode: "app", files: ["server.js", "package.json"] })
    );
    const run = () =>
      spawnSync(
        process.execPath,
        [
          "-e",
          "require(process.argv[1]+'/scripts/local-app.cjs').syncSource(process.argv[1]);",
          app,
        ],
        { encoding: "utf8", windowsHide: true }
      );
    assert.equal(run().status, 0, "A verified installed source may reuse itself");
    assert.equal(fs.readFileSync(path.join(app, "keep-private.txt"), "utf8"), "retained");
    fs.unlinkSync(path.join(app, ".managed-install.json"));
    assert.notEqual(run().status, 0, "An unverified checkout cannot become its own installation");
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("an installed restaurant launcher keeps its own data home", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tepsy-profile-paths-"));
  try {
    const app = path.join(directory, "restaurants", "abc", "app");
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(
      path.join(app, ".managed-install.json"),
      JSON.stringify({ mode: "app", files: ["server.js", "package.json"] })
    );
    const actual = paths.managedPathsForSource(app, {});
    assert.equal(actual.app, app);
    assert.equal(actual.dataHome, path.dirname(app));
    const override = paths.managedPathsForSource(app, {
      TEPSY_LOCAL_DATA_HOME: path.join(directory, "explicit"),
    });
    assert.equal(override.dataHome, path.join(directory, "explicit"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a source checkout keeps the normal installation default", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tepsy-checkout-paths-"));
  try {
    assert.deepEqual(paths.managedPathsForSource(directory, {}), paths.managedPaths({}));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
