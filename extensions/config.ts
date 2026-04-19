import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type BankStrategy = "per-directory" | "git-branch" | "pi-session" | "per-repo" | "global" | "manual";
export type RecallMode = "hybrid" | "context" | "tools" | "off";
export type WriteFrequency = "async" | "turn" | "session";
export type InjectionFrequency = "every-turn" | "first-turn";
export type SearchBudget = "low" | "mid" | "high";
export type ReasoningLevel = "low" | "medium" | "high";
export type RecallType = "world" | "experience" | "observation";

export interface HostConfig {
  enabled?: boolean;
  workspace?: string;
  peerName?: string;
  aiPeer?: string;
  linkedHosts?: string[];
  recallMode?: RecallMode;
  recallTypes?: RecallType[];
  autoCreateBank?: boolean;
  contextTokens?: number;
  contextRefreshTtlSeconds?: number;
  contextRefreshMessageThreshold?: number;
  contextCadence?: number;
  injectionFrequency?: InjectionFrequency;
  writeFrequency?: WriteFrequency | number;
  saveMessages?: boolean;
  searchBudget?: SearchBudget;
  reflectBudget?: SearchBudget;
  dialecticDynamic?: boolean;
  reasoningLevel?: ReasoningLevel;
  reasoningLevelCap?: ReasoningLevel;
  toolPreviewLength?: number;
  maxMessageLength?: number;
  logging?: boolean;
  showRecallIndicator?: boolean;
  showRetainIndicator?: boolean;
  indicatorsInContext?: boolean;
}

export interface LinkedHostFileConfig {
  baseUrl?: string;
  apiKey?: string;
  bankId?: string;
  bankStrategy?: BankStrategy;
  workspace?: string;
  peerName?: string;
  aiPeer?: string;
}

export interface HindsightConfigFile {
  apiKey?: string;
  api_key?: string;
  baseUrl?: string;
  api_url?: string;
  bankId?: string;
  bank_id?: string;
  globalBankId?: string;
  global_bank?: string;
  bankStrategy?: BankStrategy;
  recallTypes?: RecallType[];
  recall_types?: RecallType[] | string;
  mappings?: Record<string, string>;
  host?: {
    pi?: HostConfig;
  };
  hosts?: Record<string, LinkedHostFileConfig>;
}

export interface ResolvedLinkedHostConfig {
  name: string;
  baseUrl: string;
  apiKey?: string;
  bankId?: string;
  globalBankId?: string;
  bankStrategy: BankStrategy;
  workspace: string;
  peerName: string;
  aiPeer: string;
}

export interface HindsightConfig {
  enabled: boolean;
  apiKey?: string;
  baseUrl: string;
  bankId?: string;
  globalBankId?: string;
  bankStrategy: BankStrategy;
  workspace: string;
  peerName: string;
  aiPeer: string;
  linkedHosts: string[];
  linkedHostConfigs: ResolvedLinkedHostConfig[];
  recallMode: RecallMode;
  recallTypes: RecallType[];
  autoCreateBank: boolean;
  contextTokens: number;
  contextRefreshTtlSeconds: number;
  contextRefreshMessageThreshold: number;
  contextCadence: number;
  injectionFrequency: InjectionFrequency;
  writeFrequency: WriteFrequency | number;
  saveMessages: boolean;
  searchBudget: SearchBudget;
  reflectBudget: SearchBudget;
  dialecticDynamic: boolean;
  reasoningLevel: ReasoningLevel;
  reasoningLevelCap: ReasoningLevel | null;
  toolPreviewLength: number;
  maxMessageLength: number;
  logging: boolean;
  showRecallIndicator: boolean;
  showRetainIndicator: boolean;
  indicatorsInContext: boolean;
  mappings: Record<string, string>;
}

export const CONFIG_PATH = join(homedir(), ".hindsight", "config.json");
export const LOCAL_CONFIG_PATH = ".hindsight/config.json";
const DEFAULT_BASE_URL = "http://localhost:8888";

const intOr = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return fallback;
};

const boolOr = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  return fallback;
};

const csvOr = (value: unknown, fallback: string[] = []): string[] => {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  if (typeof value === "string") return value.split(",").map((v) => v.trim()).filter(Boolean);
  return fallback;
};

export const normalizeRecallTypes = (value: unknown): RecallType[] => {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",").map((entry) => entry.trim())
      : [];

  const normalized = values.filter((entry): entry is RecallType => (
    entry === "world" || entry === "experience" || entry === "observation"
  ));

  return normalized.length > 0 ? [...new Set(normalized)] : ["observation"];
};

