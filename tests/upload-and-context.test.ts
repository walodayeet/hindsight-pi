import { describe, expect, it } from "vitest";
import { chunkTextSmart, sanitizeCredentials } from "../extensions/upload.js";

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
});
