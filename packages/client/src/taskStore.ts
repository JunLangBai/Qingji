import type {
  AuthResponse,
  LocalProfile,
  LocalProfileRecord,
  SessionSecret,
  SyncConflict,
  SyncResponse,
  TaskMutation,
  TaskMutationKind,
} from "@qingji/contracts";
import { getLocalDateKey, type Task } from "@qingji/domain";
import {
  parseBackup,
  serializeBackup,
  validateTask,
} from "./data/backup";
import {
  mutateProfile,
  publishSessionChanged,
  readProfile,
  subscribeProfileEvents,
} from "./data/profileRepository";
import {
  ServerRequestError,
  fetchCurrentUser,
  loginAccount,
  logoutFromServer,
  normalizeServerUrl,
  openSyncSocket,
  pushAndPullSync,
  registerAccount,
} from "./data/serverClient";
import {
  clearStoredSession,
  readSession,
  writeSession,
} from "./data/sessionStore";

const DEVICE_KEY = "qingji.device.v1";
const AUTO_MERGE_OWNER_KEY = "qingji.auto-merge-owner.v1";
const LOCAL_OWNER = "local";
const POLL_INTERVAL_MS = 15_000;
const SYNC_BATCH_SIZE = 100;

export type SyncState =
  | "local"
  | "connecting"
  | "syncing"
  | "synced"
  | "offline"
  | "error";

export interface TaskStoreSnapshot {
  tasks: Task[];
  ready: boolean;
  initializationError?: string;
  ownerMode: "local" | "account";
  accountUsername?: string;
  syncState: SyncState;
  pendingCount: number;
  conflictCount: number;
  lastSyncedAt?: string;
  syncMessage?: string;
}

export interface ConnectAccountResult {
  auth: AuthResponse;
  mergedLocalTasks: number;
  autoMergeAllowed: boolean;
  mergeError?: string;
}

const listeners = new Set<() => void>();
let taskIndex = new Map<string, Task>();
let currentSession: SessionSecret | null = null;
let currentOwnerKey = LOCAL_OWNER;
let currentRecord: LocalProfileRecord | null = null;
let initializePromise: Promise<void> | null = null;
let socketClose: (() => void) | null = null;
let pollTimer: number | undefined;
let syncTimer: number | undefined;
let syncPromise: Promise<void> | null = null;

let snapshot: TaskStoreSnapshot = {
  tasks: [],
  ready: false,
  ownerMode: "local",
  syncState: "local",
  pendingCount: 0,
  conflictCount: 0,
};

function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `task-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function deviceId(): string {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const created = `device-${newId()}`;
  localStorage.setItem(DEVICE_KEY, created);
  return created;
}

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function deviceName(): string {
  if (window.qingjiDesktop) return "Windows 清记";
  const platform =
    (
      navigator as Navigator & {
        userAgentData?: { platform?: string };
      }
    ).userAgentData?.platform ?? navigator.platform;
  return platform ? `清记 ${platform}` : "清记移动端";
}

function platformName(): string {
  if (window.qingjiDesktop) return "windows";
  if (/Android/i.test(navigator.userAgent)) return "android";
  return "web";
}

function emit(patch: Partial<TaskStoreSnapshot> = {}): void {
  const tasks =
    patch.tasks ?? currentRecord?.profile.tasks ?? snapshot.tasks;
  const profile = currentRecord?.profile;
  taskIndex = new Map(tasks.map((task) => [task.id, task]));
  snapshot = Object.freeze({
    ...snapshot,
    ...patch,
    tasks,
    pendingCount: profile?.pendingMutations.length ?? patch.pendingCount ?? 0,
    conflictCount: profile?.conflicts.length ?? patch.conflictCount ?? 0,
  });
  for (const listener of listeners) listener();
}

async function ownerKeyForSession(session: SessionSecret): Promise<string> {
  const value = `${normalizeServerUrl(session.serverUrl)}\n${session.userId}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  const hash = [...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
  return `account:${hash}`;
}

