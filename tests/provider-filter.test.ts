import { describe, expect, it } from "vitest";
import { filterHindsightProviderMessages } from "../extensions/provider-filter.js";

describe("filterHindsightProviderMessages", () => {
  it("removes recall and status custom messages before provider serialization", () => {
    const messages = [
      { customType: "hindsight-recall", content: "old recall" },
      { customType: "hindsight-recall-status", content: "🧠 HINDSIGHT RECALL · memory context loaded" },
      { customType: "hindsight-retain-status", content: "💾 HINDSIGHT RETAIN" },
      { customType: "other", content: "keep" },
      { role: "user", content: "keep normal" },
    ];

    expect(filterHindsightProviderMessages(messages)).toEqual([messages[3], messages[4]]);
  });
});
