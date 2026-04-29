export type RecallLongQueryBehavior = "skip" | "truncate";

export type RecallQueryDecision =
  | { kind: "query"; query: string; source: "raw" | "slash-args" | "expanded" | "fallback"; truncated?: boolean; forceInspection?: boolean }
  | { kind: "skip"; reason: "empty-query" | "slash-command" | "query-too-long" | "continue-first-turn" };

const FORCE_RECALL_RE = /\b(what memory|what do you remember|what was recalled|what got recalled|what was loaded|what got loaded|what memories|memory do you have|what do you have in your context|what is in your context)\b/i;
const CONTINUE_RE = /^(continue|go on|keep going|next|proceed)$/i;
const COMMAND_ONLY_SKIP_RE = /^\/(?:hindsight(?::|\b)|reload\b|exit\b|quit\b|clear\b|compact\b|settings\b|help\b)/i;
export const FALLBACK_RECALL_QUERY = "Current durable user preferences, stable repo facts, active project goals, and important coding constraints for this workspace.";

const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();

const slashArgs = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return null;
  if (COMMAND_ONLY_SKIP_RE.test(trimmed)) return null;
  const match = trimmed.match(/^\/\S+\s+([\s\S]+)$/);
  const args = normalize(match?.[1] ?? "");
  return args || null;
};

const applyLength = (
  query: string,
  source: RecallQueryDecision extends { kind: "query" } ? never : "raw" | "slash-args" | "expanded" | "fallback",
  maxChars: number,
  behavior: RecallLongQueryBehavior,
  extra: Partial<Extract<RecallQueryDecision, { kind: "query" }>> = {},
): RecallQueryDecision => {
  const normalized = normalize(query);
  if (!normalized) return { kind: "skip", reason: "empty-query" };
  if (maxChars > 0 && normalized.length > maxChars) {
    if (behavior === "truncate") return { kind: "query", query: normalized.slice(0, maxChars).trim(), source, truncated: true, ...extra };
    return { kind: "skip", reason: "query-too-long" };
  }
  return { kind: "query", query: normalized, source, ...extra };
};

export const isContinuePrompt = (value: string): boolean => CONTINUE_RE.test(normalize(value));

export function deriveRecallQuery(input: {
  rawInput?: string | null;
  expandedPrompt?: string | null;
  lastMeaningfulPrompt?: string | null;
  maxChars?: number;
  longQueryBehavior?: RecallLongQueryBehavior;
}): RecallQueryDecision {
  const maxChars = input.maxChars ?? 800;
  const behavior = input.longQueryBehavior ?? "skip";
  const raw = normalize(input.rawInput ?? "");
  const expanded = normalize(input.expandedPrompt ?? "");
  const base = raw || expanded;
  if (!base) return { kind: "skip", reason: "empty-query" };

  const forceInspection = FORCE_RECALL_RE.test(base);
  if (forceInspection) {
    return applyLength(input.lastMeaningfulPrompt || FALLBACK_RECALL_QUERY, input.lastMeaningfulPrompt ? "fallback" : "fallback", maxChars, behavior, { forceInspection: true });
  }

  if (raw.startsWith("/")) {
    const args = slashArgs(raw);
    if (!args) return { kind: "skip", reason: "slash-command" };
    return applyLength(args, "slash-args", maxChars, behavior);
  }

  if (!raw && expanded.startsWith("/")) {
    const args = slashArgs(expanded);
    if (!args) return { kind: "skip", reason: "slash-command" };
    return applyLength(args, "slash-args", maxChars, behavior);
  }

  return applyLength(raw || expanded, raw ? "raw" : "expanded", maxChars, behavior);
}
