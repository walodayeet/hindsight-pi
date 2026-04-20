import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { bootstrap, clearHandles, ensureBank, getBankInsights, getHandles } from "./client.js";
import { clearCachedContext, refreshCachedContext, renderCachedContext } from "./context.js";
import {
  type BankStrategy,
  type RecallMode,
  type ReasoningLevel,
  type RecallType,
  normalizeBankStrategy,
  normalizeRecallMode,
  normalizeReasoningLevel,
  normalizeRecallTypes,
  resolveConfig,
  saveConfig,
  setRecallMode,
} from "./config.js";
import { deriveBankId } from "./session.js";
import { getHookStats } from "./hooks.js";

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
const runSetupWizard = async (ctx: ExtensionContext): Promise<void> => {
  const existing = await resolveConfig(ctx.cwd);
  const enabledInput = await ctx.ui.input(hinted("Enable Hindsight (true/false)", existing.enabled ? "true" : "false", "true if you have Hindsight running"), existing.enabled ? "true" : "false");
  const baseUrl = await ctx.ui.input(hinted("Hindsight base URL", existing.baseUrl || "http://localhost:8888", "http://localhost:8888 for local server"), existing.baseUrl || "http://localhost:8888");
  const apiKeyInput = await ctx.ui.input(hinted("Hindsight API key (optional for local)", mask(existing.apiKey), "blank for local/self-hosted without auth"), mask(existing.apiKey));
  const workspace = await ctx.ui.input(hinted("Workspace label", existing.workspace, "pi"), existing.workspace);
  const linkedHostsInput = await ctx.ui.input(hinted("Linked host bank aliases (comma-separated, optional)", existing.linkedHosts.join(", ") || "(none)", "blank unless you use multiple Hindsight hosts"), existing.linkedHosts.join(", "));
  const bankStrategyInput = await ctx.ui.input(hinted("Bank strategy", existing.bankStrategy, "per-repo for most users"), existing.bankStrategy);
  const manualBankId = await ctx.ui.input(hinted("Manual bank ID (optional)", existing.bankId ?? "(blank)", "blank unless using manual strategy"), existing.bankId ?? "");
  const globalBankIdInput = await ctx.ui.input(hinted("Global bank ID (optional, for shared memory)", existing.globalBankId ?? "(blank)", "blank unless you want cross-project pool"), existing.globalBankId ?? "");
  const recallModeInput = await ctx.ui.input(hinted("Recall mode (hybrid/context/tools/off)", existing.recallMode, "hybrid for most users; tools if you want max prompt-cache stability"), existing.recallMode);
  const recallTypesInput = await ctx.ui.input(hinted("Recall types (observation,experience,world)", existing.recallTypes.join(","), "observation for focused recall; observation,experience for richer recall"), existing.recallTypes.join(","));
  const autoCreateBankInput = await ctx.ui.input(hinted("Auto-create banks (true/false)", existing.autoCreateBank ? "true" : "false", "true for easiest onboarding"), existing.autoCreateBank ? "true" : "false");
  const writeFrequencyInput = await ctx.ui.input(hinted("Write frequency (async/turn/session/or positive integer)", String(existing.writeFrequency), "5 for technical chats, turn for immediate save after every response"), String(existing.writeFrequency));
  const saveMessagesInput = await ctx.ui.input(hinted("Save messages (true/false)", existing.saveMessages ? "true" : "false", "true"), existing.saveMessages ? "true" : "false");
  const recallIndicatorInput = await ctx.ui.input(hinted("Show recall indicator (true/false)", existing.showRecallIndicator ? "true" : "false", "true"), existing.showRecallIndicator ? "true" : "false");
  const retainIndicatorInput = await ctx.ui.input(hinted("Show retain indicator (true/false)", existing.showRetainIndicator ? "true" : "false", "true"), existing.showRetainIndicator ? "true" : "false");
  const indicatorsInContextInput = await ctx.ui.input(hinted("Keep indicators in conversation context (true/false)", existing.indicatorsInContext ? "true" : "false", "false so hints stay UI-only"), existing.indicatorsInContext ? "true" : "false");
  await ctx.ui.notify("Session naming left to pi default. Extension no longer renames sessions.", "info");
  const reasoningLevelInput = await ctx.ui.input(hinted("Reflect reasoning level (low/medium/high)", existing.reasoningLevel, "low for cost-friendly default"), existing.reasoningLevel);
  const reasoningCapInput = await ctx.ui.input(hinted("Reflect reasoning cap (blank/low/medium/high)", existing.reasoningLevelCap ?? "(blank)", "blank or medium"), existing.reasoningLevelCap ?? "");
  const dynamicInput = await ctx.ui.input(hinted("Reflect dynamic budget bump (true/false)", existing.dialecticDynamic ? "true" : "false", "true"), existing.dialecticDynamic ? "true" : "false");
  const toolPreviewLengthInput = await ctx.ui.input(hinted("Tool preview length", String(existing.toolPreviewLength), "500"), String(existing.toolPreviewLength));

  await saveConfig({
    enabled: parseBool(enabledInput, existing.enabled),
    apiKey: apiKeyInput && apiKeyInput !== mask(existing.apiKey) ? apiKeyInput : existing.apiKey,
    baseUrl: baseUrl ?? existing.baseUrl,
    bankId: manualBankId || undefined,
    globalBankId: globalBankIdInput || undefined,
    bankStrategy: normalizeBankStrategy(bankStrategyInput) as BankStrategy,
    recallMode: normalizeRecallMode(recallModeInput) as RecallMode,
    recallTypes: normalizeRecallTypes(parseCsv(recallTypesInput)) as RecallType[],
    autoCreateBank: parseBool(autoCreateBankInput, existing.autoCreateBank),
    workspace: workspace ?? existing.workspace,
    linkedHosts: parseCsv(linkedHostsInput),
    saveMessages: parseBool(saveMessagesInput, existing.saveMessages),
    writeFrequency: parseWriteFrequency(writeFrequencyInput, existing.writeFrequency),
    showRecallIndicator: parseBool(recallIndicatorInput, existing.showRecallIndicator),
    showRetainIndicator: parseBool(retainIndicatorInput, existing.showRetainIndicator),
    indicatorsInContext: parseBool(indicatorsInContextInput, existing.indicatorsInContext),
    renameSessionToBank: false,
    reasoningLevel: normalizeReasoningLevel(reasoningLevelInput) as ReasoningLevel,
    reasoningLevelCap: reasoningCapInput?.trim() ? normalizeReasoningLevel(reasoningCapInput) as ReasoningLevel : null,
    dialecticDynamic: parseBool(dynamicInput, existing.dialecticDynamic),
    toolPreviewLength: parsePositiveInt(toolPreviewLengthInput, existing.toolPreviewLength),
  });

  await connect(ctx);
  ctx.ui.notify("Hindsight config saved. Recommended default for most users: per-repo + hybrid + writeFrequency=5 + indicatorsInContext=false.", "success");
};