function queueMutation(
  profile: LocalProfile,
  kind: TaskMutationKind,
  task: Task,
  baseRevision: number,
): void {
  profile.pendingMutations.push({
    mutationId: crypto.randomUUID(),
    taskId: task.id,
    kind,
    baseRevision,
    task: structuredClone(task),
    createdAt: new Date().toISOString(),
  });
}

function upsertTask(profile: LocalProfile, task: Task): void {
  const index = profile.tasks.findIndex((item) => item.id === task.id);
  if (index === -1) {
    profile.tasks.push(task);
  } else {
    profile.tasks[index] = task;
  }
}

function accountMode(): boolean {
  return Boolean(currentSession);
}

function updateRecord(record: LocalProfileRecord): void {
  if (record.ownerKey !== currentOwnerKey) return;
  currentRecord = record;
  emit({ ready: true });
}

function stopRealtime(): void {
  socketClose?.();
  socketClose = null;
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

function startRealtime(): void {
  stopRealtime();
  const session = currentSession;
  if (!session) return;

  socketClose = openSyncSocket({
    serverUrl: session.serverUrl,
    token: session.token,
    onSyncAvailable: () => scheduleSync(0),
    onStatus: (status) => {
      if (currentSession?.token !== session.token) return;
      if (status === "connected" && snapshot.syncState !== "syncing") {
        emit({ syncState: snapshot.lastSyncedAt ? "synced" : "connecting" });
      } else if (status === "offline" && snapshot.syncState !== "syncing") {
        emit({ syncState: "offline" });
      }
    },
  });
  pollTimer = window.setInterval(() => {
    void syncNow();
  }, POLL_INTERVAL_MS);
}

async function activateSession(
  session: SessionSecret | null,
  publishChange: boolean,
): Promise<void> {
  stopRealtime();
  currentSession = session;
  currentOwnerKey = session ? await ownerKeyForSession(session) : LOCAL_OWNER;
  currentRecord = await readProfile(currentOwnerKey, deviceId());
  emit({
    ready: true,
    ownerMode: session ? "account" : "local",
    accountUsername: session?.username,
    syncState: session ? "connecting" : "local",
    syncMessage: undefined,
  });

  if (session) {
    startRealtime();
    scheduleSync(0);
  }
  if (publishChange) publishSessionChanged();
}

export async function initializeTaskStore(): Promise<void> {
  if (initializePromise) return initializePromise;
  initializePromise = (async () => {
    emit({ ready: false, initializationError: undefined });
    try {
      let storedSession = await readSession();
      if (
        storedSession &&
        new Date(storedSession.expiresAt).getTime() <= Date.now()
      ) {
        await clearStoredSession();
        storedSession = null;
      }
      await activateSession(storedSession, false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "无法打开本机数据库";
      snapshot = Object.freeze({
        ...snapshot,
        ready: false,
        initializationError: message,
        syncState: "error",
        syncMessage: message,
      });
      for (const listener of listeners) listener();
    }
  })();
  try {
    await initializePromise;
  } finally {
    initializePromise = null;
  }
}

async function reloadCurrentProfile(): Promise<void> {
  if (!snapshot.ready) return;
  const record = await readProfile(currentOwnerKey, deviceId());
  updateRecord(record);
}

function replaceRemoteTask(profile: LocalProfile, task: Task): void {
  const hasPending = profile.pendingMutations.some(
    (mutation) => mutation.taskId === task.id,
  );
  if (!hasPending) upsertTask(profile, task);
}

function applySyncResponse(
  profile: LocalProfile,
  response: SyncResponse,
): { applied: number; conflicts: number; rejected: number } {
  let applied = 0;
  let conflicts = 0;
  let rejected = 0;
  const handledIds = new Set<string>();
  const localTasksBeforeSync = new Map(
    profile.tasks.map((task) => [task.id, task]),
  );
  const mutationMap = new Map(
    profile.pendingMutations.map((mutation) => [
      mutation.mutationId,
      mutation,
    ]),
  );

  for (const result of response.results) {
    handledIds.add(result.mutationId);
    if (result.status === "applied") {
      applied += 1;
      continue;
    }
    if (result.status === "rejected") {
      rejected += 1;
      continue;
    }

    conflicts += 1;
    const taskId =
      result.task?.id ?? mutationMap.get(result.mutationId)?.taskId;
    const localTask = taskId
      ? localTasksBeforeSync.get(taskId)
      : undefined;
    if (localTask && result.task) {
      const serverTask = validateTask(result.task);
      const conflict: SyncConflict = {
        taskId: localTask.id,
        localTask: structuredClone(localTask),
        serverTask: structuredClone(serverTask),
        detectedAt: new Date().toISOString(),
      };
      profile.conflicts = [
        ...profile.conflicts.filter(
          (existing) => existing.taskId !== conflict.taskId,
        ),
        conflict,
      ];
      profile.pendingMutations = profile.pendingMutations.filter(
        (mutation) => mutation.taskId !== conflict.taskId,
      );
      upsertTask(profile, structuredClone(serverTask));
    }
  }

  profile.pendingMutations = profile.pendingMutations.filter(
    (mutation) => !handledIds.has(mutation.mutationId),
  );
  for (const task of response.tasks) {
    replaceRemoteTask(profile, validateTask(task));
  }
  profile.cursor = Math.max(profile.cursor, response.cursor);
  return { applied, conflicts, rejected };
}

async function performSync(): Promise<void> {
  const session = currentSession;
  const ownerKey = currentOwnerKey;
  if (!session || !snapshot.ready) return;

  emit({ syncState: "syncing", syncMessage: undefined });
  try {
    const current = await readProfile(ownerKey, deviceId());
    const mutations = current.profile.pendingMutations.slice(
      0,
      SYNC_BATCH_SIZE,
    );
    const response = await pushAndPullSync(session.serverUrl, session.token, {
      cursor: current.profile.cursor,
      deviceId: deviceId(),
      mutations,
    });
    if (currentSession?.token !== session.token || currentOwnerKey !== ownerKey) {
      return;
    }

    const { record, result } = await mutateProfile(
      ownerKey,
      deviceId(),
      (profile) => applySyncResponse(profile, response),
    );
    updateRecord(record);
    emit({
      syncState: result.conflicts > 0 ? "error" : "synced",
      lastSyncedAt: new Date().toISOString(),
      syncMessage:
        result.conflicts > 0
          ? `发现 ${result.conflicts} 个并发冲突，已保留本地版本`
          : result.rejected > 0
            ? `服务器拒绝了 ${result.rejected} 个无效变更`
            : undefined,
    });
    if (record.profile.pendingMutations.length > 0) {
      scheduleSync(150);
    }
  } catch (error) {
    if (error instanceof ServerRequestError && error.status === 401) {
      await expireSession("登录已失效，请重新连接服务器");
      return;
    }
    emit({
      syncState: "offline",
      syncMessage:
        error instanceof Error ? error.message : "暂时无法连接服务器",
    });
  }
}

export async function syncNow(): Promise<void> {
  if (!currentSession) return;
  if (syncPromise) return syncPromise;
  syncPromise = performSync();
  try {
    await syncPromise;
  } finally {
    syncPromise = null;
  }
}

export function scheduleSync(delayMs = 80): void {
  if (!currentSession) return;
  if (syncTimer !== undefined) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    syncTimer = undefined;
    void syncNow();
  }, delayMs);
}

