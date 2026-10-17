export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { DEFAULT_FLOOR_ELEMENTS } from "@/lib/floor-elements.mjs";
import { canRunSetup } from "@/lib/setup-policy.cjs";
import { normalizeMenuInput } from "@/lib/menu-input.cjs";
import { hashCredential } from "@/lib/auth-local";
import { normalizeSetupCredentials } from "@/lib/setup-credentials.cjs";
import { normalizeRestaurantLogoUrl } from "@/lib/restaurant-logo.cjs";
import { invalidateAuthConfigCache, disconnectAllSockets } from "@/lib/security-policy.cjs";

const currencies = new Set(["₺", "$", "€", "£"]);

function normalizeInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { error: "Kurulum bilgileri geçersiz." };
  if (typeof body.restaurantName !== "string") return { error: "Restoran adı geçersiz." };
  if (
    body.categories !== undefined &&
    (!Array.isArray(body.categories) || body.categories.length > 100)
  )
    return { error: "Kategori listesi geçersiz." };
  if (
    (body.categories || []).some(
      (category) =>
        !category ||
        typeof category.name !== "string" ||
        (category.items !== undefined &&
          (!Array.isArray(category.items) || category.items.length > 500))
    )
  )
    return { error: "Kategori ürünleri geçersiz." };
  const restaurantName = String(body?.restaurantName || "").trim();
  const currency = String(body?.currency || "₺");
  const sections = Array.isArray(body?.sections)
    ? body.sections.map((section) => ({
        name: String(section?.name || "").trim(),
        tableCount: Number(section?.tableCount),
      }))
    : [];
  const categories = Array.isArray(body?.categories)
    ? body.categories.map((category) => ({
        name: String(category?.name || "").trim(),
        items: Array.isArray(category?.items)
          ? category.items.map((item) =>
              normalizeMenuInput({ ...item, categoryId: "setup" }, false)
            )
          : [],
      }))
    : [];
  const names = new Set();
  if (
    Array.isArray(body.sections) &&
    body.sections.some((section) => typeof section?.name !== "string")
  )
    return { error: "Bölüm adı geçersiz." };
  if (!restaurantName || restaurantName.length > 100) return { error: "Restoran adı geçersiz." };
  if (!currencies.has(currency)) return { error: "Para birimi geçersiz." };
  if (!Array.isArray(body?.sections) || sections.length === 0 || sections.length > 20)
    return { error: "En az bir, en fazla 20 bölüm gereklidir." };
  for (const section of sections) {
    if (!section.name || section.name.length > 80 || names.has(section.name))
      return { error: "Bölüm adları boş veya tekrarlı olamaz." };
    names.add(section.name);
    if (!Number.isInteger(section.tableCount) || section.tableCount < 1 || section.tableCount > 20)
      return { error: "Her bölüm 1 ile 20 masa arasında olmalıdır." };
  }
  const categoryNames = new Set();
  for (const category of categories) {
    if (!category.name || category.name.length > 80 || categoryNames.has(category.name))
      return { error: "Kategori adları boş veya tekrarlı olamaz." };
    categoryNames.add(category.name);
    for (const item of category.items) {
      if (!item.name || item.name.length > 120) return { error: "Menü ürünü geçersiz." };
    }
  }
  const credentials = normalizeSetupCredentials(body);
  if (credentials.error) return credentials;
  const restaurantLogoUrl = normalizeRestaurantLogoUrl(body.restaurantLogoUrl);
  return { restaurantName, currency, sections, categories, restaurantLogoUrl, ...credentials };
}

function tablePosition(index, count) {
  const columns = Math.min(5, count);
  const rows = Math.ceil(count / columns);
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    posX: columns === 1 ? 50 : 12 + (column * 76) / (columns - 1),
    posY: rows === 1 ? 50 : 12 + (row * 76) / (rows - 1),
  };
}

