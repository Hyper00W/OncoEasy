/**
 * seed:demand-demo — SYNTHETIC demand dataset for the Demand Forecast Engine.
 *
 * ⚠️ DEMO DATA ⚠️
 * Every record created here is entirely synthetic and clearly labelled DEMO.
 * No real patient data, names, or phone numbers are used. All demo orders are
 * attributed to one dedicated demo user (phone +919999000001), so a re-run
 * first deletes that user's orders (and their cascaded items) and recreates
 * them — production data is never touched.
 *
 * The script seeds HISTORY ONLY. It never computes or hardcodes forecast
 * numbers: the Phase 5.0 statistical engine (recency-weighted daily average +
 * damped trend over DELIVERED orders) derives every forecast from these rows.
 *
 * Product patterns (7 synthetic medicines, deterministic PRNG):
 *   1. DEMO-STABLE    stable daily demand
 *   2. DEMO-GROW      gradually increasing demand
 *   3. DEMO-DECL      gradually decreasing demand
 *   4. DEMO-HIGHVOL   high-volume medicine
 *   5. DEMO-LOWVOL    low-volume, intermittent demand
 *   6. DEMO-WEEKEND   weekday/weekend periodic variation
 *   7. DEMO-SPIKE     stable with a recent demand spike
 *
 * It also creates PENDING_PAYMENT and CANCELLED orders whose quantities would
 * visibly change the charts if they were (wrongly) counted — a live proof that
 * only DELIVERED orders contribute to demand.
 *
 * Usage: npm run seed:demand-demo   (NODE_ENV=development or test only)
 */
