import { createHash } from "node:crypto";
import type { HindsightConfig, BankStrategy } from "./config.js";
import { execGit } from "./git.js";

const hash = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 10);

export const sanitizeBankId = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "pi-memory";

const directoryKey = (cwd: string): string => sanitizeBankId(`dir-${cwd.split(/[\\/]/).pop() ?? "project"}-${hash(cwd)}`);

const repoRoot = async (cwd: string): Promise<string | null> => {
  const result = await execGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (result?.code === 0) {
    const root = result.stdout.trim();
    return root ? root : null;
  }
  return null;
};

const repoSlug = async (cwd: string): Promise<string | null> => {
  const remote = await execGit(cwd, ["remote", "get-url", "origin"]);
  if (remote?.code === 0 && remote.stdout.trim()) {
    const url = remote.stdout.trim().replace(/\.git$/, "");
    const name = url.split(/[/:]/).pop();
    if (name) return sanitizeBankId(name);
  }

  const root = await repoRoot(cwd);
  if (!root) return null;
  const name = root.split(/[\\/]/).pop() ?? "repo";
  return sanitizeBankId(`${name}-${hash(root)}`);
};

const branchName = async (cwd: string): Promise<string | null> => {
  const result = await execGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = result?.code === 0 ? result.stdout.trim() : "";
  if (!branch || branch === "HEAD") return null;
  return sanitizeBankId(branch);
};

const sessionSlug = (): string => sanitizeBankId(`session-${Date.now().toString(36)}`);

export const deriveBankId = async (cwd: string, strategy: BankStrategy, config: HindsightConfig): Promise<string> => {
  const mapped = config.mappings[cwd];
  if (mapped) return sanitizeBankId(mapped);

  if (strategy === "manual" && config.bankId) return sanitizeBankId(config.bankId);
  if (strategy === "global") return sanitizeBankId(config.globalBankId ?? "pi-global-memory");
  if (strategy === "pi-session") return sessionSlug();
  if (strategy === "per-directory") return directoryKey(cwd);

  const repo = await repoSlug(cwd);
  if (strategy === "per-repo") return repo ?? directoryKey(cwd);

  const root = repo ?? directoryKey(cwd);
  const branch = await branchName(cwd);
  return branch ? sanitizeBankId(`${root}--${branch}`) : root;
};
