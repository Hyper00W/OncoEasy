import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import { TestimonialType, UserRole } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config({ override: true });
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://USERNAME:PASSWORD@localhost:5432/DATABASE_NAME?schema=public";
process.env.JWT_ACCESS_SECRET ??= "integration-test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "integration-test-refresh-secret";

let server: Server; let baseUrl: string; let patientId: string; let otherPatientId: string; let adminId: string; let doctorId: string;
const testimonialIds: string[] = []; const testKey = `phase4_1-${Date.now()}`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04]);

before(async () => {
  const { default: app } = await import("../src/app"); const { prisma } = await import("../src/database/prisma");
  const users = await Promise.all([createUser(prisma, "patient", UserRole.PATIENT), createUser(prisma, "other", UserRole.PATIENT), createUser(prisma, "admin", UserRole.OPS_ADMIN), createUser(prisma, "doctor", UserRole.DOCTOR)]);
  [patientId, otherPatientId, adminId, doctorId] = users.map((user) => user.id);
  server = await new Promise<Server>((resolve, reject) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); listener.once("error", reject); });
  const address = server.address(); assert.ok(address && typeof address !== "string"); const { address: host, port } = address as AddressInfo; baseUrl = `http://${host}:${port}`;
});

after(async () => {
  const { prisma } = await import("../src/database/prisma");
  await prisma.testimonial.deleteMany({ where: { id: { in: testimonialIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [patientId, otherPatientId, adminId, doctorId] } } });
  const { resetPrivateStorageProvider } = await import("../src/storage/private-storage");
  resetPrivateStorageProvider();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("admin can create IMAGE and VIDEO testimonials, list, and read them", async () => {
  const image = await request("POST", "/api/v1/admin/testimonials", await tokenFor(adminId, UserRole.OPS_ADMIN), { type: "IMAGE", title: "Anu's recovery story", description: "Care coordination made treatment simpler.", displayName: "Anu K.", displayOrder: 10 });
  const video = await request("POST", "/api/v1/admin/testimonials", await tokenFor(adminId, UserRole.OPS_ADMIN), { type: "VIDEO", title: "Raj's consultation journey", description: "He shares how referrals saved time.", displayName: "Raj S.", displayOrder: 20 });
  assert.equal(image.status, 201); assert.equal(video.status, 201);
  testimonialIds.push(image.body.data.testimonialId, video.body.data.testimonialId);
  assert.equal(image.body.data.published, false); assert.equal(image.body.data.media, null);

  const list = await request("GET", "/api/v1/admin/testimonials", await tokenFor(adminId, UserRole.OPS_ADMIN));
  const detail = await request("GET", `/api/v1/admin/testimonials/${image.body.data.testimonialId}`, await tokenFor(adminId, UserRole.OPS_ADMIN));
  assert.equal(list.status, 200);
  assert.equal(list.body.data.items.some((item: any) => item.testimonialId === image.body.data.testimonialId), true);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.testimonialId, image.body.data.testimonialId);
  assert.equal("mediaStorageKey" in detail.body.data, false);
});

test("media upload validates type, stores privately, and public API exposes temporary access only", async () => {
  const testimonialId = testimonialIds[0];
  const form = new FormData(); form.append("file", new Blob([PNG], { type: "image/png" }), "anu.png");
  const uploaded = await requestForm("POST", `/api/v1/admin/testimonials/${testimonialId}/media?type=IMAGE`, await tokenFor(adminId, UserRole.OPS_ADMIN), form);
  assert.equal(uploaded.status, 201);
  assert.ok(uploaded.body.data.media.documentName === "anu.png");
  assert.equal(uploaded.body.data.media.access, undefined);

  const { prisma } = await import("../src/database/prisma");
  const record = await prisma.testimonial.findUnique({ where: { id: testimonialId } });
  assert.ok(record?.mediaStorageKey?.startsWith("testimonials/"));

  const videoForm = new FormData(); videoForm.append("file", new Blob([WEBM], { type: "video/webm" }), "story.webm");
  const mismatch = await requestForm("POST", `/api/v1/admin/testimonials/${testimonialId}/media?type=IMAGE`, await tokenFor(adminId, UserRole.OPS_ADMIN), videoForm);
  assert.equal(mismatch.status, 400); assert.equal(mismatch.body.error.code, "UNSUPPORTED_FILE_TYPE");

  const publishWithoutMedia = await request("POST", "/api/v1/admin/testimonials", await tokenFor(adminId, UserRole.OPS_ADMIN), { type: "VIDEO", title: "No media yet", description: "Empty.", displayName: "T.", displayOrder: 5, published: true });
  assert.equal(publishWithoutMedia.status, 409); assert.equal(publishWithoutMedia.body.error.code, "TESTIMONIAL_MEDIA_REQUIRED");
  await prisma.testimonial.delete({ where: { id: publishWithoutMedia.body.data?.testimonialId ?? "" } }).catch(() => undefined);
});

test("public API returns only published testimonials in displayOrder and with temporary access", async () => {
  const published = await request("PATCH", `/api/v1/admin/testimonials/${testimonialIds[0]}`, await tokenFor(adminId, UserRole.OPS_ADMIN), { published: true });
  assert.equal(published.status, 200); assert.equal(published.body.data.published, true); assert.ok(published.body.data.publishedAt);

  const publicList = await request("GET", "/api/v1/testimonials");
  assert.equal(publicList.status, 200);
  const items = publicList.body.data.items as Array<Record<string, unknown>>;
  assert.equal(items.length >= 1, true);
  assert.equal(items.some((item) => item.testimonialId === testimonialIds[0]), true);
  assert.equal((items as any[]).every((item) => item.published === true), true);
  const media = items.find((item) => item.testimonialId === testimonialIds[0])?.media as any;
  assert.ok(media?.access?.reference?.startsWith("private://"));
  assert.equal("mediaStorageKey" in items[0], false);

  const detail = await request("GET", `/api/v1/testimonials/${testimonialIds[0]}`);
  assert.equal(detail.status, 404); // no public detail endpoint exists

  const unpublished = await request("GET", `/api/v1/testimonials/${testimonialIds[1]}`);
  assert.equal(unpublished.status, 404);
});

test("unpublished testimonials are excluded from public listing even with media", async () => {
  const form = new FormData(); form.append("file", new Blob([WEBM], { type: "video/webm" }), "raj.webm");
  const uploaded = await requestForm("POST", `/api/v1/admin/testimonials/${testimonialIds[1]}/media?type=VIDEO`, await tokenFor(adminId, UserRole.OPS_ADMIN), form);
  assert.equal(uploaded.status, 201);
  const publicList = await request("GET", "/api/v1/testimonials");
  const items = publicList.body.data.items as Array<Record<string, unknown>>;
  assert.equal(items.some((item) => item.testimonialId === testimonialIds[1]), false);
});

test("displayOrder drives public ordering and update supports reordering and unpublish", async () => {
  const reorder = await request("PATCH", `/api/v1/admin/testimonials/${testimonialIds[1]}`, await tokenFor(adminId, UserRole.OPS_ADMIN), { displayOrder: 5 });
  assert.equal(reorder.status, 200); assert.equal(reorder.body.data.displayOrder, 5);

  const publishSecond = await request("PATCH", `/api/v1/admin/testimonials/${testimonialIds[1]}`, await tokenFor(adminId, UserRole.OPS_ADMIN), { published: true });
  assert.equal(publishSecond.status, 200);

  const publicList = await request("GET", "/api/v1/testimonials");
  const items = publicList.body.data.items as Array<{ testimonialId: string; displayOrder: number }>;
  const ordered = items.filter((item) => item.testimonialId === testimonialIds[0] || item.testimonialId === testimonialIds[1]);
  assert.equal(ordered.length, 2);
  assert.ok(ordered[0].displayOrder <= ordered[1].displayOrder);

  const unpublish = await request("PATCH", `/api/v1/admin/testimonials/${testimonialIds[1]}`, await tokenFor(adminId, UserRole.OPS_ADMIN), { published: false });
  assert.equal(unpublish.body.data.published, false);
  const after = await request("GET", "/api/v1/testimonials");
  assert.equal((after.body.data.items as any[]).some((item) => item.testimonialId === testimonialIds[1]), false);
});

test("non-admin roles cannot create, update, delete, or upload testimonial media", async () => {
  const unauthenticated = await request("POST", "/api/v1/admin/testimonials", undefined, { type: "IMAGE", title: "x", description: "y", displayName: "z" });
  const patientCreate = await request("POST", "/api/v1/admin/testimonials", await tokenFor(patientId, UserRole.PATIENT), { type: "IMAGE", title: "x", description: "y", displayName: "z" });
  const doctorList = await request("GET", "/api/v1/admin/testimonials", await tokenFor(doctorId, UserRole.DOCTOR));
  const patientUpdate = await request("PATCH", `/api/v1/admin/testimonials/${testimonialIds[0]}`, await tokenFor(patientId, UserRole.PATIENT), { title: "hijack" });
  const patientDelete = await request("DELETE", `/api/v1/admin/testimonials/${testimonialIds[0]}`, await tokenFor(patientId, UserRole.PATIENT));
  const patientUpload = await requestForm("POST", `/api/v1/admin/testimonials/${testimonialIds[0]}/media?type=IMAGE`, await tokenFor(patientId, UserRole.PATIENT), new FormData());
  const publicWrite = await request("DELETE", `/api/v1/testimonials/${testimonialIds[0]}`);
  assert.equal(unauthenticated.status, 401);
  assert.equal(patientCreate.status, 403);
  assert.equal(doctorList.status, 403);
  assert.equal(patientUpdate.status, 403);
  assert.equal(patientDelete.status, 403);
  assert.equal(patientUpload.status, 403);
  // The public router exposes no write methods at all: the request falls through to 404.
  assert.equal(publicWrite.status, 404);
});

test("validation failures: bad payloads and unknown ids", async () => {
  const invalid = await request("POST", "/api/v1/admin/testimonials", await tokenFor(adminId, UserRole.OPS_ADMIN), { type: "AUDIO", title: "", description: "", displayName: "" });
  assert.equal(invalid.status, 400); assert.equal(invalid.body.error.code, "VALIDATION_ERROR");
  const missing = await request("PATCH", `/api/v1/admin/testimonials/${crypto.randomUUID()}`, await tokenFor(adminId, UserRole.OPS_ADMIN), { title: "Ghost" });
  assert.equal(missing.status, 404); assert.equal(missing.body.error.code, "TESTIMONIAL_NOT_FOUND");
  const deleteMissing = await request("DELETE", `/api/v1/admin/testimonials/${crypto.randomUUID()}`, await tokenFor(adminId, UserRole.OPS_ADMIN));
  assert.equal(deleteMissing.status, 404);
});

test("delete removes the testimonial record", async () => {
  const created = await request("POST", "/api/v1/admin/testimonials", await tokenFor(adminId, UserRole.OPS_ADMIN), { type: "IMAGE", title: "To delete", description: "Temp.", displayName: "Temp T.", displayOrder: 999 });
  const id = created.body.data.testimonialId as string; testimonialIds.push(id);
  const removed = await request("DELETE", `/api/v1/admin/testimonials/${id}`, await tokenFor(adminId, UserRole.OPS_ADMIN));
  assert.equal(removed.status, 200); assert.equal(removed.body.data.deleted, true);
  const gone = await request("GET", `/api/v1/admin/testimonials/${id}`, await tokenFor(adminId, UserRole.OPS_ADMIN));
  assert.equal(gone.status, 404);
});

test("media delivery streams private media through the backend in development", async () => {
  const testimonial = await request("POST", "/api/v1/admin/testimonials", await tokenFor(adminId, UserRole.OPS_ADMIN), { type: "IMAGE", title: "Delivery image", description: "Media delivery check.", displayName: "D. Ima", displayOrder: 700 });
  const id = testimonial.body.data.testimonialId as string; testimonialIds.push(id);
  await uploadMediaFile(id, "IMAGE", PNG, "delivery.png", "image/png");
  await request("PATCH", `/api/v1/admin/testimonials/${id}`, await tokenFor(adminId, UserRole.OPS_ADMIN), { published: true });

  const listing = await request("GET", "/api/v1/testimonials?pageSize=100");
  const item = (listing.body.data.items as any[]).find((entry) => entry.testimonialId === id);
  assert.ok(item.media.deliveryUrl.startsWith(`/api/v1/testimonials/${id}/media`));
  assert.equal("mediaStorageKey" in item.media, false);
  assert.equal("mediaStorageKey" in item, false);

  const media = await fetch(`${baseUrl}${item.media.deliveryUrl}`);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get("content-type"), "image/png");
  // Cross-origin <img>/<video> loads must not be blocked by Helmet's default CORP header.
  assert.equal(media.headers.get("cross-origin-resource-policy"), "cross-origin");
  assert.equal(media.headers.get("content-disposition")?.startsWith("inline"), true);
  const bytes = Buffer.from(await media.arrayBuffer());
  assert.equal(bytes.subarray(0, 8).equals(PNG), true);
  assert.equal(media.redirected, false); // development streams; it never exposes a private:// URL
});

