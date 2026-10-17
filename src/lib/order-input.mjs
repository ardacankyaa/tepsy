import { FinanceError } from "./finance.mjs";

function normalizeQuantity(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return NaN;
}

function normalizeOptionalText(value, { fieldName, maxLength, errorCode }) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new FinanceError(errorCode, `${fieldName} must be text.`);
  }
  return value.trim().slice(0, maxLength) || null;
}

export function normalizeOrderRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new FinanceError("invalid-order", "Order data must be a JSON object.");
  }
  if (
    typeof body.tableId !== "string" ||
    !body.tableId.trim() ||
    body.tableId.trim().length > 100
  ) {
    throw new FinanceError("invalid-table", "A valid table identifier is required.");
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
    throw new FinanceError("invalid-items", "An order must include between 1 and 100 items.");
  }

  const items = body.items.map((item) => {
    const menuItemId = typeof item?.menuItemId === "string" ? item.menuItemId.trim() : "";
    const quantity = normalizeQuantity(item?.quantity);
    const notes = normalizeOptionalText(item?.notes, {
      fieldName: "Item notes",
      maxLength: 300,
      errorCode: "invalid-items",
    });
    return { menuItemId, quantity, notes };
  });
  if (
    items.some(
      (item) =>
        !item.menuItemId ||
        item.menuItemId.length > 100 ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 99
    )
  ) {
    throw new FinanceError("invalid-items", "Order items or quantities are invalid.");
  }

  return {
    tableId: body.tableId.trim(),
    items,
    notes: normalizeOptionalText(body.notes, {
      fieldName: "Order notes",
      maxLength: 500,
      errorCode: "invalid-order",
    }),
  };
}
