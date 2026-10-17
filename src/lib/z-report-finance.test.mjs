import test from "node:test";
import assert from "node:assert/strict";
import { aggregateCollections, aggregateProductSales } from "./z-report-finance.mjs";

test("cancelled item snapshots remain outside sales and discount allocation", () => {
  const result = aggregateProductSales([
    {
      totalPrice: "50.00",
      discountAmount: "5.00",
      items: [
        {
          quantity: 1,
          unitPrice: "50.00",
          status: "PENDING",
          menuItem: { id: "coffee", name: "Coffee" },
        },
        {
          quantity: 1,
          unitPrice: "100.00",
          status: "CANCELLED",
          menuItem: { id: "cancelled", name: "Cancelled" },
        },
      ],
    },
  ]);
  assert.equal(result.grossSalesCents, 5000);
  assert.equal(result.netSalesCents, 4500);
  assert.equal(result.inconsistentOrdersCount, 0);
  assert.equal(result.products.length, 1);
});

test("collection summaries add Decimal-like amounts as exact kuruş and count distinct orders", () => {
  const summary = aggregateCollections([
    { orderId: "o1", paymentMethod: "CASH", amountPaid: { toString: () => "12.30" } },
    { orderId: "o1", paymentMethod: "CASH", amountPaid: { toString: () => "0.20" } },
    { orderId: "o2", paymentMethod: "CREDIT_CARD", amountPaid: "8.20" },
    { orderId: "o3", paymentMethod: "OTHER", amountPaid: "0.01" },
  ]);

  assert.deepEqual(summary, {
    totalRevenueCents: 2071,
    cashRevenueCents: 1250,
    cardRevenueCents: 820,
    otherRevenueCents: 1,
    totalOrdersCount: 3,
    averageOrderValueCents: 690,
  });
});

test("collections are scoped to the supplied payment period, so split payments count on their own dates", () => {
  const payments = [
    {
      orderId: "o1",
      paymentMethod: "CASH",
      amountPaid: "5.00",
      createdAt: new Date("2026-09-23T10:00:00Z"),
    },
    {
      orderId: "o1",
      paymentMethod: "CREDIT_CARD",
      amountPaid: "7.34",
      createdAt: new Date("2026-09-24T10:00:00Z"),
    },
  ];

  assert.equal(
    aggregateCollections(payments.filter((p) => p.createdAt.getUTCDate() === 23)).totalRevenueCents,
    500
  );
  assert.equal(
    aggregateCollections(payments.filter((p) => p.createdAt.getUTCDate() === 24)).totalRevenueCents,
    734
  );
});

test("product sales count each order by order period and allocate its discount in exact kuruş", () => {
  const summary = aggregateProductSales([
    {
      totalPrice: "0.10",
      discountAmount: "0.03",
      items: [
        {
          quantity: 1,
          unitPrice: "0.05",
          menuItem: { id: "tea", name: "Tea", category: { name: "Drinks" } },
        },
        {
          quantity: 1,
          unitPrice: "0.05",
          menuItem: { id: "coffee", name: "Coffee", category: { name: "Drinks" } },
        },
      ],
    },
  ]);

  assert.equal(summary.grossSalesCents, 10);
  assert.equal(summary.discountCents, 3);
  assert.equal(summary.netSalesCents, 7);
  assert.equal(summary.ordersCount, 1);
  assert.equal(
    summary.products.reduce((total, item) => total + item.totalRevenueCents, 0),
    7
  );
  assert.equal(summary.categories[0].totalRevenueCents, 7);
});

test("a 100 percent discount is accounted for without manufacturing collected revenue", () => {
  const summary = aggregateProductSales([
    {
      totalPrice: "2.00",
      discountAmount: "2.00",
      items: [
        { quantity: 1, unitPrice: "2.00", menuItem: { id: "meal", name: "Meal", category: null } },
      ],
    },
  ]);

  assert.equal(summary.grossSalesCents, 200);
  assert.equal(summary.discountCents, 200);
  assert.equal(summary.netSalesCents, 0);
  assert.equal(summary.products[0].totalRevenueCents, 0);
});

test("product report flags historical orders whose stored total or discount cannot match their items", () => {
  const summary = aggregateProductSales([
    {
      totalPrice: "1.50",
      discountAmount: "1.20",
      items: [
        { quantity: 1, unitPrice: "1.00", menuItem: { id: "meal", name: "Meal", category: null } },
      ],
    },
  ]);

  assert.equal(summary.inconsistentOrdersCount, 1);
  assert.equal(summary.grossSalesCents, 100);
  assert.equal(summary.discountCents, 100);
  assert.equal(summary.netSalesCents, 0);
});

test("product reports prefer the order item name snapshot after a menu rename", () => {
  const summary = aggregateProductSales([
    {
      totalPrice: "1.00",
      discountAmount: "0.00",
      items: [
        {
          quantity: 1,
          unitPrice: "1.00",
          menuItemName: "Espresso at sale",
          menuItem: { id: "espresso", name: "Renamed espresso", category: { name: "Drinks" } },
        },
      ],
    },
  ]);

  assert.equal(summary.products[0].name, "Espresso at sale");
});

test("category sales use the category recorded when each order was placed", () => {
  const summary = aggregateProductSales([
    {
      totalPrice: "10.00",
      discountAmount: "0.00",
      items: [
        {
          quantity: 1,
          unitPrice: "10.00",
          menuItemCategoryName: "Drinks",
          menuItem: { id: "tea", name: "Tea", category: { name: "Food" } },
        },
      ],
    },
    {
      totalPrice: "10.00",
      discountAmount: "0.00",
      items: [
        {
          quantity: 1,
          unitPrice: "10.00",
          menuItemCategoryName: "Food",
          menuItem: { id: "tea", name: "Tea", category: { name: "Food" } },
        },
      ],
    },
  ]);

  assert.deepEqual(
    summary.categories.map((category) => [category.categoryName, category.totalRevenueCents]),
    [
      ["Drinks", 1000],
      ["Food", 1000],
    ]
  );
  assert.equal(summary.products.length, 2);
});
