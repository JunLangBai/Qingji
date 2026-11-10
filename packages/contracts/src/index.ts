import type { Task } from "@qingji/domain" with { "resolution-mode": "import" };

export const DESKTOP_CHANNELS = {
  openSticky: "sticky:open",
  animateStickyIn: "sticky:animate-in",
  restoreVisibleSticky: "sticky:restore-visible",
  closeSticky: "sticky:close",
  resizeSticky: "sticky:resize",
  getStickyAlwaysOnTop: "sticky:get-always-on-top",
  setStickyAlwaysOnTop: "sticky:set-always-on-top",
  showMain: "main:show",
  focusTask: "main:focus-task",
  setCloseBehavior: "main:set-close-behavior",
  showCloseHint: "main:show-close-hint",
  resolveCloseHint: "main:resolve-close-hint",
  showTodo: "main:show-todo",
  replaceScheduledNotifications: "notifications:replace",
  getAutoStart: "app:get-auto-start",
  setAutoStart: "app:set-auto-start",
  openExternal: "app:open-external",
  readProfile: "data:read-profile",
  writeProfile: "data:write-profile",
  readSession: "auth:read-session",
  writeSession: "auth:write-session",
  clearSession: "auth:clear-session",
  saveBackup: "backup:save",
  openBackup: "backup:open",
} as const;

export interface StickyOpenOptions {
  alwaysOnTop?: boolean;
}

export interface StickyRestoreOptions {
  enabled: boolean;
  taskIds: string[];
}

export type MainCloseBehavior = "tray" | "quit";

export interface CloseHintResolution {
  action: "tray" | "quit";
  dontShowAgain: boolean;
}

export type ScheduledNotificationKind = "task-due" | "daily-summary";

export interface ScheduledNotification {
  id: number;
  kind: ScheduledNotificationKind;
  title: string;
  body: string;
  at: string;
  taskId?: string;
}

export type TaskMutationKind =
  | "create"
  | "update"
  | "complete"
  | "undo-complete"
  | "delete";

export interface TaskMutation {
  mutationId: string;
  taskId: string;
  kind: TaskMutationKind;
  baseRevision: number;
  task: Task;
  createdAt: string;
}

export interface SyncConflict {
  taskId: string;
  localTask: Task;
  serverTask: Task;
  detectedAt: string;
}

export interface LocalProfile {
  schemaVersion: 1;
  tasks: Task[];
  pendingMutations: TaskMutation[];
  cursor: number;
  conflicts: SyncConflict[];
  updatedAt: string;
}

export interface LocalProfileRecord {
  ownerKey: string;
  version: number;
  profile: LocalProfile;
}

export interface WriteLocalProfileRequest {
  ownerKey: string;
  expectedVersion: number;
  profile: LocalProfile;
}

export interface SessionSecret {
  token: string;
  serverUrl: string;
  userId: string;
  username: string;
  expiresAt: string;
}

export interface AuthUser {
  id: string;
  username: string;
}

export interface AuthRequest {
  username: string;
  password: string;
  deviceId: string;
  deviceName: string;
  platform: string;
}

export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: AuthUser;
  deviceId: string;
}

export interface SyncRequest {
  cursor: number;
  deviceId: string;
  mutations: TaskMutation[];
}

export type SyncMutationStatus = "applied" | "conflict" | "rejected";

export interface SyncMutationResult {
  mutationId: string;
  status: SyncMutationStatus;
  task?: Task;
  message?: string;
}

export interface SyncResponse {
  cursor: number;
  tasks: Task[];
  results: SyncMutationResult[];
  serverTime: string;
}

export interface AppReleaseInfo {
  latestVersion: string;
  releaseUrl: string;
  notes?: string;
}

export interface AppUpdateStatus {
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  notes?: string;
}

export interface BackupEnvelope {
  format: "qingji-backup";
  version: 1;
  exportedAt: string;
  tasks: Task[];
}

export interface QingjiDesktopApi {
  openSticky(taskId: string, options?: StickyOpenOptions): Promise<void>;
  waitForStickyEnter(): Promise<void>;
  restoreStickyWindows(options: StickyRestoreOptions): Promise<number>;
  closeSticky(): Promise<void>;
  resizeSticky(width: number, height: number): Promise<void>;
  getStickyAlwaysOnTop(): Promise<boolean>;
  setStickyAlwaysOnTop(alwaysOnTop: boolean): Promise<void>;
  showMain(taskId?: string): Promise<void>;
  setCloseBehavior(behavior: MainCloseBehavior): Promise<void>;
  onCloseHintRequested(listener: () => void): () => void;
  resolveCloseHint(resolution: CloseHintResolution): Promise<void>;
  onShowTodo(listener: () => void): () => void;
  replaceScheduledNotifications(
    notifications: ScheduledNotification[],
  ): Promise<void>;
  getAutoStart(): Promise<boolean>;
  setAutoStart(enabled: boolean): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  onFocusTask(listener: (taskId: string) => void): () => void;
  readProfile(ownerKey: string): Promise<LocalProfileRecord | null>;
  writeProfile(
    request: WriteLocalProfileRequest,
  ): Promise<LocalProfileRecord>;
  readSession(): Promise<SessionSecret | null>;
  writeSession(session: SessionSecret): Promise<void>;
  clearSession(): Promise<void>;
  saveBackup(fileName: string, contents: string): Promise<boolean>;
  openBackup(): Promise<{ name: string; text: string } | null>;
  isDesktop: true;
}
