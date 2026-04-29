import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { bootstrap, clearHandles, ensureBank, getBankInsights, getHandles } from "./client.js";
import { clearCachedContext, formatLastRecallInspection, renderCachedContext } from "./context.js";
import {
  type BankStrategy,
  type RecallMode,
  type ReasoningLevel,
  type RecallType,
  normalizeBankStrategy,
  normalizeRecallMode,
  normalizeReasoningLevel,
  normalizeRecallTypes,
  normalizeBaseUrl,
  inspectConfigSources,
  resolveConfig,
  saveConfig,
  setRecallMode,
} from "./config.js";
import { getFlushState, recordFlushFailure, recordFlushSuccess } from "./flush-state.js";
import { deriveBankId } from "./session.js";
import { getSessionDocumentId, parseCurrentSessionEntries } from "./session-document.js";
import { getHookStats } from "./hooks.js";
import { HINDSIGHT_META_TYPE, getHindsightMeta, nextMeta } from "./meta.js";
import { pruneRecallMessagesInSessionFile } from "./prune.js";
import { deleteQueue, readQueueRecords } from "./queue.js";

const mask = (value?: string): string => (value ? `${value.slice(0, 6)}...redacted` : "(none)");
const parseCsv = (value: string | undefined): string[] => (value ?? "").split(",").map((v) => v.trim()).filter(Boolean);
const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? "");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const parseBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
};
const parseWriteFrequency = (value: string | undefined, fallback: number | "async" | "turn" | "session") => {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  if (value === "async" || value === "turn" || value === "session") return value;
  return fallback;
};
const hinted = (label: string, current: string, recommendation?: string): string => {
  const suffix = recommendation ? ` Recommended: ${recommendation}.` : "";
  return `${label}\nEnter without typing keeps/selects current value: ${current}.${suffix}`;
};
const uniqueOptions = (current: string | undefined, options: string[]): string[] => {
  const seen = new Set<string>();
  const ordered = [current, ...options].filter((value): value is string => Boolean(value));
  return ordered.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
};
type WizardAction<T> =
  | { kind: "next"; value: T }
  | { kind: "back" }
  | { kind: "abort" };

const BACK = "← Back";
const ABORT = "✕ Abort setup";
const KEEP = "Keep current value";
const EDIT = "Edit value";
const boolLabel = (value: boolean): string => value ? "on" : "off";

const selectWizardAction = async (
  ctx: ExtensionContext,
  title: string,
  options: string[],
  allowBack = true,
): Promise<WizardAction<string>> => {
  const choice = await ctx.ui.select(title, [...options, ...(allowBack ? [BACK] : []), ABORT]);
  if (!choice || choice === ABORT) return { kind: "abort" };
  if (choice === BACK) return { kind: "back" };
  return { kind: "next", value: choice };
};

const inputWizardAction = async (
  ctx: ExtensionContext,
  title: string,
  current: string,
  recommendation?: string,
  allowBack = true,
): Promise<WizardAction<string>> => {
  const mode = await ctx.ui.select(
    `${title}\nCurrent: ${current || "(blank)"}${recommendation ? `\nRecommended: ${recommendation}` : ""}`,
    [KEEP, EDIT, ...(allowBack ? [BACK] : []), ABORT],
  );
  if (!mode || mode === ABORT) return { kind: "abort" };
  if (mode === BACK) return { kind: "back" };
  if (mode === KEEP) return { kind: "next", value: current };
  const value = await ctx.ui.input(hinted(title, current || "(blank)", recommendation), current);
  if (value === undefined) return { kind: "abort" };
  return { kind: "next", value };
};

const confirmWizardAction = async (
  ctx: ExtensionContext,
  title: string,
  current: boolean,
  recommendation?: string,
  allowBack = true,
): Promise<WizardAction<boolean>> => {
  const choice = await ctx.ui.select(
    `${title}\nCurrent: ${boolLabel(current)}${recommendation ? `\nRecommended: ${recommendation}` : ""}`,
    [boolLabel(current), ...uniqueOptions(undefined, ["on", "off"]).filter((value) => value !== boolLabel(current)), ...(allowBack ? [BACK] : []), ABORT],
  );
  if (!choice || choice === ABORT) return { kind: "abort" };
  if (choice === BACK) return { kind: "back" };
  return { kind: "next", value: choice === "on" };
};

const chooseRecallTypes = async (ctx: ExtensionContext, existing: readonly string[], allowBack = true): Promise<WizardAction<string>> => {
  let selected = new Set(normalizeRecallTypes(existing));
  const all: RecallType[] = ["observation", "experience", "world"];

  while (true) {
    const summary = all.map((type) => `${selected.has(type) ? "[x]" : "[ ]"} ${type}`).join("\n");
    const choice = await ctx.ui.select(
      `Recall types\nRecommended: observation for focused recall; observation,experience for richer recall\nCurrent:\n${summary}`,
      [
        ...all.map((type) => `${selected.has(type) ? "[x]" : "[ ]"} ${type}`),
        "Done",
        ...(allowBack ? [BACK] : []),
        ABORT,
      ],
    );

    if (!choice || choice === ABORT) return { kind: "abort" };
    if (choice === BACK) return { kind: "back" };
    if (choice === "Done") {
      const normalized = normalizeRecallTypes([...selected]);
      return { kind: "next", value: normalized.join(",") };
    }

    const type = choice.replace(/^\[[ x]\]\s*/, "") as RecallType;
    if (selected.has(type)) selected.delete(type);
    else selected.add(type);
    if (selected.size === 0) selected.add("observation");
  }
};

const describeConfigState = async (ctx: ExtensionContext): Promise<{ globalExists: boolean; projectExists: boolean; projectOverrides: boolean; summary: string }> => {
  const sources = await inspectConfigSources(ctx.cwd);
  const globalExists = sources.some((source) => source.exists && (source.kind === "global-json" || source.kind === "global-toml"));
  const projectExists = sources.some((source) => source.exists && (source.kind === "project-json" || source.kind === "project-toml"));
  return {
    globalExists,
    projectExists,
    projectOverrides: projectExists,
    summary: projectExists
      ? "Config: project overrides global for this repo"
      : globalExists
        ? "Config: global only"
        : "Config: no saved config yet",
  };
};

