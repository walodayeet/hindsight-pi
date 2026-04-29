let lastFlushError: string | null = null;
let lastFlushAt: string | null = null;

export const recordFlushSuccess = (): void => {
  lastFlushAt = new Date().toISOString();
  lastFlushError = null;
};

export const recordFlushFailure = (error: unknown): void => {
  lastFlushAt = new Date().toISOString();
  lastFlushError = error instanceof Error ? error.message : String(error);
};

export const getFlushState = (): { lastFlushAt: string | null; lastFlushError: string | null } => ({ lastFlushAt, lastFlushError });

export const resetFlushState = (): void => {
  lastFlushAt = null;
  lastFlushError = null;
};
