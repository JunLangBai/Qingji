import type {
  AppReleaseInfo,
  AppUpdateStatus,
} from "@qingji/contracts";
import clientPackage from "../package.json";

export const APP_VERSION = clientPackage.version;

const listeners = new Set<(release: AppReleaseInfo | null) => void>();
let latestRelease: AppReleaseInfo | null = null;

function versionParts(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

export function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    const difference =
      (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

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
  const base = serverUrl.trim().replace(/\/+$/, "");
  if (!base) return null;
  const url = new URL(`${base}/v1/update`);
  url.searchParams.set("platform", /Android/i.test(navigator.userAgent) ? "android" : "windows");
  url.searchParams.set("currentVersion", APP_VERSION);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const status = (await response.json()) as Partial<AppUpdateStatus>;
  if (
    status.available !== true ||
    typeof status.latestVersion !== "string" ||
    !isGitHubReleaseUrl(status.releaseUrl)
  ) {
    return null;
  }
  return notifyRelease({
    latestVersion: status.latestVersion,
    releaseUrl: status.releaseUrl,
    notes: typeof status.notes === "string" ? status.notes : undefined,
  });
}

export async function openReleasePage(url: string): Promise<void> {
  if (!isGitHubReleaseUrl(url)) throw new Error("更新链接不受支持");
  if (window.qingjiDesktop) {
    await window.qingjiDesktop.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
