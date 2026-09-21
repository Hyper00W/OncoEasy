import { AnalyticsEventName, Prisma } from "@prisma/client";

export type AnalyticsWriter = Pick<Prisma.TransactionClient, "analyticsEvent">;

export async function recordAnalyticsEvent(
  client: AnalyticsWriter,
  eventName: AnalyticsEventName,
  input: {
    userId?: string;
    entityType: string;
    entityId?: string;
    metadata?: Prisma.InputJsonValue;
  }
) {
  return client.analyticsEvent.create({
    data: {
      eventName,
      userId: input.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata
    }
  });
}