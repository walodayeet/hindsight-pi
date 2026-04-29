export const HINDSIGHT_RECALL_CUSTOM_TYPE = "hindsight-recall";

export const filterRecallMessages = <T extends { customType?: string }>(messages: T[]): T[] =>
  messages.filter((message) => message?.customType !== HINDSIGHT_RECALL_CUSTOM_TYPE);

export interface RecallCustomMessageDetails {
  bankId?: string;
  query?: string;
  previews?: string[];
  chars?: number;
  resultCount?: number;
  durationMs?: number;
}

export const createRecallCustomMessage = (input: {
  content: string;
  display?: boolean;
  details?: RecallCustomMessageDetails;
}): {
  role: "custom";
  customType: typeof HINDSIGHT_RECALL_CUSTOM_TYPE;
  content: string;
  display: boolean;
  details?: RecallCustomMessageDetails;
  timestamp: number;
} => ({
  role: "custom",
  customType: HINDSIGHT_RECALL_CUSTOM_TYPE,
  content: input.content,
  display: input.display ?? false,
  details: input.details,
  timestamp: Date.now(),
});
