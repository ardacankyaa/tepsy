export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import prisma from "@/lib/db";
import { credentialSessionVersion, sessionFromRequest } from "@/lib/auth-local";
import {
  currentStaffSession,
  disconnectAllSockets,
  invalidateAuthConfigCache,
} from "@/lib/security-policy.cjs";
import { isLoopbackAddress } from "@/lib/setup-policy.cjs";
import { trustedClientAddress } from "@/lib/trusted-client.cjs";
import runtimeConfig from "../../../../scripts/runtime-config.cjs";

const runFile = promisify(execFile);

async function createVerifiedResetBackup() {
  const { databasePath } = runtimeConfig.resolveRuntimeConfig(process.env, process.cwd());
  const backupDir = path.resolve(
    process.env.TEPSY_BACKUP_DIR || path.join(process.cwd(), ".tepsy", "backups")
  );
  const script = path.join(process.cwd(), "scripts", "sqlite-backup.py");
  const { stdout } = await runFile(
    process.platform === "win32" ? "py" : "python3",
    [script, "--source", databasePath, "--dest-dir", backupDir, "--prefix", "tepsy-reset"],
    {
      cwd: process.cwd(),
      windowsHide: true,
      timeout: 120000,
    }
  );
  const backupFile = path.basename(stdout.trim());
  if (!/^tepsy-reset-\d{8}-\d{6}-\d+\.db$/.test(backupFile))
    throw new Error("reset-backup-not-verified");
  return backupFile;
}

export async function POST(request) {
  try {
    if (!isLoopbackAddress(trustedClientAddress(request))) {
      return NextResponse.json(
        { error: "Sıfırlama yalnızca TEPSY sunucusunun çalıştığı bilgisayardan yapılabilir." },
        { status: 403 }
      );
    }
    const config = await prisma.restaurantConfig.findFirst({
      select: { authEnabled: true, accessPasswordHash: true },
    });
    if (config?.authEnabled && config.accessPasswordHash) {
      const session = await currentStaffSession(
        sessionFromRequest(request),
        (id) =>
          prisma.staffUser.findUnique({
            where: { id },
            select: { id: true, role: true, isActive: true, updatedAt: true },
          }),
        credentialSessionVersion(config.accessPasswordHash)
      );
      if (session?.role !== "ADMIN")
        return NextResponse.json({ error: "Yönetici girişi gerekli." }, { status: 403 });
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Geçersiz JSON isteği." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Geçersiz sıfırlama modu." }, { status: 400 });
    }
    if (body.mode !== "CLEAN")
      return NextResponse.json({ error: "Geçersiz sıfırlama modu." }, { status: 400 });
    if (body.confirmation !== "TEPSY") {
      return NextResponse.json({ error: "Sıfırlamak için TEPSY onayını girin." }, { status: 400 });
    }

    const backupFile = await createVerifiedResetBackup();
    await prisma.$transaction(async (tx) => {
      await tx.refund.deleteMany();
      await tx.auditEvent.deleteMany();
      await tx.paymentAttempt.deleteMany();
      await tx.payment.deleteMany();
      await tx.orderItem.deleteMany();
      await tx.order.deleteMany();
      await tx.cashShift.deleteMany();
      await tx.serviceRequest.deleteMany();
      await tx.floorElement.deleteMany();
      await tx.floorPlanSection.deleteMany();
      await tx.menuItem.deleteMany();
      await tx.category.deleteMany();
      await tx.table.deleteMany();
      await tx.staffUser.deleteMany();
      await tx.restaurantConfig.deleteMany();
      await tx.restaurantConfig.create({
        data: {
          restaurantName: "Yeni Restoranım",
          tagline: "Kendi Masalarınızı ve Menünüzü Ekleyin",
          isSetupCompleted: false,
        },
      });
    });
    invalidateAuthConfigCache();
    disconnectAllSockets(global.io);

    if (global.io) {
      global.io.emit("table:update");
      global.io.emit("menu:update");
    }

    return NextResponse.json({ success: true, mode: "CLEAN", backupFile });
  } catch (error) {
    console.error("Sıfırlama hatası:", error);
    return NextResponse.json({ error: "Sıfırlama işlemi yapılamadı" }, { status: 500 });
  }
}
