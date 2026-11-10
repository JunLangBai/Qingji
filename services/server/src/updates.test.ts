import { describe, expect, it } from "vitest";
import {
  compareVersions,
  createReleaseDiscovery,
  getUpdateStatus,
  parsePublishedReleaseFeed,
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

  it("discovers a published feed release that contains an installer", async () => {
    const feed = `
      <feed>
        <entry>
          <title>清记 0.1.2 Alpha 1</title>
          <link rel="alternate" href="https://github.com/JunLangBai/Qingji/releases/tag/v0.1.2-alpha.1" />
          <content type="html">&lt;p&gt;修复输入体验&lt;/p&gt;</content>
        </entry>
      </feed>
    `;
    expect(parsePublishedReleaseFeed(feed)).toEqual([
      {
        latestVersion: "0.1.2-alpha.1",
        releaseUrl:
          "https://github.com/JunLangBai/Qingji/releases/tag/v0.1.2-alpha.1",
      },
    ]);

    const fetcher = async (input: string) =>
      input.endsWith("releases.atom")
        ? new Response(feed, { status: 200 })
        : new Response(
            '<a href="/JunLangBai/Qingji/releases/download/v0.1.2-alpha.1/Qingji-Setup.exe">',
            { status: 200 },
          );
    const discover = createReleaseDiscovery(fetcher, () => 1);
    await expect(discover()).resolves.toMatchObject({
      latestVersion: "0.1.2-alpha.1",
    });
  });
});