import { OrderOriginType, OrderStatus, PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

const nodeEnv = process.env.NODE_ENV ?? "development";
if (nodeEnv !== "development" && nodeEnv !== "test") {
  throw new Error("The demand DEMO seed can only run when NODE_ENV=development or NODE_ENV=test");
}

const DEMO_PHONE = "+919999000001";
const DEMO_CATEGORY = "DEMO Demand Medicines";
const DEMO_USER_NAME = "DEMO synthetic orders (not a real patient)";
const HISTORY_DAYS = 90;
const RNG_SEED = 20260929; // deterministic — same seed, same dataset

/** mulberry32: tiny deterministic PRNG. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

type ProductPattern = {
  sku: string;
  name: string;
  price: number;
  unitsForDay: (dayIndex: number, dayOfWeek: number, rng: () => number) => number;
};

const patterns: ProductPattern[] = [
  {
    sku: "DEMO-STABLE-01",
    name: "DEMO Cyclophosphamide 50mg Tablet (synthetic)",
    price: 412,
    unitsForDay: (_i, _w, rng) => 8 + Math.floor(rng() * 3)
  },
  {
    sku: "DEMO-GROW-01",
    name: "DEMO Imatinib 400mg Tablet (synthetic)",
    price: 890,
    unitsForDay: (i, _w, rng) => Math.max(1, Math.round(4 + (i / (HISTORY_DAYS - 1)) * 10 + (rng() * 2 - 1)))
  },
  {
    sku: "DEMO-DECL-01",
    name: "DEMO Etoposide 100mg Injection (synthetic)",
    price: 1450,
    unitsForDay: (i, _w, rng) => Math.max(0, Math.round(12 - (i / (HISTORY_DAYS - 1)) * 9 + (rng() * 2 - 1)))
  },
  {
    sku: "DEMO-HIGHVOL-01",
    name: "DEMO Ondansetron 4mg Injection (synthetic)",
    price: 38,
    unitsForDay: (_i, _w, rng) => 22 + Math.floor(rng() * 9)
  },
  {
    sku: "DEMO-LOWVOL-01",
    name: "DEMO Tamoxifen 20mg Tablet (synthetic)",
    price: 156,
    unitsForDay: (i) => (i % 3 === 0 ? 2 : 0)
  },
  {
    sku: "DEMO-WEEKEND-01",
    name: "DEMO Methotrexate 2.5mg Tablet (synthetic)",
    price: 210,
    unitsForDay: (_i, w, rng) => (w === 0 || w === 6 ? 3 + Math.floor(rng() * 2) : 11 + Math.floor(rng() * 4))
  },
  {
    sku: "DEMO-SPIKE-01",
    name: "DEMO Zoledronic Acid 4mg Injection (synthetic)",
    price: 3200,
    unitsForDay: (i, _w, rng) => (i < HISTORY_DAYS - 8 ? 5 + Math.floor(rng() * 2) : 17 + Math.floor(rng() * 7))
  }
];

async function main(): Promise<void> {
  const rng = createRng(RNG_SEED);
  const now = new Date();
  const endDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 86_400_000); // yesterday UTC

  // 1. Dedicated demo patient — every demo order hangs off this user, so
  //    cleanup is exact and nothing outside the demo dataset is touched.
  const demoUser = await prisma.user.upsert({
    where: { phone: DEMO_PHONE },
    update: { fullName: DEMO_USER_NAME, role: UserRole.PATIENT, isActive: true },
    create: {
      fullName: DEMO_USER_NAME,
      phone: DEMO_PHONE,
      role: UserRole.PATIENT,
      isActive: true,
      isVerified: true
    }
  });

  // 2. Demo category + products (upsert by SKU keeps productIds stable
  //    across re-runs, so the seed is fully deterministic).
  const category = await prisma.productCategory.upsert({
    where: { slug: "demo-demand-medicines" },
    update: { name: DEMO_CATEGORY, isActive: true },
    create: { name: DEMO_CATEGORY, slug: "demo-demand-medicines", isActive: true }
  });

  const products = new Map<string, { id: string; price: number }>();
  // Products must predate the observed window: the engine observes a product
  // from max(windowStart, createdAt), so a just-created product would have a
  // zero-day observation and be correctly classified INSUFFICIENT_DATA.
  const productCreatedAt = addDays(endDay, -(HISTORY_DAYS + 7));
  for (const pattern of patterns) {
    const product = await prisma.product.upsert({
      where: { sku: pattern.sku },
      update: { name: pattern.name, isActive: true, categoryId: category.id, createdAt: productCreatedAt },
      create: {
        sku: pattern.sku,
        name: pattern.name,
        description: "Synthetic DEMO medicine created by seed:demand-demo for forecast visualisation. Not a real product.",
        categoryId: category.id,
        unitLabel: "unit",
        price: pattern.price,
        currency: "INR",
        isActive: true,
        prescriptionRequired: true,
        minimumQuantity: 1,
        createdAt: productCreatedAt
      }
    });
    products.set(pattern.sku, { id: product.id, price: pattern.price });
  }

  // 3. Remove any previous demo dataset (orders cascade to items/payments).
  const removed = await prisma.order.deleteMany({ where: { patientId: demoUser.id } });

  // 4. Synthetic DELIVERED history: one order per product per day.
  let deliveredOrders = 0;
  let deliveredItems = 0;
  let deliveredUnits = 0;

  for (let dayIndex = 0; dayIndex < HISTORY_DAYS; dayIndex += 1) {
    const orderDate = addDays(endDay, -(HISTORY_DAYS - 1 - dayIndex));
    const dayOfWeek = orderDate.getUTCDay();

    for (const pattern of patterns) {
      const units = pattern.unitsForDay(dayIndex, dayOfWeek, rng);
      if (units <= 0) continue;

      const product = products.get(pattern.sku);
      if (!product) continue;

      // Deterministic hour of day so created_at buckets are stable per seed.
      const createdAt = new Date(orderDate);
      createdAt.setUTCHours(8 + Math.floor(rng() * 11), Math.floor(rng() * 60), 0, 0);

      const subtotal = units * product.price;
      const order = await prisma.order.create({
        data: {
          patientId: demoUser.id,
          originType: OrderOriginType.DIRECT_CART,
          status: OrderStatus.DELIVERED,
          currency: "INR",
          subtotal,
          deliveryFee: 0,
          totalAmount: subtotal,
          createdAt,
          updatedAt: createdAt
        }
      });
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          productId: product.id,
          quantity: units,
          unitPriceSnapshot: product.price,
          productNameSnapshot: pattern.name,
          createdAt,
          updatedAt: createdAt
        }
      });

      deliveredOrders += 1;
      deliveredItems += 1;
      deliveredUnits += units;
    }
  }

  // 5. Non-delivered orders that must NOT count as demand. Quantities are
  //    deliberately large: if the engine wrongly aggregated them, charts
  //    would jump — their absence is the test.
  let excludedOrders = 0;
  for (const status of [OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED] as const) {
    for (let n = 0; n < 3; n += 1) {
      const createdAt = new Date(addDays(endDay, -(2 + n * 3)));
      createdAt.setUTCHours(12, 0, 0, 0);
      const product = products.get("DEMO-HIGHVOL-01");
      if (!product) continue;

      const subtotal = 30 * product.price;
      const order = await prisma.order.create({
        data: {
          patientId: demoUser.id,
          originType: OrderOriginType.DIRECT_CART,
          status,
          currency: "INR",
          subtotal,
          deliveryFee: 0,
          totalAmount: subtotal,
          createdAt,
          updatedAt: createdAt
        }
      });
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          productId: product.id,
          quantity: 30,
          unitPriceSnapshot: product.price,
          productNameSnapshot: "DEMO Ondansetron 4mg Injection (synthetic)",
          createdAt,
          updatedAt: createdAt
        }
      });
      excludedOrders += 1;
    }
  }

  console.log("==========================================================");
  console.log("  DEMAND FORECAST ENGINE — DEMO DATA SEEDED (synthetic)");
  console.log("==========================================================");
  console.log(`  Window:            ${toDayKey(addDays(endDay, -(HISTORY_DAYS - 1)))} → ${toDayKey(endDay)} (${HISTORY_DAYS} days, UTC)`);
  console.log(`  Demo medicines:    ${patterns.length} (SKUs prefixed DEMO-*)`);
  console.log(`  DELIVERED orders:  ${deliveredOrders} (${deliveredUnits} units across ${deliveredItems} items)`);
  console.log(`  Excluded orders:   ${excludedOrders} (PENDING_PAYMENT + CANCELLED, must NOT count as demand)`);
  console.log(`  Replaced previous: ${removed.count} demo orders`);
  console.log("");
  console.log("  DEMO DATA — entirely synthetic, safe to delete.");
  console.log("  Forecast numbers are NOT seeded: open the Demand Forecast");
  console.log("  Engine and the statistical engine will compute them.");
  console.log("==========================================================");
}

main()
  .catch((error: unknown) => {
    console.error("Demo demand seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