const chooseConfigScope = async (ctx: ExtensionContext, allowBack = true): Promise<WizardAction<"global" | "project">> => {
  const state = await describeConfigState(ctx);
  const choice = await selectWizardAction(ctx, `Where should this change be saved?\n${state.summary}`, [
    `Global (~/.hindsight/config.json)`,
    `Project (${ctx.cwd}/.hindsight/config.json)`,
  ], allowBack);
  if (choice.kind !== "next") return choice;
  return { kind: "next", value: choice.value.startsWith("Project") ? "project" : "global" };
};

const chooseScopeNow = async (ctx: ExtensionContext): Promise<"global" | "project" | null> => {
  const result = await chooseConfigScope(ctx, false);
  if (result.kind !== "next") return null;
  if (result.value === "project") ctx.ui.notify("Project config will override global settings for this repo.", "warning");
  return result.value;
};

const runStepLoop = async <T extends object>(
  ctx: ExtensionContext,
  steps: Array<(state: T, allowBack: boolean) => Promise<WizardAction<Partial<T>>>>,
  initial: T,
): Promise<T | undefined> => {
  const state = { ...initial };
  let index = 0;
  while (index < steps.length) {
    const result = await steps[index](state, index > 0);
    if (result.kind === "abort") {
      ctx.ui.notify("Setup aborted. No changes saved.", "warning");
      return undefined;
    }
    if (result.kind === "back") {
      index = Math.max(0, index - 1);
      continue;
    }
    Object.assign(state, result.value);
    index += 1;
  }
  return state;
};

const runSetupWizard = async (ctx: ExtensionContext): Promise<void> => {
  const existing = await resolveConfig(ctx.cwd);
  const scopeChoice = await chooseConfigScope(ctx, false);
  if (scopeChoice.kind !== "next") return;
  if (scopeChoice.value === "project") ctx.ui.notify("Project config will override global settings for this repo.", "warning");

  const enabled = await ctx.ui.confirm("Enable Hindsight?", `Current: ${boolLabel(existing.enabled)}`);
  const baseUrl = await ctx.ui.input("Hindsight base URL", existing.baseUrl);
  const apiKeyInput = await ctx.ui.input("Hindsight API key (optional)", existing.apiKey ?? "");
  const bankStrategyInput = await ctx.ui.select("Bank selection", ["Use fixed bank ID", "Use per-repo derived bank"]);
  const manualBankId = bankStrategyInput === "Use fixed bank ID"
    ? await ctx.ui.input("Bank ID", existing.bankId ?? "")
    : "";
  const recallModeInput = await ctx.ui.select("Recall mode", ["hybrid", "context", "tools", "off"]);
  const retainModeInput = await ctx.ui.select("Retain mode", ["response", "step-batch", "both", "off"]);

  await saveConfig({
    enabled,
    apiKey: apiKeyInput || undefined,
    baseUrl: normalizeBaseUrl(baseUrl ?? existing.baseUrl),
    bankId: manualBankId || undefined,
    bankStrategy: bankStrategyInput === "Use fixed bank ID" ? "manual" : "per-repo",
    recallMode: normalizeRecallMode(recallModeInput) as RecallMode,
    injectionFrequency: "every-turn",
    retainMode: retainModeInput as any,
    stepRetainThreshold: 5,
    writeFrequency: "turn",
    showRecallIndicator: true,
    showRetainIndicator: true,
    indicatorsInContext: false,
  }, { cwd: ctx.cwd, scope: scopeChoice.value });

  await connect(ctx);
  ctx.ui.notify("Hindsight basic setup saved. Advanced settings remain optional.", "success");
};

