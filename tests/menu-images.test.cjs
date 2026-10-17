const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  MAX_UPLOAD_BYTES,
  readImageRequest,
  storeMenuImage,
  readMenuImage,
} = require("../src/lib/menu-images.cjs");

test("uploaded photos are normalized, resized, content addressed and readable without the original file", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tepsy-menu-image-"));
  try {
    const original = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: "#e18435" },
    })
      .withMetadata({ orientation: 1 })
      .jpeg()
      .toBuffer();
    assert.ok(
      (await sharp(original).metadata()).exif,
      "fixture must contain metadata so stripping is tested"
    );
    const image = await storeMenuImage(original, "image/jpeg", dir);
    assert.match(image.imageUrl, /^\/api\/public\/menu-images\/[a-f0-9]{64}\.webp$/);
    assert.equal(image.width, 1600);
    assert.equal(image.height, 800);
    assert.deepEqual(await storeMenuImage(original, "image/jpeg", dir), image);
    assert.equal((await fs.readdir(dir)).length, 1);
    const saved = await readMenuImage(image.imageUrl.split("/").pop(), dir);
    const metadata = await sharp(saved).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 1600);
    assert.equal(metadata.exif, undefined);
    await assert.rejects(readMenuImage("../secret", dir), (error) => error.status === 404);
    await assert.rejects(
      readMenuImage("a".repeat(64) + ".webp", dir),
      (error) => error.status === 404
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("photos reject unsupported types, corrupt bytes, oversized payloads and disguised content", async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } })
    .png()
    .toBuffer();
  for (const [bytes, type] of [
    [Buffer.from("<svg/>"), "image/svg+xml"],
    [Buffer.from("invalid"), "image/png"],
    [png, "image/jpeg"],
    [Buffer.alloc(MAX_UPLOAD_BYTES + 1), "image/png"],
  ]) {
    await assert.rejects(storeMenuImage(bytes, type), (error) =>
      [400, 413, 415].includes(error.status)
    );
  }
  const huge = await sharp({ create: { width: 8193, height: 1, channels: 3, background: "red" } })
    .png()
    .toBuffer();
  await assert.rejects(storeMenuImage(huge, "image/png"), (error) => error.status === 400);
});

test("request size limits apply even without Content-Length or with a misleading length", async () => {
  const bytes = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
  const req = (length) =>
    new Request("http://localhost/api/menu-images", {
      method: "POST",
      headers: { "Content-Type": "image/png", ...(length ? { "Content-Length": length } : {}) },
      body: bytes,
    });
  await assert.rejects(readImageRequest(req()), (error) => error.status === 413);
  await assert.rejects(readImageRequest(req("2")), (error) => error.status === 413);
  await assert.rejects(
    readImageRequest(req(String(MAX_UPLOAD_BYTES + 1))),
    (error) => error.status === 413
  );
  await assert.rejects(
    readImageRequest(
      new Request("http://localhost", {
        method: "POST",
        body: "abc",
        headers: { "Content-Type": "image/svg+xml" },
      })
    ),
    (error) => error.status === 415
  );
});
