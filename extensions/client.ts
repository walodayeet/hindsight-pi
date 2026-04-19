import { HindsightClient } from "@vectorize-io/hindsight-client";
import type { HindsightConfig, ResolvedLinkedHostConfig } from "./config.js";
import { deriveBankId } from "./session.js";

export interface LinkedHostHandle {
  name: string;
  client: any;
  bankId: string;
  config: ResolvedLinkedHostConfig;
}

export interface BankInsights {
  profile: any | null;
  directivesCount: number | null;
  mentalModelsCount: number | null;
  documentsCount: number | null;
  entitiesCount: number | null;
}

export interface HindsightHandles {
  client: any;
  bankId: string;
  config: HindsightConfig;
  linked: LinkedHostHandle[];
}

let cachedHandles: HindsightHandles | null = null;

export const getHandles = (): HindsightHandles | null => cachedHandles;
export const clearHandles = (): void => { cachedHandles = null; };

const isNotFoundError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /404|not found/i.test(message);
};

export const ensureBank = async (client: any, bankId: string, config: { autoCreateBank: boolean; workspace: string }): Promise<void> => {
  try {
    await client.getBankProfile(bankId);
  } catch (error) {
    if (!isNotFoundError(error) || !config.autoCreateBank) throw error;
    await client.createBank(bankId, {
      name: bankId,
      background: `Persistent coding memory for pi workspace ${config.workspace}`,
    });
  }
};

const buildClient = (baseUrl: string, apiKey?: string): any => new HindsightClient({
  baseUrl,
  ...(apiKey ? { apiKey } : {}),
});

const authHeaders = (apiKey?: string): Record<string, string> => ({
  "Content-Type": "application/json",
  ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
});

const apiGet = async (baseUrl: string, apiKey: string | undefined, path: string): Promise<any | null> => {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method: "GET",
    headers: authHeaders(apiKey),
  });
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`GET ${path} failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
};

const inferCount = (value: any): number | null => {
  if (!value) return null;
  if (Array.isArray(value)) return value.length;
  if (Array.isArray(value.items)) return value.items.length;
  if (typeof value.total === "number") return value.total;
  if (typeof value.count === "number") return value.count;
  if (Array.isArray(value.data)) return value.data.length;
  return null;
};

export const getBankInsights = async (baseUrl: string, apiKey: string | undefined, bankId: string): Promise<BankInsights> => {
  const [directives, mentalModels, documents, entities] = await Promise.allSettled([
    apiGet(baseUrl, apiKey, `/v1/default/banks/${encodeURIComponent(bankId)}/directives`),
    apiGet(baseUrl, apiKey, `/v1/default/banks/${encodeURIComponent(bankId)}/mental-models`),
    apiGet(baseUrl, apiKey, `/v1/default/banks/${encodeURIComponent(bankId)}/documents`),
    apiGet(baseUrl, apiKey, `/v1/default/banks/${encodeURIComponent(bankId)}/entities`),
  ]);

  const profile = await apiGet(baseUrl, apiKey, `/v1/default/banks/${encodeURIComponent(bankId)}`)
    .catch(async () => null);

  return {
    profile,
    directivesCount: directives.status === "fulfilled" ? inferCount(directives.value) : null,
    mentalModelsCount: mentalModels.status === "fulfilled" ? inferCount(mentalModels.value) : null,
    documentsCount: documents.status === "fulfilled" ? inferCount(documents.value) : null,
    entitiesCount: entities.status === "fulfilled" ? inferCount(entities.value) : null,
  };
};

export const bootstrap = async (config: HindsightConfig, cwd: string): Promise<HindsightHandles> => {
  const client = buildClient(config.baseUrl, config.apiKey);
  const bankId = await deriveBankId(cwd, config.bankStrategy, config);
  await ensureBank(client, bankId, config);

  const linked: LinkedHostHandle[] = [];
  for (const linkedConfig of config.linkedHostConfigs) {
    const linkedClient = buildClient(linkedConfig.baseUrl, linkedConfig.apiKey);
    const linkedBankId = linkedConfig.bankId ?? await deriveBankId(cwd, linkedConfig.bankStrategy, {
      ...config,
      baseUrl: linkedConfig.baseUrl,
      apiKey: linkedConfig.apiKey,
      bankId: linkedConfig.bankId,
      bankStrategy: linkedConfig.bankStrategy,
      workspace: linkedConfig.workspace,
      peerName: linkedConfig.peerName,
      aiPeer: linkedConfig.aiPeer,
      linkedHosts: [],
      linkedHostConfigs: [],
    });
    await ensureBank(linkedClient, linkedBankId, { autoCreateBank: config.autoCreateBank, workspace: linkedConfig.workspace });
    linked.push({ name: linkedConfig.name, client: linkedClient, bankId: linkedBankId, config: linkedConfig });
  }

  cachedHandles = { client, bankId, config, linked };
  return cachedHandles;
};
