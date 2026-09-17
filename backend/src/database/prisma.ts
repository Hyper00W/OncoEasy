import { PrismaClient } from "@prisma/client";

import { databaseConfig } from "../config/database";
import { env } from "../config/env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: databaseConfig.url
      }
    }
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}