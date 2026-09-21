import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import { Prisma, UserRole } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config({ override: true });
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://USERNAME:PASSWORD@localhost:5432/DATABASE_NAME?schema=public";
process.env.JWT_ACCESS_SECRET ??= "integration-test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "integration-test-refresh-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
process.env.JWT_REFRESH_EXPIRES_IN ??= "7d";

let server: Server;
let baseUrl: string;
let adminId: string;
let patientId: string;
let doctorId: string;
let orderId: string;
let deliveryId: string;
let referralId: string;
let appointmentId: string;
let bookingId: string;
let papApplicationId: string;
let articleId: string;
let trialId: string;
let storyId: string;
let chatSessionId: string;
const testKey = `phase1_17-${Date.now()}`;
let overviewBaseline: Record<string, number>;

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");
  const [admin, patient, doctor] = await Promise.all([
    createUser(prisma, "admin", UserRole.OPS_ADMIN),
    createUser(prisma, "patient", UserRole.PATIENT),
    createUser(prisma, "doctor", UserRole.DOCTOR)
  ]);
  adminId = admin.id;
  patientId = patient.id;
  doctorId = doctor.id;
  overviewBaseline = await counts(prisma);
  await seedOperationalFixtures(prisma);

  server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    listener.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const { address: host, port } = address as AddressInfo;
  baseUrl = `http://${host}:${port}`;
});

after(async () => {
  const { prisma } = await import("../src/database/prisma");
  await prisma.chatSession.deleteMany({ where: { id: chatSessionId } });
  await prisma.patientStory.deleteMany({ where: { id: storyId } });
  await prisma.clinicalTrial.deleteMany({ where: { id: trialId } });
  await prisma.knowledgeArticle.deleteMany({ where: { id: articleId } });
  await prisma.pAPApplication.deleteMany({ where: { id: papApplicationId } });
  await prisma.labBooking.deleteMany({ where: { id: bookingId } });
  await prisma.appointment.deleteMany({ where: { id: appointmentId } });
  await prisma.doctorAvailability.deleteMany({ where: { doctorId } });
  await prisma.referral.deleteMany({ where: { id: referralId } });
  await prisma.delivery.deleteMany({ where: { id: deliveryId } });
  await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.prescription.deleteMany({ where: { patientId } });
  await prisma.product.deleteMany({ where: { sku: `${testKey}-SKU` } });
  await prisma.productCategory.deleteMany({ where: { slug: `${testKey}-category` } });
  await prisma.pAPProgram.deleteMany({ where: { name: `${testKey} PAP` } });
  await prisma.labTest.deleteMany({ where: { name: `${testKey} Lab` } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, patientId, doctorId] } } });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("OPS_ADMIN can access an accurate count-only overview", async () => {
  const response = await request("GET", "/api/v1/admin/overview", await tokenFor(adminId, UserRole.OPS_ADMIN));
  assert.equal(response.status, 200);
  for (const [key, value] of Object.entries(overviewBaseline)) {
    assert.ok(response.body.data[key] >= value + 1, key);
  }
});

test("non-admin roles cannot access the overview or admin queues", async () => {
  const patientToken = await tokenFor(patientId, UserRole.PATIENT);
  const doctorToken = await tokenFor(doctorId, UserRole.DOCTOR);
  for (const token of [patientToken, doctorToken]) {
    assert.equal((await request("GET", "/api/v1/admin/overview", token)).status, 403);
    assert.equal((await request("GET", "/api/v1/admin/referrals", token)).status, 403);
    assert.equal((await request("GET", "/api/v1/admin/pharmacy/orders", token)).status, 403);
  }
});

