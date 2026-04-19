import type { HindsightHandles } from "./client.js";
import type { WriteFrequency } from "./config.js";

const REDACT_PLACEHOLDER = "<REDACTED>";
const CONTINUED_PREFIX = "[continued] ";

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
  timestamp?: Date;
}

interface PendingWrite {
  handles: HindsightHandles;
  items: RetainItem[];
  summary: RetainSummary;
}

export interface RetainSummary {
  mode: "queued" | "saved";
  itemsCount: number;
  previews: string[];
}

export interface DeliveredRetainNotice {
  handles: HindsightHandles;
  summary: RetainSummary;
}

const isConversationMessage = (message: any): boolean => message?.role === "user" || message?.role === "assistant";

const buildTurnSummary = (messages: any[]): string => {
  const userParts: string[] = [];
  const assistantParts: string[] = [];

  for (const message of messages) {
    if (!isConversationMessage(message)) continue;
    const text = sanitizeCredentials(extractText(message.content));
    if (!text) continue;
    if (message.role === "user") userParts.push(text);
    else assistantParts.push(text);
  }

  const sections: string[] = [];
  if (userParts.length > 0) sections.push(`[user]\n${userParts.join("\n\n")}`);
  if (assistantParts.length > 0) sections.push(`[assistant]\n${assistantParts.join("\n\n")}`);
  return sections.join("\n\n").trim();
};

const toRetainItems = (handles: HindsightHandles, messages: any[]): RetainItem[] => {
  const summary = buildTurnSummary(messages);
  if (!summary) return [];
  const chunks = chunkTextSmart(summary, handles.config.maxMessageLength);
  return chunks.map((chunk) => ({
    content: chunk,
    metadata: {
      source: "pi",
      kind: "turn-summary",
      bankId: handles.bankId,
      workspace: handles.config.workspace,
    },
    timestamp: new Date(),
  }));
};

const previewItems = (items: RetainItem[], limit = 3): string[] =>
  items.slice(0, limit).map((item) => {
    const text = item.content.replace(/^\[(user|assistant)\]\s*/gm, "").trim().replace(/\s+/g, " ");
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  });

export class WriteScheduler {
  private pending: PendingWrite[] = [];
  private turnCount = 0;
  private asyncQueue: Promise<void> = Promise.resolve();

  constructor(
    private frequency: WriteFrequency | number,
    private onDelivered?: (notice: DeliveredRetainNotice) => void | Promise<void>,
  ) {}

  private async sendWithRetry(handles: HindsightHandles, items: RetainItem[]): Promise<void> {
    try {
      if (items.length === 1) {
        const [item] = items;
        await handles.client.retain(handles.bankId, item.content, item);
      } else {
        await handles.client.retainBatch(handles.bankId, items, { async: false });
      }
    } catch (firstError) {
      await new Promise((r) => setTimeout(r, 1500));
      if (items.length === 1) {
        const [item] = items;
        await handles.client.retain(handles.bankId, item.content, item);
      } else {
        await handles.client.retainBatch(handles.bankId, items, { async: false });
      }
      if (handles.config.logging) {
        console.warn("[hindsight-pi] upload retried after error:", firstError instanceof Error ? firstError.message : firstError);
      }
    }
  }

  private enqueueAsync(write: PendingWrite): void {
    this.asyncQueue = this.asyncQueue
      .then(async () => {
        await this.sendWithRetry(write.handles, write.items);
        await this.onDelivered?.({
          handles: write.handles,
          summary: { ...write.summary, mode: "saved" },
        });
      })
      .catch((error) => {
        console.error("[hindsight-pi] upload queue error:", error instanceof Error ? error.message : error);
      });
  }

  async onTurnEnd(handles: HindsightHandles, messages: any[]): Promise<RetainSummary | null> {
    const items = toRetainItems(handles, messages);
    if (items.length === 0) return null;

    const summary: RetainSummary = {
      mode: "saved",
      itemsCount: items.length,
      previews: previewItems(items),
    };

    this.turnCount += 1;
    if (this.frequency === "async") {
      summary.mode = "queued";
      this.enqueueAsync({ handles, items, summary });
      return summary;
    }
    if (this.frequency === "turn") {
      await this.sendWithRetry(handles, items);
      return summary;
    }
    this.pending.push({ handles, items, summary: { ...summary } });
    if (typeof this.frequency === "number") {
      if (this.turnCount % this.frequency === 0) {
        await this.flushPending();
        return summary;
      }
      summary.mode = "queued";
      return summary;
    }
    if (this.frequency === "session") {
      summary.mode = "queued";
    }
    return summary;
  }

  private async flushPending(): Promise<void> {
    const batch = this.pending.splice(0);
    for (const write of batch) {
      await this.sendWithRetry(write.handles, write.items);
      if (write.summary.mode === "queued") {
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
    this.turnCount = 0;
    this.asyncQueue = Promise.resolve();
  }
}
