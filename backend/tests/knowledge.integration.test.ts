import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import { KnowledgeArticleCategory, UserRole } from "@prisma/client";
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
let patientId: string;
let adminId: string;
let doctorId: string;
const articleIds: string[] = [];
const testKey = `phase1_13-${Date.now()}`;

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");
  const users = await Promise.all([
    createUser(prisma, "patient", UserRole.PATIENT),
    createUser(prisma, "admin", UserRole.OPS_ADMIN),
    createUser(prisma, "doctor", UserRole.DOCTOR)
  ]);
  [patientId, adminId, doctorId] = users.map((user) => user.id);
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
  await prisma.knowledgeArticle.deleteMany({ where: { id: { in: articleIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [patientId, adminId, doctorId] } } });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("patient can list, filter, search, paginate, and retrieve published articles", async () => {
  const publishedDisease = await createArticle({ title: "Understanding supportive care", slug: "supportive-care", category: KnowledgeArticleCategory.DISEASE, isPublished: true });
  const publishedTreatment = await createArticle({ title: "Treatment planning basics", slug: "treatment-planning-basics", category: KnowledgeArticleCategory.TREATMENT, isPublished: true });
  await createArticle({ title: "Draft research notes", slug: "draft-research-notes", category: KnowledgeArticleCategory.RESEARCH, isPublished: false });

  const list = await request("GET", "/api/v1/knowledge/articles?page=1&pageSize=1", await tokenFor(patientId));
  const category = await request("GET", "/api/v1/knowledge/articles?category=DISEASE", await tokenFor(patientId));
  const search = await request("GET", "/api/v1/knowledge/articles?search=supportive", await tokenFor(patientId));
  const detail = await request("GET", `/api/v1/knowledge/articles/${publishedDisease.slug}`, await tokenFor(patientId));
  assert.equal(list.status, 200);
  assert.equal(list.body.data.pagination.total, 2);
  assert.equal(list.body.data.items.length, 1);
  assert.equal(category.body.data.items.length, 1);
  assert.equal(category.body.data.items[0].articleId, publishedDisease.id);
  assert.equal(search.body.data.items[0].articleId, publishedDisease.id);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.content.includes("generic educational"), true);
  assert.equal(detail.body.data.articleId, publishedDisease.id);
  assert.equal(publishedTreatment.category, KnowledgeArticleCategory.TREATMENT);
});

test("patients cannot see unpublished articles", async () => {
  const draft = await createArticle({ title: "Private draft", slug: "private-draft", category: KnowledgeArticleCategory.GENERAL, isPublished: false });
  const list = await request("GET", "/api/v1/knowledge/articles", await tokenFor(patientId));
  const detail = await request("GET", `/api/v1/knowledge/articles/${draft.slug}`, await tokenFor(patientId));
  assert.equal(list.body.data.items.some((item: { articleId: string }) => item.articleId === draft.id), false);
  assert.equal(detail.status, 404);
  assert.equal(detail.body.error.code, "KNOWLEDGE_ARTICLE_NOT_FOUND");
});

test("admin can list drafts, create, edit, publish, and unpublish articles", async () => {
  const adminList = await request("GET", "/api/v1/admin/knowledge/articles", await tokenFor(adminId, UserRole.OPS_ADMIN));
  const created = await request("POST", "/api/v1/admin/knowledge/articles", await tokenFor(adminId, UserRole.OPS_ADMIN), articleInput({ slug: "admin-created-article" }));
  const articleId = created.body.data.articleId as string;
  articleIds.push(articleId);
  const adminListAfterCreate = await request("GET", "/api/v1/admin/knowledge/articles?isPublished=false", await tokenFor(adminId, UserRole.OPS_ADMIN));
  const updated = await request("PATCH", `/api/v1/admin/knowledge/articles/${articleId}`, await tokenFor(adminId, UserRole.OPS_ADMIN), { title: "Edited article title", content: "Edited educational content" });
  const published = await request("PATCH", `/api/v1/admin/knowledge/articles/${articleId}/publish`, await tokenFor(adminId, UserRole.OPS_ADMIN), { isPublished: true });
  const visible = await request("GET", `/api/v1/knowledge/articles/admin-created-article`, await tokenFor(patientId));
  const unpublished = await request("PATCH", `/api/v1/admin/knowledge/articles/${articleId}/publish`, await tokenFor(adminId, UserRole.OPS_ADMIN), { isPublished: false });
  const hidden = await request("GET", `/api/v1/knowledge/articles/admin-created-article`, await tokenFor(patientId));
  const { prisma } = await import("../src/database/prisma");
  const record = await prisma.knowledgeArticle.findUnique({ where: { id: articleId } });
  assert.equal(adminList.status, 200);
  assert.equal(created.status, 201);
  assert.equal(created.body.data.isPublished, false);
  assert.equal(adminListAfterCreate.body.data.items.some((item: { articleId: string }) => item.articleId === articleId), true);
  assert.equal(created.body.data.createdBy.userId, adminId);
  assert.equal(updated.body.data.title, "Edited article title");
  assert.equal(updated.body.data.updatedBy.userId, adminId);
  assert.equal(published.body.data.isPublished, true);
  assert.equal(visible.status, 200);
  assert.equal(unpublished.body.data.isPublished, false);
  assert.equal(hidden.status, 404);
  assert.equal(record?.createdById, adminId);
  assert.equal(record?.updatedById, adminId);
});

