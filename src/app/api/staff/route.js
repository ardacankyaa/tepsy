export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { credentialSessionVersion, hashCredential, sessionFromRequest } from "@/lib/auth-local";
import { currentStaffSession, disconnectStaffSockets } from "@/lib/security-policy.cjs";
import { normalizeStaffCreate, normalizeStaffUpdate } from "@/lib/staff-input.cjs";

async function authorize(request) {
  const config = await prisma.restaurantConfig.findFirst({
    select: { authEnabled: true, accessPasswordHash: true },
  });
  if (!config?.authEnabled || !config.accessPasswordHash) return { userId: "owner", role: "ADMIN" };
  const signed = sessionFromRequest(request);
  if (!signed) return null;
  const session = await currentStaffSession(
    signed,
    (id) => prisma.staffUser.findUnique({ where: { id } }),
    credentialSessionVersion(config.accessPasswordHash)
  );
  return session?.role === "ADMIN" ? session : null;
}

const publicUser = ({ pinHash, ...user }) => user;
const ownerOnly = () =>
  NextResponse.json(
    { error: "Yönetici hesaplarını yalnızca restoran sahibi değiştirebilir." },
    { status: 403 }
  );

export async function GET(request) {
  if (!(await authorize(request)))
    return NextResponse.json({ error: "Yetkisiz." }, { status: 403 });
  const users = await prisma.staffUser.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }] });
  return NextResponse.json(users.map(publicUser));
}

export async function POST(request) {
  const actor = await authorize(request);
  if (!actor) return NextResponse.json({ error: "Yetkisiz." }, { status: 403 });
  try {
    const body = await request.json();
    const { name, role, pin } = normalizeStaffCreate(body);
    if (role === "ADMIN" && actor.userId !== "owner") return ownerOnly();
    const user = await prisma.staffUser.create({
      data: { name, role, pinHash: hashCredential(pin) },
    });
    return NextResponse.json(publicUser(user), { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError || error.message === "Geçersiz personel bilgisi.") {
      return NextResponse.json(
        { error: error instanceof SyntaxError ? "Geçersiz JSON isteği." : error.message },
        { status: 400 }
      );
    }
    console.error("Staff create failed:", error);
    return NextResponse.json({ error: "Personel eklenemedi." }, { status: 500 });
  }
}

export async function PUT(request) {
  const actor = await authorize(request);
  if (!actor) return NextResponse.json({ error: "Yetkisiz." }, { status: 403 });
  try {
    const body = await request.json();
    const update = normalizeStaffUpdate(body);
    const user = await prisma.$transaction(async (tx) => {
      const target = await tx.staffUser.findUnique({ where: { id: body.id } });
      if (!target) return null;
      if (actor.userId !== "owner" && (target.role === "ADMIN" || update.role === "ADMIN"))
        return false;
      return tx.staffUser.update({
        where: { id: body.id },
        data: {
          ...(update.name !== undefined && { name: update.name }),
          ...(update.role !== undefined && { role: update.role }),
          ...(update.isActive !== undefined && { isActive: update.isActive }),
          ...(update.pin !== undefined && { pinHash: hashCredential(update.pin) }),
        },
      });
    });
    if (user === false) return ownerOnly();
    if (!user) return NextResponse.json({ error: "Personel bulunamadı." }, { status: 404 });
    disconnectStaffSockets(global.io, user.id);
    return NextResponse.json(publicUser(user));
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "Geçersiz JSON isteği." }, { status: 400 });
    if (error.message === "Geçersiz personel bilgisi.")
      return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Staff update failed:", error);
    return NextResponse.json({ error: "Personel güncellenemedi." }, { status: 500 });
  }
}

export async function DELETE(request) {
  const actor = await authorize(request);
  if (!actor) return NextResponse.json({ error: "Yetkisiz." }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Personel kimliği gerekli." }, { status: 400 });
  const removed = await prisma.$transaction(async (tx) => {
    const target = await tx.staffUser.findUnique({ where: { id } });
    if (!target) return null;
    if (target.role === "ADMIN" && actor.userId !== "owner") return false;
    await tx.staffUser.delete({ where: { id } });
    return true;
  });
  if (removed === false) return ownerOnly();
  if (!removed) return NextResponse.json({ error: "Personel bulunamadı." }, { status: 404 });
  disconnectStaffSockets(global.io, id);
  return NextResponse.json({ success: true });
}
