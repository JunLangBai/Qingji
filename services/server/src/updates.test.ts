import { describe, expect, it } from "vitest";
import {
  compareVersions,
  getUpdateStatus,
  readConfiguredRelease,
} from "./updates.js";

describe("application updates", () => {
  it("compares semantic versions and reports newer releases", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("v0.1.0", "0.1.0")).toBe(0);
    expect(
      getUpdateStatus("0.1.0", {
        latestVersion: "0.2.0",
        releaseUrl: "https://github.com/example/qingji/releases/tag/v0.2.0",
      }).available,
    ).toBe(true);
  });

  it("accepts only HTTPS GitHub release links", () => {
    expect(
      readConfiguredRelease({
        APP_UPDATE_VERSION: "v0.2.0",
        APP_UPDATE_URL:
          "https://github.com/example/qingji/releases/tag/v0.2.0",
      }),
    ).toMatchObject({ latestVersion: "0.2.0" });
    expect(() =>
      readConfiguredRelease({
        APP_UPDATE_VERSION: "0.2.0",
        APP_UPDATE_URL: "https://example.com/qingji/releases/tag/v0.2.0",
      }),
    ).toThrow("GitHub Release");
  });
});
