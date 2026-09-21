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
const entityIds: string[] = [];
const eventIds: string[] = [];
const testKey = `phase1_18-${Date.now()}`;

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");
  const users = await Promise.all([
    createUser(prisma, "admin", UserRole.OPS_ADMIN),
    createUser(prisma, "patient", UserRole.PATIENT),
    createUser(prisma, "doctor", UserRole.DOCTOR)
  ]);
  [adminId, patientId, doctorId] = users.map((user) => user.id);
  await seedMetrics(prisma);
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
  await prisma.analyticsEvent.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.analyticsEvent.deleteMany({ where: { entityId: { in: entityIds } } });
  await prisma.trialInterest.deleteMany({ where: { patientId } });
  await prisma.clinicalTrial.deleteMany({ where: { id: { in: entityIds } } });
  await prisma.patientStory.deleteMany({ where: { id: { in: entityIds } } });
  await prisma.knowledgeArticle.deleteMany({ where: { id: { in: entityIds } } });
  await prisma.pAPApplication.deleteMany({ where: { id: { in: entityIds } } });
  await prisma.prescription.deleteMany({ where: { patientId } });
  await prisma.labBooking.deleteMany({ where: { id: { in: entityIds } } });
  await prisma.appointment.deleteMany({ where: { id: { in: entityIds } } });
  await prisma.doctorAvailability.deleteMany({ where: { doctorId } });
  await prisma.referral.deleteMany({ where: { id: { in: entityIds } } });
  await prisma.order.deleteMany({ where: { id: { in: entityIds } } });
  await prisma.product.deleteMany({ where: { sku: `${testKey}-SKU` } });
  await prisma.productCategory.deleteMany({ where: { slug: `${testKey}-category` } });
  await prisma.pAPProgram.deleteMany({ where: { name: `${testKey} PAP` } });
  await prisma.labTest.deleteMany({ where: { name: `${testKey} Lab` } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, patientId, doctorId] } } });
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("OPS_ADMIN receives all required metrics with date filtering", async () => {
  const response = await request("GET", "/api/v1/admin/analytics/overview", await tokenFor(adminId, UserRole.OPS_ADMIN));
  assert.equal(response.status, 200);
  const data = response.body.data;
  assert.ok(data.referralConversion.created >= 2);
  assert.ok(data.referralConversion.converted >= 1);
  assert.ok(data.consultationModeSplit.IN_CLINIC >= 1);
  assert.ok(data.consultationModeSplit.PHONE >= 1);
  assert.ok(data.labConversion.bookings >= 2);
  assert.ok(data.labConversion.completed >= 1);
  assert.ok(data.papCompletion.submitted >= 2);
  assert.ok(data.papCompletion.completed >= 1);
  assert.ok(data.repeatPharmacyOrders.patients >= 1);
  assert.ok(data.doctorReReferral.doctorPatientPairs >= 1);
  assert.ok(data.journeyReturns.count >= 1);
  assert.ok(data.knowledgeEngagement.articleViews >= 1);
  assert.ok(data.clinicalTrialInterests.submitted >= 1);
  assert.ok(data.patientStories.published >= 1);
  assert.ok(data.papApprovalTime.averageHours !== null);
  assert.ok(data.papApprovalTime.approvedApplications >= 1);
  assert.ok(data.prescriptionQueryRate.queried >= 1);
  assert.ok(data.prescriptionQueryRate.reviewed >= 2);

  const filtered = await request("GET", "/api/v1/admin/analytics/overview?from=2030-01-01T00:00:00Z", await tokenFor(adminId, UserRole.OPS_ADMIN));
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.data.referralConversion.created, 0);
});

test("analytics events are paginated and sensitive metadata is not exposed", async () => {
  const { prisma } = await import("../src/database/prisma");
  const event = await prisma.analyticsEvent.create({ data: { eventName: "KNOWLEDGE_ARTICLE_VIEWED", userId: patientId, entityType: "KNOWLEDGE_ARTICLE", entityId: entityIds[0], metadata: { secret: "must-not-leak" } } });
  eventIds.push(event.id);
  const response = await request("GET", "/api/v1/admin/analytics/events?eventName=KNOWLEDGE_ARTICLE_VIEWED&page=1&pageSize=1", await tokenFor(adminId, UserRole.OPS_ADMIN));
  assert.equal(response.status, 200);
  assert.equal(response.body.data.pagination.pageSize, 1);
  assert.equal(response.body.data.items[0].metadata, undefined);
  assert.equal(response.body.data.items[0].eventName, "KNOWLEDGE_ARTICLE_VIEWED");
});

