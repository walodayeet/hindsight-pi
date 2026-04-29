import { describe, expect, it } from "vitest";
import { deriveRecallQuery } from "../extensions/recall-query.js";

describe("deriveRecallQuery", () => {
  it("uses normal raw input", () => {
    expect(deriveRecallQuery({ rawInput: "remember project routing" })).toMatchObject({ kind: "query", query: "remember project routing", source: "raw" });
  });

  it("uses slash command args as intent", () => {
    expect(deriveRecallQuery({ rawInput: "/skill:create-agents-md create new AGENTS.md", expandedPrompt: "huge expanded skill" })).toMatchObject({
      kind: "query",
      query: "create new AGENTS.md",
      source: "slash-args",
    });
  });

  it("skips pure hindsight slash commands", () => {
    expect(deriveRecallQuery({ rawInput: "/hindsight:status" })).toMatchObject({ kind: "skip", reason: "slash-command" });
  });

  it("never uses expanded skill body when raw input exists", () => {
    const expandedPrompt = "x".repeat(10_000);
    expect(deriveRecallQuery({ rawInput: "/skill:test short task", expandedPrompt })).toMatchObject({ kind: "query", query: "short task" });
  });

  it("skips long query by default", () => {
    expect(deriveRecallQuery({ rawInput: "x".repeat(801), maxChars: 800 })).toMatchObject({ kind: "skip", reason: "query-too-long" });
  });

  it("can truncate long query", () => {
    const decision = deriveRecallQuery({ rawInput: "x".repeat(801), maxChars: 800, longQueryBehavior: "truncate" });
    expect(decision).toMatchObject({ kind: "query", truncated: true });
    if (decision.kind === "query") expect(decision.query).toHaveLength(800);
  });
});
