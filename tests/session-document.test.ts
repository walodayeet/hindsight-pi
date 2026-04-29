import { describe, expect, it } from "vitest";
import { getParentSessionId, getSessionContext, getSessionDocumentId, parseCurrentSessionEntries, stableFallbackDocumentId } from "../extensions/session-document.js";

describe("session document helpers", () => {
  it("uses pi session id when available", () => {
    expect(getSessionDocumentId({ cwd: "/tmp/x", sessionManager: { getSessionId: () => "abc" } })).toBe("abc");
  });

  it("creates deterministic fallback id", () => {
    expect(stableFallbackDocumentId("/tmp/x", "a.jsonl")).toBe(stableFallbackDocumentId("/tmp/x", "a.jsonl"));
  });

  it("derives context from first user message", () => {
    const ctx = { cwd: "/tmp/project", sessionManager: { getSessionName: () => undefined, getEntries: () => [{ type: "message", message: { role: "user", content: "hello world" } }] } };
    expect(getSessionContext(ctx)).toBe("pi: hello world");
  });

  it("extracts parent session id from header path", () => {
    expect(getParentSessionId({ sessionManager: { getHeader: () => ({ parentSession: "/tmp/parent-123.jsonl" }) } })).toBe("parent-123");
  });

  it("parses current session message entries", () => {
    const ctx = { sessionManager: { getEntries: () => [{ type: "message", id: "1", message: { role: "user", content: "x" } }, { type: "custom", customType: "hindsight-meta" }] } };
    expect(parseCurrentSessionEntries(ctx)).toHaveLength(1);
  });
});
