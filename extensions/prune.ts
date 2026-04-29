import { readFile, writeFile } from "node:fs/promises";

export interface PruneRecallMessagesResult {
  removed: number;
  malformed: number;
  changed: boolean;
}

export const pruneRecallMessagesInSessionFile = async (sessionFile: string, options: { write?: boolean } = {}): Promise<PruneRecallMessagesResult> => {
  const raw = await readFile(sessionFile, "utf8");
  const lines = raw.split(/\r?\n/);
  let malformed = 0;
  let removed = 0;
  const kept = lines.filter((line) => {
    if (!line.trim()) return true;
    try {
      const entry = JSON.parse(line);
      const isRecall = (entry.type === "custom_message" || entry.type === "custom") && entry.customType === "hindsight-recall";
      if (isRecall) removed += 1;
      return !isRecall;
    } catch {
      malformed += 1;
      return true;
    }
  });
  if (options.write && removed > 0) await writeFile(sessionFile, kept.join("\n"), "utf8");
  return { removed, malformed, changed: removed > 0 };
};
