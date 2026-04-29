import { describe, expect, it } from "vitest";
import { getFlushState, recordFlushFailure, recordFlushSuccess, resetFlushState } from "../extensions/flush-state.js";

describe("flush state", () => {
  it("records success and failure", () => {
    resetFlushState();
    expect(getFlushState()).toEqual({ lastFlushAt: null, lastFlushError: null });
    recordFlushFailure(new Error("boom"));
    expect(getFlushState().lastFlushError).toBe("boom");
    expect(getFlushState().lastFlushAt).toBeTruthy();
    recordFlushSuccess();
    expect(getFlushState().lastFlushError).toBeNull();
  });
});
