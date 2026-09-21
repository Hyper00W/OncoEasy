import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const testKey = `ops213-${Date.now()}`;
const category = await prisma.productCategory.create({ data: { name: `${testKey} Category`, slug: `${testKey}-category` } });
const product = await prisma.product.create({ data: { sku: `${testKey}-SKU`, name: `${testKey} Medicine`, categoryId: category.id, price: "12.50", currency: "INR", minimumQuantity: 2 } });
const [patient, doctor] = await Promise.all([
  prisma.user.create({ data: { fullName: `${testKey} Patient`, phone: `+1555${String(Math.floor(Math.random()*1e7)).padStart(7,"0")}`, role: "PATIENT", isVerified: true } }),
  prisma.user.create({ data: { fullName: `${testKey} Doctor`, email: `${testKey}-doctor@example.com`, role: "DOCTOR", isVerified: true, isActive: true } })
]);
console.log(JSON.stringify({ testKey, categoryId: category.id, productId: product.id, patientId: patient.id, doctorId: doctor.id }));
await prisma.$disconnect();
