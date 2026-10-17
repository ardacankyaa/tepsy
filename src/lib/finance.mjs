const OPEN_ORDER_STATUSES = new Set(["PENDING", "PREPARING", "READY", "DELIVERED"]);
const PAYMENT_METHODS = new Set(["CASH", "CREDIT_CARD", "OTHER"]);
const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

export class FinanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FinanceError";
    this.code = code;
  }
}

function decimalText(value, fieldName) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new FinanceError("invalid-money", `${fieldName} must be a finite amount.`);
    }
    return value.toString();
  }
  if (typeof value === "string") return value.trim();
  if (typeof value === "bigint") return value.toString();
  if (value && typeof value.toString === "function") return value.toString().trim();
  throw new FinanceError("invalid-money", `${fieldName} must be a decimal amount.`);
}

function scaledInteger(
  value,
  scaleDigits,
  { fieldName, allowNegative = false, maxFractionDigits = scaleDigits } = {}
) {
  const text = decimalText(value, fieldName || "Amount");
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match)
    throw new FinanceError(
      "invalid-money",
      `${fieldName || "Amount"} must be a plain decimal amount.`
    );

  const isNegative = match[1] === "-";
  if (isNegative && !allowNegative) {
    throw new FinanceError("negative-money", `${fieldName || "Amount"} cannot be negative.`);
  }

  const fraction = match[3] || "";
  const keptFraction = fraction.slice(0, scaleDigits);
  const discardedFraction = fraction.slice(scaleDigits);
  if (discardedFraction.length > 0 && /[1-9]/.test(discardedFraction)) {
    throw new FinanceError(
      "money-precision",
      `${fieldName || "Amount"} cannot include fractions smaller than one kuruş.`
    );
  }
  if (fraction.length > maxFractionDigits && /[1-9]/.test(fraction.slice(maxFractionDigits))) {
    throw new FinanceError(
      "money-precision",
      `${fieldName || "Amount"} has too many decimal places.`
    );
  }

  const digits = `${match[2]}${keptFraction.padEnd(scaleDigits, "0")}`;
  let result;
  try {
    result = BigInt(digits);
  } catch {
    throw new FinanceError(
      "invalid-money",
      `${fieldName || "Amount"} is outside the supported range.`
    );
  }
  if (isNegative) result = -result;
  return result;
}

function safeCents(value, fieldName = "Amount") {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new FinanceError("invalid-money", `${fieldName} is outside the supported range.`);
  }
  return value;
}

export function moneyToCents(value) {
  const cents = scaledInteger(value, 2, { fieldName: "Money", maxFractionDigits: 2 });
  if (cents < 0n) throw new FinanceError("negative-money", "Money cannot be negative.");
  if (cents > MAX_SAFE_CENTS)
    throw new FinanceError("invalid-money", "Money is outside the supported range.");
  return Number(cents);
}

export function paymentAmountToCents(value) {
  const parsed = scaledInteger(value, 2, {
    fieldName: "Payment amount",
    allowNegative: true,
    maxFractionDigits: 2,
  });
  if (parsed > MAX_SAFE_CENTS || parsed < -MAX_SAFE_CENTS) {
    throw new FinanceError("invalid-payment", "Payment amount is outside the supported range.");
  }
  const cents = Number(parsed);
  if (cents <= 0) throw new FinanceError("invalid-payment", "Payment amount must be positive.");
  return cents;
}

export function centsToMoney(value) {
  safeCents(value, "Money");
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, "0");
  return `${sign}${whole}.${fraction}`;
}

export function calculateItemsTotalCents(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new FinanceError("invalid-items", "At least one order item is required.");
  }

  let total = 0n;
  for (const item of items) {
    if (!Number.isSafeInteger(item?.quantity) || item.quantity < 1 || item.quantity > 99) {
      throw new FinanceError("invalid-quantity", "Item quantity must be an integer from 1 to 99.");
    }
    total += BigInt(moneyToCents(item.unitPrice)) * BigInt(item.quantity);
    if (total > MAX_SAFE_CENTS)
      throw new FinanceError("invalid-money", "Order total is outside the supported range.");
  }
  return Number(total);
}

export function discountToCents(subtotalCents, discountPercent) {
  safeCents(subtotalCents, "Subtotal");
  if (subtotalCents < 0) throw new FinanceError("invalid-subtotal", "Subtotal cannot be negative.");
  const basisPoints = BigInt(discountPercentToBasisPoints(discountPercent));
  const discount = (BigInt(subtotalCents) * basisPoints + 5000n) / 10000n;
  return Number(discount);
}

export function discountPercentToBasisPoints(value) {
  const basisPoints = scaledInteger(value, 2, {
    fieldName: "Discount percent",
    maxFractionDigits: 2,
  });
  if (basisPoints < 0n || basisPoints > 10000n) {
    throw new FinanceError("invalid-discount", "Discount percent must be between 0 and 100.");
  }
  return Number(basisPoints);
}

export function basisPointsToPercent(basisPoints) {
  safeCents(basisPoints, "Discount percent");
  if (basisPoints < 0 || basisPoints > 10000) {
    throw new FinanceError("invalid-discount", "Discount percent must be between 0 and 100.");
  }
  return centsToMoney(basisPoints);
}

