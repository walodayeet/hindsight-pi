import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pruneRecallMessagesInSessionFile } from "../extensions/prune.js";

let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("pruneRecallMessagesInSessionFile", () => {
  it("previews and removes only hindsight-recall entries", async () => {
    dir = mkdtempSync(join(tmpdir(), "hindsight-prune-"));
    const file = join(dir, "session.jsonl");
    writeFileSync(file, [
      JSON.stringify({ type: "session", id: "s" }),
      JSON.stringify({ type: "custom_message", customType: "hindsight-recall", content: "memory" }),
      JSON.stringify({ type: "custom_message", customType: "other", content: "keep" }),
      "not-json",
      "",
    ].join("\n"), "utf8");

    const preview = await pruneRecallMessagesInSessionFile(file);
    expect(preview).toEqual({ removed: 1, malformed: 1, changed: true });
    expect(readFileSync(file, "utf8")).toContain("hindsight-recall");

    const result = await pruneRecallMessagesInSessionFile(file, { write: true });
    expect(result.removed).toBe(1);
    const after = readFileSync(file, "utf8");
    expect(after).not.toContain("hindsight-recall");
    expect(after).toContain("other");
    expect(after).toContain("not-json");
  });
});
