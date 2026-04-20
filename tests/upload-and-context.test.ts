import { describe, expect, it } from "vitest";
import { WriteScheduler, chunkTextSmart, sanitizeCredentials } from "../extensions/upload.js";

const makeHandles = (overrides: Record<string, unknown> = {}) => {
  const calls: string[] = [];
  const handles = {
    bankId: "bank-1",
    config: {
      workspace: "pi",
      maxMessageLength: 1000,
      retainMode: "response",
      stepRetainThreshold: 5,
      writeFrequency: "turn",
      saveMessages: true,
      logging: false,
      globalBankId: undefined,
      ...overrides,
    },
    client: {
      retain: async (_bankId: string, content: string) => { calls.push(content); },
      retainBatch: async (_bankId: string, items: Array<{ content: string }>) => { calls.push(...items.map((item) => item.content)); },
    },
  } as any;
  return { handles, calls };
};

const messages = [
  { role: "user", content: "Implement settings cleanup" },
  { role: "assistant", content: "Done. Added grouped recall and compact retain UI." },
];

describe("upload helpers", () => {
  it("redacts obvious secrets", () => {
    const input = "apiKey=sk-abcdefghijklmnopqrstuvwxyz123456 and bearer Bearer abcdefghijklmnopqrstuvwxyz123456";
    const output = sanitizeCredentials(input);
    expect(output).not.toContain("sk-");
    expect(output).toContain("<REDACTED>");
  });

  it("chunks long text on boundaries and marks continuations", () => {
    const text = "First sentence. Second sentence. Third sentence. Fourth sentence.";
    const chunks = chunkTextSmart(text, 25);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1]?.startsWith("[continued] ")).toBe(true);
  });

  it("saves immediately in response+turn mode", async () => {
    const { handles, calls } = makeHandles({ retainMode: "response", writeFrequency: "turn" });
    const scheduler = new WriteScheduler("turn");

    const outcome = await scheduler.onTurnEnd(handles, messages);

    expect(outcome && !outcome.skipped && outcome.summary.mode).toBe("saved");
    expect(calls.length).toBeGreaterThan(0);
  });

  it("queues until flush in session mode", async () => {
    const { handles, calls } = makeHandles({ retainMode: "response", writeFrequency: "session" });
    const scheduler = new WriteScheduler("session");

    const outcome = await scheduler.onTurnEnd(handles, messages);

    expect(outcome && !outcome.skipped && outcome.summary.mode).toBe("queued");
    expect(calls.length).toBe(0);
    await scheduler.flush();
    expect(calls.length).toBeGreaterThan(0);
  });

  it("does not delay response retain when numeric write frequency is set", async () => {
    const { handles, calls } = makeHandles({ retainMode: "response", writeFrequency: 5 });
    const scheduler = new WriteScheduler(5);

    const outcome = await scheduler.onTurnEnd(handles, messages);

    expect(outcome && !outcome.skipped && outcome.summary.mode).toBe("saved");
    expect(calls.length).toBeGreaterThan(0);
  });

  it("skips step-batch retain below threshold", async () => {
    const { handles } = makeHandles({ retainMode: "step-batch", stepRetainThreshold: 5, writeFrequency: "turn" });
    const scheduler = new WriteScheduler("turn");

    const outcome = await scheduler.onTurnEnd(handles, messages);

    expect(outcome).toEqual({ skipped: true, reason: "below step threshold (1/5)" });
  });
});