test("video media delivery serves the correct content type and bytes", async () => {
  const testimonial = await request("POST", "/api/v1/admin/testimonials", await tokenFor(adminId, UserRole.OPS_ADMIN), { type: "VIDEO", title: "Delivery video", description: "Media delivery check.", displayName: "D. Video", displayOrder: 710 });
  const id = testimonial.body.data.testimonialId as string; testimonialIds.push(id);
  await uploadMediaFile(id, "VIDEO", WEBM, "delivery.webm", "video/webm");
  await request("PATCH", `/api/v1/admin/testimonials/${id}`, await tokenFor(adminId, UserRole.OPS_ADMIN), { published: true });

  const media = await fetch(`${baseUrl}/api/v1/testimonials/${id}/media`);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get("content-type"), "video/webm");
  assert.equal(Buffer.from(await media.arrayBuffer()).subarray(0, 4).equals(WEBM.subarray(0, 4)), true);
});

test("unpublished, unknown, and malformed media requests are rejected", async () => {
  const hidden = await request("POST", "/api/v1/admin/testimonials", await tokenFor(adminId, UserRole.OPS_ADMIN), { type: "IMAGE", title: "Hidden media", description: "Not published.", displayName: "H. Media", displayOrder: 720 });
  const hiddenId = hidden.body.data.testimonialId as string; testimonialIds.push(hiddenId);
  await uploadMediaFile(hiddenId, "IMAGE", PNG, "hidden.png", "image/png");

  const publicHidden = await request("GET", `/api/v1/testimonials/${hiddenId}/media`);
  assert.equal(publicHidden.status, 404);
  assert.equal(publicHidden.body.error.code, "TESTIMONIAL_MEDIA_NOT_FOUND");

  const adminHidden = await fetch(`${baseUrl}/api/v1/admin/testimonials/${hiddenId}/media`, { headers: { Authorization: `Bearer ${await tokenFor(adminId, UserRole.OPS_ADMIN)}` } });
  assert.equal(adminHidden.status, 200); // admin preview works before publishing

  const noMedia = await request("POST", "/api/v1/admin/testimonials", await tokenFor(adminId, UserRole.OPS_ADMIN), { type: "IMAGE", title: "No media", description: "Media never uploaded.", displayName: "N. Media", displayOrder: 730 });
  testimonialIds.push(noMedia.body.data.testimonialId as string);
  const emptyMedia = await request("GET", `/api/v1/admin/testimonials/${noMedia.body.data.testimonialId}/media`, await tokenFor(adminId, UserRole.OPS_ADMIN));
  assert.equal(emptyMedia.status, 404);

  const unknown = await request("GET", "/api/v1/testimonials/00000000-0000-4000-8000-000000000000/media");
  assert.equal(unknown.status, 404);
  const malformed = await request("GET", "/api/v1/testimonials/not-a-uuid/media");
  assert.equal(malformed.status, 400);
});

