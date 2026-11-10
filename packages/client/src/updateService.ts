import type {
  AppReleaseInfo,
  AppUpdateStatus,
} from "@qingji/contracts";
import { compareVersions } from "@qingji/domain";
import clientPackage from "../package.json";

export const APP_VERSION = clientPackage.version;
export { compareVersions };

const listeners = new Set<(release: AppReleaseInfo | null) => void>();
let latestRelease: AppReleaseInfo | null = null;
const GITHUB_RELEASES_URL =
  "https://api.github.com/repos/JunLangBai/Qingji/releases?per_page=10";
export const OFFICIAL_UPDATE_SERVER_URL = (
  import.meta.env.VITE_QINGJI_UPDATE_SERVER_URL ||
  "https://124.220.161.94/qingji-api"
).replace(/\/+$/, "");

export function isGitHubReleaseUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "github.com" || url.hostname === "www.github.com") &&
      /^\/[^/]+\/[^/]+\/releases(?:\/|$)/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function selectLatestGitHubRelease(
  value: unknown,
): AppReleaseInfo | null {
  if (!Array.isArray(value)) return null;
  const candidates: AppReleaseInfo[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const release = item as {
      draft?: unknown;
      tag_name?: unknown;
      html_url?: unknown;
      body?: unknown;
      assets?: unknown;
    };
    if (
      release.draft === true ||
      typeof release.tag_name !== "string" ||
      !/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
        release.tag_name,
      ) ||
      !isGitHubReleaseUrl(release.html_url)
    ) {
      continue;
    }
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const hasInstallableAsset = assets.some((asset) => {
      if (!asset || typeof asset !== "object") return false;
      const name = (asset as { name?: unknown }).name;
      return typeof name === "string" && /\.(?:exe|apk)$/i.test(name);
    });
    if (!hasInstallableAsset) continue;
    candidates.push({
      latestVersion: release.tag_name.replace(/^v/i, ""),
      releaseUrl: release.html_url,
      notes:
        typeof release.body === "string" && release.body.trim()
          ? release.body.trim().slice(0, 500)
          : undefined,
    });
  }
  return (
    candidates.sort((left, right) =>
      compareVersions(right.latestVersion, left.latestVersion),
    )[0] ?? null
  );
}

function publish(release: AppReleaseInfo | null): void {
  latestRelease = release;
  for (const listener of listeners) listener(release);
}

export function notifyRelease(
  release: AppReleaseInfo | null,
): AppReleaseInfo | null {
  if (
    !release ||
    !isGitHubReleaseUrl(release.releaseUrl) ||
    compareVersions(release.latestVersion, APP_VERSION) <= 0
  ) {
    return latestRelease;
  }
  publish(release);
  return release;
}

export function getLatestRelease(): AppReleaseInfo | null {
  return latestRelease;
}

export function subscribeLatestRelease(
  listener: (release: AppReleaseInfo | null) => void,
): () => void {
  listeners.add(listener);
  listener(latestRelease);
  return () => listeners.delete(listener);
}

export async function fetchAvailableUpdate(
  serverUrl: string,
): Promise<AppReleaseInfo | null> {
  const platform = /Android/i.test(navigator.userAgent)
    ? "android"
    : "windows";

  try {
    const response = await fetch(GITHUB_RELEASES_URL, {
      headers: {
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const release = selectLatestGitHubRelease(await response.json());
      if (release) {
        return compareVersions(release.latestVersion, APP_VERSION) > 0
          ? notifyRelease(release)
          : null;
      }
    }
  } catch {
    // Fall through to the official update service.
  }

  const endpoints = new Set(
    [
      OFFICIAL_UPDATE_SERVER_URL,
      serverUrl.trim().replace(/\/+$/, ""),
    ].filter(Boolean),
  );
  for (const base of endpoints) {
    try {
      const url = new URL(`${base}/v1/update`);
      url.searchParams.set("platform", platform);
      url.searchParams.set("currentVersion", APP_VERSION);
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) continue;
      const status = (await response.json()) as Partial<AppUpdateStatus>;
      if (
        status.available !== true ||
        typeof status.latestVersion !== "string" ||
        !isGitHubReleaseUrl(status.releaseUrl)
      ) {
        continue;
      }
      const release = {
        latestVersion: status.latestVersion,
        releaseUrl: status.releaseUrl,
        notes: typeof status.notes === "string" ? status.notes : undefined,
      };
      if (compareVersions(release.latestVersion, APP_VERSION) > 0) {
        return notifyRelease(release);
      }
    } catch {
      // A user-configured server may be offline; try the next source.
    }
  }
  return null;
}

export async function openReleasePage(url: string): Promise<void> {
  if (!isGitHubReleaseUrl(url)) throw new Error("更新链接不受支持");
  if (window.qingjiDesktop) {
    await window.qingjiDesktop.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
