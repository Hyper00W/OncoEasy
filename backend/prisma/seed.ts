import { PrismaClient, UserRole } from "@prisma/client";

import { env } from "../src/config/env";
import { hashPassword } from "../src/services/password";

if (env.NODE_ENV !== "development") {
  throw new Error("The development seed can only run when NODE_ENV=development");
}

const prisma = new PrismaClient();
const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "ops-admin@localhost";
const adminPassword =
  process.env.SEED_ADMIN_PASSWORD ?? "dev-only-change-me";

async function main(): Promise<void> {
  const passwordHash = await hashPassword(adminPassword);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      fullName: "OncoEasy Operations Admin",
      passwordHash,
      role: UserRole.OPS_ADMIN,
      isActive: true,
      isVerified: true
    },
    create: {
      fullName: "OncoEasy Operations Admin",
      email: adminEmail,
      passwordHash,
      role: UserRole.OPS_ADMIN,
      isActive: true,
      isVerified: true
    }
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });