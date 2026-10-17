function normalizeRestaurantLogoUrl(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "string" && /^\/api\/public\/menu-images\/[a-f0-9]{64}\.webp$/.test(value))
    return value;
  const error = new Error("İşletme logosu için geçerli bir görsel yükleyin.");
  error.status = 400;
  throw error;
}
module.exports = { normalizeRestaurantLogoUrl };
