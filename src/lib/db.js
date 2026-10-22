import { createPrismaClient } from "./prisma-client.cjs";
import { resolveRuntimeConfig } from "../../scripts/runtime-config.cjs";

const globalForPrisma = global;

function createClient() {
  const { databasePath } = resolveRuntimeConfig(process.env);
  const client = createPrismaClient("file:" + databasePath.replaceAll("\\", "/"), {
    log: ["error"],
  });

  // Optimize SQLite for high-throughput concurrency
  client.$queryRawUnsafe(`PRAGMA journal_mode = WAL;`).catch(() => {});
  client.$queryRawUnsafe(`PRAGMA synchronous = FULL;`).catch(() => {});
  client.$queryRawUnsafe(`PRAGMA cache_size = -64000;`).catch(() => {});
  client.$queryRawUnsafe(`PRAGMA temp_store = MEMORY;`).catch(() => {});

  return client;
}

export const prisma = globalForPrisma.prisma || createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
export default prisma;
