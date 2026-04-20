export interface HookStat {
  firedAt?: string;
  result?: "ok" | "failed" | "skipped";
  detail?: string;
}

export interface HindsightHookStats {
  sessionStart: HookStat;
  recall: HookStat;
  retain: HookStat;
}

let hookStats: HindsightHookStats = { sessionStart: {}, recall: {}, retain: {} };

export const getHookStats = (): HindsightHookStats => hookStats;
export const resetHookStats = (): void => {
  hookStats = { sessionStart: {}, recall: {}, retain: {} };
};
export const setHookStat = (name: keyof HindsightHookStats, value: HookStat): void => {
  hookStats = { ...hookStats, [name]: value };
};