test("media endpoints enforce RBAC and never leak storage keys", async () => {
  const testimonial = testimonialIds[0];
  const anonymous = await request("GET", `/api/v1/admin/testimonials/${testimonial}/media`);
  const patient = await request("GET", `/api/v1/admin/testimonials/${testimonial}/media`, await tokenFor(patientId, UserRole.PATIENT));
  const doctor = await request("GET", `/api/v1/admin/testimonials/${testimonial}/media`, await tokenFor(doctorId, UserRole.DOCTOR));
  assert.equal(anonymous.status, 401);
  assert.equal(patient.status, 403);
  assert.equal(doctor.status, 403);

  const adminListing = await request("GET", "/api/v1/admin/testimonials", await tokenFor(adminId, UserRole.OPS_ADMIN));
  assert.equal(JSON.stringify(adminListing.body).includes("mediaStorageKey"), false);
  assert.equal(JSON.stringify(adminListing.body).includes("private://"), false);
});

test("replacing media deletes the previous object and the listing survives a broken object", async () => {
  const { AppError } = await import("../src/errors/app-error");
  const { setPrivateStorageProvider, resetPrivateStorageProvider } = await import("../src/storage/private-storage");
  const { prisma } = await import("../src/database/prisma");

  // Self-contained in-memory provider so deletes and missing objects are observable.
  const store = new Map<string, { body: Buffer; contentType: string }>();
  const deletedKeys: string[] = [];
  setPrivateStorageProvider({
    upload: async (input) => { store.set(input.key, { body: input.body, contentType: input.contentType }); return { key: input.key }; },
    delete: async (key) => { deletedKeys.push(key); store.delete(key); },
    read: async (key) => {
      const object = store.get(key);
      if (!object) throw new AppError(404, "STORAGE_OBJECT_NOT_FOUND", "Private object was not found");
      return object;
    }
  });

  try {
    const created = await request("POST", "/api/v1/admin/testimonials", await tokenFor(adminId, UserRole.OPS_ADMIN), { type: "IMAGE", title: "Replaced media", description: "Replacement check.", displayName: "R. Place", displayOrder: 740 });
    const id = created.body.data.testimonialId as string; testimonialIds.push(id);

    await uploadMediaFile(id, "IMAGE", PNG, "first.png", "image/png");
    const firstKey = (await prisma.testimonial.findUnique({ where: { id } }))?.mediaStorageKey as string;
    assert.ok(firstKey);

    await uploadMediaFile(id, "IMAGE", PNG, "second.png", "image/png");
    const replaced = await prisma.testimonial.findUnique({ where: { id } });
    assert.notEqual(replaced?.mediaStorageKey, firstKey);
    assert.equal(deletedKeys.includes(firstKey), true);
    assert.equal(store.has(firstKey), false); // previous object is gone

    // Stored-but-missing object: delivery 404s, but the listing still renders the card.
    store.delete(replaced?.mediaStorageKey as string);
    await prisma.testimonial.update({ where: { id }, data: { published: true } });
    const missing = await request("GET", `/api/v1/testimonials/${id}/media`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "STORAGE_OBJECT_NOT_FOUND");
    const listing = await request("GET", "/api/v1/testimonials?pageSize=100");
    assert.equal(listing.status, 200);
    const item = (listing.body.data.items as any[]).find((entry) => entry.testimonialId === id);
    assert.ok(item);
    assert.equal(item.media.access, null); // a failed temporary reference is contained per card

    // Deleting the testimonial removes its media reference entirely.
    const removed = await request("DELETE", `/api/v1/admin/testimonials/${id}`, await tokenFor(adminId, UserRole.OPS_ADMIN));
    assert.equal(removed.status, 200);
    const gone = await request("GET", `/api/v1/admin/testimonials/${id}/media`, await tokenFor(adminId, UserRole.OPS_ADMIN));
    assert.equal(gone.status, 404);
  } finally {
    resetPrivateStorageProvider();
  }
});