const runRecallWizard = async (ctx: ExtensionContext): Promise<void> => {
  const existing = await resolveConfig(ctx.cwd);
  const recallModeInput = await ctx.ui.input(hinted("Recall mode (hybrid/context/tools/off)", existing.recallMode, "hybrid for most users; tools for best prompt-cache stability"), existing.recallMode);
  const recallTypesInput = await ctx.ui.input(hinted("Recall types (observation,experience,world)", existing.recallTypes.join(","), "observation or observation,experience"), existing.recallTypes.join(","));
  const searchBudgetInput = await ctx.ui.input(hinted("Search budget (low/mid/high)", existing.searchBudget, "mid"), existing.searchBudget);
  const reflectBudgetInput = await ctx.ui.input(hinted("Reflect budget (low/mid/high)", existing.reflectBudget, "low for cost-friendly default"), existing.reflectBudget);
  const contextTokensInput = await ctx.ui.input(hinted("Context tokens", String(existing.contextTokens), "1200"), String(existing.contextTokens));
  const ttlInput = await ctx.ui.input(hinted("Context TTL seconds", String(existing.contextRefreshTtlSeconds), "300"), String(existing.contextRefreshTtlSeconds));
  const cadenceInput = await ctx.ui.input(hinted("Context cadence turns", String(existing.contextCadence), "1 for freshest recall, 3-5 for long technical sessions"), String(existing.contextCadence));
  const thresholdInput = await ctx.ui.input(hinted("Refresh after N uploaded turns/messages threshold", String(existing.contextRefreshMessageThreshold), "8"), String(existing.contextRefreshMessageThreshold));
  const injectionInput = await ctx.ui.input(hinted("Injection frequency (every-turn/first-turn)", existing.injectionFrequency, "first-turn if you care about prompt caching"), existing.injectionFrequency);
  const recallIndicatorInput = await ctx.ui.input(hinted("Show recall indicator (true/false)", existing.showRecallIndicator ? "true" : "false", "true"), existing.showRecallIndicator ? "true" : "false");
  const indicatorsInContextInput = await ctx.ui.input(hinted("Keep indicators in conversation context (true/false)", existing.indicatorsInContext ? "true" : "false", "false"), existing.indicatorsInContext ? "true" : "false");
  const reasoningInput = await ctx.ui.input(hinted("Reflect reasoning level (low/medium/high)", existing.reasoningLevel, "low"), existing.reasoningLevel);
  const reasoningCapInput = await ctx.ui.input(hinted("Reflect reasoning cap (blank/low/medium/high)", existing.reasoningLevelCap ?? "(blank)", "blank or medium"), existing.reasoningLevelCap ?? "");
  const dynamicInput = await ctx.ui.input(hinted("Reflect dynamic budget bump (true/false)", existing.dialecticDynamic ? "true" : "false", "true"), existing.dialecticDynamic ? "true" : "false");

  await saveConfig({
    recallMode: normalizeRecallMode(recallModeInput),
    recallTypes: normalizeRecallTypes(parseCsv(recallTypesInput)),
    searchBudget: searchBudgetInput === "low" || searchBudgetInput === "high" ? searchBudgetInput : "mid",
    reflectBudget: reflectBudgetInput === "mid" || reflectBudgetInput === "high" ? reflectBudgetInput : "low",
    contextTokens: parsePositiveInt(contextTokensInput, existing.contextTokens),
    contextRefreshTtlSeconds: parsePositiveInt(ttlInput, existing.contextRefreshTtlSeconds),
    contextCadence: parsePositiveInt(cadenceInput, existing.contextCadence),
    contextRefreshMessageThreshold: parsePositiveInt(thresholdInput, existing.contextRefreshMessageThreshold),
    injectionFrequency: injectionInput === "first-turn" ? "first-turn" : "every-turn",
    showRecallIndicator: parseBool(recallIndicatorInput, existing.showRecallIndicator),
    indicatorsInContext: parseBool(indicatorsInContextInput, existing.indicatorsInContext),
    reasoningLevel: normalizeReasoningLevel(reasoningInput),
    reasoningLevelCap: reasoningCapInput?.trim() ? normalizeReasoningLevel(reasoningCapInput) : null,
    dialecticDynamic: parseBool(dynamicInput, existing.dialecticDynamic),
  });
  const updated = await resolveConfig(ctx.cwd);
  setRecallMode(updated.recallMode);
  await connect(ctx);
  ctx.ui.notify(`Recall settings saved: mode=${updated.recallMode}, injection=${updated.injectionFrequency}, cadence=${updated.contextCadence}`, "success");
};

