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
      const existing = await resolveConfig(ctx.cwd);
      const enabledInput = await ctx.ui.input("Enable Hindsight (true/false)", existing.enabled ? "true" : "false");
      const baseUrl = await ctx.ui.input("Hindsight base URL", existing.baseUrl || "http://localhost:8888");
      const apiKeyInput = await ctx.ui.input("Hindsight API key (optional for local)", mask(existing.apiKey));
      const workspace = await ctx.ui.input("Workspace label", existing.workspace);
      const linkedHostsInput = await ctx.ui.input("Linked host bank aliases (comma-separated, optional)", existing.linkedHosts.join(", "));
      const bankStrategyInput = await ctx.ui.input("Bank strategy", existing.bankStrategy);
      const manualBankId = await ctx.ui.input("Manual bank ID (optional)", existing.bankId ?? "");
      const globalBankIdInput = await ctx.ui.input("Global bank ID (optional, for #global / global strategy)", existing.globalBankId ?? "");
      const recallModeInput = await ctx.ui.input("Recall mode (hybrid/context/tools/off)", existing.recallMode);
      const recallTypesInput = await ctx.ui.input("Recall types (observation,experience,world)", existing.recallTypes.join(","));
      const autoCreateBankInput = await ctx.ui.input("Auto-create banks (true/false)", existing.autoCreateBank ? "true" : "false");
      const writeFrequencyInput = await ctx.ui.input("Write frequency (async/turn/session/or positive integer)", String(existing.writeFrequency));
      const saveMessagesInput = await ctx.ui.input("Save messages (true/false)", existing.saveMessages ? "true" : "false");
      const reasoningLevelInput = await ctx.ui.input("Reflect reasoning level (low/medium/high)", existing.reasoningLevel);
      const reasoningCapInput = await ctx.ui.input("Reflect reasoning cap (blank/low/medium/high)", existing.reasoningLevelCap ?? "");
      const dynamicInput = await ctx.ui.input("Reflect dynamic budget bump (true/false)", existing.dialecticDynamic ? "true" : "false");
      const toolPreviewLengthInput = await ctx.ui.input("Tool preview length", String(existing.toolPreviewLength));

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
        reasoningLevel: normalizeReasoningLevel(reasoningLevelInput) as ReasoningLevel,
        reasoningLevelCap: reasoningCapInput?.trim() ? normalizeReasoningLevel(reasoningCapInput) as ReasoningLevel : null,
        dialecticDynamic: parseBool(dynamicInput, existing.dialecticDynamic),
        toolPreviewLength: parsePositiveInt(toolPreviewLengthInput, existing.toolPreviewLength),
      });

      await connect(ctx);
      ctx.ui.notify("Hindsight setup saved and connection initialized.", "success");
    },
  });

  pi.registerCommand("hindsight:config", {
    description: "Show effective Hindsight config with secrets redacted",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const config = await resolveConfig(ctx.cwd);
      ctx.ui.notify(JSON.stringify({ ...config, apiKey: mask(config.apiKey) }, null, 2), "info");
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
      const existing = await resolveConfig(ctx.cwd);
      const recallModeInput = await ctx.ui.input("Recall mode (hybrid/context/tools/off)", existing.recallMode);
      const recallTypesInput = await ctx.ui.input("Recall types (observation,experience,world)", existing.recallTypes.join(","));
      const searchBudgetInput = await ctx.ui.input("Search budget (low/mid/high)", existing.searchBudget);
      const reflectBudgetInput = await ctx.ui.input("Reflect budget (low/mid/high)", existing.reflectBudget);
      const contextTokensInput = await ctx.ui.input("Context tokens", String(existing.contextTokens));
      const ttlInput = await ctx.ui.input("Context TTL seconds", String(existing.contextRefreshTtlSeconds));
      const cadenceInput = await ctx.ui.input("Context cadence turns", String(existing.contextCadence));
      const thresholdInput = await ctx.ui.input("Refresh after N uploaded turns/messages threshold", String(existing.contextRefreshMessageThreshold));
      const injectionInput = await ctx.ui.input("Injection frequency (every-turn/first-turn)", existing.injectionFrequency);
      const recallIndicatorInput = await ctx.ui.input("Show recall indicator (true/false)", existing.showRecallIndicator ? "true" : "false");
      const indicatorsInContextInput = await ctx.ui.input("Keep indicators in conversation context (true/false)", existing.indicatorsInContext ? "true" : "false");
      const reasoningInput = await ctx.ui.input("Reflect reasoning level (low/medium/high)", existing.reasoningLevel);
      const reasoningCapInput = await ctx.ui.input("Reflect reasoning cap (blank/low/medium/high)", existing.reasoningLevelCap ?? "");
      const dynamicInput = await ctx.ui.input("Reflect dynamic budget bump (true/false)", existing.dialecticDynamic ? "true" : "false");

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
      ctx.ui.notify(`Recall settings saved: mode=${updated.recallMode}, types=${updated.recallTypes.join(",")}, search=${updated.searchBudget}, reflect=${updated.reflectBudget}, ttl=${updated.contextRefreshTtlSeconds}s`, "success");
    },
  });

  pi.registerCommand("hindsight:retain", {
    description: "Adjust retain/upload settings",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const existing = await resolveConfig(ctx.cwd);
      const writeFrequencyInput = await ctx.ui.input("Write frequency (async/turn/session/or positive integer)", String(existing.writeFrequency));
      const saveMessagesInput = await ctx.ui.input("Save messages (true/false)", existing.saveMessages ? "true" : "false");
      const retainIndicatorInput = await ctx.ui.input("Show retain indicator (true/false)", existing.showRetainIndicator ? "true" : "false");
      const indicatorsInContextInput = await ctx.ui.input("Keep indicators in conversation context (true/false)", existing.indicatorsInContext ? "true" : "false");
      const maxMessageLengthInput = await ctx.ui.input("Max message length", String(existing.maxMessageLength));
      const toolPreviewLengthInput = await ctx.ui.input("Tool preview length", String(existing.toolPreviewLength));

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
      ctx.ui.notify(`Retain settings saved: write=${updated.writeFrequency}, saveMessages=${updated.saveMessages ? "yes" : "no"}, preview=${updated.toolPreviewLength}, maxLen=${updated.maxMessageLength}`, "success");
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
