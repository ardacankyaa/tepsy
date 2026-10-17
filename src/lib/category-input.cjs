function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function normalizeCategoryInput(body, update = false) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    invalid("Geçersiz kategori bilgisi.");
  if (update && (typeof body.id !== "string" || !body.id.trim() || body.id.length > 100))
    invalid("Geçerli kategori ID gerekli.");
  const data = {};
  if (!update || body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120)
      invalid("Geçerli kategori adı gerekli.");
    data.name = body.name.trim();
  }
  if (body.sortOrder !== undefined) {
    if (!Number.isInteger(body.sortOrder) || Math.abs(body.sortOrder) > 100000)
      invalid("Geçerli kategori sırası gerekli.");
    data.sortOrder = body.sortOrder;
  } else if (!update) data.sortOrder = 0;
  if (body.icon !== undefined) {
    if (typeof body.icon !== "string" || !/^[A-Za-z][A-Za-z0-9]{0,59}$/.test(body.icon))
      invalid("Geçerli kategori simgesi gerekli.");
    data.icon = body.icon;
  } else if (!update) data.icon = "Coffee";
  if (update && !Object.keys(data).length) invalid("Güncellenecek kategori alanı gerekli.");
  return data;
}

module.exports = { normalizeCategoryInput };