const runRetainWizard = async (ctx: ExtensionContext): Promise<void> => {
  const existing = await resolveConfig(ctx.cwd);
  const writeFrequencyInput = await ctx.ui.input(hinted("Write frequency (async/turn/session/or positive integer)", String(existing.writeFrequency), "5 for technical chats, turn for instant save per response"), String(existing.writeFrequency));
  const saveMessagesInput = await ctx.ui.input(hinted("Save messages (true/false)", existing.saveMessages ? "true" : "false", "true"), existing.saveMessages ? "true" : "false");
  const retainIndicatorInput = await ctx.ui.input(hinted("Show retain indicator (true/false)", existing.showRetainIndicator ? "true" : "false", "true"), existing.showRetainIndicator ? "true" : "false");
  const indicatorsInContextInput = await ctx.ui.input(hinted("Keep indicators in conversation context (true/false)", existing.indicatorsInContext ? "true" : "false", "false"), existing.indicatorsInContext ? "true" : "false");
  const maxMessageLengthInput = await ctx.ui.input(hinted("Max message length", String(existing.maxMessageLength), "25000"), String(existing.maxMessageLength));
  const toolPreviewLengthInput = await ctx.ui.input(hinted("Tool preview length", String(existing.toolPreviewLength), "500"), String(existing.toolPreviewLength));

  await saveConfig({
    writeFrequency: parseWriteFrequency(writeFrequencyInput, existing.writeFrequency),
    saveMessages: parseBool(saveMessagesInput, existing.saveMessages),
    showRetainIndicator: parseBool(retainIndicatorInput, existing.showRetainIndicator),
    indicatorsInContext: parseBool(indicatorsInContextInput, existing.indicatorsInContext),
    toolPreviewLength: parsePositiveInt(toolPreviewLengthInput, existing.toolPreviewLength),
    maxMessageLength: parsePositiveInt(maxMessageLengthInput, existing.maxMessageLength),
  });
  const updated = await resolveConfig(ctx.cwd);
  await connect(ctx);
  ctx.ui.notify(`Retain settings saved: write=${updated.writeFrequency}, saveMessages=${updated.saveMessages ? "yes" : "no"}`, "success");
};

