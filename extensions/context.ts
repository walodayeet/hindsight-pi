import type { HindsightHandles } from "./client.js";

export interface RecallResultSnapshot {
  text: string;
  type?: string;
  sourceLabel?: string;
  documentId?: string | null;
  context?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown> | null;
}

export interface LastRecallState {
  text: string | null;
  previewLines: string[];
  resultCount: number;
  loadedAt: number | null;
  query: string | null;
  results: RecallResultSnapshot[];
}

const EMPTY: LastRecallState = {
  text: null,
  previewLines: [],
  resultCount: 0,
  loadedAt: null,
  query: null,
  results: [],
};

let lastRecallState: LastRecallState = EMPTY;

const uniqueBankIds = (handles: HindsightHandles): string[] => {
  const ids = [handles.bankId, handles.config.globalBankId].filter((value): value is string => Boolean(value));
  return [...new Set(ids)];
};

const META_MEMORY_RECALL_RE = /\b(what memory do you have|what was recalled|what got recalled|what was loaded|what got loaded|don't use any tools|do not use any tools|hindsight_context|hidden recalled payload|visible recall state|raw hidden recalled payload|memory context loaded)\b/i;

const shouldDropRecallResult = (result: RecallResultSnapshot, query: string): boolean => {
  if (META_MEMORY_RECALL_RE.test(result.text)) return true;
  if (!/\b(architecture|design|reflect|recall|memory system|prompt caching|system prompt)\b/i.test(query)
      && /\b(prompt caching|system prompt injection|reflect-based path|recall-type settings)\b/i.test(result.text)) {
    return true;
  }
  return false;
};

export const clearCachedContext = (): void => {
  lastRecallState = EMPTY;
};

const truncateToBudget = (text: string, tokens: number): string => {
  const budgetChars = tokens * 4;
  return text.length > budgetChars ? `${text.slice(0, budgetChars)}…` : text;
};

const compactLine = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 140 ? `${normalized.slice(0, 140)}…` : normalized;
};

const normalizeRecallEntry = (result: any, sourceLabel?: string): RecallResultSnapshot | null => {
  const text = typeof result?.text === "string" ? result.text.trim() : "";
  if (!text) return null;
  return {
    text,
    type: typeof result?.type === "string" ? result.type : undefined,
    sourceLabel,
    documentId: typeof result?.document_id === "string" ? result.document_id : null,
    context: typeof result?.context === "string" ? result.context : null,
    tags: Array.isArray(result?.tags) ? result.tags.filter((tag: unknown): tag is string => typeof tag === "string") : undefined,
    metadata: result?.metadata && typeof result.metadata === "object" ? result.metadata as Record<string, unknown> : null,
  };
};

const renderRecallResults = (results: RecallResultSnapshot[], contextTokens: number): string | null => {
  const usable = results.map((result) => {
    const label = result.type ? `[${result.type}]` : "[memory]";
    return `- ${label} ${result.text}`;
  });
  if (usable.length === 0) return null;
  const block = [
    "# Hindsight Memories",
    "- recalled for current user turn",
    "",
    "<hindsight_memories>",
    ...usable,
    "</hindsight_memories>",
  ].join("\n");
  return truncateToBudget(block, contextTokens);
};

export const refreshContextForPrompt = async (handles: HindsightHandles, prompt: string): Promise<void> => {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    lastRecallState = EMPTY;
    return;
  }

  const results: RecallResultSnapshot[] = [];

  for (const bankId of uniqueBankIds(handles)) {
    const recall = await handles.client.recall(bankId, trimmedPrompt, {
      budget: handles.config.searchBudget,
      maxTokens: Math.max(handles.config.contextTokens, 512),
    });
    const sourceLabel = bankId === handles.bankId ? handles.config.workspace : `${handles.config.workspace}:global`;
    results.push(...(recall?.results ?? [])
      .map((entry: any) => normalizeRecallEntry(entry, sourceLabel))
      .filter((entry: RecallResultSnapshot | null): entry is RecallResultSnapshot => Boolean(entry)));
  }

  for (const linked of handles.linked) {
    try {
      const recall = await linked.client.recall(linked.bankId, trimmedPrompt, {
        budget: handles.config.searchBudget,
        maxTokens: Math.max(handles.config.contextTokens, 512),
      });
      results.push(...(recall?.results ?? [])
        .map((entry: any) => normalizeRecallEntry(entry, linked.name))
        .filter((entry: RecallResultSnapshot | null): entry is RecallResultSnapshot => Boolean(entry)));
    } catch (error) {
      if (handles.config.logging) console.warn(`[hindsight-pi] linked recall failed for ${linked.name}:`, error instanceof Error ? error.message : error);
    }
  }

  const filteredResults = results.filter((result) => !shouldDropRecallResult(result, trimmedPrompt));
  const text = renderRecallResults(filteredResults, handles.config.contextTokens);
  lastRecallState = {
    text,
    previewLines: filteredResults.map((result) => compactLine(result.text)).filter(Boolean).slice(0, 6),
    resultCount: filteredResults.length,
    loadedAt: Date.now(),
    query: trimmedPrompt,
    results: filteredResults,
  };
};

export const renderCachedContext = (): string | null => lastRecallState.text;
export const countCachedContext = (): number => lastRecallState.resultCount;
export const previewCachedContext = (limit = 3): string[] => lastRecallState.previewLines.slice(0, limit);
export const getLastRecallState = (): LastRecallState => lastRecallState;

export const formatLastRecallInspection = (): string => {
  if (!lastRecallState.loadedAt || lastRecallState.results.length === 0) {
    return "No Hindsight recall has been loaded yet for this session.";
  }

  const header = [
    `Query: ${lastRecallState.query ?? "(unknown)"}`,
    `Loaded: ${new Date(lastRecallState.loadedAt).toISOString()}`,
    `Results: ${lastRecallState.results.length}`,
    "",
    "Loaded recall results:",
  ];

  const lines = lastRecallState.results.flatMap((result, index) => {
    const detail: string[] = [`${index + 1}. [${result.type ?? "memory"}] ${result.text}`];
    if (result.sourceLabel) detail.push(`   source: ${result.sourceLabel}`);
    if (result.documentId) detail.push(`   document_id: ${result.documentId}`);
    if (result.context) detail.push(`   context: ${result.context}`);
    if (result.tags?.length) detail.push(`   tags: ${result.tags.join(", ")}`);
    return detail;
  });

  return [...header, ...lines].join("\n");
};
