export const OPEN_ORDER_STATUSES = new Set(["PENDING", "PREPARING", "READY", "DELIVERED"]);

const ORDER_TRANSITIONS = new Map([
  ["AWAITING_WAITER_APPROVAL", new Set(["PENDING"])],
  ["PENDING", new Set(["PREPARING", "READY", "DELIVERED", "CANCELLED"])],
  ["PREPARING", new Set(["READY", "CANCELLED"])],
  ["READY", new Set(["DELIVERED", "CANCELLED"])],
  ["DELIVERED", new Set(["CANCELLED"])],
  ["PAID", new Set()],
  ["CANCELLED", new Set()],
]);

const KITCHEN_ITEM_STATUSES = new Set(["PENDING", "PREPARING", "READY"]);

export class OrderWorkflowError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OrderWorkflowError";
    this.code = code;
  }
}

export function isOpenOrderStatus(status) {
  return OPEN_ORDER_STATUSES.has(status);
}

export function isValidOrderTransition(currentStatus, nextStatus) {
  return ORDER_TRANSITIONS.get(currentStatus)?.has(nextStatus) || false;
}

export function validateOrderPatch(body, order) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new OrderWorkflowError("invalid-body", "Order update must be a JSON object.");
  }

  const supportedKeys = new Set(["status", "addItems", "cancelItemId", "itemStatusUpdate"]);
  const keys = Object.keys(body).filter((key) => body[key] !== undefined);
  if (keys.some((key) => !supportedKeys.has(key))) {
    throw new OrderWorkflowError("invalid-action", "Order update contains an unsupported action.");
  }
  if (keys.length !== 1) {
    throw new OrderWorkflowError("invalid-action", "Submit exactly one order action per request.");
  }

  const [action] = keys;
  if (
    order?.status === "AWAITING_WAITER_APPROVAL" &&
    !(action === "status" && body.status === "PENDING")
  ) {
    throw new OrderWorkflowError(
      "approval-required",
      "An order awaiting approval must be approved before it can be changed."
    );
  }
  if (!isOpenOrderStatus(order?.status)) {
    if (order?.status !== "AWAITING_WAITER_APPROVAL") {
      throw new OrderWorkflowError("closed-order", "Paid or cancelled orders cannot be changed.");
    }
  }

  if (action === "status") {
    if (typeof body.status !== "string" || !isValidOrderTransition(order.status, body.status)) {
      throw new OrderWorkflowError("invalid-transition", "Order status transition is not allowed.");
    }
    if (body.status === "CANCELLED" && (order.payments || []).length > 0) {
      throw new OrderWorkflowError(
        "paid-order-cancellation",
        "Orders with payments require a separate refund or correction."
      );
    }
    return { action, status: body.status };
  }

  if (action === "addItems") {
    if (!Array.isArray(body.addItems) || body.addItems.length === 0 || body.addItems.length > 100) {
      throw new OrderWorkflowError(
        "invalid-items",
        "Order update must include between 1 and 100 items."
      );
    }
    if ((order.payments || []).length > 0) {
      throw new OrderWorkflowError(
        "partially-paid-order",
        "An order with recorded payments cannot be edited."
      );
    }
    throw new OrderWorkflowError(
      "new-ticket-required",
      "Ek ürünler yeni sipariş olarak gönderilmelidir. Adisyonu yenileyip yeniden deneyin."
    );
  }

  if (action === "cancelItemId") {
    if (typeof body.cancelItemId !== "string" || !body.cancelItemId.trim()) {
      throw new OrderWorkflowError("invalid-item", "An order item identifier is required.");
    }
    if ((order.payments || []).length > 0) {
      throw new OrderWorkflowError(
        "partially-paid-order",
        "An order with recorded payments cannot be edited."
      );
    }
    return { action, itemId: body.cancelItemId.trim() };
  }

  if (action === "itemStatusUpdate") {
    const update = body.itemStatusUpdate;
    if (
      !update ||
      typeof update !== "object" ||
      Array.isArray(update) ||
      typeof update.itemId !== "string" ||
      !update.itemId.trim() ||
      !KITCHEN_ITEM_STATUSES.has(update.expectedStatus) ||
      !["PENDING", "READY"].includes(update.status) ||
      !KITCHEN_ITEM_STATUSES.has(order.status)
    ) {
      throw new OrderWorkflowError("invalid-item-status", "Order item status update is invalid.");
    }
    return {
      action,
      itemId: update.itemId.trim(),
      expectedStatus: update.expectedStatus,
      status: update.status,
    };
  }

  throw new OrderWorkflowError("invalid-action", "Order action is not supported.");
}

export function isOrderActionAllowedForRole(role, action) {
  if (role === "ADMIN") return true;
  if (role === "WAITER") {
    return (
      action.action === "addItems" ||
      action.action === "cancelItemId" ||
      (action.action === "status" && ["PENDING", "DELIVERED", "CANCELLED"].includes(action.status))
    );
  }
  if (role === "CASHIER") {
    return action.action === "addItems" || action.action === "cancelItemId";
  }
  if (role === "KITCHEN") {
    return (
      (action.action === "status" && ["PREPARING", "READY"].includes(action.status)) ||
      action.action === "itemStatusUpdate"
    );
  }
  return false;
}
