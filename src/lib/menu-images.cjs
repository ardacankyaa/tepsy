const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const formats = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" };
const imageDirectory = () =>
  path.resolve(
    process.env.TEPSY_MENU_IMAGE_DIR || path.join(process.cwd(), ".tepsy", "menu-images")
  );
function invalid(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

async function readImageRequest(request) {
  const type = String(request.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!formats[type]) invalid(415, "JPEG, PNG veya WebP fotoğraf seçin.");
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_UPLOAD_BYTES) invalid(413, "Fotoğraf en fazla 5 MB olabilir.");
  if (!request.body) invalid(400, "Fotoğraf dosyası boş.");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_UPLOAD_BYTES) {
        await reader.cancel();
        invalid(413, "Fotoğraf en fazla 5 MB olabilir.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return { bytes: Buffer.concat(chunks), type };
}

async function storeMenuImage(bytes, type, directory = imageDirectory()) {
  if (!formats[type]) invalid(415, "JPEG, PNG veya WebP fotoğraf seçin.");
  if (!bytes?.length) invalid(400, "Fotoğraf dosyası boş.");
  if (bytes.length > MAX_UPLOAD_BYTES) invalid(413, "Fotoğraf en fazla 5 MB olabilir.");
  let normalized;
  try {
    const pipeline = sharp(bytes, {
      limitInputPixels: 16_000_000,
      animated: false,
      failOn: "warning",
    });
    const metadata = await pipeline.metadata();
    if (
      metadata.format !== formats[type] ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > 8192 ||
      metadata.height > 8192 ||
      (metadata.pages || 1) > 1
    )
      invalid(400, "Fotoğraf biçimi veya boyutları geçersiz.");
    normalized = await pipeline
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84 })
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    if (error.status) throw error;
    invalid(400, "Fotoğraf okunamadı. Geçerli bir JPEG, PNG veya WebP seçin.");
  }
  const filename = crypto.createHash("sha256").update(normalized.data).digest("hex") + ".webp";
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(path.join(directory, filename), normalized.data, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return {
    imageUrl: `/api/public/menu-images/${filename}`,
    width: normalized.info.width,
    height: normalized.info.height,
  };
}

async function readMenuImage(filename, directory = imageDirectory()) {
  if (typeof filename !== "string" || !/^[a-f0-9]{64}\.webp$/.test(filename))
    invalid(404, "Fotoğraf bulunamadı.");
  try {
    return await fs.readFile(path.join(directory, filename));
  } catch (error) {
    if (error.code === "ENOENT") invalid(404, "Fotoğraf bulunamadı.");
    throw error;
  }
}

module.exports = {
  MAX_UPLOAD_BYTES,
  imageDirectory,
  readImageRequest,
  storeMenuImage,
  readMenuImage,
};