async function expireSession(message: string): Promise<void> {
  await clearStoredSession();
  await activateSession(null, true);
  emit({ syncState: "error", syncMessage: message });
}

function canAutoMergeIntoOwner(ownerKey: string): boolean {
  const recorded = localStorage.getItem(AUTO_MERGE_OWNER_KEY);
  return !recorded || recorded === ownerKey;
}

export async function connectAccount(input: {
  serverUrl: string;
  username: string;
  password: string;
  createAccount: boolean;
}): Promise<ConnectAccountResult> {
  const serverUrl = normalizeServerUrl(input.serverUrl);
  const username = input.username.trim().normalize("NFKC").toLowerCase();
  const request = {
    username,
    password: input.password,
    deviceId: deviceId(),
    deviceName: deviceName(),
    platform: platformName(),
  };
  const auth = input.createAccount
    ? await registerAccount(serverUrl, request)
    : await loginAccount(serverUrl, request);
  const session: SessionSecret = {
    token: auth.token,
    serverUrl,
    userId: auth.user.id,
    username: auth.user.username,
    expiresAt: auth.expiresAt,
  };
  const ownerKey = await ownerKeyForSession(session);
  const autoMergeAllowed = canAutoMergeIntoOwner(ownerKey);
  await writeSession(session);
  await activateSession(session, true);
  let mergedLocalTasks = 0;
  let mergeError: string | undefined;
  if (autoMergeAllowed) {
    try {
      mergedLocalTasks = await mergeLocalProfileIntoAccount();
      localStorage.setItem(AUTO_MERGE_OWNER_KEY, ownerKey);
      if (mergedLocalTasks > 0) await syncNow();
    } catch (error) {
      mergeError =
        error instanceof Error ? error.message : "本机事项自动合入失败";
      emit({ syncState: "error", syncMessage: mergeError });
    }
  }
  return { auth, mergedLocalTasks, autoMergeAllowed, mergeError };
}

