export interface HindsightMeta {
  retained?: boolean;
  tags?: string[];
}

export const HINDSIGHT_META_TYPE = "hindsight-meta";

export const getHindsightMeta = (entries: any[] | undefined): HindsightMeta | null => {
  if (!Array.isArray(entries)) return null;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.type === "custom" && entry.customType === HINDSIGHT_META_TYPE && entry.data && typeof entry.data === "object") {
      const data = entry.data as HindsightMeta;
      return {
        retained: typeof data.retained === "boolean" ? data.retained : undefined,
        tags: Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0) : [],
      };
    }
  }
  return null;
};

export const sessionRetained = (entries: any[] | undefined, defaultValue = true): boolean => {
  const meta = getHindsightMeta(entries);
  return meta?.retained ?? defaultValue;
};

export const sessionTags = (entries: any[] | undefined): string[] => getHindsightMeta(entries)?.tags ?? [];

export const nextMeta = (entries: any[] | undefined, patch: HindsightMeta, defaultRetained = true): HindsightMeta => {
  const current = getHindsightMeta(entries) ?? { retained: defaultRetained, tags: [] };
  return {
    retained: patch.retained ?? current.retained ?? defaultRetained,
    tags: patch.tags ?? current.tags ?? [],
  };
};
