import { describe, expect, it } from "vitest";
import {
  compareVersions,
  isGitHubReleaseUrl,
  selectLatestGitHubRelease,
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

  it("selects the newest published release that contains an installer", () => {
    expect(
      selectLatestGitHubRelease([
        {
          draft: false,
          tag_name: "v0.1.2-alpha.1",
          html_url:
            "https://github.com/JunLangBai/Qingji/releases/tag/v0.1.2-alpha.1",
          body: "修复体验问题",
          assets: [{ name: "Qingji-Windows-Setup.exe" }],
        },
        {
          draft: false,
          tag_name: "v0.1.1",
          html_url:
            "https://github.com/JunLangBai/Qingji/releases/tag/v0.1.1",
          assets: [],
        },
        {
          draft: true,
          tag_name: "v9.0.0",
          html_url:
            "https://github.com/JunLangBai/Qingji/releases/tag/v9.0.0",
          assets: [{ name: "Qingji.apk" }],
        },
      ]),
    ).toMatchObject({
      latestVersion: "0.1.2-alpha.1",
      notes: "修复体验问题",
    });
  });
});
