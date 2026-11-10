import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DATA_LOCATION_VERSION = 1;
const PROFILE_FILES = [
  "qingji.sqlite",
  "qingji.sqlite-wal",
  "qingji.sqlite-shm",
  "session.bin",
  "sticky-layouts.json",
  "desktop-ui-state.json",
  "Local State",
  "Preferences",
];
const PROFILE_DIRECTORIES = [
  "Local Storage",
  "Session Storage",
  "WebStorage",
];

export interface DataLocationOptions {
  executablePath: string;
  legacyUserData: string;
  localAppData: string;
  username: string;
  userDomain?: string;
  configuredRoot?: string;
  defaultDataRoot?: string;
}

export interface ResolvedDataLocation {
  dataRoot: string;
  userDataPath: string;
  locationFilePath: string;
  migratedFrom?: string;
}

interface InspectedDataDirectory {
  directory: string;
  latestActivity: number;
  rowCount: number;
}

interface StoredDataLocation {
  version: 1;
  dataRoot: string;
}

export function createUserDataFolderName(
  username: string,
  userDomain = "",
): string {
  const normalizedUsername = username.trim() || "user";
  const identity = `${userDomain}\\${normalizedUsername}`;
  const identityHash = createHash("sha256")
    .update(identity.toLocaleLowerCase())
    .digest("hex")
    .slice(0, 10);
  const safeUsername =
    normalizedUsername.toLocaleLowerCase()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/[. ]+$/g, "")
      .slice(0, 40) || "user";
  return `${safeUsername}-${identityHash}`;
}

function isProfileDataPresent(directory: string): boolean {
  return fs.existsSync(path.join(directory, "qingji.sqlite"));
}

function inspectDataDirectory(
  directory: string,
): InspectedDataDirectory | null {
  const databasePath = path.join(directory, "qingji.sqlite");
  if (!fs.existsSync(databasePath)) return null;

  let latestActivity = 0;
  let rowCount = 0;
  try {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const summary = database
        .prepare(
          `SELECT COUNT(*) AS row_count, MAX(updated_at) AS latest
           FROM local_profiles`,
        )
        .get() as { row_count?: unknown; latest?: unknown };
      rowCount = Number(summary.row_count) || 0;
      if (typeof summary.latest === "string") {
        latestActivity = Date.parse(summary.latest) || 0;
      }
    } finally {
      database.close();
    }
  } catch {
    // A damaged database can still be copied as a recovery source.
  }
  if (latestActivity === 0) {
    latestActivity = fs.statSync(databasePath).mtimeMs;
  }
  return { directory, latestActivity, rowCount };
}

function legacyDataCandidates(
  options: DataLocationOptions,
  userFolderName: string,
): string[] {
  const candidates = new Set<string>([options.legacyUserData]);
  let directory = path.dirname(options.executablePath);
  for (let depth = 0; depth < 5; depth += 1) {
    candidates.add(path.join(directory, "data", userFolderName));
    candidates.add(
      path.join(directory, "@qingjidesktop", "data", userFolderName),
    );
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  candidates.add(
    path.join(options.localAppData, "@qingji", "desktop"),
  );
  return [...candidates];
}

export function findBestLegacyDataDirectory(
  options: DataLocationOptions,
  userFolderName: string,
  excludedPath: string,
): string | undefined {
  const inspected = legacyDataCandidates(options, userFolderName)
    .filter((candidate) => path.resolve(candidate) !== path.resolve(excludedPath))
    .map(inspectDataDirectory)
    .filter(
      (candidate): candidate is InspectedDataDirectory => candidate !== null,
    )
    .sort(
      (left, right) =>
        right.latestActivity - left.latestActivity ||
        right.rowCount - left.rowCount ||
        right.directory.localeCompare(left.directory),
    );
  return inspected[0]?.directory;
}

function copyDataDirectory(source: string, target: string): void {
  const temporaryTarget = `${target}.migration-${process.pid}-${Date.now()}`;
  fs.rmSync(temporaryTarget, { recursive: true, force: true });
  fs.mkdirSync(temporaryTarget, { recursive: true });
  try {
    for (const name of PROFILE_FILES) {
      const sourcePath = path.join(source, name);
      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, path.join(temporaryTarget, name));
      }
    }
    for (const name of PROFILE_DIRECTORIES) {
      const sourcePath = path.join(source, name);
      if (fs.existsSync(sourcePath)) {
        fs.cpSync(sourcePath, path.join(temporaryTarget, name), {
          recursive: true,
        });
      }
    }
    if (fs.existsSync(target)) {
      if (fs.readdirSync(target).length > 0) {
        throw new Error("DATA_LOCATION_TARGET_NOT_EMPTY");
      }
      fs.rmdirSync(target);
    }
    fs.renameSync(temporaryTarget, target);
  } catch (error) {
    fs.rmSync(temporaryTarget, { recursive: true, force: true });
    throw error;
  }
}

