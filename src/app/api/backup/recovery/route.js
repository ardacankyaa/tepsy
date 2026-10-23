export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { readRequestJson } from "@/lib/request-json.mjs";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import os from "node:os";
import prisma from "@/lib/db";
import { authorizePaymentAccess } from "@/lib/payment-access.mjs";
import { recordAudit } from "@/lib/audit.mjs";
import { isLoopbackAddress } from "@/lib/setup-policy.cjs";
import { trustedClientAddress } from "@/lib/trusted-client.cjs";
import recovery from "@/lib/recovery.cjs";
async function owner(request) {
  const session = await authorizePaymentAccess(request, prisma);
  if (!isLoopbackAddress(trustedClientAddress(request)) || (session && session.userId !== "owner"))
    return NextResponse.json(
      { error: "Tam yedek yönetimi sunucu bilgisayarında işletme sahibine açıktır." },
      { status: 403 }
    );
}
export async function GET(request) {
  try {
    const denied = await owner(request);
    if (denied) return denied;
    return NextResponse.json(await recovery.backupStatus(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Yedek durumu okunamadı." }, { status: 500 });
  }
}
export async function POST(request) {
  let temporary;
  try {
    const denied = await owner(request);
    if (denied) return denied;
    const action = new URL(request.url).searchParams.get("action") || "create";
    if (action === "plan") {
      const plan = await recovery.saveBackupPlan(await readRequestJson(request));
      await recordAudit(prisma, request, "BACKUP_PLAN", "backup", {
        enabled: plan.plan.enabled,
        intervalHours: plan.plan.intervalHours,
      });
      return NextResponse.json(plan);
    }
    if (action === "verify") {
      temporary = await fs.mkdtemp(path.join(os.tmpdir(), "tepsy-upload-"));
      const file = path.join(temporary, "archive.zip");
      const handle = await fs.open(file, "wx", 0o600);
      const reader = request.body?.getReader();
      let size = 0;
      if (!reader) {
        await handle.close();
        throw new Error("Yedek dosyası gerekli.");
      }
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 512 * 1024 * 1024) {
            await reader.cancel();
            throw new Error("Dosya en fazla 512 MB olabilir.");
          }
          await handle.writeFile(value);
        }
      } finally {
        reader.releaseLock();
        await handle.close();
      }
      const result = await recovery.verifyRecoveryArchive(file);
      return NextResponse.json({
        verified: result.verified,
        files: Object.keys(result.manifest.files).length,
        message:
          "Yedek doğrulandı. Mevcut kurulum değiştirilmedi; kurtarma aracıyla yeni klasöre geri yükleyebilirsiniz.",
      });
    }
    if (action !== "create")
      return NextResponse.json({ error: "Geçersiz işlem." }, { status: 400 });
    const backup = await recovery.createRecoveryBackup();
    await recordAudit(prisma, request, "BACKUP_CREATED", "backup", {
      filename: backup.filename,
      sha256: backup.sha256,
    });
    return new NextResponse(Readable.toWeb(createReadStream(backup.archive)), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${backup.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error?.code === "invalid-json-body")
      return NextResponse.json(
        { error: "Geçersiz veya çok büyük JSON isteği.", code: "invalid-json" },
        { status: error.status }
      );
    console.error("Recovery backup failed", error);
    return NextResponse.json(
      {
        error:
          "Yedek işlemi tamamlanamadı. Dosyayı, Python kurulumunu ve klasör izinlerini kontrol edin.",
      },
      { status: 400 }
    );
  } finally {
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  }
}
