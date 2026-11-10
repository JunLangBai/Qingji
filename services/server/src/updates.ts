import type { FastifyInstance } from "fastify";
import type {
  AppReleaseInfo,
  AppUpdateStatus,
} from "@qingji/contracts";

const VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

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

function versionParts(version: string): number[] {
  return version
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
    return getUpdateStatus(currentVersion.replace(/^v/i, ""), release);
  });
}
