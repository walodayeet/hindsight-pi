import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeBankStrategy, normalizeRecallMode, normalizeRecallTypes, readConfigFile } from "../extensions/config.js";
import { deriveBankId, sanitizeBankId } from "../extensions/session.js";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

beforeEach(async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "hindsight-home-"));
  tempDirs.push(fakeHome);
  process.env.HOME = fakeHome;
});

afterEach(async () => {
  process.env.HOME = originalHome;
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

  it("normalizes recall types and falls back to observation", () => {
    expect(normalizeRecallTypes(["world", "experience", "bad"])) .toEqual(["world", "experience"]);
    expect(normalizeRecallTypes("observation,experience,unknown")).toEqual(["observation", "experience"]);
    expect(normalizeRecallTypes(undefined)).toEqual(["observation"]);
  });
});

describe("config file resolution", () => {
  it("merges global and local config.json files", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "hindsight-pi-project-"));
    tempDirs.push(cwd);

    const globalDir = join(homedir(), ".hindsight");
    const localDir = join(cwd, ".hindsight");
    await mkdir(globalDir, { recursive: true });
    await mkdir(localDir, { recursive: true });

    await writeFile(join(globalDir, "config.json"), JSON.stringify({
      baseUrl: "http://global",
      globalBankId: "global-memory",
      host: { pi: { recallMode: "hybrid", saveMessages: true } },
      mappings: { "/global": "bank-global" },
    }));
    await writeFile(join(localDir, "config.json"), JSON.stringify({
      bankId: "local-bank",
      host: { pi: { recallMode: "tools", contextTokens: 900 } },
      mappings: { [cwd]: "bank-local" },
    }));

    const merged = await readConfigFile(cwd);
    expect(merged?.baseUrl).toBe("http://global");
    expect(merged?.globalBankId).toBe("global-memory");
    expect(merged?.bankId).toBe("local-bank");
    expect(merged?.host?.pi?.recallMode).toBe("tools");
    expect(merged?.host?.pi?.saveMessages).toBe(true);
    expect(merged?.host?.pi?.contextTokens).toBe(900);
    expect(merged?.mappings?.[cwd]).toBe("bank-local");
    expect(merged?.mappings?.["/global"]).toBe("bank-global");
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

  it("uses global bank when strategy is global", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "hindsight-pi-"));
    tempDirs.push(cwd);
    const config = {
      bankId: undefined,
      globalBankId: "Global Memory",
      bankStrategy: "global",
      mappings: {},
    } as any;

    await expect(deriveBankId(cwd, "global", config)).resolves.toBe("global-memory");
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