const runRecallWizard = async (ctx: ExtensionContext): Promise<void> => {
  const existing = await resolveConfig(ctx.cwd);
  const draft = await runStepLoop(ctx, [
    async (_state, allowBack) => {
      const result = await selectWizardAction(ctx, "Search budget\nRecommended: mid", uniqueOptions(existing.searchBudget, ["low", "mid", "high"]), allowBack);
      return result.kind === "next" ? { kind: "next", value: { searchBudgetInput: result.value } } : result;
    },
    async (_state, allowBack) => {
      const result = await selectWizardAction(ctx, "Reflect budget\nRecommended: low", uniqueOptions(existing.reflectBudget, ["low", "mid", "high"]), allowBack);
      return result.kind === "next" ? { kind: "next", value: { reflectBudgetInput: result.value } } : result;
    },
    async (_state, allowBack) => {
      const result = await inputWizardAction(ctx, "Context tokens", String(existing.contextTokens), "1200", allowBack);
      return result.kind === "next" ? { kind: "next", value: { contextTokensInput: result.value } } : result;
    },
    async (_state, allowBack) => {
      const result = await inputWizardAction(ctx, "Context TTL seconds", String(existing.contextRefreshTtlSeconds), "300", allowBack);
      return result.kind === "next" ? { kind: "next", value: { ttlInput: result.value } } : result;
    },
    async (_state, allowBack) => {
      const result = await inputWizardAction(ctx, "Context cadence turns", String(existing.contextCadence), "1 for freshest recall, 3-5 for long technical sessions", allowBack);
      return result.kind === "next" ? { kind: "next", value: { cadenceInput: result.value } } : result;
    },
    async (_state, allowBack) => {
      const result = await inputWizardAction(ctx, "Refresh after N uploaded turns/messages threshold", String(existing.contextRefreshMessageThreshold), "8", allowBack);
      return result.kind === "next" ? { kind: "next", value: { thresholdInput: result.value } } : result;
    },
    async (_state, allowBack) => {
      const result = await selectWizardAction(ctx, "Injection frequency\nRecommended: every-turn for fresh recall. first-turn now mainly affects continue/next-style follow-ups if you want more cache stability", uniqueOptions(existing.injectionFrequency, ["every-turn", "first-turn"]), allowBack);
      return result.kind === "next" ? { kind: "next", value: { injectionInput: result.value } } : result;
    },
    async (_state, allowBack) => {
      const result = await confirmWizardAction(ctx, "Show recall indicator?", existing.showRecallIndicator, undefined, allowBack);
      return result.kind === "next" ? { kind: "next", value: { recallIndicator: result.value } } : result;
    },
    async (_state, allowBack) => {
      const result = await confirmWizardAction(ctx, "Keep indicators in conversation context?", existing.indicatorsInContext, "off.", allowBack);
      return result.kind === "next" ? { kind: "next", value: { indicatorsInContext: result.value } } : result;
    },
    async (_state, allowBack) => {
      const result = await selectWizardAction(ctx, "Reflect reasoning level", uniqueOptions(existing.reasoningLevel, ["low", "medium", "high"]), allowBack);
      return result.kind === "next" ? { kind: "next", value: { reasoningInput: result.value } } : result;
    },
    async (_state, allowBack) => {
      const result = await selectWizardAction(ctx, "Reflect reasoning cap", uniqueOptions(existing.reasoningLevelCap ?? "(blank)", ["low", "medium", "high", "(blank)"]), allowBack);
      return result.kind === "next" ? { kind: "next", value: { reasoningCapInput: result.value } } : result;
    },
    async (_state, allowBack) => {
      const result = await confirmWizardAction(ctx, "Enable dynamic reflect budget bump?", existing.dialecticDynamic, undefined, allowBack);
      return result.kind === "next" ? { kind: "next", value: { dynamic: result.value } } : result;
    },
    async (_state, allowBack) => {
      const result = await chooseConfigScope(ctx, allowBack);
      return result.kind === "next" ? { kind: "next", value: { scope: result.value } } : result;
    },
  ], {} as any);
  if (!draft) return;

  await saveConfig({
    searchBudget: draft.searchBudgetInput === "low" || draft.searchBudgetInput === "high" ? draft.searchBudgetInput : "mid",
    reflectBudget: draft.reflectBudgetInput === "mid" || draft.reflectBudgetInput === "high" ? draft.reflectBudgetInput : "low",
    contextTokens: parsePositiveInt(draft.contextTokensInput, existing.contextTokens),
    contextRefreshTtlSeconds: parsePositiveInt(draft.ttlInput, existing.contextRefreshTtlSeconds),
    contextCadence: parsePositiveInt(draft.cadenceInput, existing.contextCadence),
    contextRefreshMessageThreshold: parsePositiveInt(draft.thresholdInput, existing.contextRefreshMessageThreshold),
    injectionFrequency: draft.injectionInput === "first-turn" ? "first-turn" : "every-turn",
    showRecallIndicator: draft.recallIndicator,
    indicatorsInContext: draft.indicatorsInContext,
    reasoningLevel: normalizeReasoningLevel(draft.reasoningInput),
    reasoningLevelCap: draft.reasoningCapInput === "(blank)" ? null : normalizeReasoningLevel(draft.reasoningCapInput),
    dialecticDynamic: draft.dynamic,
  }, { cwd: ctx.cwd, scope: draft.scope });
  const updated = await resolveConfig(ctx.cwd);
  setRecallMode(updated.recallMode);
  await connect(ctx);
  ctx.ui.notify(`Recall settings saved: mode=${updated.recallMode}, injection=${updated.injectionFrequency}, reflect=${updated.reflectBudget}`, "success");
};

const runRetainWizard = async (ctx: ExtensionContext): Promise<void> => {
  const existing = await resolveConfig(ctx.cwd);
  const draft = await runStepLoop(ctx, [
    async (_state, allowBack) => {
      const result = await inputWizardAction(ctx, "Step retain threshold", String(existing.stepRetainThreshold), "5", allowBack);
      return result.kind === "next" ? { kind: "next", value: { stepThresholdInput: result.value } } : result;
    },
    async (_state, allowBack) => {
      const result = await selectWizardAction(ctx, "Write frequency\nRecommended: turn for simplest behavior; async for non-blocking saves", uniqueOptions(String(existing.writeFrequency), ["turn", "async", "session", "5"]), allowBack);
      return result.kind === "next" ? { kind: "next", value: { writeFrequencyInput: result.value } } : result;
    },
    async (_state, allowBack) => {
      const result = await confirmWizardAction(ctx, "Save messages automatically?", existing.saveMessages, undefined, allowBack);
      return result.kind === "next" ? { kind: "next", value: { saveMessages: result.value } } : result;
    },
    async (_state, allowBack) => {
      const result = await confirmWizardAction(ctx, "Show retain indicator?", existing.showRetainIndicator, undefined, allowBack);
      return result.kind === "next" ? { kind: "next", value: { showRetainIndicator: result.value } } : result;
    },
    async (_state, allowBack) => {
      const result = await confirmWizardAction(ctx, "Keep indicators in conversation context?", existing.indicatorsInContext, "off.", allowBack);
      return result.kind === "next" ? { kind: "next", value: { indicatorsInContext: result.value } } : result;
    },
    async (_state, allowBack) => {
      const result = await inputWizardAction(ctx, "Max message length", String(existing.maxMessageLength), "25000", allowBack);
      return result.kind === "next" ? { kind: "next", value: { maxMessageLengthInput: result.value } } : result;
    },
    async (_state, allowBack) => {
      const result = await inputWizardAction(ctx, "Tool preview length", String(existing.toolPreviewLength), "500", allowBack);
      return result.kind === "next" ? { kind: "next", value: { toolPreviewLengthInput: result.value } } : result;
    },
    async (_state, allowBack) => {
      const result = await chooseConfigScope(ctx, allowBack);
      return result.kind === "next" ? { kind: "next", value: { scope: result.value } } : result;
    },
  ], {} as any);
  if (!draft) return;

  await saveConfig({
    stepRetainThreshold: parsePositiveInt(draft.stepThresholdInput, existing.stepRetainThreshold),
    writeFrequency: parseWriteFrequency(draft.writeFrequencyInput, existing.writeFrequency),
    saveMessages: draft.saveMessages,
    showRetainIndicator: draft.showRetainIndicator,
    indicatorsInContext: draft.indicatorsInContext,
    toolPreviewLength: parsePositiveInt(draft.toolPreviewLengthInput, existing.toolPreviewLength),
    maxMessageLength: parsePositiveInt(draft.maxMessageLengthInput, existing.maxMessageLength),
  }, { cwd: ctx.cwd, scope: draft.scope });
  const updated = await resolveConfig(ctx.cwd);
  await connect(ctx);
  ctx.ui.notify(`Retain settings saved: write=${updated.writeFrequency}, saveMessages=${updated.saveMessages ? "yes" : "no"}`, "success");
};

