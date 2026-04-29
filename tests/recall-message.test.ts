import { describe, expect, it } from "vitest";
import { createRecallCustomMessage, filterRecallMessages, HINDSIGHT_RECALL_CUSTOM_TYPE } from "../extensions/recall-message.js";

describe("recall message helpers", () => {
  it("filters hindsight recall custom messages", () => {
    const messages = [
      { customType: HINDSIGHT_RECALL_CUSTOM_TYPE, content: "old" },
      { customType: "other", content: "keep" },
      { content: "normal" },
    ];
    expect(filterRecallMessages(messages)).toEqual([messages[1], messages[2]]);
  });

  it("creates hidden current-turn recall custom message", () => {
    const msg = createRecallCustomMessage({ content: "<hindsight_memories>x</hindsight_memories>", details: { bankId: "b" } });
    expect(msg.role).toBe("custom");
    expect(msg.customType).toBe("hindsight-recall");
    expect(msg.display).toBe(false);
    expect(msg.details?.bankId).toBe("b");
  });
});