export const normalizeBankStrategy = (value: unknown): BankStrategy => {
  switch (value) {
    case "per-directory":
    case "git-branch":
    case "pi-session":
    case "per-repo":
    case "global":
    case "manual":
      return value;
    default:
      return "per-repo";
  }
};

export const normalizeRecallMode = (value: unknown): RecallMode => {
  switch (value) {
    case "hybrid":
    case "context":
    case "tools":
    case "off":
      return value;
    default:
      return "hybrid";
  }
};

const normalizeInjectionFrequency = (value: unknown): InjectionFrequency => value === "first-turn" ? "first-turn" : "every-turn";

const normalizeBudget = (value: unknown, fallback: SearchBudget): SearchBudget => {
  switch (value) {
    case "low":
    case "mid":
    case "high":
      return value;
    default:
      return fallback;
  }
};

export const normalizeReasoningLevel = (value: unknown): ReasoningLevel => {
  switch (value) {
    case "low":
    case "medium":
    case "high":
      return value;
    default:
      return "low";
  }
};

const normalizeWriteFrequency = (value: unknown): WriteFrequency | number => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string") {
    if (value === "async" || value === "turn" || value === "session") return value;
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return 5;
};

let activeRecallMode: RecallMode = "hybrid";
export const getRecallMode = (): RecallMode => activeRecallMode;
export const setRecallMode = (mode: RecallMode): void => { activeRecallMode = mode; };

const readJsonIfPresent = async (path: string): Promise<HindsightConfigFile | null> => {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as HindsightConfigFile;
  } catch {
    return null;
  }
};

export const readConfigFile = async (cwd?: string): Promise<HindsightConfigFile | null> => {
  const globalConfig = await readJsonIfPresent(CONFIG_PATH);
  const localConfig = cwd ? await readJsonIfPresent(join(cwd, LOCAL_CONFIG_PATH)) : null;
  if (!globalConfig && !localConfig) return null;
  return {
    ...(globalConfig ?? {}),
    ...(localConfig ?? {}),
    host: {
      ...((globalConfig?.host) ?? {}),
      ...((localConfig?.host) ?? {}),
      pi: {
        ...((globalConfig?.host?.pi) ?? {}),
        ...((localConfig?.host?.pi) ?? {}),
      },
    },
    hosts: {
      ...((globalConfig?.hosts) ?? {}),
      ...((localConfig?.hosts) ?? {}),
    },
    mappings: {
      ...((globalConfig?.mappings) ?? {}),
      ...((localConfig?.mappings) ?? {}),
    },
  };
};