export function allocateDiscountAcrossOrders(orders, discountCents) {
  safeCents(discountCents, "Discount amount");
  if (discountCents < 0 || !Array.isArray(orders) || orders.length === 0) {
    throw new FinanceError("invalid-discount", "Discount allocation is invalid.");
  }

  const rows = orders
    .map((order) => ({
      order,
      grossCents: moneyToCents(order?.totalPrice),
      createdAt: order.createdAt ? new Date(order.createdAt).getTime() : 0,
    }))
    .sort((left, right) => {
      const timeDelta = left.createdAt - right.createdAt;
      return timeDelta || String(left.order.id).localeCompare(String(right.order.id));
    });
  const totalGrossCents = rows.reduce(
    (sum, row) => safeCents(sum + row.grossCents, "Gross total"),
    0
  );
  if (discountCents > totalGrossCents || (discountCents > 0 && totalGrossCents === 0)) {
    throw new FinanceError("invalid-discount", "Discount cannot exceed the gross total.");
  }
  if (discountCents === 0)
    return rows.map(({ order }) => ({ orderId: order.id, discountCents: 0 }));

  let allocated = 0;
  const shares = rows.map((row, index) => {
    const numerator = BigInt(discountCents) * BigInt(row.grossCents);
    const denominator = BigInt(totalGrossCents);
    const floorShare = Number(numerator / denominator);
    const remainder = numerator % denominator;
    allocated += floorShare;
    return { ...row, index, discountCents: floorShare, remainder };
  });

  let remaining = discountCents - allocated;
  const remainderOrder = [...shares].sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index;
    return left.remainder > right.remainder ? -1 : 1;
  });
  for (let index = 0; index < remaining; index += 1) {
    remainderOrder[index].discountCents += 1;
  }

  return shares.map(({ order, discountCents: share }) => ({
    orderId: order.id,
    discountCents: share,
  }));
}

export function computeOrderBalance(order) {
  const grossCents = moneyToCents(order?.totalPrice);
  const discountCents = moneyToCents(order?.discountAmount ?? "0");
  if (discountCents > grossCents) {
    throw new FinanceError("invalid-discount", "Order discount cannot exceed its gross amount.");
  }

  const paidCents = (order?.payments || []).reduce((sum, payment) => {
    const next = sum + moneyToCents(payment?.amountPaid);
    return safeCents(next, "Paid amount");
  }, 0);
  const netCents = grossCents - discountCents;
  if (paidCents > netCents) {
    throw new FinanceError("overpaid-order", "Recorded payments exceed the order balance.");
  }

  return {
    grossCents,
    discountCents,
    netCents,
    paidCents,
    remainingCents: netCents - paidCents,
  };
}

export function planPayment(orders, requestedAmountCents) {
  if (!Array.isArray(orders) || orders.length === 0) {
    throw new FinanceError("no-orders", "No payable orders were found.");
  }

  const seenIds = new Set();
  const orderedBalances = orders
    .map((order) => {
      if (!order?.id || seenIds.has(order.id)) {
        throw new FinanceError("invalid-order", "Payment orders must have unique identifiers.");
      }
      seenIds.add(order.id);
      if (!OPEN_ORDER_STATUSES.has(order.status)) {
        throw new FinanceError("invalid-order-state", "Order is not in a payable state.");
      }
      return {
        order,
        balance: computeOrderBalance(order),
        createdAt: order.createdAt ? new Date(order.createdAt).getTime() : 0,
      };
    })
    .sort((left, right) => {
      const timeDelta = left.createdAt - right.createdAt;
      return timeDelta || String(left.order.id).localeCompare(String(right.order.id));
    });

  const totalDueCents = orderedBalances.reduce(
    (sum, row) => safeCents(sum + row.balance.remainingCents, "Total due"),
    0
  );
  if (totalDueCents === 0 && requestedAmountCents === undefined) {
    return {
      totalDueCents: 0,
      appliedCents: 0,
      remainingBalanceCents: 0,
      allocations: orderedBalances.map(({ order }) => ({
        orderId: order.id,
        amountCents: 0,
        remainingCents: 0,
        nextStatus: "PAID",
      })),
    };
  }
  if (totalDueCents <= 0) {
    throw new FinanceError("no-balance", "No remaining balance is available to pay.");
  }

  const appliedCents =
    requestedAmountCents === undefined
      ? totalDueCents
      : safeCents(requestedAmountCents, "Payment amount");
  if (appliedCents <= 0)
    throw new FinanceError("invalid-payment", "Payment amount must be positive.");
  if (appliedCents > totalDueCents) {
    throw new FinanceError("overpayment", "Payment amount exceeds the remaining balance.");
  }

  let unallocatedCents = appliedCents;
  const allocations = orderedBalances.map(({ order, balance }) => {
    const amountCents = Math.min(balance.remainingCents, unallocatedCents);
    unallocatedCents -= amountCents;
    const remainingCents = balance.remainingCents - amountCents;
    return {
      orderId: order.id,
      amountCents,
      remainingCents,
      nextStatus: remainingCents === 0 ? "PAID" : order.status,
    };
  });

  return {
    totalDueCents,
    appliedCents,
    remainingBalanceCents: totalDueCents - appliedCents,
    allocations,
  };
}

export function validatePaymentMethod(value) {
  if (typeof value !== "string" || !PAYMENT_METHODS.has(value)) {
    throw new FinanceError("invalid-payment-method", "Payment method is not supported.");
  }
  return value;
}
