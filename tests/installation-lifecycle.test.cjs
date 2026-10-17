const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  stageFreshDatabase,
  withInstallationLock,
  serverUrl,
  runtimeMatches,
} = require("../scripts/installation-lifecycle.cjs");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function temporary(work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tepsy-installer-test-"));
  try {
    await work(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
test("failed fresh schema or seed is never published and a retry succeeds", async () =>
  temporary(async (root) => {
    const target = path.join(root, "prisma", "restaurant.db");
    await assert.rejects(
      stageFreshDatabase(target, async (stage) => {
        fs.writeFileSync(stage, "incomplete schema");
        assert.equal(fs.existsSync(target), false);
        throw new Error("Interrupted seed");
      }),
      /Interrupted seed/
    );
    assert.equal(fs.existsSync(target), false);
    await stageFreshDatabase(target, async (stage) =>
      fs.writeFileSync(stage, "complete schema and seed")
    );
    assert.equal(fs.readFileSync(target, "utf8"), "complete schema and seed");
  }));
test("fresh publication refuses an existing restaurant including a concurrent creator", async () =>
  temporary(async (root) => {
    const target = path.join(root, "restaurant.db");
    fs.writeFileSync(target, "existing restaurant");
    let called = false;
    await assert.rejects(
      stageFreshDatabase(target, async () => {
        called = true;
      }),
      /existing|exists/i
    );
    assert.equal(called, false);
    assert.equal(fs.readFileSync(target, "utf8"), "existing restaurant");
    fs.unlinkSync(target);
    await assert.rejects(
      stageFreshDatabase(target, async (stage) => {
        fs.writeFileSync(stage, "new installation");
        fs.writeFileSync(target, "other creator");
      })
    );
    assert.equal(fs.readFileSync(target, "utf8"), "other creator");
  }));
test("concurrent lifecycle operations serialize and release after failure", async () =>
  temporary(async (root) => {
    const events = [];
    let firstEntered;
    const entered = new Promise((resolve) => {
      firstEntered = resolve;
    });
    const first = withInstallationLock(root, async () => {
      events.push("first start");
      firstEntered();
      await wait(120);
      events.push("first end");
    });
    await entered;
    const second = withInstallationLock(root, async () => events.push("second start"));
    await Promise.all([first, second]);
    assert.deepEqual(events, ["first start", "first end", "second start"]);
    await assert.rejects(
      withInstallationLock(root, async () => {
        throw new Error("setup failure");
      }),
      /setup failure/
    );
    await withInstallationLock(root, async () => events.push("retry"));
    assert.equal(events.at(-1), "retry");
  }));
test("a lock held by a live process is not removed and a dead process lock is reclaimed", async () =>
  temporary(async (root) => {
    const lock = path.join(root, ".tepsy", "installation.lock");
    fs.mkdirSync(lock, { recursive: true });
    const owner = path.join(lock, "owner-existing.json");
    fs.writeFileSync(owner, JSON.stringify({ pid: process.pid }));
    await assert.rejects(
      withInstallationLock(root, async () => assert.fail("must not enter"), { timeoutMs: 100 }),
      /installation|busy|lock/i
    );
    assert.equal(fs.existsSync(owner), true);
    fs.writeFileSync(owner, JSON.stringify({ pid: 2147483647 }));
    await withInstallationLock(root, async () => assert.equal(fs.existsSync(owner), false));
    assert.equal(fs.existsSync(lock), false);
  }));
test("readiness URLs use the actual bind address and bracket IPv6", () => {
  assert.equal(serverUrl({ host: "0.0.0.0", port: 3000 }), "http://127.0.0.1:3000");
  assert.equal(serverUrl({ host: "::", port: 3000 }), "http://[::1]:3000");
  assert.equal(serverUrl({ host: "::1", port: 3100 }), "http://[::1]:3100");
  assert.equal(serverUrl({ host: "192.168.1.22", port: 3200 }), "http://192.168.1.22:3200");
});

test("a running installer child keeps its lease after an interrupted manager operation", async () =>
  temporary(async (root) => {
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      windowsHide: true,
      stdio: "ignore",
    });
    const exited = new Promise((resolve) => child.once("close", resolve));
    try {
      await assert.rejects(
        withInstallationLock(root, async (trackChild) => {
          trackChild(child.pid);
          throw new Error("manager interrupted");
        }),
        /manager interrupted/
      );
      await assert.rejects(
        withInstallationLock(root, async () => assert.fail("installer child still running"), {
          timeoutMs: 100,
        }),
        /busy/
      );
      process.kill(child.pid, 0);
    } finally {
      child.kill();
      await exited;
    }
    await withInstallationLock(root, async () => {});
    assert.equal(fs.existsSync(path.join(root, ".tepsy", "installation.lock")), false);
  }));

test("lock cleanup failure preserves the original installation error", async () =>
  temporary(async (root) => {
    const original = new Error("the build failed");
    await assert.rejects(
      withInstallationLock(root, async () => {
        const lock = path.join(root, ".tepsy", "installation.lock");
        const owner = path.join(lock, fs.readdirSync(lock)[0]);
        fs.unlinkSync(owner);
        fs.mkdirSync(owner);
        throw original;
      }),
      (error) => error === original && error.cleanupError instanceof Error
    );
  }));
test("stage cleanup failure preserves the original initialization error", async () =>
  temporary(async (root) => {
    const original = new Error("schema application failed");
    await assert.rejects(
      stageFreshDatabase(path.join(root, "restaurant.db"), async (stage) => {
        fs.mkdirSync(stage);
        throw original;
      }),
      (error) => error === original && error.cleanupError instanceof Error
    );
    assert.equal(fs.existsSync(path.join(root, "restaurant.db")), false);
  }));
test("lock cleanup errors remain visible when the installation itself succeeded", async () =>
  temporary(async (root) => {
    await assert.rejects(
      withInstallationLock(root, async () => {
        const lock = path.join(root, ".tepsy", "installation.lock");
        const owner = path.join(lock, fs.readdirSync(lock)[0]);
        fs.unlinkSync(owner);
        fs.mkdirSync(owner);
      }),
      (error) => Boolean(error.code)
    );
  }));

test("installer child lease cleanup does not throw from a child-close callback or mask a build failure", async () =>
  temporary(async (root) => {
    const original = new Error("installer child failed");
    await assert.rejects(
      withInstallationLock(root, async (trackChild) => {
        const release = trackChild(process.pid);
        const lock = path.join(root, ".tepsy", "installation.lock");
        const lease = path.join(
          lock,
          fs.readdirSync(lock).find((name) => name.startsWith("child-"))
        );
        fs.unlinkSync(lease);
        fs.mkdirSync(lease);
        assert.doesNotThrow(release);
        throw original;
      }),
      (error) => error === original && error.cleanupError instanceof Error
    );
  }));

test("owned server reuse requires matching PID, bind address and numeric port metadata", async () =>
  temporary(async (root) => {
    const state = path.join(root, ".tepsy");
    fs.mkdirSync(state);
    const record = path.join(state, "production-runtime.json");
    const requested = { host: "127.0.0.1", port: 3100 };
    assert.equal(runtimeMatches(root, 100, requested), false);
    for (const value of [
      null,
      {},
      { pid: 101, host: "127.0.0.1", port: 3100 },
      { pid: 100, host: "127.0.0.1", port: 3000 },
      { pid: 100, host: "::1", port: 3100 },
      { pid: 100, host: "127.0.0.1", port: "3100" },
    ]) {
      fs.writeFileSync(record, JSON.stringify(value));
      assert.equal(runtimeMatches(root, 100, requested), false);
    }
    fs.writeFileSync(record, "incomplete metadata");
    assert.equal(runtimeMatches(root, 100, requested), false);
    fs.writeFileSync(record, JSON.stringify({ pid: 100, host: "127.0.0.1", port: 3100 }));
    assert.equal(runtimeMatches(root, 100, requested), true);
  }));