const runConfigTui = async (ctx: ExtensionContext): Promise<void> => {
  while (true) {
    const config = await resolveConfig(ctx.cwd);
    const configState = await describeConfigState(ctx);
    const choice = await ctx.ui.select(`Hindsight settings\n${configState.summary}\nBasic settings first. Advanced settings optional.`, [
      `Enabled: ${boolLabel(config.enabled)}`,
      `Base URL: ${config.baseUrl}`,
      `Bank strategy: ${config.bankStrategy}`,
      `Bank ID: ${config.bankId ?? "(none)"}`,
      `Recall mode: ${config.recallMode}`,
      `Retain mode: ${config.retainMode}`,
      `Advanced recall settings…`,
      `Advanced retain settings…`,
      `Show config sources`,
      `Connect now`,
      `Exit`,
    ]);
    if (!choice || choice === "Exit") return;
    if (choice === "Connect now") {
      await connect(ctx);
      ctx.ui.notify("Hindsight connected and cache refreshed.", "success");
      continue;
    }
    if (choice === "Show config sources") {
      const sources = await inspectConfigSources(ctx.cwd);
      const lines = [configState.summary, ""];
      for (const source of sources) lines.push(`${source.exists ? "✓" : "-"} ${source.kind}: ${source.path}`);
      ctx.ui.notify(lines.join("\n"), "info");
      continue;
    }
    if (choice === "Advanced recall settings…") {
      await runRecallWizard(ctx);
      continue;
    }
    if (choice === "Advanced retain settings…") {
      await runRetainWizard(ctx);
      continue;
    }

    const scope = await chooseScopeNow(ctx);
    if (!scope) return;

    if (choice.startsWith("Enabled:")) {
      await saveConfig({ enabled: await ctx.ui.confirm("Enable Hindsight?", `Current: ${boolLabel(config.enabled)}`) }, { cwd: ctx.cwd, scope });
    } else if (choice.startsWith("Base URL:")) {
      const value = await ctx.ui.input("Hindsight base URL", config.baseUrl);
      await saveConfig({ baseUrl: normalizeBaseUrl(value ?? config.baseUrl) }, { cwd: ctx.cwd, scope });
    } else if (choice.startsWith("Bank strategy:")) {
      const value = await ctx.ui.select("Bank strategy", ["manual", "per-repo", "per-directory", "git-branch", "pi-session", "global"]);
      await saveConfig({ bankStrategy: normalizeBankStrategy(value) as BankStrategy }, { cwd: ctx.cwd, scope });
    } else if (choice.startsWith("Bank ID:")) {
      const value = await ctx.ui.input("Bank ID", config.bankId ?? "");
      await saveConfig({ bankId: value || undefined, bankStrategy: value ? "manual" : "per-repo" }, { cwd: ctx.cwd, scope });
    } else if (choice.startsWith("Recall mode:")) {
      const value = await ctx.ui.select("Recall mode", ["hybrid", "context", "tools", "off"]);
      await saveConfig({ recallMode: normalizeRecallMode(value) }, { cwd: ctx.cwd, scope });
    } else if (choice.startsWith("Retain mode:")) {
      const value = await ctx.ui.select("Retain mode", ["response", "step-batch", "both", "off"]);
      await saveConfig({ retainMode: value as any }, { cwd: ctx.cwd, scope });
    }

    const updated = await resolveConfig(ctx.cwd);
    setRecallMode(updated.recallMode);
    await connect(ctx);
    ctx.ui.notify(`Saved to ${scope}. Active config refreshed.`, "success");
  }
};

const updateStatusBar = (ctx: ExtensionContext, state: "off" | "connected" | "syncing" | "offline"): void => {
  const labels: Record<typeof state, string> = {
    off: "🧠 Hindsight off",
    connected: "🧠 Hindsight connected",
    syncing: "🧠 Hindsight syncing",
    offline: "🧠 Hindsight offline",
  };
  ctx.ui.setStatus("hindsight", labels[state]);
};

const connect = async (ctx: ExtensionContext): Promise<void> => {
  clearHandles();
  const config = await resolveConfig(ctx.cwd);
  if (!config.enabled) {
    updateStatusBar(ctx, "off");
    throw new Error("Hindsight is disabled.");
  }
  try {
    await bootstrap(config, ctx.cwd);
    updateStatusBar(ctx, "connected");
  } catch (error) {
    updateStatusBar(ctx, "offline");
    throw error;
  }
};

