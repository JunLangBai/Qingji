import { describe, expect, it } from "vitest";
import {
  compareVersions,
  fetchAvailableUpdate,
  fetchUpdateFromService,
  isGitHubReleaseUrl,
  OFFICIAL_UPDATE_SERVER_URL,
  resolveUpdateDownloadUrl,
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

  it("resolves update downloads only under the reporting server path", () => {
    expect(
      resolveUpdateDownloadUrl(
        "v1/update/download?platform=windows",
        "https://updates.example/qingji-api",
      ),
    ).toBe(
      "https://updates.example/qingji-api/v1/update/download?platform=windows",
    );
    expect(
      resolveUpdateDownloadUrl(
        "v1/update/download",
        "https://updates.example/qingji-api",
        "android",
      ),
    ).toBe(
      "https://updates.example/qingji-api/v1/update/download?platform=android",
    );
    expect(
      resolveUpdateDownloadUrl(
        "https://untrusted.example/v1/update/download",
        "https://updates.example/qingji-api",
      ),
    ).toBeUndefined();
    expect(
      resolveUpdateDownloadUrl(
        "https://updates.example/other/download",
        "https://updates.example/qingji-api",
      ),
    ).toBeUndefined();
  });

  it("uses the reachable update service before contacting GitHub", async () => {
    const calls: string[] = [];
    const fetcher = async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith(OFFICIAL_UPDATE_SERVER_URL)) {
        return new Response(
          JSON.stringify({
            available: true,
            currentVersion: "0.1.3-alpha.1",
            latestVersion: "0.2.0",
            releaseUrl:
              "https://github.com/example/qingji/releases/tag/v0.2.0",
            notes: "无需访问 GitHub",
            downloadUrl: "v1/update/download?platform=windows",
          }),
          { status: 200 },
        );
      }
      return new Response("unavailable", { status: 503 });
    };

    const release = await fetchAvailableUpdate(
      "https://sync.example",
      { platform: "windows", fetcher },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(
      `${OFFICIAL_UPDATE_SERVER_URL}/v1/update`,
    );
    expect(release).toMatchObject({
      latestVersion: "0.2.0",
      downloadUrl:
        `${OFFICIAL_UPDATE_SERVER_URL}/v1/update/download?platform=windows`,
    });
  });

  it("treats a valid no-update response as authoritative", async () => {
    const result = await fetchUpdateFromService(
      "https://updates.example/qingji-api",
      "android",
      async () =>
        new Response(
          JSON.stringify({
            available: false,
            currentVersion: "0.1.3-alpha.1",
          }),
          { status: 200 },
        ),
    );
    expect(result).toEqual({ reachable: true, release: null });
  });

  it("falls back to GitHub only when both update services are unreachable", async () => {
    const calls: string[] = [];
    const result = await fetchAvailableUpdate(
      "https://sync.example",
      {
        platform: "android",
        fetcher: async (input: string | URL | Request) => {
          const url = String(input);
          calls.push(url);
          if (url.includes("api.github.com")) {
            return new Response(
              JSON.stringify([
                {
                  draft: false,
                  tag_name: "v0.2.0",
                  html_url:
                    "https://github.com/example/qingji/releases/tag/v0.2.0",
                  assets: [{ name: "Qingji.apk" }],
                },
              ]),
              { status: 200 },
            );
          }
          return new Response("unavailable", { status: 503 });
        },
      },
    );
    expect(calls).toHaveLength(3);
    expect(calls[2]).toContain("api.github.com");
    expect(result).toMatchObject({ latestVersion: "0.2.0" });
  });

  it("continues after a reachable service reports no release", async () => {
    const calls: string[] = [];
    const result = await fetchAvailableUpdate(
      "https://sync.example",
      {
        platform: "windows",
        fetcher: async (input: string | URL | Request) => {
          const url = String(input);
          calls.push(url);
          if (url.includes("api.github.com")) {
            return new Response(
              JSON.stringify([
                {
                  draft: false,
                  tag_name: "v0.2.0",
                  html_url:
                    "https://github.com/example/qingji/releases/tag/v0.2.0",
                  assets: [{ name: "Qingji-Setup.exe" }],
                },
              ]),
              { status: 200 },
            );
          }
          return new Response(
            JSON.stringify({
              available: false,
              currentVersion: "0.1.3-alpha.1",
            }),
            { status: 200 },
          );
        },
      },
    );
    expect(calls).toHaveLength(3);
    expect(calls[2]).toContain("api.github.com");
    expect(result).toMatchObject({ latestVersion: "0.2.0" });
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
