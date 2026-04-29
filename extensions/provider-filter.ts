import { HINDSIGHT_RECALL_CUSTOM_TYPE } from "./recall-message.js";

export const HINDSIGHT_RECALL_STATUS_TYPE = "hindsight-recall-status";
export const HINDSIGHT_RETAIN_STATUS_TYPE = "hindsight-retain-status";

const FILTERED = new Set([
  HINDSIGHT_RECALL_CUSTOM_TYPE,
  HINDSIGHT_RECALL_STATUS_TYPE,
  HINDSIGHT_RETAIN_STATUS_TYPE,
]);

export const filterHindsightProviderMessages = <T extends { customType?: string }>(messages: T[]): T[] =>
  messages.filter((message) => !FILTERED.has(message?.customType ?? ""));
