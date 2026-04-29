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