test("a provider without read or temporary access reports a safe unavailable error", async () => {
  const { setPrivateStorageProvider, resetPrivateStorageProvider } = await import("../src/storage/private-storage");
  const testimonial = await request("POST", "/api/v1/admin/testimonials", await tokenFor(adminId, UserRole.OPS_ADMIN), { type: "IMAGE", title: "Capability probe", description: "Provider capability check.", displayName: "C. Probe", displayOrder: 750 });
  const id = testimonial.body.data.testimonialId as string; testimonialIds.push(id);
  await uploadMediaFile(id, "IMAGE", PNG, "probe.png", "image/png");

  setPrivateStorageProvider({ upload: async (input) => ({ key: input.key }), delete: async () => undefined });
  try {
    const response = await request("GET", `/api/v1/admin/testimonials/${id}/media`, await tokenFor(adminId, UserRole.OPS_ADMIN));
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, "STORAGE_READ_UNAVAILABLE");
    assert.equal(JSON.stringify(response.body).includes("private://"), false);
  } finally {
    resetPrivateStorageProvider();
  }
});

test("public ordering is deterministic when displayOrder and createdAt tie", async () => {
  const { prisma } = await import("../src/database/prisma");
  const at = new Date();
  const created: string[] = [];
  for (const name of ["Tie A", "Tie B", "Tie C"]) {
    const testimonial = await prisma.testimonial.create({
      data: { type: "IMAGE", title: `${name} ${testKey}`, description: "Deterministic ordering check.", displayName: "Tie Tester", displayOrder: 500, published: true, publishedAt: at, createdAt: at, mediaStorageKey: null }
    });
    created.push(testimonial.id); testimonialIds.push(testimonial.id);
  }

  const first = await request("GET", "/api/v1/testimonials?pageSize=100");
  const second = await request("GET", "/api/v1/testimonials?pageSize=100");
  const idsOf = (body: Record<string, any>) => (body.data.items as any[]).map((item) => item.testimonialId);
  const tied = idsOf(first.body).filter((id: string) => created.includes(id)).slice().sort();
  assert.deepEqual(created.slice().sort(), tied); // all three present
  assert.equal(idsOf(first.body).join(","), idsOf(second.body).join(",")); // stable across requests

  const tiedInOrder = idsOf(first.body).filter((id: string) => created.includes(id));
  assert.deepEqual(tiedInOrder, [...created].sort()); // id ascending tiebreaker
});

