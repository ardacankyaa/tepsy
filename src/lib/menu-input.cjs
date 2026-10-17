function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function isAllowedMenuImageUrl(value) {
  if (
    value.includes("\\") ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    return false;
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function normalizeMenuInput(body, update) {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid("Geçersiz ürün bilgisi.");
  const data = {};
  if (!update || body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120)
      invalid("Geçerli ürün adı gerekli.");
    data.name = body.name.trim();
  }
  if (!update || body.categoryId !== undefined) {
    if (
      typeof body.categoryId !== "string" ||
      !body.categoryId.trim() ||
      body.categoryId.length > 100
    )
      invalid("Geçerli kategori gerekli.");
    data.categoryId = body.categoryId;
  }
  if (!update || body.price !== undefined) {
    if (typeof body.price !== "string" && typeof body.price !== "number")
      invalid("Geçerli ürün fiyatı gerekli.");
    if (typeof body.price === "number" && !Number.isFinite(body.price))
      invalid("Geçerli ürün fiyatı gerekli.");
    const price = String(body.price);
    if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(price)) invalid("Geçerli ürün fiyatı gerekli.");
    data.price = Number(price).toFixed(2);
  }
  for (const field of ["description", "imageUrl"]) {
    if (body[field] !== undefined) {
      if (body[field] !== null && typeof body[field] !== "string")
        invalid("Geçersiz ürün açıklaması veya görseli.");
      const value = body[field]?.trim() || null;
      if (value && value.length > (field === "description" ? 1000 : 2000))
        invalid("Ürün alanı çok uzun.");
      if (field === "imageUrl" && value && !isAllowedMenuImageUrl(value))
        invalid("Görsel adresi HTTPS veya kök dizinden başlayan yerel bir yol olmalıdır.");
      data[field] = value;
    }
  }
  if (body.isAvailable !== undefined) {
    if (typeof body.isAvailable !== "boolean") invalid("Geçerli stok durumu gerekli.");
    data.isAvailable = body.isAvailable;
  } else if (!update) data.isAvailable = true;
  if (update && !Object.keys(data).length) invalid("Güncellenecek ürün alanı gerekli.");
  return data;
}

module.exports = { normalizeMenuInput, isAllowedMenuImageUrl };