export const resolveConfig = async (cwd?: string): Promise<HindsightConfig> => {
  const file = await readConfigFile(cwd);
  const host = file?.host?.pi ?? {};
  const linkedHosts = csvOr(host.linkedHosts);
  const linkedHostConfigs: ResolvedLinkedHostConfig[] = linkedHosts.flatMap((name) => {
    const entry = file?.hosts?.[name];
    if (!entry) return [];
    const resolved: ResolvedLinkedHostConfig = {
      name,
      baseUrl: entry.baseUrl ?? file?.baseUrl ?? file?.api_url ?? DEFAULT_BASE_URL,
      apiKey: entry.apiKey ?? file?.apiKey ?? file?.api_key,
      bankId: entry.bankId,
      globalBankId: file?.globalBankId ?? file?.global_bank,
      bankStrategy: normalizeBankStrategy(entry.bankStrategy ?? file?.bankStrategy),
      workspace: entry.workspace ?? name,
      peerName: entry.peerName ?? (host.peerName ?? "user"),
      aiPeer: entry.aiPeer ?? "pi",
    };
    return [resolved];
  });

  const config: HindsightConfig = {
    enabled: boolOr(process.env.HINDSIGHT_ENABLED ?? host.enabled, Boolean(process.env.HINDSIGHT_API_KEY || file?.apiKey || file?.api_key || process.env.HINDSIGHT_BASE_URL || file?.baseUrl || file?.api_url)),
    apiKey: process.env.HINDSIGHT_API_KEY ?? file?.apiKey ?? file?.api_key,
    baseUrl: process.env.HINDSIGHT_BASE_URL ?? file?.baseUrl ?? file?.api_url ?? DEFAULT_BASE_URL,
    bankId: process.env.HINDSIGHT_BANK_ID ?? file?.bankId ?? file?.bank_id,
    globalBankId: process.env.HINDSIGHT_GLOBAL_BANK_ID ?? file?.globalBankId ?? file?.global_bank,
    bankStrategy: normalizeBankStrategy(process.env.HINDSIGHT_BANK_STRATEGY ?? file?.bankStrategy),
    workspace: host.workspace ?? "pi",
    peerName: host.peerName ?? "user",
    aiPeer: host.aiPeer ?? "pi",
    linkedHosts,
    linkedHostConfigs,
    recallMode: normalizeRecallMode(process.env.HINDSIGHT_RECALL_MODE ?? host.recallMode),
    recallTypes: normalizeRecallTypes(process.env.HINDSIGHT_RECALL_TYPES ?? host.recallTypes ?? file?.recallTypes ?? file?.recall_types),
    autoCreateBank: boolOr(process.env.HINDSIGHT_AUTO_CREATE_BANK ?? host.autoCreateBank, true),
    contextTokens: intOr(process.env.HINDSIGHT_CONTEXT_TOKENS ?? host.contextTokens, 1200),
    contextRefreshTtlSeconds: intOr(process.env.HINDSIGHT_CONTEXT_REFRESH_TTL_SECONDS ?? host.contextRefreshTtlSeconds, 300),
    contextRefreshMessageThreshold: intOr(process.env.HINDSIGHT_CONTEXT_REFRESH_MESSAGE_THRESHOLD ?? host.contextRefreshMessageThreshold, 8),
    contextCadence: intOr(process.env.HINDSIGHT_CONTEXT_CADENCE ?? host.contextCadence, 1),
    injectionFrequency: normalizeInjectionFrequency(process.env.HINDSIGHT_INJECTION_FREQUENCY ?? host.injectionFrequency),
    writeFrequency: normalizeWriteFrequency(process.env.HINDSIGHT_WRITE_FREQUENCY ?? host.writeFrequency),
    saveMessages: boolOr(process.env.HINDSIGHT_SAVE_MESSAGES ?? host.saveMessages, true),
    searchBudget: normalizeBudget(process.env.HINDSIGHT_SEARCH_BUDGET ?? host.searchBudget, "mid"),
    reflectBudget: normalizeBudget(process.env.HINDSIGHT_REFLECT_BUDGET ?? host.reflectBudget, "low"),
    dialecticDynamic: boolOr(process.env.HINDSIGHT_DIALECTIC_DYNAMIC ?? host.dialecticDynamic, true),
    reasoningLevel: normalizeReasoningLevel(process.env.HINDSIGHT_REASONING_LEVEL ?? host.reasoningLevel),
    reasoningLevelCap: (process.env.HINDSIGHT_REASONING_LEVEL_CAP ?? host.reasoningLevelCap) ? normalizeReasoningLevel(process.env.HINDSIGHT_REASONING_LEVEL_CAP ?? host.reasoningLevelCap) : null,
    toolPreviewLength: intOr(process.env.HINDSIGHT_TOOL_PREVIEW_LENGTH ?? host.toolPreviewLength, 500),
    maxMessageLength: intOr(process.env.HINDSIGHT_MAX_MESSAGE_LENGTH ?? host.maxMessageLength, 25000),
    logging: boolOr(process.env.HINDSIGHT_LOGGING ?? host.logging, true),
    showRecallIndicator: boolOr(process.env.HINDSIGHT_SHOW_RECALL_INDICATOR ?? host.showRecallIndicator, true),
    showRetainIndicator: boolOr(process.env.HINDSIGHT_SHOW_RETAIN_INDICATOR ?? host.showRetainIndicator, true),
    indicatorsInContext: boolOr(process.env.HINDSIGHT_INDICATORS_IN_CONTEXT ?? host.indicatorsInContext, false),
    mappings: file?.mappings ?? {},
  };

  activeRecallMode = config.recallMode;
  return config;
};

