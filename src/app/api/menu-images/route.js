export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireStaffRole } from "@/lib/route-access.mjs";
import { readImageRequest, storeMenuImage } from "@/lib/menu-images.cjs";

export async function POST(request) {
  const access = await requireStaffRole(request, prisma, ["ADMIN"]);
  if (access.denied) return access.denied;
  try {
    const { bytes, type } = await readImageRequest(request);
    return NextResponse.json(await storeMenuImage(bytes, type), {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (!error.status) console.error("Menu photo upload failed:", error);
    return NextResponse.json(
      { error: error.status ? error.message : "Fotoğraf kaydedilemedi. Yeniden deneyin." },
      { status: error.status || 500 }
    );
  }
}