function readStoredDataRoot(locationFilePath: string): string | undefined {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(locationFilePath, "utf8"),
    ) as Partial<StoredDataLocation>;
    if (
      parsed.version === DATA_LOCATION_VERSION &&
      typeof parsed.dataRoot === "string" &&
      path.isAbsolute(parsed.dataRoot)
    ) {
      return parsed.dataRoot;
    }
  } catch {
    // A missing or invalid pointer falls back to normal discovery.
  }
  return undefined;
}

function writeStoredDataRoot(
  locationFilePath: string,
  dataRoot: string,
): void {
  fs.mkdirSync(path.dirname(locationFilePath), { recursive: true });
  const stored: StoredDataLocation = {
    version: DATA_LOCATION_VERSION,
    dataRoot,
  };
  fs.writeFileSync(
    locationFilePath,
    JSON.stringify(stored, null, 2),
    "utf8",
  );
}

function trySelectRoot(
  dataRoot: string,
  userFolderName: string,
): string | undefined {
  const userDataPath = path.join(dataRoot, userFolderName);
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    return userDataPath;
  } catch {
    return undefined;
  }
}

export function resolveUserDataLocation(
  options: DataLocationOptions,
): ResolvedDataLocation {
  const userFolderName = createUserDataFolderName(
    options.username,
    options.userDomain,
  );
  const locationFilePath = path.join(
    options.localAppData,
    "Qingji",
    "data-location.json",
  );
  const configuredRoot = options.configuredRoot?.trim()
    ? path.resolve(options.configuredRoot.trim())
    : undefined;
  const storedRoot = readStoredDataRoot(locationFilePath);
  const installDriveRoot = path.parse(options.executablePath).root;
  const preferredRoot =
    options.defaultDataRoot ??
    path.join(installDriveRoot, "QingjiData");
  const fallbackRoot = path.join(options.localAppData, "QingjiData");
  const roots = [
    configuredRoot,
    storedRoot,
    preferredRoot,
    fallbackRoot,
  ].filter(
    (candidate, index, all): candidate is string =>
      Boolean(candidate) && all.indexOf(candidate) === index,
  );

  let dataRoot: string | undefined;
  let userDataPath: string | undefined;
  for (const candidate of roots) {
    userDataPath = trySelectRoot(candidate, userFolderName);
    if (userDataPath) {
      dataRoot = candidate;
      break;
    }
  }
  if (!dataRoot || !userDataPath) {
    throw new Error("DATA_LOCATION_UNAVAILABLE");
  }

  let migratedFrom: string | undefined;
  if (!isProfileDataPresent(userDataPath)) {
    const source = findBestLegacyDataDirectory(
      options,
      userFolderName,
      userDataPath,
    );
    if (source) {
      copyDataDirectory(source, userDataPath);
      migratedFrom = source;
    }
  }

  try {
    writeStoredDataRoot(locationFilePath, dataRoot);
  } catch (error) {
    console.error("Unable to persist the Qingji data location", error);
  }

  return {
    dataRoot,
    userDataPath,
    locationFilePath,
    migratedFrom,
  };
}
