import { z } from "zod";

const typeSchema = z.enum(["IMAGE", "VIDEO"]);
const booleanQuerySchema = z.enum(["true", "false"]).transform((value) => value === "true");

// Public-facing copy must be real content: non-blank and containing at least one
// letter or digit (so punctuation/whitespace-only values are rejected).
const meaningfulText = (max: number) =>
  z.string().trim().min(2).max(max).regex(/[A-Za-z0-9]/, "This field needs actual content");

export const testimonialListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  type: typeSchema.optional(),
  published: booleanQuerySchema.optional()
}).strict();

export const testimonialIdParamsSchema = z.object({ testimonialId: z.string().uuid() });
export const testimonialMediaQuerySchema = z.object({ type: typeSchema });

export const createTestimonialSchema = z.object({
  type: typeSchema,
  title: meaningfulText(140),
  description: z.string().trim().min(2).max(4000).regex(/[A-Za-z0-9]/, "This field needs actual content"),
  displayName: meaningfulText(120),
  displayOrder: z.number().int().min(0).max(100000).optional().default(0),
  published: z.boolean().optional().default(false)
}).strict();

export const updateTestimonialSchema = z.object({
  title: meaningfulText(140).optional(),
  description: z.string().trim().min(2).max(4000).regex(/[A-Za-z0-9]/, "This field needs actual content").optional(),
  displayName: meaningfulText(120).optional(),
  displayOrder: z.number().int().min(0).max(100000).optional(),
  published: z.boolean().optional(),
  type: typeSchema.optional()
}).strict().refine((value) => Object.keys(value).length > 0, { message: "At least one testimonial field is required" });

export type TestimonialListQuery = z.infer<typeof testimonialListQuerySchema>;
export type CreateTestimonialInput = z.infer<typeof createTestimonialSchema>;
export type UpdateTestimonialInput = z.infer<typeof updateTestimonialSchema>;
