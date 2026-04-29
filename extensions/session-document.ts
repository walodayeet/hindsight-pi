import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

const textFromContent = (content: unknown): string => {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.map((block: any) => typeof block === "string" ? block : typeof block?.text === "string" ? block.text : "").join(" ").trim();
};

export const stableFallbackDocumentId = (cwd: string, sessionFile?: string | null): string => {
  const input = `${resolve(cwd)}\n${sessionFile ?? ""}`;
  return `pi-session-${createHash("sha256").update(input).digest("hex").slice(0, 24)}`;
};

export const getSessionDocumentId = (ctx: any): string => {
  const id = ctx?.sessionManager?.getSessionId?.();
  if (id) return id;
  return stableFallbackDocumentId(ctx?.cwd ?? process.cwd(), ctx?.sessionManager?.getSessionFile?.());
};

export const getParentSessionId = (ctx: any): string | undefined => {
  const parent = ctx?.sessionManager?.getHeader?.()?.parentSession;
  if (!parent || typeof parent !== "string") return undefined;
  const normalized = parent.replace(/\\/g, "/");
  const file = normalized.split("/").pop() ?? normalized;
  return file.replace(/\.jsonl$/i, "") || undefined;
};

export const getSessionStartTimestamp = (ctx: any): string => {
  const header = ctx?.sessionManager?.getHeader?.();
  return header?.timestamp ?? new Date().toISOString();
};

export const getSessionContext = (ctx: any, prefix = "pi: ", maxLength = 100): string => {
  const name = ctx?.sessionManager?.getSessionName?.();
  const entries = ctx?.sessionManager?.getEntries?.() ?? [];
  const firstUser = entries.find((entry: any) => entry?.type === "message" && entry.message?.role === "user");
  const firstText = textFromContent(firstUser?.message?.content);
  const cwdName = basename(resolve(ctx?.cwd ?? process.cwd()));
  const raw = `${prefix}${name || firstText || cwdName}`;
  return raw.length > maxLength ? raw.slice(0, maxLength) : raw;
};

export const parseCurrentSessionEntries = (ctx: any): Record<string, unknown>[] => {
  const entries = ctx?.sessionManager?.getEntries?.() ?? [];
  return entries
    .filter((entry: any) => entry?.type === "message")
    .map((entry: any) => ({
      id: entry.id,
      parentId: entry.parentId,
      timestamp: entry.timestamp,
      type: entry.type,
      message: entry.message,
    }));
};
