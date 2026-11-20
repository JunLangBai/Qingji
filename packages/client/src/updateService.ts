import type {
  AppReleaseInfo,
  AppUpdateStatus,
  UpdatePlatform,
} from "@qingji/contracts";
import { compareVersions } from "@qingji/domain";
import clientPackage from "../package.json";

export const APP_VERSION = clientPackage.version;
export { compareVersions };

const listeners = new Set<(release: AppReleaseInfo | null) => void>();
let latestRelease: AppReleaseInfo | null = null;
const VERSION_PATTERN =
  /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const GITHUB_RELEASES_URL =
  "https://api.github.com/repos/JunLangBai/Qingji/releases?per_page=10";
export const OFFICIAL_UPDATE_SERVER_URL = (
  import.meta.env.VITE_QINGJI_UPDATE_SERVER_URL ||
  "https://124.220.161.94/qingji-api"
).replace(/\/+$/, "");

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface UpdateServiceResult {
  reachable: boolean;
  release: AppReleaseInfo | null;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && isLoopbackHost(url.hostname)))
    );
  } catch {
    return false;
  }
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

export function resolveUpdateDownloadUrl(
  value: unknown,
  serverBaseUrl: string,
  platform?: UpdatePlatform,
): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const base = new URL(serverBaseUrl.trim());
    const target = new URL(
      value.trim(),
      `${serverBaseUrl.trim().replace(/\/+$/, "")}/`,
    );
    if (
      !isSafeExternalUrl(target.toString()) ||
      target.origin !== base.origin
    ) {
      return undefined;
    }
    const basePath = base.pathname.replace(/\/+$/, "");
    if (
      basePath &&
      target.pathname !== basePath &&
      !target.pathname.startsWith(`${basePath}/`)
    ) {
      return undefined;
    }
    if (platform) {
      target.searchParams.set("platform", platform);
    }
    return target.toString();
  } catch {
    return undefined;
  }
}

export function detectUpdatePlatform(): UpdatePlatform {
  return typeof navigator !== "undefined" &&
    /Android/i.test(navigator.userAgent)
    ? "android"
    : "windows";
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
      !VERSION_PATTERN.test(release.tag_name) ||
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
    (release.downloadUrl !== undefined &&
      !isSafeExternalUrl(release.downloadUrl)) ||
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

export async function fetchUpdateFromService(
  baseUrl: string,
  platform: UpdatePlatform,
  fetcher: FetchLike = fetch,
): Promise<UpdateServiceResult> {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  if (!normalizedBase) return { reachable: false, release: null };
  try {
    const url = new URL(`${normalizedBase}/v1/update`);
    url.searchParams.set("platform", platform);
    url.searchParams.set("currentVersion", APP_VERSION);
    const response = await fetcher(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return { reachable: false, release: null };
    const status = (await response.json()) as Partial<AppUpdateStatus>;
    if (status.available === false) {
      return { reachable: true, release: null };
    }
    if (
      status.available !== true ||
      typeof status.latestVersion !== "string" ||
      !VERSION_PATTERN.test(status.latestVersion) ||
      !isGitHubReleaseUrl(status.releaseUrl)
    ) {
      return { reachable: false, release: null };
    }
    if (compareVersions(status.latestVersion, APP_VERSION) <= 0) {
      return { reachable: true, release: null };
    }
    return {
      reachable: true,
      release: {
        latestVersion: status.latestVersion,
        releaseUrl: status.releaseUrl,
        notes:
          typeof status.notes === "string"
            ? status.notes.slice(0, 500)
            : undefined,
        downloadUrl: resolveUpdateDownloadUrl(
          status.downloadUrl,
          normalizedBase,
          platform,
        ),
      },
    };
  } catch {
    return { reachable: false, release: null };
  }
}

export async function fetchAvailableUpdate(
  serverUrl: string,
  options: {
    platform?: UpdatePlatform;
    fetcher?: FetchLike;
  } = {},
): Promise<AppReleaseInfo | null> {
  const platform =
    options.platform ?? detectUpdatePlatform();
  const fetcher = options.fetcher ?? fetch;
  const configuredServer = serverUrl.trim().replace(/\/+$/, "");
  const services = new Set(
    [OFFICIAL_UPDATE_SERVER_URL, configuredServer].filter(Boolean),
  );

  for (const base of services) {
    const result = await fetchUpdateFromService(
      base,
      platform,
      fetcher,
    );
    if (result.release) return notifyRelease(result.release);
  }

  try {
    const response = await fetcher(GITHUB_RELEASES_URL, {
      headers: {
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return null;
    const release = selectLatestGitHubRelease(await response.json());
    if (!release) return null;
    return compareVersions(release.latestVersion, APP_VERSION) > 0
      ? notifyRelease(release)
      : null;
  } catch {
    return null;
  }
}

export async function openReleasePage(url: string): Promise<void> {
  if (!isGitHubReleaseUrl(url)) throw new Error("更新链接不受支持");
  if (window.qingjiDesktop) {
    await window.qingjiDesktop.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function openUpdateDownload(url: string): Promise<void> {
  if (!isSafeExternalUrl(url)) throw new Error("下载链接不受支持");
  if (window.qingjiDesktop) {
    await window.qingjiDesktop.openUpdateDownload(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function openReleaseAction(
  release: AppReleaseInfo,
): Promise<void> {
  if (release.downloadUrl) {
    await openUpdateDownload(release.downloadUrl);
    return;
  }
  await openReleasePage(release.releaseUrl);
}
