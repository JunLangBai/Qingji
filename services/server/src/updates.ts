import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import type {
  AppReleaseInfo,
  AppUpdateStatus,
  UpdatePlatform,
} from "@qingji/contracts";
import { compareVersions } from "@qingji/domain";
export { compareVersions };

const VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const RELEASE_FEED_URL =
  "https://github.com/JunLangBai/Qingji/releases.atom";
const RELEASE_DISCOVERY_TTL_MS = 10 * 60 * 1_000;
const UPSTREAM_HEADER_TIMEOUT_MS = 15_000;

export type FetchLike = (
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

export function parseUpdatePlatform(
  value: unknown,
): UpdatePlatform | null {
  return value === "windows" || value === "android" ? value : null;
}

export function updateAssetName(
  latestVersion: string,
  platform: UpdatePlatform,
): string {
  const version = latestVersion.replace(/^v/i, "");
  return platform === "android"
    ? `Qingji-${version}-Android-Release.apk`
    : `Qingji-${version}-Windows-Setup-x64.exe`;
}

export function getUpdateAsset(
  release: AppReleaseInfo,
  platform: UpdatePlatform,
): { name: string; url: string } | null {
  try {
    const releaseUrl = new URL(release.releaseUrl);
    const parts = releaseUrl.pathname.split("/").filter(Boolean);
    if (
      parts.length !== 5 ||
      parts[2] !== "releases" ||
      parts[3] !== "tag"
    ) {
      return null;
    }
    const owner = parts[0];
    const repository = parts[1];
    const tag = decodeURIComponent(parts[4] ?? "");
    if (
      !owner ||
      !/^[0-9A-Za-z_.-]+$/.test(owner) ||
      !repository ||
      !/^[0-9A-Za-z_.-]+$/.test(repository) ||
      tag.replace(/^v/i, "") !== release.latestVersion
    ) {
      return null;
    }
    const name = updateAssetName(release.latestVersion, platform);
    return {
      name,
      url:
        `https://github.com/${owner}/${repository}/releases/download/` +
        `${encodeURIComponent(tag)}/${encodeURIComponent(name)}`,
    };
  } catch {
    return null;
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
  platform?: UpdatePlatform,
  allowDownload = true,
): AppUpdateStatus {
  if (!release) {
    return { available: false, currentVersion };
  }
  const available = compareVersions(release.latestVersion, currentVersion) > 0;
  const canDownload = Boolean(
    allowDownload &&
      platform &&
      getUpdateAsset(release, platform),
  );
  return {
    available,
    currentVersion,
    latestVersion: release.latestVersion,
    releaseUrl: release.releaseUrl,
    notes: release.notes,
    downloadUrl:
      available && platform && canDownload
        ? `v1/update/download?platform=${platform}`
        : undefined,
  };
}

async function resolveRelease(
  release: AppReleaseInfo | null,
  releaseDiscovery?: () => Promise<AppReleaseInfo | null>,
): Promise<AppReleaseInfo | null> {
  if (release) return release;
  return releaseDiscovery?.().catch(() => null) ?? null;
}

export async function registerUpdateRoutes(
  app: FastifyInstance,
  release: AppReleaseInfo | null,
  releaseDiscovery?: () => Promise<AppReleaseInfo | null>,
  fetcher: FetchLike = fetch,
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
    const platform = parseUpdatePlatform(request.query.platform);
    if (request.query.platform && !platform) {
      return reply.status(400).send({
        code: "INVALID_PLATFORM",
        message: "更新平台无效",
      });
    }
    const currentRelease = await resolveRelease(release, releaseDiscovery);
    return getUpdateStatus(
      currentVersion.replace(/^v/i, ""),
      currentRelease,
      platform ?? undefined,
      release === null,
    );
  });

  app.get<{
    Querystring: { platform?: string };
  }>("/v1/update/download", async (request, reply) => {
    const platform = parseUpdatePlatform(request.query.platform);
    if (!platform) {
      return reply.status(400).send({
        code: "INVALID_PLATFORM",
        message: "更新平台无效",
      });
    }

    const currentRelease = await resolveRelease(release, releaseDiscovery);
    const asset = currentRelease
      ? getUpdateAsset(currentRelease, platform)
      : null;
    if (!asset) {
      return reply.status(404).send({
        code: "UPDATE_ASSET_NOT_FOUND",
        message: "暂时没有可下载的安装包",
      });
    }

    const controller = new AbortController();
    const headerTimeout = setTimeout(
      () => controller.abort(),
      UPSTREAM_HEADER_TIMEOUT_MS,
    );
    let upstream: Response;
    try {
      upstream = await fetcher(asset.url, {
        headers: {
          Accept: "application/octet-stream",
          "User-Agent": "qingji-update-proxy",
          ...(request.headers.range
            ? { Range: request.headers.range }
            : {}),
        },
        signal: controller.signal,
      });
    } catch (error) {
      request.log.warn({ err: error }, "update download unavailable");
      return reply.status(502).send({
        code: "UPDATE_DOWNLOAD_FAILED",
        message: "更新服务暂时无法获取安装包",
      });
    } finally {
      clearTimeout(headerTimeout);
    }

    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel().catch(() => undefined);
      return reply.status(502).send({
        code: "UPDATE_DOWNLOAD_FAILED",
        message: "更新服务暂时无法获取安装包",
      });
    }

    reply.status(upstream.status === 206 ? 206 : 200);
    reply.header(
      "Content-Type",
      upstream.headers.get("content-type") ?? "application/octet-stream",
    );
    reply.header(
      "Content-Disposition",
      `attachment; filename="${asset.name}"`,
    );
    for (const name of [
      "content-length",
      "content-range",
      "accept-ranges",
      "etag",
    ]) {
      const value = upstream.headers.get(name);
      if (value) reply.header(name, value);
    }
    return reply.send(
      Readable.from(
        upstream.body as unknown as AsyncIterable<Uint8Array>,
      ),
    );
  });
}
