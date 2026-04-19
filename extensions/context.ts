import type { HindsightHandles } from "./client.js";

interface CachedContext {
  text: string | null;
  refreshedAt: number | null;
  pinned: boolean;
}

const EMPTY: CachedContext = { text: null, refreshedAt: null, pinned: false };
let cachedContext: CachedContext = EMPTY;
let messagesSinceRefresh = 0;
export let pendingRefresh: Promise<void> | null = null;

export const clearCachedContext = (): void => {
  cachedContext = EMPTY;
  messagesSinceRefresh = 0;
};

export const incrementMessageCount = (count: number): void => {
  messagesSinceRefresh += count;
};

const truncateToBudget = (text: string, tokens: number): string => {
  const budgetChars = tokens * 4;
  return text.length > budgetChars ? `${text.slice(0, budgetChars)}…` : text;
};

const renderResults = (results: Array<{ text?: string; type?: string }>, contextTokens: number): string | null => {
  if (results.length === 0) return null;
  const grouped = new Map<string, string[]>();
  for (const result of results) {
    const type = result.type ?? "memory";
    const text = result.text?.trim();
    if (!text) continue;
    const bucket = grouped.get(type) ?? [];
    bucket.push(`- ${text}`);
    grouped.set(type, bucket);
  }
  const sections = [...grouped.entries()].map(([type, items]) => `${type}:\n${items.join("\n")}`);
  if (sections.length === 0) return null;
  return truncateToBudget(`[Persistent memory]\n${sections.join("\n\n")}`, contextTokens);
};

export const refreshCachedContext = async (handles: HindsightHandles): Promise<void> => {
  const result = await handles.client.recall(
    handles.bankId,
    "What user preferences, durable project facts, architecture facts, and recent coding context matter for this pi workspace?",
    {
      budget: handles.config.searchBudget,
      maxTokens: Math.max(handles.config.contextTokens * 2, 512),
    },
  );

  cachedContext = {
    text: renderResults(result?.results ?? [], handles.config.contextTokens),
    refreshedAt: Date.now(),
    pinned: false,
  };
  messagesSinceRefresh = 0;
};

export const pinCachedContext = (): void => {
  if (cachedContext.refreshedAt !== null) cachedContext.pinned = true;
};

export const backgroundRefresh = (handles: HindsightHandles): void => {
  pendingRefresh = refreshCachedContext(handles).finally(() => {
    pendingRefresh = null;
  });
};

export const shouldRefreshCachedContext = (handles: HindsightHandles): boolean => {
  if (cachedContext.pinned) return false;
  if (cachedContext.refreshedAt === null) return true;
  const ttlExpired = (Date.now() - cachedContext.refreshedAt) / 1000 >= handles.config.contextRefreshTtlSeconds;
  const thresholdExceeded = messagesSinceRefresh >= handles.config.contextRefreshMessageThreshold;
  return ttlExpired || thresholdExceeded;
};

export const renderCachedContext = (): string | null => cachedContext.text;

export const previewCachedContext = (limit = 3): string[] => {
  if (!cachedContext.text) return [];
  const lines = cachedContext.text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .slice(0, limit)
    .map((line) => line.slice(2));
  return lines;
};
