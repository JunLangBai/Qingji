import type {
  LocalProfileRecord,
  WriteLocalProfileRequest,
} from "@qingji/contracts";

export class ProfileVersionConflictError extends Error {
  constructor() {
    super("PROFILE_VERSION_CONFLICT");
    this.name = "ProfileVersionConflictError";
  }
}

export interface ProfileStore {
  read(ownerKey: string): Promise<LocalProfileRecord | null>;
  write(request: WriteLocalProfileRequest): Promise<LocalProfileRecord>;
}

const PROFILE_KEY_PREFIX = "qingji.profile.v1.";
const NATIVE_DATABASE = "qingji";

function profileStorageKey(ownerKey: string): string {
  return `${PROFILE_KEY_PREFIX}${encodeURIComponent(ownerKey)}`;
}

class BrowserProfileStore implements ProfileStore {
  private readonly lockName = "qingji-profile-write";

  async read(ownerKey: string): Promise<LocalProfileRecord | null> {
    const raw = localStorage.getItem(profileStorageKey(ownerKey));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as LocalProfileRecord;
    } catch {
      throw new Error("LOCAL_PROFILE_CORRUPTED");
    }
  }

  async write(
    request: WriteLocalProfileRequest,
  ): Promise<LocalProfileRecord> {
    const operation = async () => {
      const current = await this.read(request.ownerKey);
      if ((current?.version ?? 0) !== request.expectedVersion) {
        throw new ProfileVersionConflictError();
      }
      const record: LocalProfileRecord = {
        ownerKey: request.ownerKey,
        version: request.expectedVersion + 1,
        profile: request.profile,
      };
      localStorage.setItem(
        profileStorageKey(request.ownerKey),
        JSON.stringify(record),
      );
      return record;
    };

    const locks = globalThis.navigator?.locks;
    return locks
      ? locks.request(this.lockName, operation)
      : operation();
  }
}

class DesktopProfileStore implements ProfileStore {
  async read(ownerKey: string): Promise<LocalProfileRecord | null> {
    return window.qingjiDesktop?.readProfile(ownerKey) ?? null;
  }

  async write(
    request: WriteLocalProfileRequest,
  ): Promise<LocalProfileRecord> {
    if (!window.qingjiDesktop) throw new Error("DESKTOP_BRIDGE_UNAVAILABLE");
    try {
      return await window.qingjiDesktop.writeProfile(request);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("PROFILE_VERSION_CONFLICT")
      ) {
        throw new ProfileVersionConflictError();
      }
      throw error;
    }
  }
}

interface SqliteRow {
  version?: unknown;
  profile_json?: unknown;
}

class CapacitorProfileStore implements ProfileStore {
  private databasePromise:
    | Promise<import("@capacitor-community/sqlite").SQLiteDBConnection>
    | undefined;

  private database() {
    this.databasePromise ??= this.openDatabase();
    return this.databasePromise;
  }

  private async openDatabase() {
    const [{ CapacitorSQLite, SQLiteConnection }] = await Promise.all([
      import("@capacitor-community/sqlite"),
    ]);
    const connection = new SQLiteConnection(CapacitorSQLite);
    const consistency = await connection.checkConnectionsConsistency();
    const exists = await connection.isConnection(NATIVE_DATABASE, false);
    const secretStored = await connection.isSecretStored();
    if (!secretStored.result) {
      await connection.setEncryptionSecret(
        `${crypto.randomUUID()}${crypto.randomUUID()}`,
      );
    }
    const database =
      consistency.result && exists.result
        ? await connection.retrieveConnection(NATIVE_DATABASE, false)
        : await connection.createConnection(
            NATIVE_DATABASE,
            true,
            "secret",
            1,
            false,
          );
    if (!(await database.isDBOpen()).result) {
      await database.open();
    }
    await database.query("PRAGMA journal_mode = WAL;");
    await database.query("PRAGMA synchronous = NORMAL;");
    await database.execute(`
      CREATE TABLE IF NOT EXISTS local_profiles (
        owner_key TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        profile_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    return database;
  }

  async read(ownerKey: string): Promise<LocalProfileRecord | null> {
    const database = await this.database();
    const result = await database.query(
      "SELECT version, profile_json FROM local_profiles WHERE owner_key = ?",
      [ownerKey],
    );
    const row = result.values?.[0] as SqliteRow | undefined;
    if (!row) return null;
    if (typeof row.version !== "number" || typeof row.profile_json !== "string") {
      throw new Error("LOCAL_PROFILE_CORRUPTED");
    }
    return {
      ownerKey,
      version: row.version,
      profile: JSON.parse(row.profile_json),
    };
  }

  async write(
    request: WriteLocalProfileRequest,
  ): Promise<LocalProfileRecord> {
    const database = await this.database();
    await database.beginTransaction();
    try {
      const current = await this.read(request.ownerKey);
      if ((current?.version ?? 0) !== request.expectedVersion) {
        throw new ProfileVersionConflictError();
      }
      const nextVersion = request.expectedVersion + 1;
      const now = new Date().toISOString();
      if (current) {
        await database.run(
          `UPDATE local_profiles
           SET version = ?, profile_json = ?, updated_at = ?
           WHERE owner_key = ?`,
          [
            nextVersion,
            JSON.stringify(request.profile),
            now,
            request.ownerKey,
          ],
          false,
        );
      } else {
        await database.run(
          `INSERT INTO local_profiles
             (owner_key, version, profile_json, updated_at)
           VALUES (?, ?, ?, ?)`,
          [
            request.ownerKey,
            nextVersion,
            JSON.stringify(request.profile),
            now,
          ],
          false,
        );
      }
      await database.commitTransaction();
      return {
        ownerKey: request.ownerKey,
        version: nextVersion,
        profile: request.profile,
      };
    } catch (error) {
      await database.rollbackTransaction();
      throw error;
    }
  }
}

let selectedStore: ProfileStore | undefined;
let resolvedStoreKind: "desktop" | "native" | "browser" | undefined;

async function isNativePlatform(): Promise<boolean> {
  const { Capacitor } = await import("@capacitor/core");
  return Capacitor.isNativePlatform();
}

export async function getProfileStore(): Promise<ProfileStore> {
  if (selectedStore) return selectedStore;

  if (window.qingjiDesktop) {
    selectedStore = new DesktopProfileStore();
    resolvedStoreKind = "desktop";
  } else if (await isNativePlatform()) {
    selectedStore = new CapacitorProfileStore();
    resolvedStoreKind = "native";
  } else {
    selectedStore = new BrowserProfileStore();
    resolvedStoreKind = "browser";
  }
  return selectedStore;
}

export function getProfileStoreKind(): "desktop" | "native" | "browser" {
  return resolvedStoreKind ?? "browser";
}