export async function disconnectAccount(): Promise<void> {
  const session = currentSession;
  if (session) {
    try {
      await logoutFromServer(session.serverUrl, session.token);
    } catch {
      // Local sign-out must still work when the server is unavailable.
    }
  }
  await clearStoredSession();
  await activateSession(null, true);
}

export async function validateCurrentSession(): Promise<boolean> {
  if (!currentSession) return false;
  try {
    const user = await fetchCurrentUser(
      currentSession.serverUrl,
      currentSession.token,
    );
    return user.id === currentSession.userId;
  } catch (error) {
    if (error instanceof ServerRequestError && error.status === 401) {
      await expireSession("登录已失效，请重新连接服务器");
    }
    return false;
  }
}

async function mutateActive<T>(
  mutator: (draft: LocalProfile) => T,
): Promise<T> {
  if (!snapshot.ready) await initializeTaskStore();
  const ownerKey = currentOwnerKey;
  const { record, result } = await mutateProfile(
    ownerKey,
    deviceId(),
    mutator,
  );
  updateRecord(record);
  if (accountMode()) scheduleSync();
  return result;
}

export function getTasksSnapshot(): Task[] {
  return snapshot.tasks;
}

export function getTaskSnapshot(id: string): Task | undefined {
  return taskIndex.get(id);
}

export function getTaskStoreSnapshot(): TaskStoreSnapshot {
  return snapshot;
}

export async function createTask(input: {
  title: string;
  dueAt: string;
  note?: string;
  notificationLeadMinutes?: Task["notificationLeadMinutes"];
}): Promise<Task> {
  return mutateActive((profile) => {
    const now = new Date();
    const task: Task = {
      id: newId(),
      title: input.title.trim(),
      note: input.note?.trim() || undefined,
      createdAt: now.toISOString(),
      createdOn: getLocalDateKey(now),
      createdTimezone: localTimeZone(),
      dueAt: new Date(input.dueAt).toISOString(),
      status: "active",
      updatedAt: now.toISOString(),
      revision: 0,
      lastModifiedBy: deviceId(),
      notificationLeadMinutes: input.notificationLeadMinutes ?? null,
    };
    profile.tasks.unshift(task);
    if (accountMode()) queueMutation(profile, "create", task, 0);
    return task;
  });
}

