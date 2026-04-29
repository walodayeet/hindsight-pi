import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendQueueRecord, deleteQueue, readQueueRecords, queuePath } from "../extensions/queue.js";

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
