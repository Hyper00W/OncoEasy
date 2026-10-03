import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const users = await p.user.findMany({ select: { role: true, email: true, phone: true } });
console.log(JSON.stringify(users, null, 0));
await p.$disconnect();