test("content validation rejects meaningless copy and invalid display order", async () => {
  const token = await tokenFor(adminId, UserRole.OPS_ADMIN);
  const blankTitle = await request("POST", "/api/v1/admin/testimonials", token, { type: "IMAGE", title: "   ", description: "Real description.", displayName: "Valid Name" });
  const punctuationTitle = await request("POST", "/api/v1/admin/testimonials", token, { type: "IMAGE", title: "---", description: "Real description.", displayName: "Valid Name" });
  const blankName = await request("POST", "/api/v1/admin/testimonials", token, { type: "IMAGE", title: "Valid title", description: "Real description.", displayName: "  " });
  const negativeOrder = await request("POST", "/api/v1/admin/testimonials", token, { type: "IMAGE", title: "Valid title", description: "Real description.", displayName: "Valid Name", displayOrder: -5 });
  const fractionalOrder = await request("POST", "/api/v1/admin/testimonials", token, { type: "IMAGE", title: "Valid title", description: "Real description.", displayName: "Valid Name", displayOrder: 1.5 });
  for (const response of [blankTitle, punctuationTitle, blankName, negativeOrder, fractionalOrder]) {
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "VALIDATION_ERROR");
  }

  const created = await request("POST", "/api/v1/admin/testimonials", token, { type: "IMAGE", title: "Valid title", description: "Real description.", displayName: "Valid Name", displayOrder: 0 });
  const id = created.body.data.testimonialId as string; testimonialIds.push(id);
  const badOrder = await request("PATCH", `/api/v1/admin/testimonials/${id}`, token, { displayOrder: -1 });
  const blankTitleUpdate = await request("PATCH", `/api/v1/admin/testimonials/${id}`, token, { title: "..." });
  const noFields = await request("PATCH", `/api/v1/admin/testimonials/${id}`, token, {});
  assert.equal(badOrder.status, 400);
  assert.equal(blankTitleUpdate.status, 400);
  assert.equal(noFields.status, 400);
});

