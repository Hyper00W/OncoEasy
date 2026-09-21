type JourneyStageRecord = {
  key: string;
  order: number;
  title: string;
  description: string;
  checklist: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type JourneyHistoryRecord = {
  fromStage: string;
  toStage: string;
  changedAt: Date;
};

export function toJourneyStageResponse(stage: JourneyStageRecord) {
  return {
    stage: stage.key,
    order: stage.order,
    title: stage.title,
    description: stage.description,
    checklist: stage.checklist,
    isActive: stage.isActive,
    createdAt: stage.createdAt.toISOString(),
    updatedAt: stage.updatedAt.toISOString()
  };
}

export function toJourneyHistoryResponse(history: JourneyHistoryRecord) {
  return {
    fromStage: history.fromStage,
    toStage: history.toStage,
    changedAt: history.changedAt.toISOString()
  };
}
