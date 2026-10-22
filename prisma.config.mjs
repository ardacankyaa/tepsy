import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";
import runtimeConfig from "./scripts/runtime-config.cjs";

// Prisma CLI commands target the same database as the server: TEPSY_DATABASE_URL (or the legacy
// RESTOPOS_DATABASE_URL), defaulting to prisma/dev.db.
const root = fileURLToPath(new URL(".", import.meta.url));
const { databasePath } = runtimeConfig.resolveRuntimeConfig(process.env, root);

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: "file:" + databasePath.replaceAll("\\", "/") },
});
