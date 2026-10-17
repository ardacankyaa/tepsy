import { moneyToCents } from "./finance.mjs";

const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

function safeSum(left, right, fieldName) {
  const result = left + right;
  if (!Number.isSafeInteger(result))
    throw new Error(`${fieldName} is outside the supported range.`);
  return result;
}

function safeProduct(left, right, fieldName) {
  const result = BigInt(left) * BigInt(right);
  if (result > MAX_SAFE_CENTS) throw new Error(`${fieldName} is outside the supported range.`);
  return Number(result);
}

export function aggregateCollections(payments) {
  let totalRevenueCents = 0;
  let cashRevenueCents = 0;
  let cardRevenueCents = 0;
  let otherRevenueCents = 0;
  const orderIds = new Set();

  for (const payment of payments) {
    const cents = moneyToCents(payment.amountPaid);
    totalRevenueCents = safeSum(totalRevenueCents, cents, "Total revenue");
    if (payment.paymentMethod === "CASH") {
      cashRevenueCents = safeSum(cashRevenueCents, cents, "Cash revenue");
    } else if (payment.paymentMethod === "CREDIT_CARD") {
      cardRevenueCents = safeSum(cardRevenueCents, cents, "Card revenue");
    } else {
      otherRevenueCents = safeSum(otherRevenueCents, cents, "Other revenue");
    }
    if (payment.orderId) orderIds.add(payment.orderId);
  }

  return {
    totalRevenueCents,
    cashRevenueCents,
    cardRevenueCents,
    otherRevenueCents,
    totalOrdersCount: orderIds.size,
    averageOrderValueCents: orderIds.size ? Math.round(totalRevenueCents / orderIds.size) : 0,
  };
}

function allocateDiscount(items, discountCents, grossCents) {
  const appliedDiscountCents = Math.min(discountCents, grossCents);
  if (appliedDiscountCents === 0 || grossCents === 0) return items.map(() => 0);

  let allocated = 0;
  const shares = items.map((item, index) => {
    const numerator = BigInt(appliedDiscountCents) * BigInt(item.grossCents);
    const denominator = BigInt(grossCents);
    const share = Number(numerator / denominator);
    allocated += share;
    return { index, share, remainder: numerator % denominator };
  });
  const remainderOrder = [...shares].sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index;
    return left.remainder > right.remainder ? -1 : 1;
  });
  for (let index = 0; index < appliedDiscountCents - allocated; index += 1) {
    remainderOrder[index].share += 1;
  }
  return shares.map((share) => share.share);
}

export function aggregateProductSales(orders) {
  const products = new Map();
  const categories = new Map();
  let grossSalesCents = 0;
  let discountCents = 0;
  let netSalesCents = 0;
  let inconsistentOrdersCount = 0;

  for (const order of orders) {
    const items = (order.items || [])
      .filter((item) => item.status !== "CANCELLED")
      .map((item) => {
        if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
          throw new Error("Order item quantity is outside the supported range.");
        }
        const grossCents = safeProduct(
          moneyToCents(item.unitPrice),
          item.quantity,
          "Product sales"
        );
        return { item, grossCents };
      });
    const itemGrossCents = items.reduce(
      (sum, row) => safeSum(sum, row.grossCents, "Product sales"),
      0
    );
    const storedGrossCents = moneyToCents(order.totalPrice ?? "0");
    const requestedDiscountCents = moneyToCents(order.discountAmount ?? "0");
    if (
      storedGrossCents !== itemGrossCents ||
      requestedDiscountCents > itemGrossCents ||
      requestedDiscountCents > storedGrossCents
    ) {
      inconsistentOrdersCount += 1;
    }
    const allocatedDiscounts = allocateDiscount(items, requestedDiscountCents, itemGrossCents);

    for (let index = 0; index < items.length; index += 1) {
      const { item, grossCents } = items[index];
      const itemDiscountCents = allocatedDiscounts[index];
      const netCents = grossCents - itemDiscountCents;
      const menuItem = item.menuItem || {};
      const categoryName = item.menuItemCategoryName || menuItem.category?.name || "Diğer";
      const productId = `${menuItem.id || `unknown:${menuItem.name || "Ürün"}`}:${categoryName}`;
      const product = products.get(productId) || {
        id: productId,
        name: item.menuItemName || menuItem.name || "Ürün",
        categoryName,
        quantity: 0,
        grossRevenueCents: 0,
        discountAmountCents: 0,
        totalRevenueCents: 0,
      };
      product.quantity = safeSum(product.quantity, item.quantity, "Product quantity");
      product.grossRevenueCents = safeSum(product.grossRevenueCents, grossCents, "Product sales");
      product.discountAmountCents = safeSum(
        product.discountAmountCents,
        itemDiscountCents,
        "Product discount"
      );
      product.totalRevenueCents = safeSum(product.totalRevenueCents, netCents, "Net product sales");
      products.set(productId, product);

      const category = categories.get(categoryName) || {
        categoryName,
        quantity: 0,
        grossRevenueCents: 0,
        discountAmountCents: 0,
        totalRevenueCents: 0,
      };
      category.quantity = safeSum(category.quantity, item.quantity, "Category quantity");
      category.grossRevenueCents = safeSum(
        category.grossRevenueCents,
        grossCents,
        "Category sales"
      );
      category.discountAmountCents = safeSum(
        category.discountAmountCents,
        itemDiscountCents,
        "Category discount"
      );
      category.totalRevenueCents = safeSum(
        category.totalRevenueCents,
        netCents,
        "Net category sales"
      );
      categories.set(categoryName, category);

      grossSalesCents = safeSum(grossSalesCents, grossCents, "Gross product sales");
      discountCents = safeSum(discountCents, itemDiscountCents, "Product discounts");
      netSalesCents = safeSum(netSalesCents, netCents, "Net product sales");
    }
  }

  return {
    ordersCount: orders.length,
    grossSalesCents,
    discountCents,
    netSalesCents,
    inconsistentOrdersCount,
    products: [...products.values()].sort(
      (left, right) => right.totalRevenueCents - left.totalRevenueCents
    ),
    categories: [...categories.values()].sort(
      (left, right) => right.totalRevenueCents - left.totalRevenueCents
    ),
  };
}
