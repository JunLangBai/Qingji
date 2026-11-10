import type {
  LocalProfile,
  LocalProfileRecord,
} from "@qingji/contracts";
import {
  getLocalDateKey,
  type Task,
} from "@qingji/domain";
import { validateTask } from "./backup";
import {
  ProfileVersionConflictError,
  getProfileStore,
} from "./profileStore";

const LEGACY_TASKS_KEY = "qingji.tasks.v1";
const PROFILE_RETRY_LIMIT = 8;
const PROFILE_CHANNEL_NAME = "qingji-profile-sync";
const profileChannel =
  typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel(PROFILE_CHANNEL_NAME);

type ProfileEvent =
  | { type: "profile-changed"; ownerKey: string }
  | { type: "session-changed" };
const profileListeners = new Set<(event: ProfileEvent) => void>();

export function emptyProfile(now = new Date()): LocalProfile {
  return {
    schemaVersion: 1,
    tasks: [],
    pendingMutations: [],
    cursor: 0,
    conflicts: [],
    updatedAt: now.toISOString(),
  };
}

export function cloneProfile(profile: LocalProfile): LocalProfile {
  return structuredClone(profile);
}

export function publishProfileChanged(ownerKey: string): void {
  profileChannel?.postMessage({
    type: "profile-changed",
    ownerKey,
  } satisfies ProfileEvent);
}

export function publishSessionChanged(): void {
  profileChannel?.postMessage({
    type: "session-changed",
  } satisfies ProfileEvent);
}

export function subscribeProfileEvents(
  listener: (event: ProfileEvent) => void,
): () => void {
  profileListeners.add(listener);
  return () => profileListeners.delete(listener);
}

profileChannel?.addEventListener("message", (event) => {
  const data = event.data as Partial<ProfileEvent> | undefined;
  if (data?.type !== "profile-changed" && data?.type !== "session-changed") {
    return;
  }
  for (const listener of profileListeners) listener(data as ProfileEvent);
});

function parseProfile(value: unknown): LocalProfile {
  if (!value || typeof value !== "object") {
    throw new Error("LOCAL_PROFILE_CORRUPTED");
  }
  const profile = value as Partial<LocalProfile>;
  if (
    profile.schemaVersion !== 1 ||
    !Array.isArray(profile.tasks) ||
    !Array.isArray(profile.pendingMutations) ||
    !Array.isArray(profile.conflicts) ||
    typeof profile.cursor !== "number" ||
    !Number.isSafeInteger(profile.cursor) ||
    profile.cursor < 0 ||
    typeof profile.updatedAt !== "string"
  ) {
    throw new Error("LOCAL_PROFILE_CORRUPTED");
  }
  return {
    schemaVersion: 1,
    tasks: profile.tasks.map(validateTask),
    pendingMutations: profile.pendingMutations,
    cursor: profile.cursor,
    conflicts: profile.conflicts,
    updatedAt: profile.updatedAt,
  };
}

function parseLegacyTasks(): Task[] | null {
  const raw = localStorage.getItem(LEGACY_TASKS_KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.map(validateTask);
  } catch {
    return null;
  }
}

function seedTasks(deviceId: string): Task[] {
  const now = Date.now();
  const create = (
    title: string,
    createdOffsetMs: number,
    dueOffsetMs: number,
  ): Task => {
    const createdAt = new Date(now + createdOffsetMs);
    return {
      id: crypto.randomUUID(),
      title,
      createdAt: createdAt.toISOString(),
      createdOn: getLocalDateKey(createdAt),
      createdTimezone:
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      dueAt: new Date(now + dueOffsetMs).toISOString(),
      status: "active",
      updatedAt: new Date().toISOString(),
      revision: 0,
      lastModifiedBy: deviceId,
    };
  };
  return [
    create("整理明天的汇报材料", -2 * 60 * 60 * 1000, 2 * 60 * 60 * 1000),
    create("回复合作方的确认邮件", -4 * 60 * 60 * 1000, -30 * 60 * 1000),
    create("下班路上取快递", -24 * 60 * 60 * 1000, -18 * 60 * 60 * 1000),
    create("续订常用软件", 0, 26 * 60 * 60 * 1000),
  ];
}

function initialProfile(
  ownerKey: string,
  deviceId: string,
): LocalProfile {
  const profile = emptyProfile();
  if (ownerKey !== "local") return profile;

  const legacy = parseLegacyTasks();
  profile.tasks = legacy ?? seedTasks(deviceId);
  return profile;
}

export async function ensureProfile(
  ownerKey: string,
  deviceId: string,
): Promise<LocalProfileRecord> {
  const store = await getProfileStore();
  for (let attempt = 0; attempt < PROFILE_RETRY_LIMIT; attempt += 1) {
    const current = await store.read(ownerKey);
    if (current) {
      return {
        ...current,
        profile: parseProfile(current.profile),
      };
    }
    try {
      return await store.write({
        ownerKey,
        expectedVersion: 0,
        profile: initialProfile(ownerKey, deviceId),
      });
    } catch (error) {
      if (!(error instanceof ProfileVersionConflictError)) throw error;
    }
  }
  throw new Error("PROFILE_WRITE_BUSY");
}

export async function readProfile(
  ownerKey: string,
  deviceId: string,
): Promise<LocalProfileRecord> {
  const record = await ensureProfile(ownerKey, deviceId);
  return {
    ...record,
    profile: parseProfile(record.profile),
  };
}

export async function mutateProfile<T>(
  ownerKey: string,
  deviceId: string,
  mutator: (draft: LocalProfile) => T,
): Promise<{ record: LocalProfileRecord; result: T }> {
  const store = await getProfileStore();
  for (let attempt = 0; attempt < PROFILE_RETRY_LIMIT; attempt += 1) {
    const current = await ensureProfile(ownerKey, deviceId);
    const draft = cloneProfile(current.profile);
    const result = mutator(draft);
    draft.updatedAt = new Date().toISOString();
    try {
      const record = await store.write({
        ownerKey,
        expectedVersion: current.version,
        profile: draft,
      });
      publishProfileChanged(ownerKey);
      return { record, result };
    } catch (error) {
      if (!(error instanceof ProfileVersionConflictError)) throw error;
    }
  }
  throw new Error("PROFILE_WRITE_BUSY");
}
