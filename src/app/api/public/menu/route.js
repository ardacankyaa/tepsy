export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";

export async function GET(request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || !/^[a-f0-9]{48}$/.test(token))
    return NextResponse.json({ error: "QR kodu geçersiz." }, { status: 400 });
  const table = await prisma.table.findUnique({
    where: { qrToken: token },
    select: { id: true, tableNumber: true, isArchived: true },
  });
  if (!table || table.isArchived)
    return NextResponse.json({ error: "Masa bulunamadı." }, { status: 404 });
  const [config, categories] = await Promise.all([
    prisma.restaurantConfig.findFirst({
      select: {
        restaurantName: true,
        restaurantLogoUrl: true,
        currency: true,
        defaultLanguage: true,
        qrOrderEnabled: true,
      },
    }),
    prisma.category.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        items: {
          where: { isAvailable: true },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            description: true,
            imageUrl: true,
            price: true,
            categoryId: true,
            isAvailable: true,
          },
        },
      },
    }),
  ]);
  return NextResponse.json(
    {
      restaurant: {
        name: config?.restaurantName || "TEPSY",
        logoUrl: config?.restaurantLogoUrl || null,
        currency: config?.currency || "₺",
        defaultLanguage: config?.defaultLanguage || "tr",
      },
      table: { label: table.tableNumber },
      categories: categories.map(({ items, ...category }) => ({
        id: category.id,
        name: category.name,
        icon: category.icon,
        sortOrder: category.sortOrder,
      })),
      items: categories.flatMap((category) => category.items),
      orderingEnabled: Boolean(config?.qrOrderEnabled),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