test("duplicate slugs and invalid payloads are rejected", async () => {
  const first = await request("POST", "/api/v1/admin/knowledge/articles", await tokenFor(adminId, UserRole.OPS_ADMIN), articleInput({ slug: "unique-slug" }));
  articleIds.push(first.body.data.articleId);
  const duplicate = await request("POST", "/api/v1/admin/knowledge/articles", await tokenFor(adminId, UserRole.OPS_ADMIN), articleInput({ slug: "unique-slug" }));
  const invalidCategory = await request("POST", "/api/v1/admin/knowledge/articles", await tokenFor(adminId, UserRole.OPS_ADMIN), { ...articleInput({ slug: "bad-category" }), category: "INVALID" });
  const invalidSlug = await request("POST", "/api/v1/admin/knowledge/articles", await tokenFor(adminId, UserRole.OPS_ADMIN), articleInput({ slug: "Not Valid" }));
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, "KNOWLEDGE_ARTICLE_SLUG_CONFLICT");
  assert.equal(invalidCategory.status, 400);
  assert.equal(invalidCategory.body.error.code, "VALIDATION_ERROR");
  assert.equal(invalidSlug.status, 400);
  assert.equal(invalidSlug.body.error.code, "VALIDATION_ERROR");
});

test("patient and unauthorized roles cannot access admin knowledge endpoints", async () => {
  const unauthenticated = await request("GET", "/api/v1/knowledge/articles");
  const patientAdmin = await request("GET", "/api/v1/admin/knowledge/articles", await tokenFor(patientId));
  const doctorAdmin = await request("GET", "/api/v1/admin/knowledge/articles", await tokenFor(doctorId, UserRole.DOCTOR));
  assert.equal(unauthenticated.status, 401);
  assert.equal(patientAdmin.status, 403);
  assert.equal(doctorAdmin.status, 403);
});

async function createArticle(input: { title: string; slug: string; category: KnowledgeArticleCategory; isPublished: boolean }) {
  const { prisma } = await import("../src/database/prisma");
  const article = await prisma.knowledgeArticle.create({ data: { ...articleInput(input), createdById: adminId, updatedById: adminId, publishedAt: input.isPublished ? new Date() : null } });
  articleIds.push(article.id);
  return article;
}

function articleInput(input: { slug: string; title?: string; category?: KnowledgeArticleCategory; isPublished?: boolean }) {
  return { title: input.title ?? "Curated knowledge article", slug: input.slug, category: input.category ?? KnowledgeArticleCategory.GENERAL, summary: "A concise educational summary.", content: "This is generic educational content for the OncoEasy Knowledge Bank.", ...(input.isPublished === undefined ? {} : { isPublished: input.isPublished }) };
}

async function createUser(prisma: typeof import("../src/database/prisma").prisma, name: string, role: UserRole) {
  return prisma.user.create({ data: { fullName: `${testKey} ${name}`, email: `${testKey}-${name}@example.com`, phone: `+1555${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`, role, isVerified: true } });
}

async function tokenFor(userId: string, role = UserRole.PATIENT) {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function request(method: string, path: string, token?: string, body?: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() as Record<string, any> };
}
