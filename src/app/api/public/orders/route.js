export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { moneyToCents, centsToMoney } from "@/lib/finance.mjs";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { readRequestJson } from "@/lib/request-json.mjs";
import {
  normalizeCustomerItems,
  normalizeCustomerOrderNotes,
  canCancelCustomerOrder,
  getPublicQrOrderStatus,
} from "@/lib/qr-policy.cjs";
import {
  findIdempotentOrder,
  optionalOrderIdempotencyKey,
  orderRequestFingerprint,
  OrderIdempotencyError,
  withOrderIdempotencyLock,
} from "@/lib/order-idempotency-server.mjs";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const token = String(searchParams.get("token") || "");
  const orderId = String(searchParams.get("orderId") || "");
  if (!/^[a-f0-9]{48}$/.test(token) || !orderId || orderId.length > 100) {
    return NextResponse.json({ error: "İstek geçersiz." }, { status: 400 });
  }
  const table = await prisma.table.findUnique({
    where: { qrToken: token },
    select: { id: true, isArchived: true },
  });
  if (!table || table.isArchived)
    return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { tableId: true, source: true, status: true },
  });
  const result = getPublicQrOrderStatus(order, table.id);
  return result
    ? NextResponse.json(result, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
}

export async function POST(request) {
  let idempotencyKey = null;
  let requestFingerprint = null;
  try {
    let body;
    try {
      body = await readRequestJson(request);
    } catch (error) {
      return NextResponse.json(
        { error: "Geçersiz JSON isteği.", code: "invalid-json" },
        { status: error.code === "invalid-json-body" ? error.status : 400 }
      );
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Sipariş verisi geçersiz." }, { status: 400 });
    }
    if (typeof body.token !== "string")
      return NextResponse.json({ error: "Sipariş verisi geçersiz." }, { status: 400 });
    const token = body.token;
    const items = normalizeCustomerItems(body.items);
    if (!/^[a-f0-9]{48}$/.test(token) || !items)
      return NextResponse.json({ error: "Sipariş verisi geçersiz." }, { status: 400 });
    idempotencyKey = optionalOrderIdempotencyKey(body);
    const notes = normalizeCustomerOrderNotes(body.orderNotes);
    if (notes === undefined) {
      return NextResponse.json({ error: "Sipariş notu geçersiz." }, { status: 400 });
    }
    let tipCents;
    try {
      tipCents = moneyToCents(body.tipAmount ?? 0);
      if (tipCents > 100000000) throw new Error();
    } catch {
      return NextResponse.json({ error: "Bahşiş tutarı geçersiz." }, { status: 400 });
    }
    const payload = {
      tableId: null,
      items,
      notes,
      ...(tipCents ? { tipAmount: centsToMoney(tipCents) } : {}),
    };
    requestFingerprint = idempotencyKey ? orderRequestFingerprint("QR", payload) : null;

    const createOrder = () =>
      prisma.$transaction(async (tx) => {
        const table = await tx.table.findUnique({
          where: { qrToken: token },
          select: { id: true, isArchived: true },
        });
        if (!table || table.isArchived) return { error: "Masa bulunamadı.", status: 404 };

        payload.tableId = table.id;
        requestFingerprint = idempotencyKey ? orderRequestFingerprint("QR", payload) : null;
        const existing = await findIdempotentOrder(tx, idempotencyKey, requestFingerprint);
        if (existing)
          return {
            order: { id: existing.id, status: existing.status },
            tableId: table.id,
            created: false,
          };

        const config = await tx.restaurantConfig.findFirst({ select: { qrOrderEnabled: true } });
        if (!config?.qrOrderEnabled) return { error: "QR siparişi şu anda kapalı.", status: 403 };

        const recent = await tx.order.findFirst({
          where: {
            tableId: table.id,
            source: "QR",
            createdAt: { gt: new Date(Date.now() - 30000) },
          },
          select: { id: true },
        });
        if (recent)
          return {
            error: "Yeni istek göndermeden önce kısa süre bekleyin.",
            status: 429,
            retryAfterSeconds: 30,
          };

        const ids = [...new Set(items.map((item) => item.menuItemId))];
        const products = await tx.menuItem.findMany({
          where: { id: { in: ids }, isAvailable: true },
          select: { id: true, name: true, price: true, category: { select: { name: true } } },
        });
        if (products.length !== ids.length)
          return { error: "Ürünlerden biri kullanılamıyor.", status: 400 };
        const productsById = new Map(products.map((item) => [item.id, item]));
        const orderItems = items.map((item) => ({
          menuItemId: item.menuItemId,
          menuItemName: productsById.get(item.menuItemId).name,
          menuItemCategoryName: productsById.get(item.menuItemId).category.name,
          quantity: item.quantity,
          unitPrice: productsById.get(item.menuItemId).price,
          notes: item.notes || null,
          status: "PENDING",
        }));
        const totalPrice = orderItems.reduce(
          (sum, item) => sum.plus(item.unitPrice.mul(item.quantity)),
          new Prisma.Decimal(0)
        );
        const order = await tx.order.create({
          data: {
            tableId: table.id,
            status: "AWAITING_WAITER_APPROVAL",
            source: "QR",
            totalPrice,
            tipAmount: centsToMoney(tipCents),
            notes,
            ...(idempotencyKey && { idempotencyKey, requestFingerprint }),
            items: { create: orderItems },
          },
          select: { id: true, status: true },
        });
        return { order, tableId: table.id, created: true };
      });

    let result;
    try {
      result = await withOrderIdempotencyLock(idempotencyKey, createOrder);
    } catch (error) {
      if (!idempotencyKey) throw error;
      const existing = await findIdempotentOrder(prisma, idempotencyKey, requestFingerprint);
      if (!existing) throw error;
      result = {
        order: { id: existing.id, status: existing.status },
        tableId: existing.tableId,
        created: false,
      };
    }
    if (result.error)
      return NextResponse.json(
        {
          error: result.error,
          ...(result.retryAfterSeconds && { retryAfterSeconds: result.retryAfterSeconds }),
        },
        { status: result.status }
      );
    if (result.created)
      global.io
        ?.to("role:ADMIN")
        .to("role:WAITER")
        .emit("qr:request", { id: result.order.id, tableId: result.tableId });
    return NextResponse.json(
      { orderId: result.order.id, status: result.order.status },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof OrderIdempotencyError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    console.error("QR order failed:", error);
    return NextResponse.json({ error: "Sipariş isteği gönderilemedi." }, { status: 500 });
  }
}

export async function DELETE(request) {
  let body;
  try {
    body = await readRequestJson(request);
  } catch (error) {
    return NextResponse.json(
      { error: "Geçersiz JSON isteği." },
      {
        status: error.code === "invalid-json-body" ? error.status : 400,
      }
    );
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof body.token !== "string" ||
    typeof body.orderId !== "string"
  ) {
    return NextResponse.json({ error: "İstek geçersiz." }, { status: 400 });
  }
  const { token, orderId } = body;
  if (!/^[a-f0-9]{48}$/.test(token) || !orderId)
    return NextResponse.json({ error: "İstek geçersiz." }, { status: 400 });
  const [table, order] = await Promise.all([
    prisma.table.findUnique({ where: { qrToken: token }, select: { id: true, isArchived: true } }),
    prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, tableId: true, source: true, status: true },
    }),
  ]);
  if (!table || table.isArchived || !canCancelCustomerOrder(order, table.id)) {
    return NextResponse.json({ error: "Onay bekleyen istek bulunamadı." }, { status: 409 });
  }
  const changed = await prisma.order.updateMany({
    where: { id: orderId, tableId: table.id, source: "QR", status: "AWAITING_WAITER_APPROVAL" },
    data: { status: "CANCELLED" },
  });
  if (!changed.count)
    return NextResponse.json({ error: "İstek artık geri çekilemez." }, { status: 409 });
  global.io
    ?.to("role:ADMIN")
    .to("role:WAITER")
    .emit("qr:reviewed", { id: orderId, status: "CANCELLED" });
  return NextResponse.json({ orderId, status: "CANCELLED" });
}
