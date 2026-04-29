import type { HindsightHandles } from "./client.js";
import type { RetainMode, WriteFrequency } from "./config.js";

const REDACT_PLACEHOLDER = "<REDACTED>";
const CONTINUED_PREFIX = "[continued] ";
const TRIVIAL_PROMPT_RE = /^(ok|yes|no|thanks|thank you|continue|next|done|sure|sounds good|got it)$/i;

const STRIP_PATTERNS: RegExp[] = [
  /\[Persistent memory\][\s\S]*?(?=\n\[[a-z]+\]|$)/g,
  /<(?:antThinking|thinking|reasoning)>[\s\S]*?<\/(?:antThinking|thinking|reasoning)>/g,
  /data:[^;]+;base64,[A-Za-z0-9+/=]{100,}/g,
];

const SECRET_PATTERNS: RegExp[] = [
  /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['\"]?([^\s'\"`,;}{]{8,})['\"]?/gi,
  /\bsk-[A-Za-z0-9\-]{20,}\b/g,
  /\bhch-v\d+-[A-Za-z0-9]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*/g,
];

export const sanitizeCredentials = (text: string): string => {
  let result = text;
  for (const re of SECRET_PATTERNS) {
    re.lastIndex = 0;
    result = result.replace(re, REDACT_PLACEHOLDER);
  }
  return result;
};

const extractText = (content: unknown): string => {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((entry) => {
      if (typeof entry === "string") return [entry];
      if (entry && typeof entry === "object" && "type" in entry && "text" in entry) {
        const block = entry as { type?: string; text?: string };
        if (block.type === "text" && typeof block.text === "string") return [block.text];
      }
      return [] as string[];
    })
    .join("\n")
    .trim();
};

const findChunkBoundary = (search: string, maxLen: number): number => {
  const paragraph = search.lastIndexOf("\n\n");
  if (paragraph > 0) return paragraph + 2;
  const sentence = search.lastIndexOf(". ");
  if (sentence > 0) return sentence + 2;
  const word = search.lastIndexOf(" ");
  if (word > 0) return word + 1;
  return maxLen;
};

export const chunkTextSmart = (text: string, maxLen: number): string[] => {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    const search = remaining.slice(0, maxLen);
    const cut = findChunkBoundary(search, maxLen);
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  return chunks.map((chunk, index) => (index === 0 ? chunk : `${CONTINUED_PREFIX}${chunk}`));
};

interface RetainItem {
  content: string;
  context?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  timestamp?: Date;
}

interface PendingWrite {
  handles: HindsightHandles;
  bankId: string;
  items: RetainItem[];
  summary: RetainSummary;
  notify: boolean;
}

const cloneMessages = (messages: any[]): any[] => messages.map((message) => ({
  ...message,
  content: Array.isArray(message?.content)
    ? message.content.map((entry: any) => (entry && typeof entry === "object" ? { ...entry } : entry))
    : message?.content,
}));

const assistantOnlyMessages = (messages: any[]): any[] => messages.filter((message) => message?.role === "assistant");

export interface RetainSummary {
  mode: "queued" | "saved";
  itemsCount: number;
  previews: string[];
  fullText: string;
}

export type RetainOutcome =
  | { skipped: true; reason: string }
  | { skipped: false; summary: RetainSummary };

export interface DeliveredRetainNotice {
  handles: HindsightHandles;
  summary: RetainSummary;
}

const isConversationMessage = (message: any): boolean => message?.role === "user" || message?.role === "assistant";
const META_MEMORY_QUERY_RE = /\b(what memory|what do you remember|what was recalled|what got recalled|what was loaded|what got loaded|memory do you have|what do you have in your context|what is in your context|don't use any tools|do not use any tools|hindsight_context)\b/i;
const META_MEMORY_CONTENT_RE = /\b(what memory do you have|what was recalled|what got recalled|what was loaded|what got loaded|don't use any tools|do not use any tools|hindsight_context|hidden recalled payload|visible recall state|raw hidden recalled payload|memory context loaded)\b/i;
const sanitizeTag = (value: string): string => value.toLowerCase().replace(/[^a-z0-9:_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
const buildRetainTags = (handles: HindsightHandles, bankId: string, kind: "turn-summary" | "explicit", origin: "auto" | "explicit"): string[] => {
  const tags = [
    "source:pi",
    `workspace:${sanitizeTag(handles.config.workspace)}`,
    `bank:${sanitizeTag(bankId)}`,
    `kind:${kind}`,
    `origin:${origin}`,
  ];
  return [...new Set(tags.filter((tag) => tag.length > 0))];
};

const latestUserText = (messages: any[]): string => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") return extractText(messages[i]?.content);
  }
  return "";
};

const shouldRetainToGlobalBank = (messages: any[]): boolean => /(^|\s)#(global|me)(?=\s|$)/i.test(latestUserText(messages));

export const shouldSkipRetain = (messages: any[]): { skip: boolean; reason?: string } => {
  const prompt = latestUserText(messages).trim();
  if (!prompt) return { skip: true, reason: "no prompt" };
  if (prompt.length < 5) return { skip: true, reason: "too short" };
  if (TRIVIAL_PROMPT_RE.test(prompt)) return { skip: true, reason: "trivial" };
  if (/^(#nomem|#skip)(?=\s|$)/i.test(prompt)) return { skip: true, reason: "opt-out" };
  if (META_MEMORY_QUERY_RE.test(prompt)) return { skip: true, reason: "meta-memory" };
  return { skip: false };
};

const buildTurnSummary = (messages: any[]): string => {
  const userParts: string[] = [];
  const assistantParts: string[] = [];

  for (const message of messages) {
    if (!isConversationMessage(message)) continue;
    let text = sanitizeCredentials(extractText(message.content));
    for (const pattern of STRIP_PATTERNS) text = text.replace(pattern, "");
    text = text.trim();
    if (!text) continue;
    if (META_MEMORY_CONTENT_RE.test(text)) continue;
    if (message.role === "user") userParts.push(text);
    else assistantParts.push(text);
  }

  const sections: string[] = [];
  if (userParts.length > 0) sections.push(`[user]\n${userParts.join("\n\n")}`);
  if (assistantParts.length > 0) sections.push(`[assistant]\n${assistantParts.join("\n\n")}`);
  return sections.join("\n\n").trim();
};

const toRetainItems = (handles: HindsightHandles, messages: any[], bankId = handles.bankId): { summary: string; items: RetainItem[] } => {
  const summary = buildTurnSummary(messages);
  if (!summary) return { summary: "", items: [] };
  const chunks = chunkTextSmart(summary, handles.config.maxMessageLength);
  const tags = buildRetainTags(handles, bankId, "turn-summary", "auto");
  return {
    summary,
    items: chunks.map((chunk) => ({
      content: chunk,
      metadata: {
        source: "pi",
        kind: "turn-summary",
        origin: "auto",
        bankId,
        workspace: handles.config.workspace,
      },
      tags,
      timestamp: new Date(),
    })),
  };
};

const previewItems = (items: RetainItem[], limit = 3): string[] =>
  items.slice(0, limit).map((item) => {
    const text = item.content.replace(/^\[(user|assistant)\]\s*/gm, "").trim().replace(/\s+/g, " ");
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  });

export const countWorkUnits = (messages: any[]): number => {
  let count = 0;
  for (const message of messages) {
    if (message?.role === "assistant") count += 1;
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const block of content) {
      if (block && typeof block === "object" && "type" in block && (block as any).type === "tool_use") count += 1;
    }
  }
  return Math.max(count, 1);
};

export class WriteScheduler {
  private pending: PendingWrite[] = [];
  private pendingTurns = 0;
  private workCount = 0;
  private asyncQueue: Promise<void> = Promise.resolve();
  private processBuffer: any[] = [];

  constructor(
    private frequency: WriteFrequency | number,
    private onDelivered?: (notice: DeliveredRetainNotice) => void | Promise<void>,
  ) {}

  private async sendWithRetry(handles: HindsightHandles, bankId: string, items: RetainItem[]): Promise<void> {
    const batchItems = items.map((item) => ({
      content: item.content,
      context: item.context,
      metadata: item.metadata,
      tags: item.tags,
      timestamp: item.timestamp,
    }));
    try {
      await handles.client.retainBatch(bankId, batchItems, { async: false });
    } catch (firstError) {
      await new Promise((r) => setTimeout(r, 1500));
      await handles.client.retainBatch(bankId, batchItems, { async: false });
      if (handles.config.logging) {
        console.warn("[hindsight-pi] upload retried after error:", firstError instanceof Error ? firstError.message : firstError);
      }
    }
  }

  private enqueueAsync(write: PendingWrite): void {
    this.asyncQueue = this.asyncQueue
      .then(async () => {
        await this.sendWithRetry(write.handles, write.bankId, write.items);
        if (write.notify) {
          await this.onDelivered?.({
            handles: write.handles,
            summary: { ...write.summary, mode: "saved" },
          });
        }
      })
      .catch((error) => {
        console.error("[hindsight-pi] upload queue error:", error instanceof Error ? error.message : error);
      });
  }

  private queuePending(writes: Array<{ bankId: string; items: RetainItem[] }>, handles: HindsightHandles, summary: RetainSummary): void {
    this.pendingTurns += 1;
    this.pending.push(...writes.map((write, index) => ({
      handles,
      bankId: write.bankId,
      items: write.items,
      summary,
      notify: index === 0,
    })));
  }

  async onTurnEnd(handles: HindsightHandles, messages: any[]): Promise<RetainOutcome | null> {
    const skip = shouldSkipRetain(messages);
    if (skip.skip) return { skipped: true, reason: skip.reason ?? "skipped" };

    const currentMessages = cloneMessages(messages);
    this.processBuffer.push(...currentMessages);

    const workUnits = countWorkUnits(messages);
    const retainMode = (handles.config.retainMode ?? "response") as RetainMode;
    const stepThreshold = handles.config.stepRetainThreshold ?? 5;
    this.workCount += workUnits;

    const bankIds = [handles.bankId];
    if (handles.config.globalBankId && handles.config.globalBankId !== handles.bankId && shouldRetainToGlobalBank(messages)) {
      bankIds.push(handles.config.globalBankId);
    }

    const stepTriggered = (retainMode === "step-batch" || retainMode === "both") && this.workCount >= stepThreshold;
    if (stepTriggered) {
      const stepWrites = bankIds
        .map((bankId) => ({ bankId, items: toRetainItems(handles, this.processBuffer, bankId).items }))
        .filter((entry) => entry.items.length > 0);
      for (const write of stepWrites) await this.sendWithRetry(handles, write.bankId, write.items);
      this.processBuffer = [];
      this.workCount = 0;
    }

    let responseSource: any[] = [];
    if (retainMode === "response") responseSource = currentMessages;
    else if (retainMode === "both") responseSource = stepTriggered ? assistantOnlyMessages(currentMessages) : currentMessages;
    else if (retainMode === "step-batch") return stepTriggered
      ? {
          skipped: false,
          summary: {
            mode: "saved",
            itemsCount: bankIds
              .map((bankId) => toRetainItems(handles, messages, bankId).items.length)
              .reduce((sum, value) => sum + value, 0),
            previews: previewItems(toRetainItems(handles, messages, handles.bankId).items),
            fullText: toRetainItems(handles, messages, handles.bankId).summary,
          },
        }
      : { skipped: true, reason: `below step threshold (${workUnits}/${stepThreshold})` };
    else return { skipped: true, reason: "retain off" };

    const base = toRetainItems(handles, responseSource, handles.bankId);
    const writes = bankIds
      .map((bankId) => ({ bankId, items: toRetainItems(handles, responseSource, bankId).items }))
      .filter((entry) => entry.items.length > 0);
    if (writes.length === 0) return null;

    const savedSummary: RetainSummary = {
      mode: "saved",
      itemsCount: writes.reduce((count, entry) => count + entry.items.length, 0),
      previews: previewItems(writes[0]?.items ?? []),
      fullText: base.summary,
    };
    const queuedSummary: RetainSummary = { ...savedSummary, mode: "queued" };

    if (this.frequency === "async") {
      writes.forEach((write, index) => this.enqueueAsync({
        handles,
        bankId: write.bankId,
        items: write.items,
        summary: queuedSummary,
        notify: index === 0,
      }));
      return { skipped: false, summary: queuedSummary };
    }

    if (this.frequency === "session") {
      this.queuePending(writes, handles, queuedSummary);
      return { skipped: false, summary: queuedSummary };
    }

    if (typeof this.frequency === "number") {
      for (const write of writes) await this.sendWithRetry(handles, write.bankId, write.items);
      return { skipped: false, summary: savedSummary };
    }

    for (const write of writes) await this.sendWithRetry(handles, write.bankId, write.items);
    return { skipped: false, summary: savedSummary };
  }

  private async flushPending(): Promise<void> {
    const batch = this.pending.splice(0);
    this.pendingTurns = 0;
    for (const write of batch) {
      await this.sendWithRetry(write.handles, write.bankId, write.items);
      if (write.notify && write.summary.mode === "queued") {
        await this.onDelivered?.({
          handles: write.handles,
          summary: { ...write.summary, mode: "saved" },
        });
      }
    }
  }

  async flush(): Promise<void> {
    await this.flushPending();
    await this.asyncQueue;
  }

  reset(): void {
    this.pending = [];
    this.pendingTurns = 0;
    this.workCount = 0;
    this.processBuffer = [];
    this.asyncQueue = Promise.resolve();
  }
}