const runConfigTui = async (ctx: ExtensionContext): Promise<void> => {
  const choice = await ctx.ui.select("Hindsight config", [
    "Guided setup",
    "Recall settings",
    "Retain settings",
    "Show current settings",
    "Connect now",
  ]);
  if (choice === "Guided setup") return runSetupWizard(ctx);
  if (choice === "Recall settings") return runRecallWizard(ctx);
  if (choice === "Retain settings") return runRetainWizard(ctx);
  if (choice === "Show current settings") return ctx.ui.notify(await statusText(ctx), "info");
  if (choice === "Connect now") return connect(ctx).then(() => ctx.ui.notify("Hindsight connected and cache refreshed.", "success"));
};

const connect = async (ctx: ExtensionContext): Promise<void> => {
  clearHandles();
  const config = await resolveConfig(ctx.cwd);
  if (!config.enabled) throw new Error("Hindsight is disabled.");
  const handles = await bootstrap(config, ctx.cwd);
  await refreshCachedContext(handles);
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
    `Recall types: ${config.recallTypes.join(", ")}`,
    `Search budget: ${config.searchBudget}`,
    `Reflect budget: ${config.reflectBudget}`,
    `Reflect dynamic budget: ${config.dialecticDynamic ? "on" : "off"}`,
    `Reasoning level: ${config.reasoningLevel}`,
    `Reasoning cap: ${config.reasoningLevelCap ?? "(none)"}`,
    `Write frequency: ${config.writeFrequency}`,
    `Auto-create bank: ${config.autoCreateBank ? "yes" : "no"}`,
    `Injection: ${config.injectionFrequency}`,
    `Context TTL: ${config.contextRefreshTtlSeconds}s`,
    `Tool preview length: ${config.toolPreviewLength}`,
    `Max message length: ${config.maxMessageLength}`,
    `Save messages: ${config.saveMessages ? "yes" : "no"}`,
    `Recall indicator: ${config.showRecallIndicator ? (config.indicatorsInContext ? "in-context" : "ui-only") : "off"}`,
    `Retain indicator: ${config.showRetainIndicator ? (config.indicatorsInContext ? "in-context" : "ui-only") : "off"}`,
    `Hook session_start: ${hookText("sessionStart")}`,
    `Hook recall: ${hookText("recall")}`,
    `Hook retain: ${hookText("retain")}`,
    `Cache: ${cache ? `${cache.length} chars` : "empty"}`,
  ].join("\n");
};

