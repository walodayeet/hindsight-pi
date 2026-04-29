import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";
import { bootstrap, clearHandles, getHandles } from "./client.js";
import { registerCommands } from "./commands.js";
import { getRecallMode, resolveConfig } from "./config.js";
import { clearCachedContext, countCachedContext, getLastRecallErrorReason, previewCachedContext, refreshContextForPrompt, renderCachedContext } from "./context.js";
import { registerTools } from "./tools.js";
import { WriteScheduler } from "./upload.js";
import { recordFlushFailure, recordFlushSuccess } from "./flush-state.js";
import { resetHookStats, setHookStat } from "./hooks.js";
import { sessionRetained, sessionTags } from "./meta.js";
import { filterHindsightProviderMessages, HINDSIGHT_RECALL_STATUS_TYPE, HINDSIGHT_RETAIN_STATUS_TYPE } from "./provider-filter.js";
import { createRecallCustomMessage, HINDSIGHT_RECALL_CUSTOM_TYPE } from "./recall-message.js";
import { deriveRecallQuery, isContinuePrompt } from "./recall-query.js";
import { appendQueueRecord, deleteQueue, readQueueRecords } from "./queue.js";
import { prepareRetainEntry } from "./retain/prepare.js";
import { buildAutomaticTags, expandObservationScopes } from "./retain/tags.js";
import { deriveWorkspaceSessionName } from "./session.js";
import { getParentSessionId, getSessionContext, getSessionDocumentId, getSessionStartTimestamp } from "./session-document.js";

const setStatus = (ctx: { ui: { setStatus(id: string, text: string): void } }, state: "off" | "connecting" | "recalling" | "connected" | "syncing" | "offline") => {
  const labels: Record<typeof state, string> = {
    off: "🧠 Hindsight off",
    connecting: "🧠 Hindsight connecting…",
    recalling: "🧠 Hindsight recalling…",
    connected: "🧠 Hindsight connected",
    syncing: "🧠 Hindsight syncing…",
    offline: "🧠 Hindsight offline",
  };
  ctx.ui.setStatus("hindsight", labels[state]);
};

const RETAIN_MESSAGE_TYPE = HINDSIGHT_RETAIN_STATUS_TYPE;
const RECALL_MESSAGE_TYPE = HINDSIGHT_RECALL_STATUS_TYPE;
const RECALL_CONTEXT_TYPE = HINDSIGHT_RECALL_CUSTOM_TYPE;

