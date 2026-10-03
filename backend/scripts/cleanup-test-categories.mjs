/**
 * Removes leftover TEST junk from the product catalog (test-mode only):
 *   - Deletes the 8 empty test categories ("Dashboard test category" x4,
 *     "phase3_8-*" x4) — all have zero products, so deletion is safe.
 *   - Hides the DEMO Demand Medicines category (isActive=false) so the
 *     synthetic forecast-demo products stop appearing on the public storefront.
 *     The products stay active in the database, so the Demand Forecast Engine
 *     keeps computing forecasts from their order history.
 *
 * Re-run seed:demand-demo later and it re-activates the demo category.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const testSlugs = await prisma.productCategory.findMany({
  where: {
    OR: [
      { name: { contains: "test", mode: "insensitive" } },
      { slug: { contains: "phase3_" } }
    ]
  },
  include: { _count: { select: { products: true } } }
});

let deleted = 0;
for (const category of testSlugs) {
  if (category._count.products > 0) {
    console.log(`SKIP (has products): ${category.slug} (${category._count.products})`);
    continue;
  }
  await prisma.productCategory.delete({ where: { id: category.id } });
  deleted += 1;
  console.log(`deleted: ${category.slug}`);
}

const demo = await prisma.productCategory.update({
  where: { slug: "demo-demand-medicines" },
  data: { isActive: false }
});
console.log(`\ndeleted empty test categories: ${deleted}`);
console.log(`demo category hidden from public catalog: ${demo.name} (isActive=false, products kept for forecast engine)`);
await prisma.$disconnect();
