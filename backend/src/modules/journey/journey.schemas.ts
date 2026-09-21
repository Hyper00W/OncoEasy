import { z } from "zod";

export const journeyStageParamSchema = z.object({
  stage: z.enum(["DIAGNOSED", "TREATMENT_PLANNING", "ACTIVE_TREATMENT", "FOLLOW_UP"])
});

export const updateJourneyStageSchema = z.object({
  stage: z.enum(["DIAGNOSED", "TREATMENT_PLANNING", "ACTIVE_TREATMENT", "FOLLOW_UP"])
}).strict();

export const updateJourneyContentSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(4000).optional(),
  checklist: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
  isActive: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one stage content field is required"
});

export type JourneyStageKeyInput = z.infer<typeof journeyStageParamSchema>["stage"];
export type UpdateJourneyStageInput = z.infer<typeof updateJourneyStageSchema>;
export type UpdateJourneyContentInput = z.infer<typeof updateJourneyContentSchema>;
