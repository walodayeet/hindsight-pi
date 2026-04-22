import { describe, expect, it } from "vitest";
import { clearCachedContext, countCachedContext, formatLastRecallInspection, getLastRecallState, refreshContextForPrompt, renderCachedContext } from "../extensions/context.js";
import { WriteScheduler, chunkTextSmart, sanitizeCredentials } from "../extensions/upload.js";

const makeHandles = (overrides: Record<string, unknown> = {}) => {
  const calls: Array<{ content: string; tags?: string[]; metadata?: Record<string, unknown> }> = [];
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
      retain: async (_bankId: string, content: string, item?: { tags?: string[]; metadata?: Record<string, unknown> }) => { calls.push({ content, tags: item?.tags, metadata: item?.metadata }); },
      retainBatch: async (_bankId: string, items: Array<{ content: string; tags?: string[]; metadata?: Record<string, unknown> }>) => { calls.push(...items.map((item) => ({ content: item.content, tags: item.tags, metadata: item.metadata }))); },
    },
  } as any;
  return { handles, calls };
};

const messages = [
  { role: "user", content: "Implement settings cleanup" },
  { role: "assistant", content: "Done. Added grouped recall and compact retain UI." },
];

describe("context helpers", () => {
  it("stores the exact last recall result set for inspection", async () => {
    clearCachedContext();
    const handles = {
      bankId: "bank-1",
      config: {
        workspace: "pi",
        searchBudget: "mid",
        contextTokens: 512,
        logging: false,
        globalBankId: undefined,
      },
      linked: [],
      client: {
        recall: async () => ({
          results: [
            { text: "User prefers compact status output", type: "observation", document_id: "doc-1", context: "preferences", tags: ["session:s1"] },
            { text: "User asked for fresh recall each turn", type: "experience", document_id: "doc-1" },
          ],
        }),
      },
    } as any;

    await refreshContextForPrompt(handles, "what should i remember?");

    expect(countCachedContext()).toBe(2);
    expect(renderCachedContext()).toContain("<hindsight_memories>");
    expect(getLastRecallState().query).toBe("what should i remember?");
    expect(formatLastRecallInspection()).toContain("User prefers compact status output");
    expect(formatLastRecallInspection()).toContain("document_id: doc-1");
  });

  it("filters low-value meta recall results", async () => {
    clearCachedContext();
    const handles = {
      bankId: "bank-1",
      config: {
        workspace: "pi",
        searchBudget: "mid",
        contextTokens: 512,
        logging: false,
        globalBankId: undefined,
      },
      linked: [],
      client: {
        recall: async () => ({
          results: [
            { text: "Visible recall state: banner like memory context loaded.", type: "experience", document_id: "doc-noise" },
            { text: "Stable project goal: ship Hindsight-pi architecture v2.", type: "world", document_id: "doc-keep" },
          ],
        }),
      },
    } as any;

    await refreshContextForPrompt(handles, "Current durable user preferences, stable repo facts, active project goals, and important coding constraints for this workspace.");

    expect(countCachedContext()).toBe(1);
    expect(formatLastRecallInspection()).toContain("ship Hindsight-pi architecture v2");
    expect(formatLastRecallInspection()).not.toContain("Visible recall state");
  });

  it("clears last recall inspection state", () => {
    clearCachedContext();
    expect(formatLastRecallInspection()).toContain("No Hindsight recall has been loaded yet");
  });
});

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
    expect(calls[0]?.tags).toContain("source:pi");
    expect(calls[0]?.metadata?.kind).toBe("turn-summary");
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

  it("skips retaining meta-memory inspection prompts", async () => {
    const { handles, calls } = makeHandles({ retainMode: "response", writeFrequency: "turn" });
    const scheduler = new WriteScheduler("turn");
    const metaMessages = [
      { role: "user", content: "what memory do you have? don't use any tools" },
      { role: "assistant", content: "Memory in context: ..." },
    ];

    const outcome = await scheduler.onTurnEnd(handles, metaMessages as any[]);

    expect(outcome).toEqual({ skipped: true, reason: "meta-memory" });
    expect(calls.length).toBe(0);
  });
});
