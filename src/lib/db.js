import { PrismaClient } from "@prisma/client";

const globalForPrisma = global;

function createPrismaClient() {
  const databaseUrl = process.env.TEPSY_DATABASE_URL || process.env.RESTOPOS_DATABASE_URL;
  const client = new PrismaClient({
    log: ["error"],
    ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
  });

  // Optimize SQLite for high-throughput concurrency
  client.$queryRawUnsafe(`PRAGMA journal_mode = WAL;`).catch(() => {});
  client.$queryRawUnsafe(`PRAGMA synchronous = FULL;`).catch(() => {});
  client.$queryRawUnsafe(`PRAGMA cache_size = -64000;`).catch(() => {});
  client.$queryRawUnsafe(`PRAGMA temp_store = MEMORY;`).catch(() => {});

  return client;
}

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
export default prisma;
