import { describe, expect, it } from "vitest";
import { getHindsightMeta, nextMeta, sessionRetained, sessionTags } from "../extensions/meta.js";

describe("hindsight session meta", () => {
  const entries = [
    { type: "custom", customType: "hindsight-meta", data: { retained: true, tags: ["a"] } },
    { type: "custom", customType: "other", data: { retained: false } },
    { type: "custom", customType: "hindsight-meta", data: { retained: false, tags: ["b", 1, "c"] } },
  ];

  it("reads the latest hindsight meta", () => {
    expect(getHindsightMeta(entries)).toEqual({ retained: false, tags: ["b", "c"] });
    expect(sessionRetained(entries)).toBe(false);
    expect(sessionTags(entries)).toEqual(["b", "c"]);
  });

  it("builds next meta from patch", () => {
    expect(nextMeta(entries, { tags: ["x"] })).toEqual({ retained: false, tags: ["x"] });
    expect(nextMeta([], { retained: false })).toEqual({ retained: false, tags: [] });
  });
});
