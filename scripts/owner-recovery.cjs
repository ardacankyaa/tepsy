const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const { resolveRuntimeConfig } = require("./runtime-config.cjs");
const { managedPaths } = require("./local-paths.cjs");
const { issueRecoveryCode } = require("../src/lib/owner-recovery.cjs");

function recoveryInstallation(args = [], cwd = process.cwd(), env = process.env) {
  if (args.length === 0)
    return fs.existsSync(path.join(cwd, ".managed-install.json"))
      ? path.resolve(cwd)
      : managedPaths(env).app;
  if (args.length !== 2 || args[0] !== "--installation" || !path.isAbsolute(args[1]))
    throw new Error(
      'Usage: npm run owner:recovery -- [--installation "ABSOLUTE_INSTALLATION_FOLDER"]'
    );
  return path.resolve(args[1]);
}
function recoveryRuntime(root, env = process.env) {
  const envFile = path.join(root, ".env");
  const configured = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : {};
  const inherited = { ...env };
  if (configured.TEPSY_DATABASE_URL || configured.RESTOPOS_DATABASE_URL) {
    delete inherited.TEPSY_DATABASE_URL;
    delete inherited.RESTOPOS_DATABASE_URL;
  }
  return resolveRuntimeConfig({ ...inherited, ...configured }, root);
}
function recoveryPrismaClient(root) {
  try {
    const factory = path.join(root, "src", "lib", "prisma-client.cjs");
    if (fs.existsSync(factory)) {
      const { createPrismaClient } = require(factory);
      if (typeof createPrismaClient !== "function") throw new Error("Invalid Prisma client");
      return createPrismaClient;
    }
    // Installations from before Prisma 7 still construct their own client directly.
    const { PrismaClient } = require(path.join(root, "node_modules", "@prisma", "client"));
    if (typeof PrismaClient !== "function") throw new Error("Invalid Prisma client");
    return (url) => new PrismaClient({ datasources: { db: { url } } });
  } catch (cause) {
    throw new Error(
      "The selected installation's dependencies are missing or unavailable. Run START.bat for that installation first, then retry owner recovery.",
      { cause }
    );
  }
}
async function main(args = process.argv.slice(2)) {
  const root = recoveryInstallation(args);
  const runtime = recoveryRuntime(root);
  if (!fs.existsSync(runtime.databasePath))
    throw new Error(
      "Installation database does not exist. Run this command from the existing installation or pass --installation."
    );
  const createPrismaClient = recoveryPrismaClient(root);
  const prisma = createPrismaClient("file:" + runtime.databasePath.replaceAll("\\", "/"));
  try {
    const config = await prisma.restaurantConfig.findFirst({
      select: { accessPasswordHash: true },
    });
    const result = issueRecoveryCode({ root, passwordHash: config?.accessPasswordHash });
    process.stdout.write(
      `\nTEPSY owner recovery / İşletme sahibi şifre kurtarma\nInstallation / Kurulum: ${root}\n\nRecovery code / Kurtarma kodu: ${result.code}\n\nValid for 10 minutes, one use only. Keep this code private.\n10 dakika geçerli, tek kullanımlık. Kodu paylaşmayın.\nOpen the login page on the server computer and select Forgot password.\nSunucu bilgisayarında giriş ekranındaki Şifremi unuttum seçeneğini açın.\n`
    );
  } finally {
    await prisma.$disconnect();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { recoveryInstallation, recoveryRuntime, recoveryPrismaClient, main };
