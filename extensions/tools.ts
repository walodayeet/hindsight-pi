import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ensureBank, getBankInsights, getHandles, type HindsightHandles } from "./client.js";
import { getRecallMode, type ReasoningLevel, type SearchBudget } from "./config.js";
import { sessionRetained } from "./meta.js";

const sanitizeTag = (value: string): string => value.toLowerCase().replace(/[^a-z0-9:_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

const LEVELS: readonly ReasoningLevel[] = ["low", "medium", "high"];
const LEVEL_TO_BUDGET: Record<ReasoningLevel, SearchBudget> = {
  low: "low",
  medium: "mid",
  high: "high",
};

const nextLevel = (level: ReasoningLevel): ReasoningLevel => {
  const idx = LEVELS.indexOf(level);
  return LEVELS[Math.min(idx + 1, LEVELS.length - 1)];
};

const dynamicBudget = (query: string, baseLevel: ReasoningLevel, dynamic: boolean, cap: ReasoningLevel | null): SearchBudget => {
  let level = baseLevel;
  if (dynamic) {
    if (query.length >= 120) level = nextLevel(level);
    if (query.length >= 400) level = nextLevel(level);
  }
  if (cap && LEVELS.indexOf(level) > LEVELS.indexOf(cap)) level = cap;
  return LEVEL_TO_BUDGET[level];
};

const activeBankIds = (handles: HindsightHandles): string[] => {
  const ids = [handles.bankId, handles.config.globalBankId].filter((value): value is string => Boolean(value));
  return [...new Set(ids)];
};

const ensureHandles = async () => {
  const handles = getHandles();
  if (!handles) throw new Error("Hindsight is not connected. Run /hindsight:setup first.");
  await ensureBank(handles.client, handles.bankId, handles.config);
  if (handles.config.globalBankId && handles.config.globalBankId !== handles.bankId) {
    await ensureBank(handles.client, handles.config.globalBankId, handles.config);
  }
  return handles;
};

const formatResults = (results: Array<{ text?: string; type?: string; sourceHost?: string }>, preview: number): string => {
  if (results.length === 0) return "No relevant memory found.";
  return results
    .map((entry, index) => `${index + 1}. [${entry.sourceHost ?? "pi"} | ${entry.type ?? "memory"}] ${(entry.text ?? "").slice(0, preview)}`)
    .join("\n\n");
};

export const registerTools = (pi: ExtensionAPI): void => {
  pi.registerTool({
    name: "hindsight_search",
    label: "Hindsight Search",
    description: "Search raw durable memory from Hindsight using recall.",
    promptSnippet: "Search raw durable memory in Hindsight.",
    promptGuidelines: ["Use this tool for past facts, user preferences, project history, or architecture details when raw evidence is best."],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      budget: Type.Optional(Type.String({ description: "Recall budget: low, mid, or high" })),
    }),
    async execute(_toolCallId: string, params: any) {
      if (getRecallMode() === "off") throw new Error("Hindsight memory is disabled.");
      const handles = await ensureHandles();
      const results: Array<{ text?: string; type?: string; sourceHost?: string }> = [];
      for (const bankId of activeBankIds(handles)) {
        const main = await handles.client.recall(bankId, params.query, {
          budget: params.budget ?? handles.config.searchBudget,
          maxTokens: Math.max(handles.config.contextTokens * 2, 512),
          types: handles.config.recallTypes,
        });
        const sourceHost = bankId === handles.bankId ? handles.config.workspace : `${handles.config.workspace}:global`;
        results.push(...(main?.results ?? []).map((r: any) => ({ ...r, sourceHost })));
      }

      for (const linked of handles.linked) {
        try {
          const hostResult = await linked.client.recall(linked.bankId, params.query, {
            budget: params.budget ?? handles.config.searchBudget,
            maxTokens: Math.max(handles.config.contextTokens * 2, 512),
            types: handles.config.recallTypes,
          });
          results.push(...(hostResult?.results ?? []).map((r: any) => ({ ...r, sourceHost: linked.name })));
        } catch (error) {
          if (handles.config.logging) console.warn(`[hindsight-pi] linked search failed for ${linked.name}:`, error instanceof Error ? error.message : error);
        }
      }

      return {
        content: [{ type: "text", text: formatResults(results, handles.config.toolPreviewLength) }],
        details: { count: results.length },
      };
    },
  });

  pi.registerTool({
    name: "hindsight_context",
    label: "Hindsight Context",
    description: "Synthesize memory context from Hindsight using reflect.",
    promptSnippet: "Synthesize memory context from Hindsight.",
    promptGuidelines: ["Use this tool when the user asks for a summary, synthesis, or deeper memory-backed guidance."],
    parameters: Type.Object({
      query: Type.String({ description: "Question to ask Hindsight" }),
      context: Type.Optional(Type.String({ description: "Optional extra context" })),
      budget: Type.Optional(Type.String({ description: "Reflect budget: low, mid, or high" })),
    }),
    async execute(_toolCallId: string, params: any) {
      if (getRecallMode() === "off") throw new Error("Hindsight memory is disabled.");
      const handles = await ensureHandles();
      const budget = (params.budget as SearchBudget | undefined) ?? dynamicBudget(
        params.query,
        handles.config.reasoningLevel,
        handles.config.dialecticDynamic,
        handles.config.reasoningLevelCap,
      );

      const reflectQuery = params.context
        ? `${params.query}\n\nAdditional context:\n${params.context}`
        : params.query;
      const sections: string[] = [];
      for (const bankId of activeBankIds(handles)) {
        const primary = await handles.client.reflect(bankId, reflectQuery, {
          budget,
        });
        const label = bankId === handles.bankId ? handles.config.workspace : `${handles.config.workspace}:global`;
        sections.push(`=== [${label}] ===\n${primary?.text ?? "No synthesized context returned."}`);
      }

      for (const linked of handles.linked) {
        try {
          const hostResult = await linked.client.reflect(linked.bankId, reflectQuery, {
            budget,
          });
          sections.push(`=== [${linked.name}] ===\n${hostResult?.text ?? "No synthesized context returned."}`);
        } catch (error) {
          if (handles.config.logging) console.warn(`[hindsight-pi] linked context failed for ${linked.name}:`, error instanceof Error ? error.message : error);
        }
      }

      return {
        content: [{ type: "text", text: sections.join("\n\n") }],
        details: { budget },
      };
    },
  });

  pi.registerTool({
    name: "hindsight_retain",
    label: "Hindsight Retain",
    description: "Store explicit durable memory in Hindsight.",
    promptSnippet: "Store explicit durable memory in Hindsight.",
    promptGuidelines: ["Use this tool when the user explicitly says to remember a preference, fact, or decision."],
    parameters: Type.Object({
      content: Type.String({ description: "Durable memory to store" }),
      context: Type.Optional(Type.String({ description: "Optional context for the memory" })),
    }),
    async execute(_toolCallId: string, params: any) {
      const handles = await ensureHandles();
      const maybeEntries = (params.__sessionEntries ?? undefined) as any[] | undefined;
      if (maybeEntries && !sessionRetained(maybeEntries, true)) {
        return { content: [{ type: "text", text: "Hindsight retention is disabled for this session." }], details: { refused: true } };
      }
      await handles.client.retainBatch(handles.bankId, [{
        content: params.content,
        context: params.context,
        metadata: {
          source: "pi",
          explicit: "true",
          kind: "explicit",
          origin: "explicit",
          workspace: handles.config.workspace,
          peer: handles.config.peerName,
          aiPeer: handles.config.aiPeer,
        },
        tags: [
          "source:pi",
          `workspace:${sanitizeTag(handles.config.workspace)}`,
          `bank:${sanitizeTag(handles.bankId)}`,
          "kind:explicit",
          "origin:explicit",
        ],
      }], { async: false });
      return {
        content: [{ type: "text", text: `Saved durable memory to ${handles.bankId}.` }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "hindsight_bank_profile",
    label: "Hindsight Bank Profile",
    description: "Inspect current Hindsight bank profile and runtime connection info.",
    parameters: Type.Object({}),
    async execute(_toolCallId: string) {
      const handles = await ensureHandles();
      const insights = await getBankInsights(handles.config.baseUrl, handles.config.apiKey, handles.bankId);
      const profile = insights.profile ?? await handles.client.getBankProfile(handles.bankId);
      const disposition = profile?.disposition
        ? `skepticism=${profile.disposition.skepticism ?? "?"}, literalism=${profile.disposition.literalism ?? "?"}, empathy=${profile.disposition.empathy ?? "?"}`
        : "none";
      const linked = handles.linked.length > 0 ? handles.linked.map((h) => `${h.name}:${h.bankId}`).join(", ") : "none";
      const text = [
        `Bank ID: ${handles.bankId}`,
        `Name: ${profile?.name ?? handles.bankId}`,
        `Background: ${profile?.background ?? ""}`,
        `Disposition: ${disposition}`,
        `Directives: ${insights.directivesCount ?? "unknown"}`,
        `Mental models: ${insights.mentalModelsCount ?? "unknown"}`,
        `Documents: ${insights.documentsCount ?? "unknown"}`,
        `Entities: ${insights.entitiesCount ?? "unknown"}`,
        `Workspace: ${handles.config.workspace}`,
        `Global bank: ${handles.config.globalBankId ?? "none"}`,
        `Linked hosts: ${linked}`,
        `Base URL: ${handles.config.baseUrl}`,
        `Recall mode: ${handles.config.recallMode}`,
        `Memory query mode: fresh recall across all memory types for auto-context`,
      ].join("\n");
      return {
        content: [{ type: "text", text }],
        details: {
          profile,
          directivesCount: insights.directivesCount,
          mentalModelsCount: insights.mentalModelsCount,
          documentsCount: insights.documentsCount,
          entitiesCount: insights.entitiesCount,
          linkedHosts: handles.linked.map((h) => ({ name: h.name, bankId: h.bankId })),
        },
      };
    },
  });
};