test("analytics API is OPS_ADMIN-only", async () => {
  assert.equal((await request("GET", "/api/v1/admin/analytics/overview", await tokenFor(patientId, UserRole.PATIENT))).status, 403);
  assert.equal((await request("GET", "/api/v1/admin/analytics/events", await tokenFor(doctorId, UserRole.DOCTOR))).status, 403);
  assert.equal((await request("GET", "/api/v1/admin/analytics/overview?from=invalid", await tokenFor(adminId, UserRole.OPS_ADMIN))).status, 400);
});

test("failed transactions do not retain analytics events and article access records engagement", async () => {
  const { prisma } = await import("../src/database/prisma");
  const { recordAnalyticsEvent } = await import("../src/modules/analytics/analytics.events");
  const failedEntityId = "00000000-0000-4000-8000-000000000001";
  await assert.rejects(() => prisma.$transaction(async (transaction) => {
    await recordAnalyticsEvent(transaction, "REFERRAL_CREATED", { userId: patientId, entityType: "REFERRAL", entityId: failedEntityId });
    throw new Error("rollback");
  }));
  assert.equal(await prisma.analyticsEvent.count({ where: { entityId: failedEntityId } }), 0);
  const articleRecord = await prisma.knowledgeArticle.findFirst({ where: { slug: `${testKey}-article` }, select: { id: true, slug: true } });
  assert.ok(articleRecord);
  const articleId = articleRecord.id;
  const before = await prisma.analyticsEvent.count({ where: { eventName: "KNOWLEDGE_ARTICLE_VIEWED", entityId: articleId } });
  const response = await request("GET", `/api/v1/knowledge/articles/${articleRecord.slug}`, await tokenFor(patientId, UserRole.PATIENT));
  assert.equal(response.status, 200);
  assert.equal(await prisma.analyticsEvent.count({ where: { eventName: "KNOWLEDGE_ARTICLE_VIEWED", entityId: articleId } }), before + 1);
});

