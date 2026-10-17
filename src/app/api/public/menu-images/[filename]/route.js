export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { readMenuImage } from "@/lib/menu-images.cjs";

export async function GET(request, context) {
  try {
    const { filename } = await context.params;
    return new Response(new Uint8Array(await readMenuImage(filename)), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (!error.status) console.error("Menu photo read failed:", error);
    return NextResponse.json(
      { error: error.status ? error.message : "Fotoğraf açılamadı." },
      { status: error.status || 500 }
    );
  }
}
