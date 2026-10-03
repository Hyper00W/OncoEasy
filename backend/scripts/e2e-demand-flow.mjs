/**
 * E2E demand-flow verification (test-mode only).
 * 1. Marks DEMO-HIGHVOL-01 as non-Rx temporarily (test DB only).
 * 2. Patient OTP login -> add to cart -> create order (PENDING_PAYMENT).
 * 3. Reads summary totals -> the pending order's units must NOT be counted.
 * 4. Marks the order DELIVERED directly in DB (no payment provider exists).
 * 5. Reads summary again -> totals must increase by exactly the delivered units.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const base = "http://localhost:3000/api/v1";

async function api(path, options = {}, token = null) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body.data ?? body;
}

async function main() {
  // --- 0. product -> non-Rx for the flow test
  const product = await prisma.product.findUnique({ where: { sku: "DEMO-HIGHVOL-01" } });
  if (!product) throw new Error("Run seed:demand-demo first");
  await prisma.product.update({ where: { id: product.id }, data: { prescriptionRequired: false } });

  // --- 1. patient login (test mode echoes OTP)
  await api("/auth/patient/request-otp", { method: "POST", body: JSON.stringify({ phone: "+911234567890" }) });
  const otpRes = await api("/auth/patient/verify-otp", { method: "POST", body: JSON.stringify({ phone: "+911234567890", otp: "0000" }) }).catch(() => null);
  // OTP is echoed by test mode: fetch it again properly
  const otpResponse = await fetch(`${base}/auth/patient/request-otp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: "+911234567890" }) });
  const otpJson = (await otpResponse.json()).data;
  const login = await api("/auth/patient/verify-otp", { method: "POST", body: JSON.stringify({ phone: "+911234567890", otp: otpJson.testOtp }) });
  const patientToken = login.accessToken;
  console.log("patient logged in:", login.user.role);

  // --- 2. baseline summary
  const ownerLogin = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: "owner@oncoeasy.local", password: "dev-only-owner-change-me" }) });
  const ownerToken = ownerLogin.accessToken;
  const before = await api("/admin/pharmacy/forecasts/summary?horizonDays=7", {}, ownerToken);
  const highvolBefore = before.topProducts.find((p) => p.sku === "DEMO-HIGHVOL-01");
  console.log("BASELINE highvol recentDemand:", highvolBefore?.recentDemand, "totalHistorical:", highvolBefore?.totalHistoricalDemand);

  // --- 3. cart -> order (PENDING_PAYMENT)
  await api("/pharmacy/cart/items", { method: "POST", body: JSON.stringify({ productId: product.id, quantity: 12 }) }, patientToken);
  const cart = await api("/pharmacy/cart", {}, patientToken);
  const order = await api("/pharmacy/orders", { method: "POST", body: JSON.stringify({}) }, patientToken);
  console.log("order created:", order.id?.slice(0, 8), "status:", order.status);

  // --- 4. PENDING must not count
  const afterPending = await api("/admin/pharmacy/forecasts/summary?horizonDays=7", {}, ownerToken);
  const highvolPending = afterPending.topProducts.find((p) => p.sku === "DEMO-HIGHVOL-01");
  console.log("PENDING highvol totalHistorical:", highvolPending?.totalHistoricalDemand);
  if (highvolPending.totalHistoricalDemand !== highvolBefore.totalHistoricalDemand) {
    throw new Error("FAIL: pending order leaked into demand");
  }
  console.log("PASS: PENDING_PAYMENT order excluded from demand");

  // --- 5. mark DELIVERED (DB-level; no payment/fulfilment provider in test mode).
  // The engine's observation window is complete UTC days ending YESTERDAY (today
  // is deliberately excluded so a partial day can't depress baselines). To make
  // the delivered order verifiable inside the current window, backdate its
  // created_at to yesterday — the same day-bucketing the engine documents.
  const yesterday = new Date(Date.now() - 86_400_000);
  yesterday.setUTCHours(15, 0, 0, 0);
  await prisma.order.update({
    where: { id: order.id },
    data: { status: "DELIVERED", createdAt: yesterday, updatedAt: yesterday, items: { updateMany: { where: { orderId: order.id }, data: { createdAt: yesterday, updatedAt: yesterday } } } }
  });

  const afterDelivered = await api("/admin/pharmacy/forecasts/summary?horizonDays=7", {}, ownerToken);
  const highvolAfter = afterDelivered.topProducts.find((p) => p.sku === "DEMO-HIGHVOL-01");
  console.log("DELIVERED highvol totalHistorical:", highvolAfter.totalHistoricalDemand, "(delta:", highvolAfter.totalHistoricalDemand - highvolPending.totalHistoricalDemand + ")");
  if (highvolAfter.totalHistoricalDemand - highvolPending.totalHistoricalDemand !== 12) {
    throw new Error("FAIL: delivered order not aggregated as exactly +12 units");
  }
  console.log("PASS: DELIVERED order aggregated (+12 units exactly)");

  // --- 6. CANCELLED order must not count
  await prisma.order.create({
    data: {
      patientId: login.user.id,
      originType: "DIRECT_CART",
      status: "CANCELLED",
      currency: "INR",
      subtotal: 0,
      totalAmount: 0,
      items: { create: { productId: product.id, quantity: 99, unitPriceSnapshot: product.price, productNameSnapshot: product.name } }
    }
  });
  const afterCancelled = await api("/admin/pharmacy/forecasts/summary?horizonDays=7", {}, ownerToken);
  const highvolCancelled = afterCancelled.topProducts.find((p) => p.sku === "DEMO-HIGHVOL-01");
  if (highvolCancelled.totalHistoricalDemand !== highvolAfter.totalHistoricalDemand) {
    throw new Error("FAIL: cancelled order leaked into demand");
  }
  console.log("PASS: CANCELLED order excluded from demand");

  // --- 7. restore product Rx flag + PII check on forecast payloads
  await prisma.product.update({ where: { id: product.id }, data: { prescriptionRequired: true } });
  const payloadText = JSON.stringify({ before, afterDelivered });
  for (const pii of ["+911234567890", "phone", "patientId", "address", "prescriptionId"]) {
    if (payloadText.includes(pii)) throw new Error(`FAIL: forecast payload contains PII field: ${pii}`);
  }
  console.log("PASS: no PII in forecast payloads");
  console.log("E2E DEMAND FLOW: ALL CHECKS PASSED");
}

main()
  .catch((error) => { console.error("E2E FAILED:", error.message); process.exitCode = 1; })
  .finally(() => void prisma.$disconnect());
