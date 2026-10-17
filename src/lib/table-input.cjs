class TableInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function normalizeTableInput(body, create = false) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new TableInputError("Masa bilgileri geçersiz.");
  const result = { ...body };
  for (const [key, max] of [
    ["id", 100],
    ["tableNumber", 80],
    ["section", 80],
  ]) {
    if (body[key] !== undefined || (create ? key === "tableNumber" : key === "id")) {
      if (typeof body[key] !== "string" || !body[key].trim() || body[key].trim().length > max)
        throw new TableInputError("Masa adı, bölüm veya kimlik geçersiz.");
      result[key] = body[key].trim();
    }
  }
  for (const [key, min, max] of [
    ["capacity", 1, 99],
    ["posX", 0, 100],
    ["posY", 0, 100],
  ]) {
    if (body[key] === undefined) continue;
    if (!["number", "string"].includes(typeof body[key]) || String(body[key]).trim() === "")
      throw new TableInputError("Masa kapasitesi veya konumu geçersiz.");
    const value = Number(body[key]);
    if (
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (key === "capacity" && !Number.isInteger(value))
    )
      throw new TableInputError("Masa kapasitesi veya konumu geçersiz.");
    result[key] = value;
  }
  if (body.shape !== undefined && !["SQUARE", "ROUND", "RECTANGLE"].includes(body.shape))
    throw new TableInputError("Masa şekli geçersiz.");
  return result;
}

module.exports = { normalizeTableInput, TableInputError };