test("new admin queues expose referral, order, consultation, and delivery operations", async () => {
  const token = await tokenFor(adminId, UserRole.OPS_ADMIN);
  const referrals = await request("GET", "/api/v1/admin/referrals?status=SENT&page=1&pageSize=100", token);
  const orders = await request("GET", "/api/v1/admin/pharmacy/orders?status=PENDING_PAYMENT&page=1&pageSize=100", token);
  const appointments = await request("GET", `/api/v1/admin/consultations/appointments?status=PENDING&doctorId=${doctorId}&pageSize=100`, token);
  const deliveries = await request("GET", "/api/v1/admin/pharmacy/deliveries?status=PENDING&pageSize=100", token);
  const delivery = await request("GET", `/api/v1/admin/pharmacy/deliveries/${deliveryId}`, token);
  assert.equal(referrals.status, 200);
  assert.ok(referrals.body.data.items.some((item: { referralId: string }) => item.referralId === referralId));
  assert.equal(referrals.body.data.pagination.pageSize, 100);
  assert.equal(orders.status, 200);
  assert.ok(orders.body.data.items.some((item: { id: string }) => item.id === orderId));
  assert.equal(appointments.status, 200);
  assert.ok(appointments.body.data.items.some((item: { appointmentId: string }) => item.appointmentId === appointmentId));
  assert.equal(deliveries.status, 200);
  assert.ok(deliveries.body.data.items.some((item: { id: string }) => item.id === deliveryId));
  assert.equal(delivery.status, 200);
  assert.equal(delivery.body.data.order.patientId, patientId);
  assert.equal(delivery.body.data.proofs[0]?.storageKey, undefined);
});

test("existing admin workflows remain reachable and private fields stay hidden", async () => {
  const token = await tokenFor(adminId, UserRole.OPS_ADMIN);
  const endpoints = [
    "/api/v1/pharmacy/prescriptions/review-queue",
    "/api/v1/admin/labs/bookings?status=PENDING_OPS",
    "/api/v1/admin/pap/applications?status=SUBMITTED",
    "/api/v1/admin/knowledge/articles?isPublished=false",
    "/api/v1/admin/trials?isPublished=false",
    "/api/v1/admin/stories/?status=UNDER_REVIEW",
    "/api/v1/admin/chat/sessions?escalated=true"
  ];
  const responses = await Promise.all(endpoints.map((path) => request("GET", path, token)));
  responses.forEach((response, index) => assert.equal(response.status, 200, endpoints[index]));
  const pap = responses[2].body.data.find((item: { applicationId: string }) => item.applicationId === papApplicationId);
  const story = responses[5].body.data.items.find((item: { storyId: string }) => item.storyId === storyId);
  const chat = responses[6].body.data.items.find((item: { sessionId: string }) => item.sessionId === chatSessionId);
  assert.equal(pap.documents[0]?.storageKey, undefined);
  assert.equal(story.photo?.storageKey, undefined);
  assert.equal(chat.sessionId, chatSessionId);
});

test("admin filters are validated and patients cannot cross into admin visibility", async () => {
  const adminToken = await tokenFor(adminId, UserRole.OPS_ADMIN);
  const patientToken = await tokenFor(patientId, UserRole.PATIENT);
  const invalid = await request("GET", "/api/v1/admin/consultations/appointments?from=not-a-date", adminToken);
  const patientAccess = await request("GET", "/api/v1/admin/pharmacy/orders", patientToken);
  const detail = await request("GET", `/api/v1/admin/pharmacy/orders/${orderId}`, adminToken);
  assert.equal(invalid.status, 400);
  assert.equal(patientAccess.status, 403);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.patient.patientId, patientId);
  assert.equal(detail.body.data.patient.email, undefined);
});

