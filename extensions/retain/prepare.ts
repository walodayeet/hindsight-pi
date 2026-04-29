import { sanitizeCredentials } from "../upload.js";

export type RetainContentType = "text" | "thinking" | "toolCall" | "image";
export interface RetainContentConfig {
  assistant?: RetainContentType[];
  user?: RetainContentType[];
  toolResult?: RetainContentType[];
}
export type ToolFilterMode = { include?: string[]; exclude?: string[] };
export interface ToolFilterConfig {
  toolCall?: ToolFilterMode;
  toolResult?: ToolFilterMode;
}
export interface StripConfig {
  topLevel?: string[];
  message?: string[];
}

const DEFAULT_RETAIN_CONTENT: Required<RetainContentConfig> = {
  assistant: ["text"],
  user: ["text"],
  toolResult: [],
};

const DEFAULT_STRIP: Required<StripConfig> = {
  topLevel: ["type", "id", "parentId"],
  message: ["api", "provider", "model", "usage", "cost", "stopReason", "timestamp", "responseId"],
};

const DEFAULT_TOOL_FILTER: ToolFilterConfig = {
  toolCall: { exclude: ["grep", "find", "ls", "read", "hindsight_retain", "hindsight_recall", "hindsight_reflect", "hindsight_search", "hindsight_context"] },
  toolResult: { exclude: ["grep", "find", "ls", "write", "edit", "hindsight_retain", "hindsight_recall", "hindsight_reflect", "hindsight_search", "hindsight_context"] },
};

const META_MEMORY_RE = /\b(what memory|what do you remember|what was recalled|what got recalled|what was loaded|memory do you have|hindsight_context|hindsight-recall)\b/i;
const OPT_OUT_RE = /(^|\s)#(?:nomem|skip)(?=\s|$)/i;

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const toolAllowed = (toolName: string | undefined, mode?: ToolFilterMode): boolean => {
  if (!mode || !toolName) return true;
  if (mode.include) return mode.include.includes(toolName);
  if (mode.exclude) return !mode.exclude.includes(toolName);
  return true;
};

const blockKind = (block: any): RetainContentType | null => {
  if (!block || typeof block !== "object") return null;
  if (block.type === "text") return "text";
  if (block.type === "thinking" || block.type === "reasoning") return "thinking";
  if (block.type === "tool_use" || block.type === "toolCall") return "toolCall";
  if (block.type === "image" || block.type === "image_url") return "image";
  return null;
};

const stripFields = (obj: Record<string, unknown>, fields: string[]): void => {
  for (const field of fields) delete obj[field];
};

export interface PrepareRetainOptions {
  retainContent?: RetainContentConfig;
  strip?: StripConfig;
  toolFilter?: ToolFilterConfig;
}

export const prepareRetainMessage = (message: any, options: PrepareRetainOptions = {}): any | null => {
  if (!message || typeof message !== "object") return null;
  if (message.customType === "hindsight-recall") return null;
  const role = message.role;
  if (role !== "user" && role !== "assistant" && role !== "toolResult") return null;

  const retainContent = { ...DEFAULT_RETAIN_CONTENT, ...(options.retainContent ?? {}) };
  const strip = { ...DEFAULT_STRIP, ...(options.strip ?? {}) };
  const toolFilter = { ...DEFAULT_TOOL_FILTER, ...(options.toolFilter ?? {}) };

  const msg = cloneJson(message);
  if (role === "toolResult" && !toolAllowed(msg.toolName ?? msg.name, toolFilter.toolResult)) return null;

  if (typeof msg.content === "string") {
    if (!retainContent[role as keyof typeof retainContent]?.includes("text")) return null;
    msg.content = sanitizeCredentials(msg.content);
    if (META_MEMORY_RE.test(msg.content) || OPT_OUT_RE.test(msg.content)) return null;
  } else if (Array.isArray(msg.content)) {
    msg.content = msg.content.filter((block: any) => {
      const kind = blockKind(block);
      if (!kind || !retainContent[role as keyof typeof retainContent]?.includes(kind)) return false;
      if (kind === "toolCall" && !toolAllowed(block.name, toolFilter.toolCall)) return false;
      return true;
    }).map((block: any) => {
      const next = { ...block };
      if (typeof next.text === "string") next.text = sanitizeCredentials(next.text);
      return next;
    });
    if (msg.content.length === 0) return null;
    if (msg.content.some((block: any) => typeof block.text === "string" && (META_MEMORY_RE.test(block.text) || OPT_OUT_RE.test(block.text)))) return null;
  }

  stripFields(msg, strip.message ?? []);
  return msg;
};

export const prepareRetainEntry = (entry: Record<string, unknown>, options: PrepareRetainOptions = {}): Record<string, unknown> | null => {
  const cloned = cloneJson(entry);
  const prepared = prepareRetainMessage((cloned as any).message, options);
  if (!prepared) return null;
  (cloned as any).message = prepared;
  stripFields(cloned, options.strip?.topLevel ?? DEFAULT_STRIP.topLevel);
  return cloned;
};
