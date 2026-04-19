import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeBankStrategy, normalizeRecallMode } from "../extensions/config.js";
import { deriveBankId, sanitizeBankId } from "../extensions/session.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("config normalization", () => {
  it("normalizes supported strategies and falls back safely", () => {
    expect(normalizeBankStrategy("per-repo")).toBe("per-repo");
    expect(normalizeBankStrategy("manual")).toBe("manual");
    expect(normalizeBankStrategy("weird")).toBe("per-repo");
  });

  it("normalizes recall mode and falls back to hybrid", () => {
    expect(normalizeRecallMode("tools")).toBe("tools");
    expect(normalizeRecallMode("off")).toBe("off");
    expect(normalizeRecallMode("strange")).toBe("hybrid");
  });
});

describe("bank id derivation", () => {
  it("sanitizes unsafe bank ids", () => {
    expect(sanitizeBankId("My Repo/Feature Branch")).toBe("my-repo-feature-branch");
  });

  it("uses explicit mapping before strategy", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "hindsight-pi-"));
    tempDirs.push(cwd);
    const config = {
      bankId: undefined,
      globalBankId: undefined,
      bankStrategy: "per-repo",
      mappings: { [cwd]: "Mapped Bank" },
    } as any;

    await expect(deriveBankId(cwd, "per-repo", config)).resolves.toBe("mapped-bank");
  });

  it("uses manual bank id when strategy is manual", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "hindsight-pi-"));
    tempDirs.push(cwd);
    const config = {
      bankId: "Team Memory",
      globalBankId: undefined,
      bankStrategy: "manual",
      mappings: {},
    } as any;

    await expect(deriveBankId(cwd, "manual", config)).resolves.toBe("team-memory");
  });

  it("falls back to a deterministic derived bank id outside git repo", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "hindsight-pi-"));
    tempDirs.push(cwd);
    const config = {
      bankId: undefined,
      globalBankId: undefined,
      bankStrategy: "per-repo",
      mappings: {},
    } as any;

    const bankId = await deriveBankId(cwd, "per-repo", config);
    expect(bankId.length).toBeGreaterThan(5);
    expect(bankId).toMatch(/^[a-z0-9_-]+$/);
  });
});
