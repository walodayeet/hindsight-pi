import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendQueueRecord, coalesceRetainBatchItems, deleteQueue, readQueueRecords, queuePath, toRetainBatchPayload } from "../extensions/queue.js";

let dir: string;
let oldRoot: string | undefined;

beforeEach(() => {
  oldRoot = process.env.HINDSIGHT_QUEUE_ROOT;
  dir = mkdtempSync(join(tmpdir(), "hindsight-queue-"));
  process.env.HINDSIGHT_QUEUE_ROOT = dir;
});

afterEach(() => {
  if (oldRoot === undefined) delete process.env.HINDSIGHT_QUEUE_ROOT;
  else process.env.HINDSIGHT_QUEUE_ROOT = oldRoot;
  rmSync(dir, { recursive: true, force: true });
});

describe("queue", () => {
  it("persists and reads queue records", () => {
    appendQueueRecord({ sessionId: "s/1", bankId: "b", content: "{}", timestamp: "t", document_id: "s/1", update_mode: "append" });
    const { records, malformed } = readQueueRecords("s/1");
    expect(malformed).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ bankId: "b", update_mode: "append" });
  });

  it("tolerates malformed lines and preserves file until explicit delete", () => {
    appendQueueRecord({ sessionId: "s", bankId: "b", content: "one", timestamp: "t" });
    const path = queuePath("s");
    require("node:fs").appendFileSync(path, "not-json\n", "utf8");
    const read = readQueueRecords("s");
    expect(read.records).toHaveLength(1);
    expect(read.malformed).toBe(1);
    deleteQueue("s");
    expect(readQueueRecords("s").records).toHaveLength(0);
  });
});

describe("coalesceRetainBatchItems", () => {
  it("merges append items that share a document_id into one unique batch item", () => {
    const coalesced = coalesceRetainBatchItems([
      {
        content: '{"n":1}',
        context: "pi: a",
        tags: ["auto", "session"],
        metadata: { source: "pi", kind: "session-message" },
        timestamp: "t0",
        document_id: "session-1",
        update_mode: "append",
        observation_scopes: ["scope-a"],
      },
      {
        content: '{"n":2}',
        context: "pi: a",
        tags: ["session", "cwd:x"],
        metadata: { source: "pi", kind: "session-message", origin: "auto" },
        timestamp: "t0",
        document_id: "session-1",
        update_mode: "append",
        observation_scopes: ["scope-a"],
      },
    ]);

    expect(coalesced).toHaveLength(1);
    expect(coalesced[0]).toMatchObject({
      content: '{"n":1}\n{"n":2}',
      document_id: "session-1",
      update_mode: "append",
      timestamp: "t0",
      context: "pi: a",
    });
    expect(coalesced[0].tags?.sort()).toEqual(["auto", "cwd:x", "session"]);
    expect(coalesced[0].metadata).toEqual({ source: "pi", kind: "session-message", origin: "auto" });
  });

  it("keeps distinct document_ids and items without document_id", () => {
    const coalesced = coalesceRetainBatchItems([
      { content: "a", timestamp: "t", document_id: "d1", update_mode: "append" },
      { content: "b", timestamp: "t" },
      { content: "c", timestamp: "t", document_id: "d2", update_mode: "append" },
      { content: "d", timestamp: "t", document_id: "d1", update_mode: "append" },
      { content: "e", timestamp: "t" },
    ]);

    expect(coalesced.map((item) => item.content)).toEqual(["a\nd", "b", "c", "e"]);
    expect(new Set(coalesced.map((item) => item.document_id).filter(Boolean)).size).toBe(2);
  });

  it("lets replace overwrite prior content for the same document_id", () => {
    const coalesced = coalesceRetainBatchItems([
      { content: "old", timestamp: "t0", document_id: "d1", update_mode: "append" },
      { content: "new", timestamp: "t1", document_id: "d1", update_mode: "replace", tags: ["fresh"] },
    ]);
    expect(coalesced).toEqual([
      { content: "new", timestamp: "t1", document_id: "d1", update_mode: "replace", tags: ["fresh"] },
    ]);
  });

  it("toRetainBatchPayload maps coalesced records for retainBatch", () => {
    const payload = toRetainBatchPayload([
      {
        sessionId: "s",
        bankId: "b",
        content: "one",
        context: "ctx",
        tags: ["t"],
        metadata: { source: "pi" },
        timestamp: "t",
        document_id: "s",
        update_mode: "append",
        observation_scopes: ["o"],
      },
    ]);
    expect(payload).toEqual([
      {
        content: "one",
        context: "ctx",
        tags: ["t"],
        metadata: { source: "pi" },
        timestamp: "t",
        document_id: "s",
        update_mode: "append",
        observation_scopes: ["o"],
      },
    ]);
  });
});