async function seedMetrics(prisma: typeof import("../src/database/prisma").prisma) {
  const category = await prisma.productCategory.create({ data: { name: `${testKey} Category`, slug: `${testKey}-category` } });
  const product = await prisma.product.create({ data: { sku: `${testKey}-SKU`, name: `${testKey} Product`, categoryId: category.id, price: new Prisma.Decimal("10.00"), currency: "INR" } });
  const referralOne = await prisma.referral.create({ data: { doctorId, patientId, accessTokenHash: `${testKey}-referral-1`, status: "ORDERED", orderedAt: new Date("2026-09-10T00:00:00Z"), items: { create: { productId: product.id, quantity: 1, productNameSnapshot: product.name } } } });
  const referralTwo = await prisma.referral.create({ data: { doctorId, patientId, accessTokenHash: `${testKey}-referral-2`, status: "SENT", items: { create: { productId: product.id, quantity: 1, productNameSnapshot: product.name } } } });
  entityIds.push(referralOne.id, referralTwo.id);
  const orders = await Promise.all([1, 2].map(() => prisma.order.create({ data: { patientId, originType: "DIRECT_CART", status: "DELIVERED", currency: "INR", subtotal: new Prisma.Decimal("10.00"), deliveryFee: new Prisma.Decimal("0.00"), totalAmount: new Prisma.Decimal("10.00"), items: { create: { productId: product.id, quantity: 1, unitPriceSnapshot: new Prisma.Decimal("10.00"), productNameSnapshot: product.name } } } })));
  entityIds.push(...orders.map((order) => order.id));
  const availability = await prisma.doctorAvailability.create({ data: { doctorId, startsAt: new Date("2026-09-20T10:00:00Z"), endsAt: new Date("2026-09-20T11:00:00Z") } });
  const phoneAvailability = await awaitAvailability(prisma, doctorId);
  const appointments = await Promise.all([prisma.appointment.create({ data: { doctorId, patientId, availabilityId: availability.id, consultationType: "IN_CLINIC", scheduledAt: availability.startsAt, endsAt: availability.endsAt } }), prisma.appointment.create({ data: { doctorId, patientId, availabilityId: phoneAvailability.id, consultationType: "PHONE", scheduledAt: phoneAvailability.startsAt, endsAt: phoneAvailability.endsAt } })]);
  entityIds.push(...appointments.map((appointment) => appointment.id));
  const labTest = await prisma.labTest.create({ data: { name: `${testKey} Lab`, description: "Test", category: "General", price: new Prisma.Decimal("10.00"), currency: "INR" } });
  const labs = await Promise.all(["COMPLETED", "PENDING_OPS"].map((status) => prisma.labBooking.create({ data: { patientId, labTestId: labTest.id, collectionType: "CENTER", preferredDate: new Date("2026-09-20"), status: status as "COMPLETED" | "PENDING_OPS" } })));
  entityIds.push(...labs.map((lab) => lab.id));
  const papProgram = await prisma.pAPProgram.create({ data: { name: `${testKey} PAP`, description: "Program", eligibilityDescription: "Eligibility", requiredDocuments: [] } });
  const papApproved = await prisma.pAPApplication.create({ data: { patientId, papProgramId: papProgram.id, status: "COMPLETED", createdAt: new Date("2026-09-10T00:00:00Z"), reviewedAt: new Date("2026-09-11T00:00:00Z"), reviewedBy: adminId, applicationData: {} } });
  const papSubmitted = await prisma.pAPApplication.create({ data: { patientId, papProgramId: papProgram.id, status: "SUBMITTED", applicationData: {} } });
  entityIds.push(papApproved.id, papSubmitted.id);
  const prescriptionQuery = await prisma.prescription.create({ data: { patientId, source: "PATIENT_UPLOAD", status: "QUERY", documentKey: `${testKey}/query.pdf`, documentName: "query.pdf", mimeType: "application/pdf" } });
  const prescriptionVerified = await prisma.prescription.create({ data: { patientId, source: "PATIENT_UPLOAD", status: "VERIFIED", documentKey: `${testKey}/verified.pdf`, documentName: "verified.pdf", mimeType: "application/pdf" } });
  entityIds.push(prescriptionQuery.id, prescriptionVerified.id);
  const article = await prisma.knowledgeArticle.create({ data: { title: `${testKey} Article`, slug: `${testKey}-article`, category: "GENERAL", summary: "Summary", content: "Content", isPublished: true, publishedAt: new Date(), createdById: adminId } });
  const trial = await prisma.clinicalTrial.create({ data: { title: `${testKey} Trial`, summary: "Summary", description: "Description", source: "OTHER", sourceTrialId: `${testKey}-trial`, isPublished: true, publishedAt: new Date(), createdById: adminId } });
  const interest = await prisma.trialInterest.create({ data: { trialId: trial.id, patientId } });
  const story = await prisma.patientStory.create({ data: { displayName: "Patient", story: "Story", consentGiven: true, status: "APPROVED", isPublished: true, publishedAt: new Date(), createdById: adminId } });
  entityIds.push(article.id, trial.id, interest.id, story.id);
  const { recordAnalyticsEvent } = await import("../src/modules/analytics/analytics.events");
  const events = await Promise.all([
    recordAnalyticsEvent(prisma, "JOURNEY_STAGE_RETURNED", { userId: patientId, entityType: "PATIENT_JOURNEY", entityId: patientId }),
    recordAnalyticsEvent(prisma, "KNOWLEDGE_ARTICLE_VIEWED", { userId: patientId, entityType: "KNOWLEDGE_ARTICLE", entityId: article.id }),
    recordAnalyticsEvent(prisma, "TRIAL_INTEREST_SUBMITTED", { userId: patientId, entityType: "TRIAL_INTEREST", entityId: interest.id })
  ]);
  eventIds.push(...events.map((event) => event.id));
}

async function awaitAvailability(prisma: typeof import("../src/database/prisma").prisma, userId: string) {
  return prisma.doctorAvailability.create({ data: { doctorId: userId, startsAt: new Date("2026-09-21T10:00:00Z"), endsAt: new Date("2026-09-21T11:00:00Z") } });
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