export async function POST(request) {
  try {
    const input = normalizeInput(await request.json());
    if (input.error) return NextResponse.json({ error: input.error }, { status: 400 });

    const accessPasswordHash = hashCredential(input.ownerPassword);
    await prisma.$transaction(async (tx) => {
      const [config, tables, orders, payments, staff, existingCategories] = await Promise.all([
        tx.restaurantConfig.findFirst({
          select: { id: true, isSetupCompleted: true, accessPasswordHash: true },
        }),
        tx.table.count(),
        tx.order.count(),
        tx.payment.count(),
        tx.staffUser.count(),
        tx.category.count(),
      ]);
      if (
        !canRunSetup({
          tables,
          orders,
          payments,
          staff,
          categories: existingCategories,
          isSetupCompleted: config?.isSetupCompleted,
          hasAccessPassword: Boolean(config?.accessPasswordHash),
        })
      ) {
        const error = new Error("setup-conflict");
        error.status = 409;
        throw error;
      }

      const configData = {
        restaurantName: input.restaurantName,
        restaurantLogoUrl: input.restaurantLogoUrl,
        restaurantCode: input.restaurantCode,
        accessPasswordHash,
        authEnabled: true,
        currency: input.currency,
        isSetupCompleted: true,
      };
      if (config) await tx.restaurantConfig.update({ where: { id: config.id }, data: configData });
      else await tx.restaurantConfig.create({ data: configData });
      const usedPrefixes = new Set();
      for (let sectionIndex = 0; sectionIndex < input.sections.length; sectionIndex += 1) {
        const section = input.sections[sectionIndex];
        const basePrefix =
          section.name
            .replace(/[^\p{L}\p{N}]/gu, "")
            .slice(0, 2)
            .toUpperCase() || "S";
        let prefix = basePrefix;
        let suffix = 2;
        while (usedPrefixes.has(prefix)) prefix = `${basePrefix}${suffix++}`;
        usedPrefixes.add(prefix);
        for (let index = 0; index < section.tableCount; index += 1) {
          const position = tablePosition(index, section.tableCount);
          await tx.table.create({
            data: {
              tableNumber: `${prefix}-${index + 1}`,
              section: section.name,
              capacity: index % 2 === 0 ? 2 : 4,
              status: "AVAILABLE",
              ...position,
              shape: index % 3 === 2 ? "ROUND" : "SQUARE",
              width: 85,
              height: 85,
            },
          });
        }
      }
      const sectionNames = new Set(input.sections.map((section) => section.name));
      const defaults = DEFAULT_FLOOR_ELEMENTS.filter((element) =>
        sectionNames.has(element.section)
      );
      if (defaults.length) await tx.floorElement.createMany({ data: defaults });
      for (let categoryIndex = 0; categoryIndex < input.categories.length; categoryIndex += 1) {
        const category = input.categories[categoryIndex];
        const createdCategory = await tx.category.create({
          data: { name: category.name, sortOrder: categoryIndex + 1, icon: "Coffee" },
        });
        for (const item of category.items) {
          await tx.menuItem.create({
            data: {
              name: item.name,
              categoryId: createdCategory.id,
              price: item.price,
              description: item.description,
              imageUrl: item.imageUrl,
              isAvailable: true,
            },
          });
        }
      }
    });

    invalidateAuthConfigCache();
    disconnectAllSockets(global.io);
    if (global.io) {
      global.io.emit("table:update");
      global.io.emit("table:layout_update");
      global.io.emit("menu:update");
      global.io.emit("config:update", {
        restaurantName: input.restaurantName,
        restaurantLogoUrl: input.restaurantLogoUrl,
        currency: input.currency,
      });
    }
    return NextResponse.json({ success: true, message: "Restoran başarıyla kuruldu!" });
  } catch (error) {
    if (error instanceof SyntaxError || error?.status === 400)
      return NextResponse.json(
        { error: error?.status === 400 ? error.message : "Geçersiz JSON." },
        { status: 400 }
      );
    if (error?.status === 409 || error?.message === "setup-conflict")
      return NextResponse.json(
        { error: "Mevcut restoran verileri kurulumla silinemez." },
        { status: 409 }
      );
    console.error("Kurulum hatası:", error);
    return NextResponse.json({ error: "Restoran kurulumu başarısız oldu" }, { status: 500 });
  }
}
