import { describe, expect, it } from "vitest";
import { buildAutomaticTags, expandObservationScopes, expandTagPlaceholders, getProjectName } from "../extensions/retain/tags.js";

describe("retain tags and scopes", () => {
  const config = { constantTags: ["harness:pi"], projectName: "stable-project", observationScopes: [["{project}"], ["{cwd}"]] } as any;
  const ctx = { cwd: "/tmp/somewhere/project", sessionId: "s1", parentId: "p1" };

  it("expands project independent of cwd", () => {
    expect(getProjectName(config, ctx.cwd)).toBe("stable-project");
    expect(expandTagPlaceholders(["{project}", "user:me"], config, ctx)).toEqual(["project:stable-project", "user:me"]);
  });

  it("builds automatic retain tags", () => {
    expect(buildAutomaticTags(config, ctx, "auto")).toEqual(expect.arrayContaining([
      "harness:pi",
      "session:s1",
      "parent:p1",
      "project:stable-project",
      "store_method:auto",
    ]));
  });

  it("expands observation scopes at queue time", () => {
    const scopes = expandObservationScopes(config, ctx) as string[][];
    expect(scopes[0]).toEqual(["project:stable-project"]);
    expect(scopes[1][0]).toMatch(/cwd:.*\/tmp\/somewhere\/project$/);
  });
});