export async function updateTask(
  id: string,
  patch: Partial<Task>,
): Promise<Task | undefined> {
  return mutateActive((profile) => {
    const current = profile.tasks.find((task) => task.id === id);
    if (!current || current.deletedAt || current.status !== "active") {
      return current;
    }
    const updated: Task = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
      revision: current.revision + 1,
      lastModifiedBy: deviceId(),
    };
    upsertTask(profile, updated);
    if (accountMode()) {
      queueMutation(profile, "update", updated, current.revision);
    }
    return updated;
  });
}

export async function completeTask(id: string): Promise<Task | undefined> {
  return mutateActive((profile) => {
    const current = profile.tasks.find((task) => task.id === id);
    if (!current || current.deletedAt) return current;
    if (current.status === "completed") return current;
    const completed: Task = {
      ...current,
      status: "completed",
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revision: current.revision + 1,
      lastModifiedBy: deviceId(),
    };
    upsertTask(profile, completed);
    if (accountMode()) {
      queueMutation(profile, "complete", completed, current.revision);
    }
    return completed;
  });
}

export async function completeTasks(taskIds: string[]): Promise<number> {
  const selected = new Set(taskIds);
  return mutateActive((profile) => {
    let changed = 0;
    for (const current of profile.tasks) {
      if (
        !selected.has(current.id) ||
        current.deletedAt ||
        current.status !== "active"
      ) {
        continue;
      }
      const completed: Task = {
        ...current,
        status: "completed",
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        revision: current.revision + 1,
        lastModifiedBy: deviceId(),
      };
      upsertTask(profile, completed);
      if (accountMode()) {
        queueMutation(profile, "complete", completed, current.revision);
      }
      changed += 1;
    }
    return changed;
  });
}

export async function undoCompleteTask(id: string): Promise<void> {
  await mutateActive((profile) => {
    const current = profile.tasks.find((task) => task.id === id);
    if (!current || current.deletedAt || current.status === "active") return;
    const restored: Task = {
      ...current,
      status: "active",
      completedAt: undefined,
      updatedAt: new Date().toISOString(),
      revision: current.revision + 1,
      lastModifiedBy: deviceId(),
    };
    upsertTask(profile, restored);
    if (accountMode()) {
      queueMutation(profile, "undo-complete", restored, current.revision);
    }
  });
}

export async function undoCompleteTasks(
  taskIds: string[],
): Promise<number> {
  const selected = new Set(taskIds);
  return mutateActive((profile) => {
    let changed = 0;
    for (const current of profile.tasks) {
      if (
        !selected.has(current.id) ||
        current.deletedAt ||
        current.status !== "completed"
      ) {
        continue;
      }
      const restored: Task = {
        ...current,
        status: "active",
        completedAt: undefined,
        updatedAt: new Date().toISOString(),
        revision: current.revision + 1,
        lastModifiedBy: deviceId(),
      };
      upsertTask(profile, restored);
      if (accountMode()) {
        queueMutation(
          profile,
          "undo-complete",
          restored,
          current.revision,
        );
      }
      changed += 1;
    }
    return changed;
  });
}

export async function deleteTask(id: string): Promise<void> {
  await mutateActive((profile) => {
    const current = profile.tasks.find((task) => task.id === id);
    if (!current || current.deletedAt) return;
    const deleted: Task = {
      ...current,
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revision: current.revision + 1,
      lastModifiedBy: deviceId(),
    };
    upsertTask(profile, deleted);
    if (accountMode()) {
      queueMutation(profile, "delete", deleted, current.revision);
    }
  });
}

export async function deleteTasks(taskIds: string[]): Promise<number> {
  const selected = new Set(taskIds);
  return mutateActive((profile) => {
    let changed = 0;
    for (const current of profile.tasks) {
      if (!selected.has(current.id) || current.deletedAt) continue;
      const deleted: Task = {
        ...current,
        deletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        revision: current.revision + 1,
        lastModifiedBy: deviceId(),
      };
      upsertTask(profile, deleted);
      if (accountMode()) {
        queueMutation(profile, "delete", deleted, current.revision);
      }
      changed += 1;
    }
    return changed;
  });
}

