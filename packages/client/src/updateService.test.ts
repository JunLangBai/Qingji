import { describe, expect, it } from "vitest";
import {
  compareVersions,
  isGitHubReleaseUrl,
} from "./updateService";

describe("update links", () => {
  it("compares release versions", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("v0.1.0", "0.1.0")).toBe(0);
  });

  it("accepts only GitHub release pages", () => {
    expect(
      isGitHubReleaseUrl(
        "https://github.com/example/qingji/releases/tag/v0.2.0",
      ),
    ).toBe(true);
    expect(
      isGitHubReleaseUrl(
        "https://example.com/example/qingji/releases/tag/v0.2.0",
      ),
    ).toBe(false);
    expect(
      isGitHubReleaseUrl("javascript:alert(1)"),
    ).toBe(false);
  });
});