export default function hindsightMemory(pi: ExtensionAPI): void {
  let initializing: Promise<void> | null = null;
  let turnCount = 0;
  let lastContextTurn = 0;
  let scheduler: WriteScheduler | null = null;
  let retainInFlight: Promise<void> = Promise.resolve();
  let pendingRecallIndicator: { config: any; content: string; details: Record<string, unknown> } | null = null;
  let currentUi: { notify(message: string, level?: string): void } | null = null;
  let lastMeaningfulRecallQuery: string | null = null;
  let lastRawUserInput: string | null = null;
  let pendingRecallQuery: string | null = null;
  let pendingRecallConfig: any | null = null;
  let pendingInspectionHint = "";
  let recallInjectedForCurrentAgent = false;
  let pendingToolHint = "";

  const emitIndicator = (config: any, type: string, content: string, details: Record<string, unknown> = {}): void => {
    if ((type === RECALL_MESSAGE_TYPE && !config.showRecallIndicator) || (type === RETAIN_MESSAGE_TYPE && !config.showRetainIndicator)) return;

    // Status indicators are UI only. Custom messages are serialized as user
    // messages by pi, so using pi.sendMessage here bloats provider context and
    // can make the agent see banners like "memory context loaded" instead of
    // the actual hidden recall payload.
    currentUi?.notify(content, type === RETAIN_MESSAGE_TYPE ? "success" : "info");
  };

  const compactSnippet = (value: string, maxLine = 100): string => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLine) return normalized;
    const first = normalized.slice(0, maxLine);
    const second = normalized.slice(maxLine, maxLine * 2);
    return `${first}${first.length < normalized.length ? "…" : ""}${second ? `\n  ${second}${normalized.length > maxLine * 2 ? "…" : ""}` : ""}`;
  };

  const renderRecallBox = (message: any, options: any, theme: any) => {
    const details = (message.details ?? {}) as { bankId?: string; previews?: string[]; chars?: number; resultCount?: number; query?: string };
    const count = details.resultCount ?? details.previews?.length ?? 0;
    const box = new Box(1, 1, (t: string) => theme.bg("customMessageBg", t));
    let text = `${theme.fg("accent", "🧠 HINDSIGHT RECALL")} ${theme.fg("muted", details.bankId ?? "")}`.trim();
    text += `\n${theme.fg("accent", `Loaded ${count} memory snippet${count === 1 ? "" : "s"}`)}`;
    if (options.expanded && details.query) text += `\n${theme.fg("dim", `query: ${compactSnippet(details.query, 120)}`)}`;
    if (options.expanded && details.previews?.length) text += `\n${details.previews.map((line) => `• ${compactSnippet(line)}`).join("\n")}`;
    if (options.expanded && details.chars) text += `\n${theme.fg("dim", `${details.chars} chars injected`)}`;
    box.addChild(new Text(text, 0, 0));
    return box;
  };

  pi.registerMessageRenderer(RECALL_MESSAGE_TYPE, renderRecallBox);
  pi.registerMessageRenderer(RECALL_CONTEXT_TYPE, (message: any, options: any, theme: any) => {
    if (message.display === false) return undefined;
    return renderRecallBox(message, options, theme);
  });
  pi.registerMessageRenderer(RETAIN_MESSAGE_TYPE, (message: any, _options: any, theme: any) => {
    const details = (message.details ?? {}) as { mode?: string; bankId?: string; itemsCount?: number; queueStatus?: string };
    const saved = details.mode === "saved";
    const box = new Box(1, 1, (t: string) => theme.bg("customMessageBg", t));
    let text = `${theme.fg(saved ? "success" : "warning", saved ? "💾 HINDSIGHT RETAIN" : "⏳ HINDSIGHT RETAIN")} ${theme.fg("muted", details.bankId ?? "")}`.trim();
    text += `\n${theme.fg(saved ? "success" : "warning", saved ? "Memory retained" : "Memory queued")}`;
    if (details.itemsCount) text += `\n${theme.fg("dim", `${details.itemsCount} item(s)`)}`;
    if (!saved && details.queueStatus) text += `\n${theme.fg("dim", details.queueStatus)}`;
    box.addChild(new Text(text, 0, 0));
    return box;
  });

  pi.on("context", async (event: any) => {
    const messages = Array.isArray(event.messages) ? event.messages : [];
    const filtered = filterHindsightProviderMessages(messages);
    if (filtered.length !== messages.length) return { messages: filtered };
  });

  registerTools(pi);
  registerCommands(pi);

  const initialize = (ctx: { cwd: string; ui: { setStatus(id: string, text: string): void; notify(message: string, level?: string): void } }) => {
    initializing = (async () => {
      try {
        clearHandles();
        clearCachedContext();
        turnCount = 0;
        lastContextTurn = 0;
        lastMeaningfulRecallQuery = null;
        lastRawUserInput = null;
        pendingRecallQuery = null;
        pendingRecallConfig = null;
        pendingInspectionHint = "";
        pendingToolHint = "";
        recallInjectedForCurrentAgent = false;
        scheduler?.reset();
        scheduler = null;
        retainInFlight = Promise.resolve();
        resetHookStats();
        setHookStat("sessionStart", { firedAt: new Date().toISOString(), result: "ok" });

        const config = await resolveConfig(ctx.cwd);
        if (!config.enabled) {
          setStatus(ctx, "off");
          setHookStat("sessionStart", { firedAt: new Date().toISOString(), result: "skipped", detail: "disabled" });
          return;
        }

        scheduler = new WriteScheduler(config.writeFrequency, ({ handles, summary }) => {
          emitIndicator(handles.config, RETAIN_MESSAGE_TYPE, `retain successful for bank ${handles.bankId}`, {
            mode: "saved",
            bankId: handles.bankId,
            itemsCount: summary.itemsCount,
            previews: summary.previews,
            fullText: summary.fullText,
          });
        });
        const handles = await bootstrap(config, ctx.cwd);
        pi.setSessionName(deriveWorkspaceSessionName(ctx.cwd));
        setHookStat("sessionStart", { firedAt: new Date().toISOString(), result: "ok", detail: `bank=${handles.bankId}` });
        setStatus(ctx, "connected");
      } catch (error) {
        console.error("[hindsight-pi] initialization failed:", error instanceof Error ? error.message : error);
        setHookStat("sessionStart", { firedAt: new Date().toISOString(), result: "failed", detail: error instanceof Error ? error.message : String(error) });
        setStatus(ctx, "offline");
      } finally {
        initializing = null;
      }
    })();
  };

  pi.on("session_start", async (_event: any, ctx: any) => {
    currentUi = ctx.ui;
    setStatus(ctx, "connecting");
    initialize(ctx);
  });

  pi.on("input", async (event: any) => {
    lastRawUserInput = (event.text ?? "").trim();
  });

  pi.on("before_agent_start", async (event: any) => {
    if (initializing) await initializing;
    const recallMode = getRecallMode();
    if (recallMode === "tools" || recallMode === "off") {
      pendingRecallQuery = null;
      pendingRecallConfig = null;
      pendingInspectionHint = "";
      pendingToolHint = "";
      return;
    }
    const handles = getHandles();
    if (!handles) return;

    turnCount += 1;
    recallInjectedForCurrentAgent = false;
    pendingRecallIndicator = null;
    const expandedPrompt = (event.prompt ?? "").trim();
    const capturedRawPrompt = lastRawUserInput;
    lastRawUserInput = null;
    const rawPrompt = (capturedRawPrompt ?? "").trim();
    const basePrompt = rawPrompt || expandedPrompt;
    const continuePrompt = isContinuePrompt(basePrompt);
    const decision = deriveRecallQuery({
      rawInput: continuePrompt && lastMeaningfulRecallQuery ? lastMeaningfulRecallQuery : capturedRawPrompt,
      expandedPrompt: continuePrompt && lastMeaningfulRecallQuery ? lastMeaningfulRecallQuery : expandedPrompt,
      lastMeaningfulPrompt: lastMeaningfulRecallQuery,
      maxChars: handles.config.recallMaxQueryChars,
      longQueryBehavior: handles.config.recallLongQueryBehavior,
    });
    const shouldSkipAutoRecall = decision.kind === "query"
      && !decision.forceInspection
      && handles.config.injectionFrequency === "first-turn"
      && turnCount > 1
      && continuePrompt;
    if (shouldSkipAutoRecall || decision.kind === "skip") {
      pendingRecallQuery = null;
      pendingRecallConfig = null;
      pendingInspectionHint = "";
      pendingToolHint = "";
      const detail = shouldSkipAutoRecall ? "continue-first-turn" : decision.kind === "skip" ? decision.reason : "empty-query";
      setHookStat("recall", {
        firedAt: new Date().toISOString(),
        result: "skipped",
        detail,
      });
      if (detail === "query-too-long") {
        currentUi?.notify(`🧠 Hindsight recall skipped: query exceeds ${handles.config.recallMaxQueryChars} characters. Shorten prompt or set recallLongQueryBehavior=truncate.`, "warning");
      }
      return;
    }

    lastContextTurn = turnCount;
    if (!decision.forceInspection && decision.query) lastMeaningfulRecallQuery = decision.query;
    pendingRecallQuery = decision.query;
    pendingRecallConfig = handles.config;
    pendingInspectionHint = decision.forceInspection
      ? "\n\nIf the user asks what memory is loaded or what is in current context, answer from the loaded <hindsight_memories> block directly. Do not say no memory was loaded if the block is present."
      : "";
    pendingToolHint = recallMode === "hybrid"
      ? "\n\nUse hindsight_search for raw facts, hindsight_context for deeper synthesis beyond already loaded memory, and hindsight_retain when user explicitly wants something remembered."
      : "";
  });

  pi.on("agent_start", async () => {
    recallInjectedForCurrentAgent = false;
  });

  pi.on("context", async (event: any, ctx: any) => {
    const inputMessages = Array.isArray(event.messages) ? event.messages : [];
    const filteredMessages = filterHindsightProviderMessages(inputMessages);
    const handles = getHandles();
    if (!handles || !pendingRecallQuery || recallInjectedForCurrentAgent) {
      if (filteredMessages.length !== inputMessages.length) return { messages: filteredMessages };
      return;
    }

    setStatus(ctx, "recalling");
    currentUi?.notify("🧠 Hindsight recalling…", "info");

    try {
      const recallStartedAt = Date.now();
      await refreshContextForPrompt(handles, pendingRecallQuery, { cwd: ctx.cwd, sessionId: getSessionDocumentId(ctx), parentId: getParentSessionId(ctx) });
      const recallDurationMs = Date.now() - recallStartedAt;
      const memory = renderCachedContext();
      if (!memory) {
        setHookStat("recall", { firedAt: new Date().toISOString(), result: "skipped", detail: "empty-or-too-long" });
        recallInjectedForCurrentAgent = true;
        pendingRecallQuery = null;
        pendingRecallConfig = null;
        pendingInspectionHint = "";
        pendingToolHint = "";
        pendingRecallIndicator = null;
        const reason = getLastRecallErrorReason();
        currentUi?.notify(
          reason === "query-too-long"
            ? "🧠 Hindsight recall skipped: query exceeds Hindsight limit. Shorten prompt or change settings."
            : "🧠 Hindsight recall skipped for this turn (no results or recall failed).",
          "warning",
        );
        return;
      }

      const totalResults = Math.max(countCachedContext(), 1);
      const previews = previewCachedContext(Math.min(totalResults, 6));
      setHookStat("recall", { firedAt: new Date().toISOString(), result: "ok", detail: `recall:${totalResults}` });
      recallInjectedForCurrentAgent = true;
      pendingRecallIndicator = {
        config: handles.config,
        content: `🧠 HINDSIGHT RECALL · memory context loaded${recallDurationMs > 0 ? ` in ${recallDurationMs}ms` : ""}`,
        details: {
          bankId: handles.bankId,
          previews,
          chars: memory.length,
          resultCount: totalResults,
          query: pendingRecallQuery,
          durationMs: recallDurationMs,
        },
      };
      const contextMessage = createRecallCustomMessage({
        content: `${memory}${pendingInspectionHint}${pendingToolHint}`,
        display: false,
        details: {
          bankId: handles.bankId,
          query: pendingRecallQuery,
        },
      });
      pendingRecallQuery = null;
      pendingRecallConfig = null;
      pendingInspectionHint = "";
      pendingToolHint = "";
      if (handles.config.autoRecallPersist) {
        pi.sendMessage({
          customType: RECALL_CONTEXT_TYPE,
          content: contextMessage.content,
          display: handles.config.autoRecallDisplay,
          details: contextMessage.details,
        }, { triggerTurn: false });
      }
      emitIndicator(handles.config, RECALL_MESSAGE_TYPE, pendingRecallIndicator.content, pendingRecallIndicator.details);
      pendingRecallIndicator = null;
      return {
        messages: [...filteredMessages, contextMessage],
      };
    } finally {
      setStatus(ctx, "connected");
    }
  });

  const flushQueuedSession = async (ctx: any): Promise<void> => {
    const handles = getHandles();
    if (!handles) return;
    const sessionId = getSessionDocumentId(ctx);
    const { records } = readQueueRecords(sessionId, "auto");
    if (records.length === 0) return;
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
    } catch (error) {
      recordFlushFailure(error);
      setHookStat("retain", { firedAt: new Date().toISOString(), result: "failed", detail: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };

  pi.on("message_end", async (event: any, ctx: any) => {
    const handles = getHandles();
    if (!handles || !handles.config.saveMessages) return;
    const sessionId = getSessionDocumentId(ctx);
    const entries = ctx?.sessionManager?.getEntries?.() ?? [];
    if (!sessionRetained(entries, true)) return;
    const message = event?.message;
    if (!message || message.customType === RECALL_CONTEXT_TYPE || message.customType === RECALL_MESSAGE_TYPE || message.customType === RETAIN_MESSAGE_TYPE) return;
    const role = message.role;
    if (role !== "user" && role !== "assistant" && role !== "toolResult") return;
    const preparedEntry = prepareRetainEntry({ type: "message", message, timestamp: new Date().toISOString() }, handles.config);
    if (!preparedEntry) return;
    const content = JSON.stringify(preparedEntry);
    appendQueueRecord({
      sessionId,
      bankId: handles.bankId,
      content,
      context: getSessionContext(ctx),
      tags: [...buildAutomaticTags(handles.config, { cwd: ctx.cwd, sessionId, parentId: getParentSessionId(ctx) }, "auto"), ...sessionTags(entries)],
      metadata: { source: "pi", kind: "session-message", origin: "auto", workspace: handles.config.workspace },
      timestamp: getSessionStartTimestamp(ctx),
      document_id: sessionId,
      update_mode: "append",
      observation_scopes: expandObservationScopes(handles.config, { cwd: ctx.cwd, sessionId, parentId: getParentSessionId(ctx) }) ?? undefined,
    }, "auto");
    setHookStat("retain", { firedAt: new Date().toISOString(), result: "ok", detail: "queued:message_end" });
  });

  pi.on("agent_end", async () => {
    recallInjectedForCurrentAgent = false;
    pendingRecallQuery = null;
    pendingRecallConfig = null;
    pendingInspectionHint = "";
    pendingToolHint = "";
  });

  const flush = async (_event?: any, ctx?: any) => { await retainInFlight; await scheduler?.flush(); if (ctx) await flushQueuedSession(ctx); };
  pi.on("session_shutdown", flush);
  pi.on("session_before_switch", flush);
  pi.on("session_before_fork", flush);
  pi.on("session_before_compact", flush);
}