export const saveConfig = async (input: {
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  bankId?: string;
  globalBankId?: string;
  bankStrategy?: BankStrategy;
  recallMode?: RecallMode;
  recallTypes?: RecallType[];
  autoCreateBank?: boolean;
  logging?: boolean;
  peerName?: string;
  aiPeer?: string;
  workspace?: string;
  linkedHosts?: string[];
  dialecticDynamic?: boolean;
  reasoningLevel?: ReasoningLevel;
  reasoningLevelCap?: ReasoningLevel | null;
  searchBudget?: SearchBudget;
  reflectBudget?: SearchBudget;
  contextTokens?: number;
  contextRefreshTtlSeconds?: number;
  contextRefreshMessageThreshold?: number;
  contextCadence?: number;
  injectionFrequency?: InjectionFrequency;
  writeFrequency?: WriteFrequency | number;
  saveMessages?: boolean;
  toolPreviewLength?: number;
  maxMessageLength?: number;
  showRecallIndicator?: boolean;
  showRetainIndicator?: boolean;
  indicatorsInContext?: boolean;
  mappings?: Record<string, string>;
}): Promise<void> => {
  const current = (await readConfigFile()) ?? {};
  const next: HindsightConfigFile = {
    ...current,
    apiKey: input.apiKey ?? current.apiKey ?? current.api_key,
    api_key: input.apiKey ?? current.apiKey ?? current.api_key,
    baseUrl: input.baseUrl ?? current.baseUrl ?? current.api_url,
    api_url: input.baseUrl ?? current.baseUrl ?? current.api_url,
    bankId: input.bankId ?? current.bankId ?? current.bank_id,
    bank_id: input.bankId ?? current.bankId ?? current.bank_id,
    globalBankId: input.globalBankId ?? current.globalBankId ?? current.global_bank,
    global_bank: input.globalBankId ?? current.globalBankId ?? current.global_bank,
    bankStrategy: input.bankStrategy ?? current.bankStrategy,
    recallTypes: input.recallTypes ?? current.recallTypes ?? normalizeRecallTypes(current.recall_types),
    recall_types: input.recallTypes ?? current.recallTypes ?? normalizeRecallTypes(current.recall_types),
    mappings: input.mappings ?? current.mappings,
    host: {
      ...(current.host ?? {}),
      pi: {
        ...(current.host?.pi ?? {}),
        enabled: input.enabled ?? current.host?.pi?.enabled,
        workspace: input.workspace ?? current.host?.pi?.workspace,
        peerName: input.peerName ?? current.host?.pi?.peerName,
        aiPeer: input.aiPeer ?? current.host?.pi?.aiPeer,
        linkedHosts: input.linkedHosts ?? current.host?.pi?.linkedHosts,
        recallMode: input.recallMode ?? current.host?.pi?.recallMode,
        recallTypes: input.recallTypes ?? current.host?.pi?.recallTypes,
        autoCreateBank: input.autoCreateBank ?? current.host?.pi?.autoCreateBank,
        logging: input.logging ?? current.host?.pi?.logging,
        dialecticDynamic: input.dialecticDynamic ?? current.host?.pi?.dialecticDynamic,
        reasoningLevel: input.reasoningLevel ?? current.host?.pi?.reasoningLevel,
        reasoningLevelCap: input.reasoningLevelCap === null ? undefined : input.reasoningLevelCap ?? current.host?.pi?.reasoningLevelCap,
        showRecallIndicator: input.showRecallIndicator ?? current.host?.pi?.showRecallIndicator,
        showRetainIndicator: input.showRetainIndicator ?? current.host?.pi?.showRetainIndicator,
        indicatorsInContext: input.indicatorsInContext ?? current.host?.pi?.indicatorsInContext,
        searchBudget: input.searchBudget ?? current.host?.pi?.searchBudget,
        reflectBudget: input.reflectBudget ?? current.host?.pi?.reflectBudget,
        contextTokens: input.contextTokens ?? current.host?.pi?.contextTokens,
        contextRefreshTtlSeconds: input.contextRefreshTtlSeconds ?? current.host?.pi?.contextRefreshTtlSeconds,
        contextRefreshMessageThreshold: input.contextRefreshMessageThreshold ?? current.host?.pi?.contextRefreshMessageThreshold,
        contextCadence: input.contextCadence ?? current.host?.pi?.contextCadence,
        injectionFrequency: input.injectionFrequency ?? current.host?.pi?.injectionFrequency,
        writeFrequency: input.writeFrequency ?? current.host?.pi?.writeFrequency,
        saveMessages: input.saveMessages ?? current.host?.pi?.saveMessages,
        toolPreviewLength: input.toolPreviewLength ?? current.host?.pi?.toolPreviewLength,
        maxMessageLength: input.maxMessageLength ?? current.host?.pi?.maxMessageLength,
      },
    },
  };

  await mkdir(dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
};