export function exportCurrentProfile(): string {
  return serializeBackup(snapshot.tasks);
}

export async function importBackupText(text: string): Promise<{
  imported: number;
  skipped: number;
  copied: number;
}> {
  const backup = parseBackup(text);
  return mutateActive((profile) => {
    let imported = 0;
    let skipped = 0;
    let copied = 0;
    const now = new Date().toISOString();

    for (const importedTask of backup.tasks) {
      const existing = profile.tasks.find(
        (task) => task.id === importedTask.id,
      );
      if (existing) {
        if (JSON.stringify(existing) === JSON.stringify(importedTask)) {
          skipped += 1;
          continue;
        }
        const copy: Task = {
          ...importedTask,
          id: newId(),
          title: `${importedTask.title}（导入副本）`,
          updatedAt: now,
          revision: 0,
          lastModifiedBy: deviceId(),
        };
        profile.tasks.push(copy);
        if (accountMode()) queueMutation(profile, "create", copy, 0);
        copied += 1;
        continue;
      }

      const task: Task = {
        ...importedTask,
        updatedAt: now,
        revision: 0,
        lastModifiedBy: deviceId(),
      };
      profile.tasks.push(task);
      if (accountMode()) queueMutation(profile, "create", task, 0);
      imported += 1;
    }
    return { imported, skipped, copied };
  });
}

export async function mergeLocalProfileIntoAccount(): Promise<number> {
  if (!currentSession) throw new Error("请先连接服务器账号");
  const local = await readProfile(LOCAL_OWNER, deviceId());
  return mutateActive((profile) => {
    let imported = 0;
    const now = new Date().toISOString();
    for (const localTask of local.profile.tasks) {
      if (localTask.deletedAt) continue;
      if (profile.tasks.some((task) => task.id === localTask.id)) continue;
      const task: Task = {
        ...localTask,
        updatedAt: now,
        revision: 0,
        lastModifiedBy: deviceId(),
      };
      profile.tasks.push(task);
      queueMutation(profile, "create", task, 0);
      imported += 1;
    }
    return imported;
  });
}

export async function resolveConflict(
  taskId: string,
  strategy: "keep-local" | "use-server",
): Promise<void> {
  await mutateActive((profile) => {
    const conflict = profile.conflicts.find(
      (candidate) => candidate.taskId === taskId,
    );
    if (!conflict) return;

    if (strategy === "keep-local") {
      if (conflict.serverTask.deletedAt) {
        const copy: Task = {
          ...conflict.localTask,
          id: newId(),
          title: `${conflict.localTask.title}（恢复副本）`,
          updatedAt: new Date().toISOString(),
          revision: 0,
          deletedAt: undefined,
          lastModifiedBy: deviceId(),
        };
        profile.tasks.push(copy);
        if (accountMode()) queueMutation(profile, "create", copy, 0);
      } else {
        const localTask: Task = {
          ...conflict.localTask,
          updatedAt: new Date().toISOString(),
          revision: conflict.serverTask.revision + 1,
          lastModifiedBy: deviceId(),
        };
        upsertTask(profile, localTask);
        if (accountMode()) {
          queueMutation(
            profile,
            localTask.deletedAt ? "delete" : "update",
            localTask,
            conflict.serverTask.revision,
          );
        }
      }
    } else {
      upsertTask(profile, conflict.serverTask);
    }
    profile.conflicts = profile.conflicts.filter(
      (candidate) => candidate.taskId !== taskId,
    );
  });
}

export function getSyncConflicts(): SyncConflict[] {
  return currentRecord?.profile.conflicts ?? [];
}

export function subscribeTasks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

subscribeProfileEvents((event) => {
  if (event.type === "session-changed") {
    void initializeTaskStore();
    return;
  }
  if (event.ownerKey === currentOwnerKey) {
    void reloadCurrentProfile();
  }
});