test("display order updates are respected and delete removes the testimonial from the public listing", async () => {
  const token = await tokenFor(adminId, UserRole.OPS_ADMIN);
  const first = await request("POST", "/api/v1/admin/testimonials", token, { type: "IMAGE", title: "Order first", description: "Ordering check.", displayName: "Order One", displayOrder: 100 });
  const second = await request("POST", "/api/v1/admin/testimonials", token, { type: "IMAGE", title: "Order second", description: "Ordering check.", displayName: "Order Two", displayOrder: 200 });
  const firstId = first.body.data.testimonialId as string; const secondId = second.body.data.testimonialId as string;
  testimonialIds.push(firstId, secondId);
  await uploadMediaFile(firstId, "IMAGE", PNG, "order-first.png", "image/png");
  await uploadMediaFile(secondId, "IMAGE", PNG, "order-second.png", "image/png");
  await request("PATCH", `/api/v1/admin/testimonials/${firstId}`, token, { published: true });
  await request("PATCH", `/api/v1/admin/testimonials/${secondId}`, token, { published: true });

  const before = await request("GET", "/api/v1/testimonials?pageSize=100");
  const orderedIds = (before.body.data.items as any[]).map((item) => item.testimonialId).filter((id: string) => [firstId, secondId].includes(id));
  assert.deepEqual(orderedIds, [firstId, secondId]);

  // Swap the orders and confirm the public listing follows.
  const swapped = await request("PATCH", `/api/v1/admin/testimonials/${firstId}`, token, { displayOrder: 300 });
  assert.equal(swapped.status, 200); assert.equal(swapped.body.data.displayOrder, 300);
  const after = await request("GET", "/api/v1/testimonials?pageSize=100");
  const swappedIds = (after.body.data.items as any[]).map((item) => item.testimonialId).filter((id: string) => [firstId, secondId].includes(id));
  assert.deepEqual(swappedIds, [secondId, firstId]);

  const removed = await request("DELETE", `/api/v1/admin/testimonials/${secondId}`, token);
  assert.equal(removed.status, 200);
  const listing = await request("GET", "/api/v1/testimonials?pageSize=100");
  assert.equal((listing.body.data.items as any[]).some((item) => item.testimonialId === secondId), false);
  const adminListing = await request("GET", "/api/v1/admin/testimonials", token);
  assert.equal((adminListing.body.data.items as any[]).some((item) => item.testimonialId === secondId), false);
});

async function uploadMediaFile(id: string, type: "IMAGE" | "VIDEO", bytes: Buffer, fileName: string, mimeType: string) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), fileName);
  const response = await requestForm("POST", `/api/v1/admin/testimonials/${id}/media?type=${type}`, await tokenFor(adminId, UserRole.OPS_ADMIN), form);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response;
}

async function createUser(prisma: typeof import("../src/database/prisma").prisma, name: string, role: UserRole) { return prisma.user.create({ data: { fullName: `${testKey} ${name}`, email: `${testKey}-${name}@example.com`, phone: `+1555${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`, role, isVerified: true } }); }
async function tokenFor(userId: string, role = UserRole.PATIENT) { const { generateAccessToken } = await import("../src/services/jwt"); return generateAccessToken({ userId, role }); }
async function request(method: string, path: string, token?: string, body?: Record<string, unknown>) { const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const text = await response.text(); const parsed = text.startsWith("<") ? { raw: text } : JSON.parse(text); return { status: response.status, body: parsed as Record<string, any> }; }
async function requestForm(method: string, path: string, token: string, body: FormData) { const response = await fetch(`${baseUrl}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, body }); return { status: response.status, body: await response.json() as Record<string, any> }; }
