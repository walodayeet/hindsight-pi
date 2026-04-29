import { describe, expect, it } from "vitest";
import { prepareRetainEntry, prepareRetainMessage } from "../extensions/retain/prepare.js";

describe("prepareRetainMessage", () => {
  it("excludes hindsight recall custom messages", () => {
    expect(prepareRetainMessage({ role: "custom", customType: "hindsight-recall", content: "x" })).toBeNull();
  });

  it("filters tool calls by exclude list", () => {
    const prepared = prepareRetainMessage({
      role: "assistant",
      content: [
        { type: "text", text: "hello" },
        { type: "tool_use", name: "hindsight_recall", input: {} },
        { type: "tool_use", name: "bash", input: {} },
      ],
    }, { retainContent: { assistant: ["text", "toolCall"] }, toolFilter: { toolCall: { exclude: ["hindsight_recall"] } } });
    expect(prepared.content).toHaveLength(2);
    expect(prepared.content.some((block: any) => block.name === "hindsight_recall")).toBe(false);
  });

  it("can exclude tool results", () => {
    expect(prepareRetainMessage({ role: "toolResult", toolName: "grep", content: "result" }, { retainContent: { toolResult: ["text"] }, toolFilter: { toolResult: { exclude: ["grep"] } } })).toBeNull();
  });

  it("strips fields and redacts secrets", () => {
    const prepared = prepareRetainEntry({ type: "message", id: "1", message: { role: "user", content: "api_key=supersecret123", model: "x" } });
    expect(prepared).not.toBeNull();
    expect(prepared).not.toHaveProperty("id");
    expect((prepared as any).message).not.toHaveProperty("model");
    expect((prepared as any).message.content).toContain("<REDACTED>");
  });

  it("keeps #nomem/#skip opt-out messages out of auto retain", () => {
    expect(prepareRetainMessage({ role: "user", content: "#nomem do not store this" })).toBeNull();
    expect(prepareRetainMessage({ role: "user", content: "please do it #skip" })).toBeNull();
  });

  it("keeps meta-memory inspection prompts out of auto retain", () => {
    expect(prepareRetainMessage({ role: "user", content: "what memory do you have?" })).toBeNull();
  });

  it("thinking inclusion is configurable", () => {
    const excluded = prepareRetainMessage({ role: "assistant", content: [{ type: "thinking", text: "secret reasoning" }] });
    expect(excluded).toBeNull();
    const included = prepareRetainMessage({ role: "assistant", content: [{ type: "thinking", text: "reasoning" }] }, { retainContent: { assistant: ["thinking"] } });
    expect(included.content).toHaveLength(1);
  });
});