export const registerCommands = (pi: ExtensionAPI): void => {
  pi.registerCommand("hindsight:status", {
    description: "Show Hindsight connection and runtime status",
    handler: async (_args: string, ctx: ExtensionContext) => {
      ctx.ui.notify(await statusText(ctx), "info");
    },
  });

  pi.registerCommand("hindsight:setup", {
    description: "Interactive first-time setup for Hindsight in pi",
    handler: async (_args: string, ctx: ExtensionContext) => {
      await runSetupWizard(ctx);
    },
  });

  pi.registerCommand("hindsight:tui", {
    description: "Interactive Hindsight config menu",
    handler: async (_args: string, ctx: ExtensionContext) => {
      await runConfigTui(ctx);
    },
  });

  pi.registerCommand("hindsight:config", {
    description: "Show effective Hindsight config with secrets redacted",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const config = await resolveConfig(ctx.cwd);
      const handles = getHandles();
      const { renameSessionToBank: _renameSessionToBank, ...displayConfig } = config;
      ctx.ui.notify(JSON.stringify({ ...displayConfig, apiKey: mask(config.apiKey), connected: Boolean(handles), activeBank: handles?.bankId ?? null }, null, 2), "info");
    },
  });

  pi.registerCommand("hindsight:connect", {
    description: "Connect or reconnect Hindsight now",
    handler: async (_args: string, ctx: ExtensionContext) => {
      await connect(ctx);
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
      checks.push(`recall_types: ${config.recallTypes.join(",")}`);
      checks.push(`reasoning_level: ${config.reasoningLevel}`);
      checks.push(`reflect_dynamic_budget: ${config.dialecticDynamic ? "on" : "off"}`);

      if (!config.enabled) {
        ctx.ui.notify(checks.join("\n"), "warning");
        return;
      }

      try {
        const handles = await bootstrap(config, ctx.cwd);
        await ensureBank(handles.client, handles.bankId, handles.config);
        await handles.client.recall(handles.bankId, "health check", { budget: "low", maxTokens: 256, types: config.recallTypes });
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
        ctx.ui.notify(checks.join("\n"), "success");
      } catch (error) {
        checks.push(`connectivity: failed`);
        checks.push(`error: ${error instanceof Error ? error.message : String(error)}`);
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
    description: "Force Hindsight cache refresh",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const handles = getHandles();
      if (!handles) {
        ctx.ui.notify("Hindsight is not connected. Run /hindsight:setup first.", "warning");
        return;
      }
      clearCachedContext();
      await refreshCachedContext(handles);
      ctx.ui.notify("Hindsight cache refreshed.", "success");
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
      });
      ctx.ui.notify(`Mapped ${ctx.cwd} → ${bankId}`, "success");
    },
  });

  pi.registerCommand("hindsight:recall", {
    description: "Adjust recall/injection settings",
    handler: async (_args: string, ctx: ExtensionContext) => {
      await runRecallWizard(ctx);
    },
  });

  pi.registerCommand("hindsight:retain", {
    description: "Adjust retain/upload settings",
    handler: async (_args: string, ctx: ExtensionContext) => {
      await runRetainWizard(ctx);
    },
  });

  pi.registerCommand("hindsight:settings", {
    description: "Show quick summary of recall/retain knobs",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const config = await resolveConfig(ctx.cwd);
      ctx.ui.notify([
        `Enabled: ${config.enabled ? "yes" : "no"}`,
        `Global bank: ${config.globalBankId ?? "(none)"}`,
        `Recall mode: ${config.recallMode}`,
        `Recall types: ${config.recallTypes.join(", ")}`,
        `Search budget: ${config.searchBudget}`,
        `Reflect budget: ${config.reflectBudget}`,
        `Reflect dynamic budget: ${config.dialecticDynamic ? "on" : "off"}`,
        `Reasoning level: ${config.reasoningLevel}`,
        `Reasoning cap: ${config.reasoningLevelCap ?? "(none)"}`,
        `Context tokens: ${config.contextTokens}`,
        `Context TTL: ${config.contextRefreshTtlSeconds}s`,
        `Context cadence: ${config.contextCadence}`,
        `Refresh threshold: ${config.contextRefreshMessageThreshold}`,
        `Injection: ${config.injectionFrequency}`,
        `Write frequency: ${config.writeFrequency}`,
        `Auto-create bank: ${config.autoCreateBank ? "yes" : "no"}`,
        `Save messages: ${config.saveMessages ? "yes" : "no"}`,
        `Tool preview length: ${config.toolPreviewLength}`,
        `Recall indicator: ${config.showRecallIndicator ? (config.indicatorsInContext ? "in-context" : "ui-only") : "off"}`,
        `Retain indicator: ${config.showRetainIndicator ? (config.indicatorsInContext ? "in-context" : "ui-only") : "off"}`,
        `Max message length: ${config.maxMessageLength}`,
      ].join("\n"), "info");
    },
  });
};
