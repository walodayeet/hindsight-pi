import { mkdirSync, readFileSync, rmSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface QueueRecord {
  sessionId: string;
  bankId: string;
  content: string;
  context?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  timestamp: string;
  document_id?: string;
  update_mode?: "append" | "replace";
  observation_scopes?: unknown;
}

const root = (): string => process.env.HINDSIGHT_QUEUE_ROOT || join(homedir(), ".hindsight", "pi-queues");
const safe = (value: string): string => value.replace(/[^a-zA-Z0-9_.-]+/g, "-").slice(0, 120) || "default";
export const queuePath = (sessionId: string, kind: "auto" | "tool" = "auto"): string => join(root(), `${safe(sessionId)}.${kind}.jsonl`);

export const appendQueueRecord = (record: QueueRecord, kind: "auto" | "tool" = "auto"): void => {
  mkdirSync(root(), { recursive: true });
  appendFileSync(queuePath(record.sessionId, kind), `${JSON.stringify(record)}\n`, "utf8");
};

export const readQueueRecords = (sessionId: string, kind: "auto" | "tool" = "auto"): { records: QueueRecord[]; malformed: number } => {
  const path = queuePath(sessionId, kind);
  if (!existsSync(path)) return { records: [], malformed: 0 };
  const records: QueueRecord[] = [];
  let malformed = 0;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line) as QueueRecord); } catch { malformed += 1; }
  }
  return { records, malformed };
};

export const deleteQueue = (sessionId: string, kind: "auto" | "tool" = "auto"): void => {
  rmSync(queuePath(sessionId, kind), { force: true });
};

export const countQueueRecords = (sessionId: string): number => readQueueRecords(sessionId, "auto").records.length + readQueueRecords(sessionId, "tool").records.length;

/** Fields accepted by Hindsight `retainBatch` content items. */
export type RetainBatchItem = {
  content: string;
  context?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  timestamp: string;
  document_id?: string;
  update_mode?: "append" | "replace";
  observation_scopes?: unknown;
};

/**
 * Hindsight rejects a batch that lists the same `document_id` more than once.
 * Auto-retain queues one append row per message with a stable session document_id,
 * so flush must coalesce duplicates before `retainBatch`.
 */
export const coalesceRetainBatchItems = <T extends RetainBatchItem>(items: T[]): T[] => {
  const result: T[] = [];
  const indexByDocId = new Map<string, number>();

  for (const item of items) {
    const docId = item.document_id;
    if (!docId) {
      result.push(item);
      continue;
    }

    const existingIndex = indexByDocId.get(docId);
    if (existingIndex === undefined) {
      indexByDocId.set(docId, result.length);
      result.push({ ...item });
      continue;
    }

    const existing = result[existingIndex]!;
    if ((item.update_mode ?? existing.update_mode) === "replace") {
      result[existingIndex] = { ...item };
      continue;
    }

    const tags = [...new Set([...(existing.tags ?? []), ...(item.tags ?? [])])];
    result[existingIndex] = {
      ...existing,
      content: existing.content ? `${existing.content}\n${item.content}` : item.content,
      tags: tags.length > 0 ? tags : existing.tags,
      metadata: { ...(existing.metadata ?? {}), ...(item.metadata ?? {}) },
      observation_scopes: item.observation_scopes ?? existing.observation_scopes,
    };
  }

  return result;
};

export const toRetainBatchPayload = (records: QueueRecord[]): RetainBatchItem[] =>
  coalesceRetainBatchItems(records.map((record) => ({
    content: record.content,
    context: record.context,
    tags: record.tags,
    metadata: record.metadata,
    timestamp: record.timestamp,
    document_id: record.document_id,
    update_mode: record.update_mode,
    observation_scopes: record.observation_scopes,
  })));
