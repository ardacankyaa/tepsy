import { createHash } from "node:crypto";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const pendingKeys = new Map();

export class OrderIdempotencyError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "OrderIdempotencyError";
    this.code = code;
    this.status = status;
  }
}

export function optionalOrderIdempotencyKey(body) {
  if (
    body?.idempotencyKey === undefined ||
    body.idempotencyKey === null ||
    body.idempotencyKey === ""
  )
    return null;
  if (typeof body.idempotencyKey !== "string") {
    throw new OrderIdempotencyError(
      "invalid-idempotency-key",
      400,
      "The idempotency key is invalid."
    );
  }

  const key = body.idempotencyKey.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new OrderIdempotencyError(
      "invalid-idempotency-key",
      400,
      "The idempotency key is invalid."
    );
  }
  return key;
}

export function orderRequestFingerprint(source, payload) {
  return createHash("sha256").update(JSON.stringify({ source, payload })).digest("hex");
}

export async function findIdempotentOrder(client, key, fingerprint) {
  if (!key) return null;
  const order = await client.order.findUnique({ where: { idempotencyKey: key } });
  if (!order) return null;
  if (order.requestFingerprint !== fingerprint) {
    throw new OrderIdempotencyError(
      "idempotency-conflict",
      409,
      "This idempotency key was already used for a different order."
    );
  }
  return order;
}

export async function withOrderIdempotencyLock(key, operation) {
  if (!key) return operation();

  const preceding = pendingKeys.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  pendingKeys.set(key, current);
  await preceding;

  try {
    return await operation();
  } finally {
    release();
    if (pendingKeys.get(key) === current) pendingKeys.delete(key);
  }
}

export function preferOrderItemNameSnapshots(order) {
  if (!order || !Array.isArray(order.items)) return order;
  return {
    ...order,
    items: order.items.map((item) =>
      !item.menuItemName && item.menuItem?.name
        ? { ...item, menuItemName: item.menuItem.name }
        : item
    ),
  };
}

export function preferTableOrderItemNameSnapshots(table) {
  if (!table || !Array.isArray(table.orders)) return table;
  return { ...table, orders: table.orders.map(preferOrderItemNameSnapshots) };
}
