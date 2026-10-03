import type { RequestHandler, Response } from "express";

import { createTestimonial, deleteTestimonial, getAdminTestimonial, getTestimonialMedia, listAdminTestimonials, listPublishedTestimonials, updateTestimonial, uploadTestimonialMedia } from "./testimonials.service";
import type { CreateTestimonialInput, TestimonialListQuery, UpdateTestimonialInput } from "./testimonials.schemas";

export const listPublished: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await listPublishedTestimonials(request.query as unknown as TestimonialListQuery) }); } catch (error) { next(error); } };
export const listAdmin: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await listAdminTestimonials(request.query as unknown as TestimonialListQuery) }); } catch (error) { next(error); } };
export const getAdmin: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await getAdminTestimonial(request.params.testimonialId as string) }); } catch (error) { next(error); } };
export const create: RequestHandler = async (request, response, next) => { try { response.status(201).json({ success: true, data: await createTestimonial(request.user?.userId as string, request.body as CreateTestimonialInput) }); } catch (error) { next(error); } };
export const update: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await updateTestimonial(request.user?.userId as string, request.params.testimonialId as string, request.body as UpdateTestimonialInput) }); } catch (error) { next(error); } };
export const remove: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await deleteTestimonial(request.user?.userId as string, request.params.testimonialId as string) }); } catch (error) { next(error); } };
export const uploadMedia: RequestHandler = async (request, response, next) => { try { response.status(201).json({ success: true, data: await uploadTestimonialMedia(request.user?.userId as string, request.params.testimonialId as string, request.query.type as "IMAGE" | "VIDEO", request.file) }); } catch (error) { next(error); } };
export const getPublicMedia: RequestHandler = async (request, response, next) => { try { await sendMedia(response, await getTestimonialMedia(request.params.testimonialId as string, { publicOnly: true })); } catch (error) { next(error); } };
export const getAdminMedia: RequestHandler = async (request, response, next) => { try { await sendMedia(response, await getTestimonialMedia(request.params.testimonialId as string, { publicOnly: false })); } catch (error) { next(error); } };

async function sendMedia(response: Response, delivery: Awaited<ReturnType<typeof getTestimonialMedia>>) {
  // Media is loaded by <img>/<video> from the frontend origin, which is a different
  // origin in development and in production deployments. Helmet's default
  // `Cross-Origin-Resource-Policy: same-origin` would block those loads, so the
  // delivery responses (and the redirect to the provider's signed URL) opt out.
  response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

  if (delivery.kind === "redirect") {
    // Production: the provider's short-lived signed URL is served straight to the browser.
    response.redirect(302, delivery.url);
    return;
  }

  // Development: stream the object through the backend. Keys and credentials stay server-side.
  response.setHeader("Content-Type", delivery.contentType);
  response.setHeader("Content-Length", delivery.body.length);
  response.setHeader("Content-Disposition", `inline; filename="${delivery.documentName}"`);
  response.setHeader("Cache-Control", "private, max-age=300");
  response.status(200).end(delivery.body);
}