async function seedOperationalFixtures(prisma: typeof import("../src/database/prisma").prisma) {
  const category = await prisma.productCategory.create({ data: { name: `${testKey} Category`, slug: `${testKey}-category` } });
  const product = await prisma.product.create({ data: { sku: `${testKey}-SKU`, name: `${testKey} Product`, categoryId: category.id, price: new Prisma.Decimal("10.00"), currency: "INR" } });
  await prisma.prescription.create({ data: { patientId, source: "PATIENT_UPLOAD", status: "PENDING_REVIEW", documentKey: `${testKey}/prescription.pdf`, documentName: "prescription.pdf", mimeType: "application/pdf", createdByUserId: patientId } });
  const order = await prisma.order.create({ data: { patientId, originType: "DIRECT_CART", status: "PENDING_PAYMENT", currency: "INR", subtotal: new Prisma.Decimal("10.00"), deliveryFee: new Prisma.Decimal("0.00"), totalAmount: new Prisma.Decimal("10.00"), items: { create: { productId: product.id, quantity: 1, unitPriceSnapshot: new Prisma.Decimal("10.00"), productNameSnapshot: product.name } } } });
  orderId = order.id;
  const delivery = await prisma.delivery.create({ data: { orderId: order.id, mode: "LOCAL", status: "PENDING" } });
  deliveryId = delivery.id;
  const referral = await prisma.referral.create({ data: { doctorId, patientId, accessTokenHash: `${testKey}-referral`, items: { create: { productId: product.id, quantity: 1, productNameSnapshot: product.name } } } });
  referralId = referral.id;
  const availability = await prisma.doctorAvailability.create({ data: { doctorId, startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000) } });
  const appointment = await prisma.appointment.create({ data: { doctorId, patientId, availabilityId: availability.id, consultationType: "PHONE", scheduledAt: availability.startsAt, endsAt: availability.endsAt } });
  appointmentId = appointment.id;
  const labTest = await prisma.labTest.create({ data: { name: `${testKey} Lab`, description: "Test", category: "General", price: new Prisma.Decimal("10.00"), currency: "INR" } });
  const booking = await prisma.labBooking.create({ data: { patientId, labTestId: labTest.id, collectionType: "CENTER", preferredDate: new Date(), status: "PENDING_OPS" } });
  bookingId = booking.id;
  const papProgram = await prisma.pAPProgram.create({ data: { name: `${testKey} PAP`, description: "Program", eligibilityDescription: "Eligibility", requiredDocuments: [] } });
  const pap = await prisma.pAPApplication.create({ data: { patientId, papProgramId: papProgram.id, applicationData: { fullName: "Patient" } } });
  papApplicationId = pap.id;
  const article = await prisma.knowledgeArticle.create({ data: { title: `${testKey} Article`, slug: `${testKey}-article`, category: "GENERAL", summary: "Summary", content: "Content", createdById: adminId } });
  articleId = article.id;
  const trial = await prisma.clinicalTrial.create({ data: { title: `${testKey} Trial`, summary: "Summary", description: "Description", source: "OTHER", sourceTrialId: `${testKey}-trial`, createdById: adminId } });
  trialId = trial.id;
  const story = await prisma.patientStory.create({ data: { displayName: "Patient", story: "Story", consentGiven: true, status: "UNDER_REVIEW", createdById: adminId } });
  storyId = story.id;
  const chat = await prisma.chatSession.create({ data: { patientId, status: "ESCALATED", intent: "HUMAN_SUPPORT", escalated: true } });
  chatSessionId = chat.id;
}

async function counts(prisma: typeof import("../src/database/prisma").prisma) {
  const [prescriptions, orders, deliveries, referrals, consultations, labs, pap, articles, trials, stories, chats] = await prisma.$transaction([
    prisma.prescription.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.order.count({ where: { status: { in: ["PENDING_PRESCRIPTION", "PENDING_PHARMACIST_REVIEW", "PENDING_PAYMENT"] } } }),
    prisma.delivery.count({ where: { status: { in: ["PENDING", "ASSIGNED", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "SHIPPED"] } } }),
    prisma.referral.count({ where: { status: { in: ["SENT", "VIEWED"] } } }),
    prisma.appointment.count({ where: { status: { in: ["PENDING", "CONFIRMED"] }, scheduledAt: { gte: new Date() } } }),
    prisma.labBooking.count({ where: { status: "PENDING_OPS" } }),
    prisma.pAPApplication.count({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW", "MORE_INFORMATION_REQUIRED"] } } }),
    prisma.knowledgeArticle.count({ where: { isPublished: false } }),
    prisma.clinicalTrial.count({ where: { isPublished: false } }),
    prisma.patientStory.count({ where: { status: "UNDER_REVIEW" } }),
    prisma.chatSession.count({ where: { escalated: true, status: "ESCALATED" } })
  ]);
  return { pendingPrescriptionReviews: prescriptions, pendingOrders: orders, activeDeliveries: deliveries, pendingReferrals: referrals, upcomingConsultations: consultations, pendingLabBookings: labs, papApplicationsRequiringAttention: pap, draftKnowledgeArticles: articles, unpublishedClinicalTrials: trials, storiesAwaitingReview: stories, escalatedChatSessions: chats };
}

async function createUser(prisma: typeof import("../src/database/prisma").prisma, name: string, role: UserRole) {
  return prisma.user.create({ data: { fullName: `${testKey} ${name}`, email: `${testKey}-${name}@example.com`, phone: `+1555${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`, role, isVerified: true } });
}

async function tokenFor(userId: string, role: UserRole) {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function request(method: string, path: string, token: string) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json() as Record<string, any> };
}
