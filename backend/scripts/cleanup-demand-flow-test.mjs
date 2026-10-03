/** Removes the e2e flow test's orders from the test patient (keeps demo data pristine). */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const patient = await prisma.user.findUnique({ where: { phone: "+911234567890" } });
if (patient) {
  const removed = await prisma.order.deleteMany({ where: { patientId: patient.id } });
  console.log("removed flow-test orders:", removed.count);
} else {
  console.log("no test patient found — nothing to clean");
}
await prisma.$disconnect();