const statusText = async (ctx: ExtensionContext): Promise<string> => {
  const config = await resolveConfig(ctx.cwd);
  const handles = getHandles();
  const bankId = handles?.bankId ?? await deriveBankId(ctx.cwd, config.bankStrategy, config);
  const cache = renderCachedContext();
  const bankSource = config.mappings[ctx.cwd]
    ? "mapped"
    : config.bankStrategy === "manual" && config.bankId
      ? "manual"
      : "derived";
  const insights = config.enabled
    ? await getBankInsights(config.baseUrl, config.apiKey, bankId).catch(() => ({ profile: null, directivesCount: null, mentalModelsCount: null, documentsCount: null, entitiesCount: null }))
    : { profile: null, directivesCount: null, mentalModelsCount: null, documentsCount: null, entitiesCount: null };
  const disposition = insights.profile?.disposition
    ? `skepticism=${insights.profile.disposition.skepticism ?? "?"}, literalism=${insights.profile.disposition.literalism ?? "?"}, empathy=${insights.profile.disposition.empathy ?? "?"}`
    : "none";

  const meta = getHindsightMeta(ctx.sessionManager.getEntries?.() ?? []);
  const queue = readQueueRecords(getSessionDocumentId(ctx), "auto");
  const flushState = getFlushState();
  const hooks = getHookStats();
  const hookText = (name: keyof typeof hooks): string => {
    const hook = hooks[name];
    return hook.firedAt ? `${hook.result ?? "ok"}${hook.detail ? ` (${hook.detail})` : ""}` : "not fired";
  };

  return [
    `Enabled: ${config.enabled ? "yes" : "no"}`,
    `Connected: ${handles ? "yes" : "no"}`,
    `Base URL: ${config.baseUrl}`,
    `Active bank: ${bankId} (${bankSource})`,
    `Global bank: ${config.globalBankId ?? "(none)"}`,
    `Bank name: ${insights.profile?.name ?? bankId}`,
    `Bank background: ${insights.profile?.background ?? ""}`,
    `Disposition: ${disposition}`,
    `Directives: ${insights.directivesCount ?? "unknown"}`,
    `Mental models: ${insights.mentalModelsCount ?? "unknown"}`,
    `Documents: ${insights.documentsCount ?? "unknown"}`,
    `Entities: ${insights.entitiesCount ?? "unknown"}`,
    `Strategy: ${config.bankStrategy}`,
    `Recall mode: ${config.recallMode}`,
    `Memory query mode: fresh recall across all memory types`,
    `Search budget: ${config.searchBudget}`,
    `Reflect budget: ${config.reflectBudget}`,
    `Reflect dynamic budget: ${config.dialecticDynamic ? "on" : "off"}`,
    `Reasoning level: ${config.reasoningLevel}`,
    `Reasoning cap: ${config.reasoningLevelCap ?? "(none)"}`,
    `Write frequency: ${config.writeFrequency}`,
    `Retain mode: ${config.retainMode}`,
    `Session retain: ${(meta?.retained ?? true) ? "enabled" : "disabled"}`,
    `Session tags: ${meta?.tags?.length ? meta.tags.join(", ") : "(none)"}`,
    `Queue: ${queue.records.length} auto record(s), ${queue.malformed} malformed`,
    `Last flush: ${flushState.lastFlushAt ?? "never"}`,
    `Last flush error: ${flushState.lastFlushError ?? "none"}`,
    `Step retain threshold: ${config.stepRetainThreshold}`,
    `Auto-create bank: ${config.autoCreateBank ? "yes" : "no"}`,
    `Injection: ${config.injectionFrequency}`,
    `Recall freshness: queried fresh from current user prompt each turn (no session cache)`,
    `Deprecated context TTL knob: ${config.contextRefreshTtlSeconds}s`,
    `Tool preview length: ${config.toolPreviewLength}`,
    `Max message length: ${config.maxMessageLength}`,
    `Save messages: ${config.saveMessages ? "yes" : "no"}`,
    `Recall indicator: ${config.showRecallIndicator ? (config.indicatorsInContext ? "in-context" : "ui-only") : "off"}`,
    `Recall tags: ${config.autoRecallTags?.length ? config.autoRecallTags.join(", ") : "(broad)"}`,
    `Recall tag match: ${config.autoRecallTagsMatch}`,
    `Observation scopes: ${config.observationScopes ? JSON.stringify(config.observationScopes) : "(default)"}`,
    `Retain indicator: ${config.showRetainIndicator ? (config.indicatorsInContext ? "in-context" : "ui-only") : "off"}`,
    `Hook session_start: ${hookText("sessionStart")}`,
    `Hook recall: ${hookText("recall")}`,
    `Hook retain: ${hookText("retain")}`,
    `Last recall payload: ${cache ? `${cache.length} chars` : "empty"}`,
  ].join("\n");
};

