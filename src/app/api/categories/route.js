export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireStaffRole } from "@/lib/route-access.mjs";
import { normalizeCategoryInput } from "@/lib/category-input.cjs";

export async function GET() {
  try {
    const categories = await prisma.category.findMany({
      include: {
        items: {
          orderBy: { name: "asc" },
        },
      },
      orderBy: { sortOrder: "asc" },
    });

    return NextResponse.json(categories);
  } catch (error) {
    console.error("Kategori listeleme hatası:", error);
    return NextResponse.json({ error: "Kategoriler alınamadı" }, { status: 500 });
  }
}

export async function POST(request) {
  const access = await requireStaffRole(request, prisma, ["ADMIN"]);
  if (access.denied) return access.denied;
  try {
    const body = await request.json();
    const data = normalizeCategoryInput(body);
    const category = await prisma.category.create({
      data,
      include: { items: true },
    });

    if (global.io) {
      global.io.emit("menu:update");
    }

    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "Geçersiz JSON isteği." }, { status: 400 });
    if (error.status === 400) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error.code === "P2002")
      return NextResponse.json({ error: "Bu kategori adı zaten kullanılıyor." }, { status: 409 });
    console.error("Kategori ekleme hatası:", error);
    return NextResponse.json({ error: "Kategori eklenemedi veya zaten mevcut" }, { status: 500 });
  }
}

export async function PUT(request) {
  const access = await requireStaffRole(request, prisma, ["ADMIN"]);
  if (access.denied) return access.denied;
  try {
    const body = await request.json();
    const dataToUpdate = normalizeCategoryInput(body, true);

    const updatedCategory = await prisma.category.update({
      where: { id: body.id },
      data: dataToUpdate,
      include: { items: true },
    });

    if (global.io) {
      global.io.emit("menu:update");
    }

    return NextResponse.json(updatedCategory);
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "Geçersiz JSON isteği." }, { status: 400 });
    if (error.status === 400) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error.code === "P2002")
      return NextResponse.json({ error: "Bu kategori adı zaten kullanılıyor." }, { status: 409 });
    if (error.code === "P2025")
      return NextResponse.json({ error: "Kategori bulunamadı." }, { status: 404 });
    console.error("Kategori güncelleme hatası:", error);
    return NextResponse.json({ error: "Kategori güncellenemedi" }, { status: 500 });
  }
}

export async function DELETE(request) {
  const access = await requireStaffRole(request, prisma, ["ADMIN"]);
  if (access.denied) return access.denied;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Kategori ID zorunludur" }, { status: 400 });
    }

    // The schema cascades category deletes to products, so refuse non-empty categories
    // instead of silently removing every product that was never ordered.
    const result = await prisma.$transaction(async (tx) => {
      const productCount = await tx.menuItem.count({ where: { categoryId: id } });
      if (productCount > 0) return { productCount };
      await tx.category.delete({ where: { id } });
      return { productCount: 0 };
    });
    if (result.productCount > 0)
      return NextResponse.json(
        {
          error:
            "Ürün içeren kategori silinemez. Önce ürünleri başka kategoriye taşıyın veya satışa kapatın.",
          code: "category-not-empty",
        },
        { status: 409 }
      );

    if (global.io) {
      global.io.emit("menu:update");
    }

    return NextResponse.json({ success: true, id });
  } catch (error) {
    if (error.code === "P2003")
      return NextResponse.json(
        {
          error:
            "Siparişlerde kullanılan ürünleri içeren kategori silinemez. Ürünleri satışa kapatabilirsiniz.",
        },
        { status: 409 }
      );
    if (error.code === "P2025")
      return NextResponse.json({ error: "Kategori bulunamadı." }, { status: 404 });
    console.error("Kategori silme hatası:", error);
    return NextResponse.json({ error: "Kategori silinemedi" }, { status: 500 });
  }
}
