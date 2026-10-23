export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireStaffRole } from "@/lib/route-access.mjs";
import { normalizeMenuInput } from "@/lib/menu-input.cjs";

function writeErrorResponse(error, operation) {
  if (error instanceof SyntaxError)
    return NextResponse.json({ error: "Geçersiz JSON isteği." }, { status: 400 });
  if (error?.status === 400) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error?.code === "P2025")
    return NextResponse.json({ error: "Ürün bulunamadı." }, { status: 404 });
  if (error?.code === "P2003") {
    if (operation === "delete") {
      return NextResponse.json(
        { error: "Siparişlerde kullanılan ürün silinemez; satışa kapatın." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Kategori bulunamadı." }, { status: 400 });
  }
  console.error(`Menü ürünü ${operation} hatası:`, error);
  return NextResponse.json(
    {
      error:
        operation === "create"
          ? "Menü ürünü eklenemedi"
          : operation === "update"
            ? "Menü ürünü güncellenemedi"
            : "Menü ürünü silinemedi",
    },
    { status: 500 }
  );
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get("categoryId");
    const availableOnly = searchParams.get("availableOnly") === "true";

    const where = {};
    if (categoryId && categoryId !== "ALL") {
      where.categoryId = categoryId;
    }
    if (availableOnly) {
      where.isAvailable = true;
    }

    const items = await prisma.menuItem.findMany({
      where,
      include: {
        category: true,
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(items);
  } catch (error) {
    console.error("Menü ürünleri listeleme hatası:", error);
    return NextResponse.json({ error: "Menü ürünleri alınamadı" }, { status: 500 });
  }
}

export async function POST(request) {
  const access = await requireStaffRole(request, prisma, ["ADMIN"]);
  if (access.denied) return access.denied;
  try {
    const body = await request.json();
    const data = normalizeMenuInput(body, false);

    const newItem = await prisma.menuItem.create({
      data,
      include: {
        category: true,
      },
    });

    if (global.io) {
      global.io.emit("menu:update");
    }

    return NextResponse.json(newItem, { status: 201 });
  } catch (error) {
    return writeErrorResponse(error, "create");
  }
}

export async function PUT(request) {
  const access = await requireStaffRole(request, prisma, ["ADMIN"]);
  if (access.denied) return access.denied;
  try {
    const body = await request.json();
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.id !== "string" ||
      !body.id.trim() ||
      body.id.length > 100
    ) {
      return NextResponse.json({ error: "Ürün ID zorunludur" }, { status: 400 });
    }
    const id = body.id.trim();

    const dataToUpdate = normalizeMenuInput(body, true);

    const updatedItem = await prisma.menuItem.update({
      where: { id },
      data: dataToUpdate,
      include: {
        category: true,
      },
    });

    if (global.io) {
      global.io.emit("menu:update");
    }

    return NextResponse.json(updatedItem);
  } catch (error) {
    return writeErrorResponse(error, "update");
  }
}

export async function DELETE(request) {
  const access = await requireStaffRole(request, prisma, ["ADMIN"]);
  if (access.denied) return access.denied;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Ürün ID zorunludur" }, { status: 400 });
    }

    await prisma.menuItem.delete({
      where: { id },
    });

    if (global.io) {
      global.io.emit("menu:update");
    }

    return NextResponse.json({ success: true, id });
  } catch (error) {
    return writeErrorResponse(error, "delete");
  }
}
