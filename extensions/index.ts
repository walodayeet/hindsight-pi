import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { bootstrap, clearHandles, getHandles } from "./client.js";
import { registerCommands } from "./commands.js";
import { getRecallMode, resolveConfig } from "./config.js";
import { backgroundRefresh, clearCachedContext, incrementMessageCount, pendingRefresh, pinCachedContext, previewCachedContext, refreshCachedContext, renderCachedContext, shouldRefreshCachedContext } from "./context.js";
import { registerTools } from "./tools.js";
import { WriteScheduler } from "./upload.js";
import { resetHookStats, setHookStat } from "./hooks.js";

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

  const emitIndicator = (config: any, type: string, content: string, details: Record<string, unknown> = {}): void => {
    if ((type === RECALL_MESSAGE_TYPE && !config.showRecallIndicator) || (type === RETAIN_MESSAGE_TYPE && !config.showRetainIndicator)) return;
    if (!config.indicatorsInContext && currentUi) {
      currentUi.notify(content, type === RETAIN_MESSAGE_TYPE ? "success" : "info");
      return;
    }
    pi.sendMessage({ customType: type, content, display: true, details });
  };

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
        resetHookStats();
        setHookStat("sessionStart", { firedAt: new Date().toISOString(), result: "ok" });

        const config = await resolveConfig();
        if (!config.enabled) {
          setStatus(ctx, "off");
          setHookStat("sessionStart", { firedAt: new Date().toISOString(), result: "skipped", detail: "disabled" });
          return;
        }

        scheduler = new WriteScheduler(config.writeFrequency, ({ handles, summary }) => {
          emitIndicator(handles.config, RETAIN_MESSAGE_TYPE, `retain successful: ${summary.itemsCount} item(s) for bank ${handles.bankId}`, {
            mode: "saved",
            bankId: handles.bankId,
            itemsCount: summary.itemsCount,
            previews: summary.previews,
          });
        });
        const handles = await bootstrap(config, ctx.cwd);
        if (config.renameSessionToBank) pi.setSessionName(handles.bankId);
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
    emitIndicator(handles.config, RECALL_MESSAGE_TYPE, `recall injected: ${previews.length > 0 ? previews.length : 1} memory snippet(s) into bank ${handles.bankId}`, {
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
        const verb = summary.mode === "queued" ? "queued retain" : "retain successful";
        emitIndicator(handles.config, RETAIN_MESSAGE_TYPE, `${verb}: ${summary.itemsCount} item(s) for bank ${handles.bankId}`, {
          mode: summary.mode,
          bankId: handles.bankId,
          itemsCount: summary.itemsCount,
          previews: summary.previews,
        });
      }
    } catch (error) {
      console.error("[hindsight-pi] upload failed:", error instanceof Error ? error.message : error);
      setHookStat("retain", { firedAt: new Date().toISOString(), result: "failed", detail: error instanceof Error ? error.message : String(error) });
      setStatus(ctx, "offline");
    }
  });

  const flush = async () => { await scheduler?.flush(); };
  pi.on("session_shutdown", flush);
  pi.on("session_before_switch", flush);
  pi.on("session_before_fork", flush);
  pi.on("session_before_compact", flush);
}
