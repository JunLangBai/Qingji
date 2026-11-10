import type { FastifyInstance } from "fastify";
import type {
  AppReleaseInfo,
  AppUpdateStatus,
} from "@qingji/contracts";
import { compareVersions } from "@qingji/domain";
export { compareVersions };

const VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const RELEASE_FEED_URL =
  "https://github.com/JunLangBai/Qingji/releases.atom";
const RELEASE_DISCOVERY_TTL_MS = 10 * 60 * 1_000;

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

interface ReleaseCandidate {
  latestVersion: string;
  releaseUrl: string;
  notes?: string;
}

export function isGitHubReleaseUrl(value: string): boolean {
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

export function readConfiguredRelease(
  env: NodeJS.ProcessEnv = process.env,
): AppReleaseInfo | null {
  const latestVersion = env.APP_UPDATE_VERSION?.trim();
  const releaseUrl = env.APP_UPDATE_URL?.trim();
  if (!latestVersion && !releaseUrl) return null;
  if (
    !latestVersion ||
    !VERSION_PATTERN.test(latestVersion) ||
    !releaseUrl ||
    !isGitHubReleaseUrl(releaseUrl)
  ) {
    throw new Error(
      "APP_UPDATE_VERSION and a GitHub Release APP_UPDATE_URL are required together",
    );
  }
  const notes = env.APP_UPDATE_NOTES?.trim();
  return {
    latestVersion: latestVersion.replace(/^v/i, ""),
    releaseUrl,
    notes: notes ? notes.slice(0, 500) : undefined,
  };
}

export function parsePublishedReleaseFeed(xml: string): ReleaseCandidate[] {
  const candidates: ReleaseCandidate[] = [];
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const entry = match[1] ?? "";
    const releaseUrl = entry.match(
      /https:\/\/github\.com\/JunLangBai\/Qingji\/releases\/tag\/[^"<\s]+/i,
    )?.[0];
    if (!releaseUrl) continue;
    const tag = decodeURIComponent(
      releaseUrl.split("/").pop() ?? "",
    ).replace(/^v/i, "");
    if (!VERSION_PATTERN.test(tag)) continue;
    candidates.push({
      latestVersion: tag,
      releaseUrl,
    });
  }
  return candidates;
}

export async function discoverLatestPublishedRelease(
  fetcher: FetchLike = fetch,
): Promise<AppReleaseInfo | null> {
  const feedResponse = await fetcher(RELEASE_FEED_URL, {
    headers: {
      Accept: "application/atom+xml",
      "User-Agent": "qingji-server-release-discovery",
    },
    signal: AbortSignal.timeout(4_000),
  });
  if (!feedResponse.ok) return null;

  const candidates = parsePublishedReleaseFeed(await feedResponse.text());
  candidates.sort((left, right) =>
    compareVersions(right.latestVersion, left.latestVersion),
  );
  const recentCandidates = candidates.slice(0, 5);
  const hasInstallableAsset = await Promise.all(
    recentCandidates.map(async (candidate) => {
      const assetUrl = candidate.releaseUrl.replace(
        "/releases/tag/",
        "/releases/expanded_assets/",
      );
      try {
        const assetResponse = await fetcher(assetUrl, {
          headers: {
            Accept: "text/html",
            "User-Agent": "qingji-server-release-discovery",
          },
          signal: AbortSignal.timeout(3_000),
        });
        if (!assetResponse.ok) return false;
        const assetHtml = await assetResponse.text();
        return /href="[^"]+\.(?:exe|apk)(?:\?[^"]*)?"/i.test(assetHtml);
      } catch {
        return false;
      }
    }),
  );
  const index = hasInstallableAsset.findIndex(Boolean);
  return index === -1 ? null : (recentCandidates[index] ?? null);
}

export function createReleaseDiscovery(
  fetcher: FetchLike = fetch,
  now: () => number = Date.now,
): () => Promise<AppReleaseInfo | null> {
  let cachedRelease: AppReleaseInfo | null | undefined;
  let cacheExpiresAt = 0;
  let pending: Promise<AppReleaseInfo | null> | undefined;

  return async () => {
    if (cachedRelease !== undefined && now() < cacheExpiresAt) {
      return cachedRelease;
    }
    pending ??= discoverLatestPublishedRelease(fetcher)
      .catch(() => null)
      .then((release) => {
        cachedRelease = release;
        cacheExpiresAt = now() + RELEASE_DISCOVERY_TTL_MS;
        return release;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}

export function getUpdateStatus(
  currentVersion: string,
  release: AppReleaseInfo | null,
): AppUpdateStatus {
  if (!release) {
    return { available: false, currentVersion };
  }
  return {
    available: compareVersions(release.latestVersion, currentVersion) > 0,
    currentVersion,
    latestVersion: release.latestVersion,
    releaseUrl: release.releaseUrl,
    notes: release.notes,
  };
}

export async function registerUpdateRoutes(
  app: FastifyInstance,
  release: AppReleaseInfo | null,
  releaseDiscovery?: () => Promise<AppReleaseInfo | null>,
): Promise<void> {
  app.get<{
    Querystring: { currentVersion?: string; platform?: string };
  }>("/v1/update", async (request, reply) => {
    const currentVersion = request.query.currentVersion?.trim();
    if (!currentVersion || !VERSION_PATTERN.test(currentVersion)) {
      return reply.status(400).send({
        code: "INVALID_VERSION",
        message: "当前版本号无效",
      });
    }
    let currentRelease = release;
    if (!currentRelease && releaseDiscovery) {
      currentRelease = await releaseDiscovery().catch(() => null);
    }
    return getUpdateStatus(
      currentVersion.replace(/^v/i, ""),
      currentRelease,
    );
  });
}
