import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";
import { bootstrap, clearHandles, getHandles } from "./client.js";
import { registerCommands } from "./commands.js";
import { getRecallMode, resolveConfig } from "./config.js";
import { backgroundRefresh, clearCachedContext, incrementMessageCount, pendingRefresh, pinCachedContext, previewCachedContext, refreshCachedContext, renderCachedContext, shouldRefreshCachedContext } from "./context.js";
import { registerTools } from "./tools.js";
import { WriteScheduler } from "./upload.js";
import { resetHookStats, setHookStat } from "./hooks.js";
import { deriveWorkspaceSessionName } from "./session.js";

const setStatus = (ctx: { ui: { setStatus(id: string, text: string): void } }, state: "off" | "connected" | "syncing" | "offline") => {
  const labels: Record<typeof state, string> = {
    off: "🧠 Hindsight off",
    connected: "🧠 Hindsight connected",
    syncing: "🧠 Hindsight syncing",
    offline: "🧠 Hindsight offline",
  };
  ctx.ui.setStatus("hindsight", labels[state]);
};

const RETAIN_MESSAGE_TYPE = "hindsight-retain-status";
const RECALL_MESSAGE_TYPE = "hindsight-recall-status";

export default function hindsightMemory(pi: ExtensionAPI): void {
  let initializing: Promise<void> | null = null;
  let turnCount = 0;
  let lastContextTurn = 0;
  let scheduler: WriteScheduler | null = null;
  let currentUi: { notify(message: string, level?: string): void } | null = null;
  let retainInFlight: Promise<void> = Promise.resolve();

  const emitIndicator = (config: any, type: string, content: string, details: Record<string, unknown> = {}): void => {
    if ((type === RECALL_MESSAGE_TYPE && !config.showRecallIndicator) || (type === RETAIN_MESSAGE_TYPE && !config.showRetainIndicator)) return;

    if (!config.indicatorsInContext && currentUi) {
      currentUi.notify(content, type === RETAIN_MESSAGE_TYPE ? "success" : "info");
      return;
    }

    pi.sendMessage({ customType: type, content, display: true, details }, { triggerTurn: false });
  };

  const compactSnippet = (value: string, maxLine = 100): string => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLine) return normalized;
    const first = normalized.slice(0, maxLine);
    const second = normalized.slice(maxLine, maxLine * 2);
    return `${first}${first.length < normalized.length ? "…" : ""}${second ? `\n  ${second}${normalized.length > maxLine * 2 ? "…" : ""}` : ""}`;
  };

  pi.registerMessageRenderer(RECALL_MESSAGE_TYPE, (message: any, options: any, theme: any) => {
    const details = (message.details ?? {}) as { bankId?: string; previews?: string[]; chars?: number };
    const count = details.previews?.length ?? 0;
    const box = new Box(1, 1, (t: string) => theme.bg("customMessageBg", t));
    let text = `${theme.fg("accent", `🧠 Memory loaded (${count} snippet${count === 1 ? "" : "s"})`)} ${theme.fg("muted", details.bankId ?? "")}`.trim();
    if (options.expanded && details.previews?.length) text += `\n${details.previews.map((line) => `• ${compactSnippet(line)}`).join("\n")}`;
    if (options.expanded && details.chars) text += `\n${theme.fg("dim", `${details.chars} chars of memory injected into prompt`)}`;
    box.addChild(new Text(text, 0, 0));
    return box;
  });
  pi.registerMessageRenderer(RETAIN_MESSAGE_TYPE, (message: any, _options: any, theme: any) => {
    const details = (message.details ?? {}) as { mode?: string; bankId?: string; itemsCount?: number; queueStatus?: string };
    const saved = details.mode === "saved";
    const box = new Box(1, 1, (t: string) => theme.bg("customMessageBg", t));
    let text = `${theme.fg(saved ? "success" : "warning", saved ? "💾 Memory retained" : "⏳ Memory queued")} ${theme.fg("muted", details.bankId ?? "")}`.trim();
    if (details.itemsCount) text += `\n${theme.fg("dim", `${details.itemsCount} item(s)`)}`;
    if (!saved && details.queueStatus) text += `\n${theme.fg("dim", details.queueStatus)}`;
    box.addChild(new Text(text, 0, 0));
    return box;
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
        await refreshCachedContext(handles);
        setHookStat("sessionStart", { firedAt: new Date().toISOString(), result: "ok", detail: `bank=${handles.bankId}` });
        if (config.injectionFrequency === "first-turn") pinCachedContext();
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
    initialize(ctx);
  });

  pi.on("before_agent_start", async (event: any) => {
    if (initializing) await initializing;
    const recallMode = getRecallMode();
    if (recallMode === "tools" || recallMode === "off") return;
    const handles = getHandles();
    if (!handles) return;

    turnCount += 1;
    if (handles.config.injectionFrequency === "first-turn" && turnCount > 1) return;

    const shouldRefresh = (turnCount - lastContextTurn) >= handles.config.contextCadence && shouldRefreshCachedContext(handles);
    if (pendingRefresh) await pendingRefresh;
    if (shouldRefresh) {
      backgroundRefresh(handles);
      lastContextTurn = turnCount;
    }

    const memory = renderCachedContext();
    if (!memory) {
      setHookStat("recall", { firedAt: new Date().toISOString(), result: "skipped", detail: "empty" });
      return;
    }
    const previews = previewCachedContext(3);
    setHookStat("recall", { firedAt: new Date().toISOString(), result: "ok", detail: `${previews.length > 0 ? previews.length : 1} snippet(s)` });
    emitIndicator(handles.config, RECALL_MESSAGE_TYPE, `🧠 Memory loaded (${previews.length > 0 ? previews.length : 1} snippet${previews.length > 0 ? (previews.length === 1 ? "" : "s") : ""})`, {
      bankId: handles.bankId,
      previews,
      chars: memory.length,
    });
    const toolHint = recallMode === "hybrid"
      ? "\n\nUse hindsight_search for raw facts, hindsight_context for synthesized memory answers, and hindsight_retain when user explicitly wants something remembered."
      : "";
    return {
      systemPrompt: `${event.systemPrompt}\n\n${memory}${toolHint}`,
    };
  });

  pi.on("agent_end", async (event: any, ctx: any) => {
    const handles = getHandles();
    if (!handles || !handles.config.saveMessages) return;
    incrementMessageCount(event.messages.length);
    setStatus(ctx, "syncing");

    retainInFlight = retainInFlight.then(async () => {
      try {
        const outcome = await scheduler?.onTurnEnd(handles, event.messages as any[]);
        setStatus(ctx, "connected");
        if (outcome?.skipped) {
          setHookStat("retain", { firedAt: new Date().toISOString(), result: "skipped", detail: outcome.reason });
          return;
        }
        if (outcome && !outcome.skipped) {
          const { summary } = outcome;
          setHookStat("retain", { firedAt: new Date().toISOString(), result: "ok", detail: `${summary.mode}:${summary.itemsCount}` });
          const queueStatus = summary.mode !== "queued"
            ? undefined
            : handles.config.writeFrequency === "async"
              ? "waiting for server confirmation"
              : handles.config.writeFrequency === "session"
                ? "saved on session end"
                : typeof handles.config.writeFrequency === "number"
                  ? `saved on flush after ${handles.config.writeFrequency} queued turn(s)`
                  : undefined;
          const retainLabel = summary.mode === "queued"
            ? handles.config.writeFrequency === "session"
              ? "Memory queued for session end"
              : handles.config.writeFrequency === "async"
                ? "Memory queued for async save"
                : typeof handles.config.writeFrequency === "number"
                  ? `Memory queued for ${handles.config.writeFrequency}-turn batch`
                  : "Memory queued"
            : "Memory retained";
          emitIndicator(handles.config, RETAIN_MESSAGE_TYPE, `${retainLabel}`, {
            mode: summary.mode,
            bankId: handles.bankId,
            itemsCount: summary.itemsCount,
            previews: summary.previews,
            ...(queueStatus ? { queueStatus } : {}),
            ...(summary.mode === "saved" ? { fullText: summary.fullText } : {}),
          });
        }
      } catch (error) {
        console.error("[hindsight-pi] upload failed:", error instanceof Error ? error.message : error);
        setHookStat("retain", { firedAt: new Date().toISOString(), result: "failed", detail: error instanceof Error ? error.message : String(error) });
        setStatus(ctx, "offline");
      }
    });
  });

  const flush = async () => { await retainInFlight; await scheduler?.flush(); };
  pi.on("session_shutdown", flush);
  pi.on("session_before_switch", flush);
  pi.on("session_before_fork", flush);
  pi.on("session_before_compact", flush);
}
