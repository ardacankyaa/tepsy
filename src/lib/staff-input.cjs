const ROLES = new Set(["ADMIN", "WAITER", "KITCHEN", "CASHIER"]);

function invalid() {
  throw new Error("Geçersiz personel bilgisi.");
}

function normalizeStaffUpdate(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof body.id !== "string" ||
    !body.id.trim()
  )
    invalid();
  const data = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 100)
      invalid();
    data.name = body.name.trim();
  }
  if (body.role !== undefined) {
    if (typeof body.role !== "string" || !ROLES.has(body.role.toUpperCase())) invalid();
    data.role = body.role.toUpperCase();
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") invalid();
    data.isActive = body.isActive;
  }
  if (body.pin !== undefined) {
    if (typeof body.pin !== "string" || body.pin.length < 4 || body.pin.length > 32) invalid();
    data.pin = body.pin;
  }
  if (!Object.keys(data).length) invalid();
  return data;
}

function normalizeStaffCreate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid();
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 100)
    invalid();
  if (body.role !== undefined && typeof body.role !== "string") invalid();
  if (
    body.pin === undefined ||
    typeof body.pin !== "string" ||
    body.pin.length < 4 ||
    body.pin.length > 32
  )
    invalid();

  const role = (body.role || "WAITER").toUpperCase();
  if (!ROLES.has(role)) invalid();
  return { name: body.name.trim(), role, pin: body.pin };
}

module.exports = { normalizeStaffCreate, normalizeStaffUpdate };
