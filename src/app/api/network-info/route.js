export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireStaffRole } from "@/lib/route-access.mjs";
import os from "os";
import networkAddress from "@/lib/network-address.cjs";
import { readDeviceConfig, writeDeviceConfig } from "@/lib/devices/config";

function networkInfo(config) {
  const configuredUrl = config.network?.qrBaseUrl || "";
  if (configuredUrl) {
    const url = new URL(configuredUrl);
    return {
      qrBaseUrl: configuredUrl,
      ip: url.hostname,
      port: Number(url.port) || (url.protocol === "https:" ? 443 : 80),
      baseUrl: url.origin,
    };
  }
  const ip = networkAddress.selectLocalIPv4(os.networkInterfaces());
  const port = Number(process.env.PORT) || 3000;
  return { qrBaseUrl: "", ip, port, baseUrl: `http://${ip}:${port}` };
}

export async function GET() {
  try {
    return NextResponse.json(networkInfo(await readDeviceConfig()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("QR network config read failed:", error);
    return NextResponse.json({ error: "QR ağ adresi okunamadı." }, { status: 500 });
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
      typeof body.qrBaseUrl !== "string"
    ) {
      return NextResponse.json({ error: "QR adresi metin olmalıdır." }, { status: 400 });
    }
    const existing = await readDeviceConfig();
    const config = await writeDeviceConfig({ ...existing, network: { qrBaseUrl: body.qrBaseUrl } });
    return NextResponse.json(networkInfo(config), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const invalid = error instanceof SyntaxError || !error?.code;
    return NextResponse.json(
      { error: invalid ? error.message : "QR ağ adresi kaydedilemedi." },
      { status: invalid ? 400 : 500 }
    );
  }
}