export const registerCommands = (pi: ExtensionAPI): void => {
  pi.registerCommand("hindsight:status", {
    description: "Show Hindsight connection and runtime status",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const text = await statusText(ctx);
      const config = await resolveConfig(ctx.cwd);
      updateStatusBar(ctx, !config.enabled ? "off" : getHandles() ? "connected" : "offline");
      ctx.ui.notify(text, "info");
    },
  });

  pi.registerCommand("hindsight:setup", {
    description: "Interactive first-time setup for Hindsight in pi",
    handler: async (_args: string, ctx: ExtensionContext) => {
      await runSetupWizard(ctx);
    },
  });

  pi.registerCommand("hindsight:config", {
    description: "Show effective Hindsight config with secrets redacted",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const config = await resolveConfig(ctx.cwd);
      const handles = getHandles();
      updateStatusBar(ctx, !config.enabled ? "off" : handles ? "connected" : "offline");
      const { renameSessionToBank: _renameSessionToBank, ...displayConfig } = config;
      ctx.ui.notify(JSON.stringify({ ...displayConfig, apiKey: mask(config.apiKey), connected: Boolean(handles), activeBank: handles?.bankId ?? null }, null, 2), "info");
    },
  });

  pi.registerCommand("hindsight:where", {
    description: "Show which Hindsight config files exist and what values they contribute",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const sources = await inspectConfigSources(ctx.cwd);
      const effective = await resolveConfig(ctx.cwd);
      const lines: string[] = [];
      lines.push(`Effective baseUrl: ${effective.baseUrl}`);
      lines.push(`Effective bankId: ${effective.bankId ?? "(none)"}`);
      lines.push(`Effective bankStrategy: ${effective.bankStrategy}`);
      lines.push(`Effective globalBankId: ${effective.globalBankId ?? "(none)"}`);
      lines.push("");
      for (const source of sources) {
        lines.push(`${source.exists ? "✓" : "-"} ${source.kind}: ${source.path}`);
        if (source.data) {
          const host = source.data.host?.pi;
          if (source.data.baseUrl || source.data.api_url) lines.push(`  baseUrl: ${source.data.baseUrl ?? source.data.api_url}`);
          if (source.data.bankId || source.data.bank_id) lines.push(`  bankId: ${source.data.bankId ?? source.data.bank_id}`);
          if (source.data.globalBankId || source.data.global_bank) lines.push(`  globalBankId: ${source.data.globalBankId ?? source.data.global_bank}`);
          if (source.data.bankStrategy) lines.push(`  bankStrategy: ${source.data.bankStrategy}`);
          if (host?.recallMode) lines.push(`  host.pi.recallMode: ${host.recallMode}`);
          if (host?.retainMode) lines.push(`  host.pi.retainMode: ${host.retainMode}`);
        }
      }
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("hindsight:connect", {
    description: "Connect or reconnect Hindsight now",
    handler: async (_args: string, ctx: ExtensionContext) => {
      await connect(ctx);
      updateStatusBar(ctx, "connected");
      ctx.ui.notify("Hindsight connected and cache refreshed.", "success");
    },
  });

  pi.registerCommand("hindsight:doctor", {
    description: "Run a Hindsight connectivity and bank preflight",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const config = await resolveConfig(ctx.cwd);
      const checks: string[] = [];
      checks.push(`enabled: ${config.enabled ? "yes" : "no"}`);
      checks.push(`base_url: ${config.baseUrl}`);
      checks.push(`workspace: ${config.workspace}`);
      checks.push(`global_bank: ${config.globalBankId ?? "none"}`);
      checks.push(`linked_hosts: ${config.linkedHosts.length > 0 ? config.linkedHosts.join(", ") : "none"}`);
      checks.push(`bank_strategy: ${config.bankStrategy}`);
      checks.push(`memory_query_mode: recall`);
      checks.push(`reasoning_level: ${config.reasoningLevel}`);
      checks.push(`reflect_dynamic_budget: ${config.dialecticDynamic ? "on" : "off"}`);
      checks.push(`auto_recall_tags: ${config.autoRecallTags?.length ? config.autoRecallTags.join(", ") : "broad"}`);
      checks.push(`auto_recall_tags_match: ${config.autoRecallTagsMatch}`);
      checks.push(`observation_scopes: ${config.observationScopes ? JSON.stringify(config.observationScopes) : "default"}`);
      if (config.autoRecallTags?.length && config.observationScopes && Array.isArray(config.observationScopes)) {
        const flatScopes = new Set(config.observationScopes.flat());
        const missing = config.autoRecallTags.filter((tag) => tag.startsWith("{") && !flatScopes.has(tag));
        if (missing.length > 0) checks.push(`warning: recall tag placeholder(s) not present in observationScopes: ${missing.join(", ")}`);
      }
      if (config.autoRecallTagsMatch.endsWith("strict") && !config.autoRecallTags?.length) {
        checks.push("warning: strict tag matching has no effect without autoRecallTags");
      }

      if (!config.enabled) {
        updateStatusBar(ctx, "off");
        ctx.ui.notify(checks.join("\n"), "warning");
        return;
      }

      try {
        const handles = await bootstrap(config, ctx.cwd);
        await ensureBank(handles.client, handles.bankId, handles.config);
        await handles.client.recall(handles.bankId, "health check", { budget: "low", maxTokens: 128 });
        const insights = await getBankInsights(config.baseUrl, config.apiKey, handles.bankId).catch(() => null);
        checks.push(`active_bank: ${handles.bankId}`);
        checks.push(`connectivity: ok`);
        if (insights) {
          checks.push(`bank_name: ${insights.profile?.name ?? handles.bankId}`);
          checks.push(`directives: ${insights.directivesCount ?? "unknown"}`);
          checks.push(`mental_models: ${insights.mentalModelsCount ?? "unknown"}`);
          checks.push(`documents: ${insights.documentsCount ?? "unknown"}`);
          checks.push(`entities: ${insights.entitiesCount ?? "unknown"}`);
        }
        if (handles.linked.length > 0) checks.push(`linked_resolved: ${handles.linked.map((h) => `${h.name}:${h.bankId}`).join(", ")}`);
        updateStatusBar(ctx, "connected");
        ctx.ui.notify(checks.join("\n"), "success");
      } catch (error) {
        checks.push(`connectivity: failed`);
        checks.push(`error: ${error instanceof Error ? error.message : String(error)}`);
        updateStatusBar(ctx, "offline");
        ctx.ui.notify(checks.join("\n"), "error");
      }
    },
  });

  pi.registerCommand("hindsight:stats", {
    description: "Fetch Hindsight bank stats if server exposes them",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const config = await resolveConfig(ctx.cwd);
      const bankId = getHandles()?.bankId ?? await deriveBankId(ctx.cwd, config.bankStrategy, config);
      try {
        const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/v1/default/banks/${encodeURIComponent(bankId)}/stats`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
          },
        });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const stats = await response.json();
        ctx.ui.notify(JSON.stringify({ bankId, stats }, null, 2), "info");
      } catch (error) {
        ctx.ui.notify(`Stats unavailable for ${bankId}: ${error instanceof Error ? error.message : String(error)}`, "warning");
      }
    },
  });

  pi.registerCommand("hindsight:mode", {
    description: "Switch Hindsight recall mode",
    handler: async (args: string, ctx: ExtensionContext) => {
      const mode = normalizeRecallMode(args?.trim() || "hybrid");
      setRecallMode(mode);
      ctx.ui.notify(`Recall mode set to ${mode}`, "info");
    },
  });

  pi.registerCommand("hindsight:sync", {
    description: "Clear last recall inspection state so the next user turn fetches fresh recall",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const handles = getHandles();
      if (!handles) {
        ctx.ui.notify("Hindsight is not connected. Run /hindsight:setup first.", "warning");
        return;
      }
      clearCachedContext();
      updateStatusBar(ctx, "connected");
      ctx.ui.notify("Cleared last recall preview. Hindsight recall is fetched fresh from the next user prompt.", "success");
    },
  });

  pi.registerCommand("hindsight:inspect-last-recall", {
    description: "Show the exact last Hindsight recall result set loaded for inspection",
    handler: async (_args: string, ctx: ExtensionContext) => {
      ctx.ui.notify(formatLastRecallInspection(), "info");
    },
  });

  pi.registerCommand("hindsight:popup", {
    description: "Show the exact last Hindsight recall result set loaded for inspection",
    handler: async (_args: string, ctx: ExtensionContext) => {
      ctx.ui.notify(formatLastRecallInspection(), "info");
    },
  });

  pi.registerCommand("hindsight:flush", {
    description: "Flush queued Hindsight retain records for the current session",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const handles = getHandles();
      if (!handles) {
        ctx.ui.notify("Hindsight is not connected. Run /hindsight:setup first.", "warning");
        return;
      }
      const sessionId = getSessionDocumentId(ctx);
      const { records, malformed } = readQueueRecords(sessionId, "auto");
      if (records.length === 0) {
        ctx.ui.notify(malformed ? `No valid queued records (${malformed} malformed line(s) ignored).` : "No queued Hindsight records for this session.", "info");
        return;
      }
      try {
        await handles.client.retainBatch(handles.bankId, records.map((record) => ({
          content: record.content,
          context: record.context,
          tags: record.tags,
          metadata: record.metadata,
          timestamp: record.timestamp,
          document_id: record.document_id,
          update_mode: record.update_mode,
          observation_scopes: record.observation_scopes,
        })), { async: false });
        deleteQueue(sessionId, "auto");
        recordFlushSuccess();
        ctx.ui.notify(`Flushed ${records.length} Hindsight queued record(s).`, "success");
      } catch (error) {
        recordFlushFailure(error);
        ctx.ui.notify(`Hindsight flush failed; queue preserved: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.registerCommand("hindsight:prune-recall-messages", {
    description: "Remove persisted hindsight-recall custom messages from the current session file (requires confirm)",
    handler: async (args: string, ctx: ExtensionContext) => {
      const sessionFile = ctx.sessionManager.getSessionFile?.();
      if (!sessionFile) {
        ctx.ui.notify("Current session is not persisted; nothing to prune.", "info");
        return;
      }
      const preview = await pruneRecallMessagesInSessionFile(sessionFile);
      if (args.trim() !== "confirm") {
        ctx.ui.notify(`Prune preview: would remove ${preview.removed} hindsight-recall entr${preview.removed === 1 ? "y" : "ies"} from ${sessionFile}. Re-run /hindsight:prune-recall-messages confirm to rewrite the file. Malformed lines preserved: ${preview.malformed}.`, "warning");
        return;
      }
      if (preview.removed === 0) {
        ctx.ui.notify("No persisted hindsight-recall messages found in current session.", "info");
        return;
      }
      const result = await pruneRecallMessagesInSessionFile(sessionFile, { write: true });
      ctx.ui.notify(`Removed ${result.removed} persisted hindsight-recall entr${result.removed === 1 ? "y" : "ies"} from current session file.`, "success");
    },
  });

  pi.registerCommand("hindsight:toggle-retain", {
    description: "Toggle automatic Hindsight retention for this session",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const entries = ctx.sessionManager.getEntries?.() ?? [];
      const current = getHindsightMeta(entries);
      const retained = !(current?.retained ?? true);
      pi.appendEntry(HINDSIGHT_META_TYPE, nextMeta(entries, { retained }));
      ctx.ui.notify(
        retained
          ? "Hindsight retention for this session is now enabled. If this session had retention disabled earlier, run /hindsight:parse-and-upsert-session before continuing to backfill prior turns."
          : "Hindsight retention for this session is now disabled. New auto-retain queue entries will not be created.",
        retained ? "success" : "warning",
      );
    },
  });

  pi.registerCommand("hindsight:tag", {
    description: "Add a Hindsight tag to the current session",
    handler: async (args: string, ctx: ExtensionContext) => {
      const tag = args.trim();
      if (!tag) { ctx.ui.notify("Usage: /hindsight:tag <tag>", "warning"); return; }
      const entries = ctx.sessionManager.getEntries?.() ?? [];
      const current = getHindsightMeta(entries) ?? { retained: true, tags: [] };
      const tags = [...new Set([...(current.tags ?? []), tag])];
      pi.appendEntry(HINDSIGHT_META_TYPE, nextMeta(entries, { tags }));
      ctx.ui.notify(`Added Hindsight session tag: ${tag}`, "success");
    },
  });

  pi.registerCommand("hindsight:remove-tag", {
    description: "Remove a Hindsight tag from the current session",
    handler: async (args: string, ctx: ExtensionContext) => {
      const tag = args.trim();
      if (!tag) { ctx.ui.notify("Usage: /hindsight:remove-tag <tag>", "warning"); return; }
      const entries = ctx.sessionManager.getEntries?.() ?? [];
      const current = getHindsightMeta(entries) ?? { retained: true, tags: [] };
      const tags = (current.tags ?? []).filter((value) => value !== tag);
      pi.appendEntry(HINDSIGHT_META_TYPE, nextMeta(entries, { tags }));
      ctx.ui.notify(`Removed Hindsight session tag: ${tag}`, "success");
    },
  });

  pi.registerCommand("hindsight:parse-session", {
    description: "Parse the current Pi session to Hindsight JSON records without uploading",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const records = parseCurrentSessionEntries(ctx);
      ctx.ui.notify(JSON.stringify({ document_id: getSessionDocumentId(ctx), count: records.length, records }, null, 2), "info");
    },
  });

  pi.registerCommand("hindsight:parse-and-upsert-session", {
    description: "Parse and upsert the current Pi session to Hindsight using stable document id",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const handles = getHandles();
      if (!handles) { ctx.ui.notify("Hindsight is not connected. Run /hindsight:setup first.", "warning"); return; }
      const records = parseCurrentSessionEntries(ctx);
      const documentId = getSessionDocumentId(ctx);
      await handles.client.retainBatch(handles.bankId, [{
        content: JSON.stringify(records),
        document_id: documentId,
        update_mode: "replace",
        context: `pi session ${documentId}`,
        timestamp: ctx.sessionManager.getHeader?.()?.timestamp ?? new Date().toISOString(),
        tags: ["harness:pi", `session:${documentId}`, "store_method:import"],
      }], { async: false });
      ctx.ui.notify(`Upserted ${records.length} parsed session record(s) to Hindsight document ${documentId}.`, "success");
    },
  });

  pi.registerCommand("hindsight:upsert-historical-sessions", {
    description: "Upsert persisted sessions from the current session directory (requires confirm)",
    handler: async (args: string, ctx: ExtensionContext) => {
      const handles = getHandles();
      if (!handles) { ctx.ui.notify("Hindsight is not connected. Run /hindsight:setup first.", "warning"); return; }
      const sessionDir = ctx.sessionManager.getSessionDir?.();
      if (!sessionDir) { ctx.ui.notify("No session directory available.", "warning"); return; }
      const files = (await readdir(sessionDir)).filter((file) => file.endsWith(".jsonl"));
      if (args.trim() !== "confirm") {
        ctx.ui.notify(`Historical import preview: would parse/upsert ${files.length} session file(s) from ${sessionDir}. Re-run /hindsight:upsert-historical-sessions confirm to upload.`, "warning");
        return;
      }
      let uploaded = 0;
      for (const file of files) {
        const path = join(sessionDir, file);
        const raw = await readFile(path, "utf8").catch(() => "");
        const records = raw.split(/\r?\n/).flatMap((line) => {
          if (!line.trim()) return [];
          try {
            const entry = JSON.parse(line);
            return entry?.type === "message" ? [{ id: entry.id, parentId: entry.parentId, timestamp: entry.timestamp, type: entry.type, message: entry.message }] : [];
          } catch { return []; }
        });
        if (records.length === 0) continue;
        const documentId = basename(file, ".jsonl");
        await handles.client.retainBatch(handles.bankId, [{
          content: JSON.stringify(records),
          document_id: documentId,
          update_mode: "replace",
          context: `pi historical session ${documentId}`,
          tags: ["harness:pi", `session:${documentId}`, "store_method:import"],
          timestamp: records[0]?.timestamp ?? new Date().toISOString(),
        }], { async: false });
        uploaded += 1;
      }
      ctx.ui.notify(`Upserted ${uploaded}/${files.length} historical session file(s).`, "success");
    },
  });

  pi.registerCommand("hindsight:profile", {
    description: "Apply a Hindsight v3 setup profile: broad | project | cwd | global | isolated",
    handler: async (args: string, ctx: ExtensionContext) => {
      const profile = args.trim() || "project";
      const current = await resolveConfig(ctx.cwd);
      if (profile === "broad" || profile === "single-bank-broad") {
        await saveConfig({ autoRecallTags: null, autoRecallTagsMatch: "any", constantTags: current.constantTags?.length ? current.constantTags : ["harness:pi"] }, { cwd: ctx.cwd, scope: "project" });
        ctx.ui.notify("Applied broad recall profile: one bank with no recall tag filter.", "success");
        return;
      }
      if (profile === "project" || profile === "single-bank-project") {
        await saveConfig({ autoRecallTags: ["{project}"], autoRecallTagsMatch: "any_strict", observationScopes: [["{project}"]], constantTags: current.constantTags?.length ? current.constantTags : ["harness:pi"] }, { cwd: ctx.cwd, scope: "project" });
        ctx.ui.notify("Applied project-scoped recall profile using {project} tags/scopes.", "success");
        return;
      }
      if (profile === "cwd") {
        await saveConfig({ autoRecallTags: ["{cwd}"], autoRecallTagsMatch: "any_strict", observationScopes: [["{cwd}"]], constantTags: current.constantTags?.length ? current.constantTags : ["harness:pi"] }, { cwd: ctx.cwd, scope: "project" });
        ctx.ui.notify("Applied cwd-scoped recall profile using {cwd} tags/scopes.", "success");
        return;
      }
      if (profile === "global") {
        await saveConfig({ bankStrategy: "global", autoRecallTags: null, autoRecallTagsMatch: "any" }, { cwd: ctx.cwd, scope: "project" });
        ctx.ui.notify("Applied global-only bank profile for this project config.", "success");
        return;
      }
      if (profile === "isolated") {
        await saveConfig({ bankStrategy: "per-repo", autoRecallTags: ["{project}"], autoRecallTagsMatch: "any_strict", observationScopes: [["{project}"]] }, { cwd: ctx.cwd, scope: "project" });
        ctx.ui.notify("Applied hard-isolation-ish profile: per-repo bank plus project tags.", "success");
        return;
      }
      ctx.ui.notify("Usage: /hindsight:profile broad|project|cwd|global|isolated", "warning");
    },
  });

  pi.registerCommand("hindsight:map", {
    description: "Map current directory to explicit Hindsight bank ID",
    handler: async (args: string, ctx: ExtensionContext) => {
      const bankId = args?.trim();
      if (!bankId) {
        ctx.ui.notify("Usage: /hindsight:map <bank-id>", "warning");
        return;
      }
      const current = await resolveConfig(ctx.cwd);
      await saveConfig({
        mappings: { ...current.mappings, [ctx.cwd]: bankId },
      }, { cwd: ctx.cwd, scope: "global" });
      ctx.ui.notify(`Mapped ${ctx.cwd} → ${bankId}`, "success");
    },
  });

  pi.registerCommand("hindsight:settings", {
    description: "Interactive Hindsight settings",
    handler: async (_args: string, ctx: ExtensionContext) => {
      await runConfigTui(ctx);
    },
  });
};
