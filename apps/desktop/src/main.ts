import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  safeStorage,
  screen,
  shell,
  Tray,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  DESKTOP_CHANNELS,
  type CloseHintResolution,
  type LocalProfile,
  type LocalProfileRecord,
  type MainCloseBehavior,
  type ScheduledNotification,
  type SessionSecret,
  type WriteLocalProfileRequest,
} from "@qingji/contracts";
import { resolveUserDataLocation } from "./dataLocation.js";

function configureUserDataPath(): void {
  const legacyUserData = app.getPath("userData");
  if (!app.isPackaged) {
    app.setPath(
      "userData",
      path.join(legacyUserData, "development"),
    );
    return;
  }

  const resolved = resolveUserDataLocation({
    executablePath: process.execPath,
    legacyUserData,
    localAppData:
      process.env.LOCALAPPDATA?.trim() || app.getPath("appData"),
    username:
      process.env.USERNAME?.trim() ||
      process.env.USER?.trim() ||
      "user",
    userDomain: process.env.USERDOMAIN,
    configuredRoot: process.env.QINGJI_DATA_DIR,
  });
  if (resolved.migratedFrom) {
    console.info(
      `Migrated Qingji user data from ${resolved.migratedFrom} to ${resolved.userDataPath}`,
    );
  }
  app.setPath("userData", resolved.userDataPath);
}

configureUserDataPath();

const TRAY_ICON =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAJ0SURBVFhH7VY9SBxBFD4QgqRKmS6WibeLlhJn2ZSCBEIg5HY90EosLCxCEGwCggEbWwshECIHNpdCSJlGEjtLy4gcXGmZcpxv5+3t25/Zmz3nOj/4OO7u7fvevL+d1iMmxXz8erG9tvwmJb7TX9PBi/Vw1o+DDcWeH4n/6lMa2PfiYGthPXxGjz4ccOjHYlghZqQXiTu/E+wgcHLTFJ/kb3kjv28vVgqk7J4PZIrb880KG3G98DGcI6e2WJEnN+RVDuTpHhxtytMh/dQIA/nj85JEn5Dz8Zh5siKjn3/IAYAgJg8AB0BJvCh8SRJmoGbtTvA3Sd/xJTlRuDospFZzfAkyerH4N7Y50Tj8IQikjrmYNQqBqyCOSKoMPWrmbncRAEZ4/kP4nCTz0OOWiY1LKdikBBnFV5LMQwXwCwZVTic6fYpS/4hrksyA5sg23KG8oGcBBOE2AExFYSL8teWlvBEP4lLu5/57ONVYviNpDfxQMtw7k7fDM9lNv/OxtMTFMfPHqaaNpDV4AxrpMoAo+ELSGu1IdCoNOVkAtR3P7EwBeFGwS9Ia2NUlw8QRq7/DDODAJK2B5VA02r8iL+kLyWUJVNOTdAaVFv0OSMhfPpQFZyUQQ5LMA40xMsIEkJPRHDvKgJq4bySZR1IGWkZ88YycOAqg9v6ItxWMSvXHw25K0CepaiALr94fZFvQsIh4AOY1zYIHVXatLiVP367K7i71AN/jpgzwfmEonr40enVIFlP99bsZi5vPBlhOyfW6yqEt1SEanbwIWlC9kmM79q1qbgOMDua37soGUsZ6ja7hTZHcHXB5xeJKqb5PVXQ6aLXuAVatjcz+BDtXAAAAAElFTkSuQmCC";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let mainCloseBehavior: MainCloseBehavior = "tray";
let closeHintPending = false;
let stickyRestoreHandled = false;
const stickyWindows = new Map<string, BrowserWindow>();
const stickySaveTimers = new Map<string, NodeJS.Timeout>();
const stickyCloseTimers = new Map<string, NodeJS.Timeout>();
const notificationTimers = new Map<number, NodeJS.Timeout>();
let scheduledNotifications = new Map<number, ScheduledNotification>();
let profileDatabase: DatabaseSync | null = null;

interface StickyLayout {
  x?: number;
  y?: number;
  width: number;
  height: number;
  alwaysOnTop: boolean;
  visible: boolean;
}

interface StoredStickyLayout extends Omit<StickyLayout, "visible"> {
  visible?: boolean;
}

interface StickyRestoreRequest {
  enabled: boolean;
  taskIds: string[];
}

interface DesktopUiState {
  closeToTrayHintShown: boolean;
}

const STICKY_MIN_WIDTH = 260;
const STICKY_MIN_HEIGHT = 190;
const STICKY_MAX_WIDTH = 640;
const STICKY_MAX_HEIGHT = 520;
const MAX_SCHEDULED_NOTIFICATIONS = 600;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const stickyLayouts = new Map<string, StickyLayout>();
let desktopUiState: DesktopUiState = {
  closeToTrayHintShown: false,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function profileDatabasePath(): string {
  return path.join(app.getPath("userData"), "qingji.sqlite");
}

function sessionPath(): string {
  return path.join(app.getPath("userData"), "session.bin");
}

function desktopUiStatePath(): string {
  return path.join(app.getPath("userData"), "desktop-ui-state.json");
}

function loadDesktopUiState(): void {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(desktopUiStatePath(), "utf8"),
    ) as Partial<DesktopUiState>;
    desktopUiState = {
      closeToTrayHintShown: parsed.closeToTrayHintShown === true,
    };
  } catch {
    desktopUiState = { closeToTrayHintShown: false };
  }
}

function persistDesktopUiState(): void {
  try {
    fs.mkdirSync(path.dirname(desktopUiStatePath()), { recursive: true });
    fs.writeFileSync(
      desktopUiStatePath(),
      JSON.stringify(desktopUiState, null, 2),
      "utf8",
    );
  } catch (error) {
    console.error("Unable to save desktop UI state", error);
  }
}

function getProfileDatabase(): DatabaseSync {
  if (profileDatabase) return profileDatabase;

  const databasePath = profileDatabasePath();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  profileDatabase = new DatabaseSync(databasePath);
  profileDatabase.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS local_profiles (
      owner_key TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      profile_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return profileDatabase;
}

function normalizeOwnerKey(ownerKey: unknown): string {
  if (
    typeof ownerKey !== "string" ||
    ownerKey.length < 1 ||
    ownerKey.length > 512
  ) {
    throw new Error("INVALID_OWNER_KEY");
  }
  return ownerKey;
}

async function readLocalProfile(
  ownerKey: unknown,
): Promise<LocalProfileRecord | null> {
  const key = normalizeOwnerKey(ownerKey);
  const row = getProfileDatabase()
    .prepare(
      "SELECT version, profile_json FROM local_profiles WHERE owner_key = ?",
    )
    .get(key) as
    | { version: number; profile_json: string }
    | undefined;

  if (!row) return null;
  let profileJson = row.profile_json;
  if (row.profile_json.startsWith("enc:v1:")) {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error(
        `本机安全存储当前不可用，数据仍保留在 ${app.getPath("userData")}。请勿删除该目录。`,
      );
    }
    try {
      profileJson = (
        await safeStorage.decryptStringAsync(
          Buffer.from(row.profile_json.slice("enc:v1:".length), "base64"),
        )
      ).result;
    } catch {
      throw new Error(
        `本机数据解密失败，原数据库仍保留在 ${app.getPath("userData")}。请勿卸载或删除数据目录，并先联系恢复。`,
      );
    }
  }
  return {
    ownerKey: key,
    version: row.version,
    profile: JSON.parse(profileJson) as LocalProfile,
  };
}

async function writeLocalProfile(
  request: WriteLocalProfileRequest,
): Promise<LocalProfileRecord> {
  const ownerKey = normalizeOwnerKey(request?.ownerKey);
  const expectedVersion = Number(request?.expectedVersion);
  if (
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0 ||
    !request?.profile ||
    request.profile.schemaVersion !== 1
  ) {
    throw new Error("INVALID_PROFILE_WRITE");
  }

  const database = getProfileDatabase();
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error(
      "本机安全存储当前不可用，未写入任何数据。请勿删除现有数据目录。",
    );
  }
  const profileJson = `enc:v1:${(
    await safeStorage.encryptStringAsync(JSON.stringify(request.profile))
  )
    .toString("base64")}`;
  const now = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = database
      .prepare(
        "SELECT version FROM local_profiles WHERE owner_key = ?",
      )
      .get(ownerKey) as { version: number } | undefined;

    if ((current?.version ?? 0) !== expectedVersion) {
      throw new Error("PROFILE_VERSION_CONFLICT");
    }

    const nextVersion = expectedVersion + 1;
    if (current) {
      database
        .prepare(
          `UPDATE local_profiles
           SET version = ?, profile_json = ?, updated_at = ?
           WHERE owner_key = ?`,
        )
        .run(nextVersion, profileJson, now, ownerKey);
    } else {
      database
        .prepare(
          `INSERT INTO local_profiles
             (owner_key, version, profile_json, updated_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(ownerKey, nextVersion, profileJson, now);
    }
    database.exec("COMMIT");
    return { ownerKey, version: nextVersion, profile: request.profile };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

async function readSession(): Promise<SessionSecret | null> {
  try {
    const encrypted = fs.readFileSync(sessionPath());
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return null;
    const parsed = JSON.parse(
      (await safeStorage.decryptStringAsync(encrypted)).result,
    ) as Partial<SessionSecret> & { email?: unknown };
    const username =
      typeof parsed.username === "string"
        ? parsed.username
        : typeof parsed.email === "string"
          ? parsed.email
          : null;
    if (
      typeof parsed.token !== "string" ||
      typeof parsed.serverUrl !== "string" ||
      typeof parsed.userId !== "string" ||
      !username ||
      typeof parsed.expiresAt !== "string"
    ) {
      return null;
    }
    return {
      token: parsed.token,
      serverUrl: parsed.serverUrl,
      userId: parsed.userId,
      username,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

async function writeSession(session: SessionSecret): Promise<void> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error("SECURE_STORAGE_UNAVAILABLE");
  }
  if (
    !session ||
    typeof session.token !== "string" ||
    typeof session.serverUrl !== "string" ||
    typeof session.userId !== "string" ||
    typeof session.username !== "string" ||
    typeof session.expiresAt !== "string"
  ) {
    throw new Error("INVALID_SESSION");
  }

  fs.mkdirSync(path.dirname(sessionPath()), { recursive: true });
  fs.writeFileSync(
    sessionPath(),
    await safeStorage.encryptStringAsync(JSON.stringify(session)),
  );
}

function clearSession(): void {
  try {
    fs.rmSync(sessionPath(), { force: true });
  } catch (error) {
    console.error("Unable to clear saved session", error);
  }
}

function stickyLayoutPath(): string {
  return path.join(app.getPath("userData"), "sticky-layouts.json");
}

function loadStickyLayouts(): void {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(stickyLayoutPath(), "utf8"),
    ) as Record<string, StoredStickyLayout>;
    for (const [taskId, layout] of Object.entries(parsed)) {
      stickyLayouts.set(taskId, {
        ...layout,
        visible: layout.visible === true,
      });
    }
  } catch {
    // First run or an unreadable local layout file; defaults are sufficient.
  }
}

function persistStickyLayouts(): void {
  try {
    fs.mkdirSync(path.dirname(stickyLayoutPath()), { recursive: true });
    fs.writeFileSync(
      stickyLayoutPath(),
      JSON.stringify(Object.fromEntries(stickyLayouts), null, 2),
      "utf8",
    );
  } catch (error) {
    console.error("Unable to save sticky layout", error);
  }
}

function savedStickyLayout(
  taskId: string,
  defaultAlwaysOnTop: boolean,
): StickyLayout {
  const saved = stickyLayouts.get(taskId);
  const width = clamp(
    saved?.width ?? 320,
    STICKY_MIN_WIDTH,
    STICKY_MAX_WIDTH,
  );
  const height = clamp(
    saved?.height ?? 240,
    STICKY_MIN_HEIGHT,
    STICKY_MAX_HEIGHT,
  );
  let x = saved?.x;
  let y = saved?.y;

  if (x !== undefined && y !== undefined) {
    const display = screen.getDisplayMatching({ x, y, width, height });
    x = clamp(
      x,
      display.workArea.x,
      display.workArea.x + display.workArea.width - width,
    );
    y = clamp(
      y,
      display.workArea.y,
      display.workArea.y + display.workArea.height - height,
    );
  }

  return {
    x,
    y,
    width,
    height,
    alwaysOnTop: saved?.alwaysOnTop ?? defaultAlwaysOnTop,
    visible: saved?.visible === true,
  };
}

function saveStickyLayoutState(
  taskId: string,
  window: BrowserWindow,
  visible: boolean,
): void {
  if (window.isDestroyed()) return;
  const bounds = window.getBounds();
  stickyLayouts.set(taskId, {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    alwaysOnTop: window.isAlwaysOnTop(),
    visible,
  });
  persistStickyLayouts();
}

function rememberStickyBounds(taskId: string, window: BrowserWindow): void {
  const previous = stickySaveTimers.get(taskId);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    if (window.isDestroyed()) return;
    saveStickyLayoutState(
      taskId,
      window,
      stickyLayouts.get(taskId)?.visible ?? true,
    );
    stickySaveTimers.delete(taskId);
  }, 180);
  stickySaveTimers.set(taskId, timer);
}

function isDevelopment(): boolean {
  return !app.isPackaged;
}

function preloadPath(): string {
  return path.join(__dirname, "preload.js");
}

function clientFile(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "client", "index.html")
    : path.join(__dirname, "../../../packages/client/dist/index.html");
}

function loadRoute(
  window: BrowserWindow,
  query: Record<string, string> = {},
): void {
  if (isDevelopment()) {
    const url = new URL("http://127.0.0.1:5173");
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    void window.loadURL(url.toString());
    return;
  }

  void window.loadFile(clientFile(), { query });
}

function createMainWindow(showOnReady = true): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 780,
    minHeight: 620,
    title: "清记",
    backgroundColor: "#f6f3ec",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  loadRoute(mainWindow);
  if (showOnReady) {
    mainWindow.once("ready-to-show", () => mainWindow?.show());
  }
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    if (mainCloseBehavior === "quit") {
      isQuitting = true;
      app.quit();
      return;
    }
    event.preventDefault();
    if (desktopUiState.closeToTrayHintShown) {
      mainWindow?.hide();
      return;
    }
    if (!mainWindow || mainWindow.isDestroyed() || closeHintPending) {
      return;
    }
    closeHintPending = true;
    mainWindow.webContents.send(DESKTOP_CHANNELS.showCloseHint);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  return mainWindow;
}

function createStickyWindow(
  taskId: string,
  options: { alwaysOnTop?: boolean } = {},
): BrowserWindow {
  const existing = stickyWindows.get(taskId);
  if (existing && !existing.isDestroyed()) {
    const pendingClose = stickyCloseTimers.get(taskId);
    if (pendingClose) {
      clearTimeout(pendingClose);
      stickyCloseTimers.delete(taskId);
    }
    existing.setOpacity(1);
    saveStickyLayoutState(taskId, existing, true);
    existing.show();
    existing.focus();
    refreshTrayMenu();
    return existing;
  }

  const layout = savedStickyLayout(
    taskId,
    options.alwaysOnTop ?? true,
  );
  const sticky = new BrowserWindow({
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    minWidth: STICKY_MIN_WIDTH,
    minHeight: STICKY_MIN_HEIGHT,
    maxWidth: STICKY_MAX_WIDTH,
    maxHeight: STICKY_MAX_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: true,
    alwaysOnTop: layout.alwaysOnTop,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  stickyWindows.set(taskId, sticky);
  refreshTrayMenu();
  saveStickyLayoutState(taskId, sticky, true);
  loadRoute(sticky, { view: "sticky", taskId });
  sticky.once("ready-to-show", () => {
    if (sticky.isDestroyed()) return;
    sticky.show();
    sticky.webContents.send("sticky:animate-in");
  });
  sticky.on("move", () => rememberStickyBounds(taskId, sticky));
  sticky.on("resize", () => rememberStickyBounds(taskId, sticky));
  sticky.on("close", () => {
    const visibleAtClose = isQuitting
      ? (stickyLayouts.get(taskId)?.visible ?? sticky.isVisible())
      : false;
    saveStickyLayoutState(taskId, sticky, visibleAtClose);
  });
  sticky.on("closed", () => {
    const pendingSave = stickySaveTimers.get(taskId);
    if (pendingSave) clearTimeout(pendingSave);
    stickySaveTimers.delete(taskId);
    const pendingClose = stickyCloseTimers.get(taskId);
    if (pendingClose) clearTimeout(pendingClose);
    stickyCloseTimers.delete(taskId);
    stickyWindows.delete(taskId);
    refreshTrayMenu();
  });
  sticky.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  return sticky;
}

function restoreVisibleStickyWindows(
  request: StickyRestoreRequest,
): number {
  if (stickyRestoreHandled) return 0;
  stickyRestoreHandled = true;
  if (!request.enabled) return 0;

  const availableTaskIds = new Set(request.taskIds);
  let restored = 0;
  for (const [taskId, layout] of stickyLayouts) {
    if (!layout.visible || !availableTaskIds.has(taskId)) continue;
    createStickyWindow(taskId, {
      alwaysOnTop: layout.alwaysOnTop,
    });
    restored += 1;
  }
  return restored;
}

function showMainWindow(focusTaskId?: string): void {
  const window = createMainWindow();
  if (focusTaskId) {
    const sendFocus = () => {
      if (!window.isDestroyed()) {
        window.webContents.send(DESKTOP_CHANNELS.focusTask, focusTaskId);
      }
    };
    if (window.webContents.isLoading()) {
      window.webContents.once("did-finish-load", sendFocus);
    } else {
      sendFocus();
    }
  }
  window.show();
  window.focus();
}

function showTodoInMainWindow(): void {
  const window = createMainWindow();
  const sendShowTodo = () => {
    if (!window.isDestroyed()) {
      window.webContents.send(DESKTOP_CHANNELS.showTodo);
    }
  };
  if (window.webContents.isLoading()) {
    window.webContents.once("did-finish-load", sendShowTodo);
  } else {
    sendShowTodo();
  }
  window.show();
  window.focus();
}

function clearScheduledNotifications(): void {
  for (const timer of notificationTimers.values()) {
    clearTimeout(timer);
  }
  notificationTimers.clear();
  scheduledNotifications = new Map();
}

function displayScheduledNotification(
  notification: ScheduledNotification,
): void {
  if (!Notification.isSupported()) return;
  const nativeNotification = new Notification({
    title: notification.title,
    body: notification.body,
  });
  nativeNotification.on("click", () => {
    if (notification.taskId) {
      showMainWindow(notification.taskId);
    } else {
      showTodoInMainWindow();
    }
  });
  nativeNotification.show();
}

function armNotificationTimer(
  notification: ScheduledNotification,
): void {
  const previous = notificationTimers.get(notification.id);
  if (previous) clearTimeout(previous);

  const remaining = new Date(notification.at).getTime() - Date.now();
  if (remaining <= 0) {
    notificationTimers.delete(notification.id);
    return;
  }

  const timer = setTimeout(
    () => {
      if (new Date(notification.at).getTime() - Date.now() > 500) {
        armNotificationTimer(notification);
        return;
      }
      notificationTimers.delete(notification.id);
      scheduledNotifications.delete(notification.id);
      displayScheduledNotification(notification);
    },
    Math.min(remaining, MAX_TIMER_DELAY_MS),
  );
  notificationTimers.set(notification.id, timer);
}

function replaceScheduledNotifications(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new Error("INVALID_NOTIFICATIONS");
  }
  if (value.length > MAX_SCHEDULED_NOTIFICATIONS) {
    throw new Error("TOO_MANY_NOTIFICATIONS");
  }

  const next = new Map<number, ScheduledNotification>();
  const now = Date.now();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Partial<ScheduledNotification>;
    const at = typeof item.at === "string" ? new Date(item.at) : null;
    if (
      typeof item.id !== "number" ||
      !Number.isInteger(item.id) ||
      item.id < 1 ||
      item.id > 2_147_483_647 ||
      (item.kind !== "task-due" && item.kind !== "daily-summary") ||
      typeof item.title !== "string" ||
      item.title.length < 1 ||
      item.title.length > 200 ||
      typeof item.body !== "string" ||
      item.body.length < 1 ||
      item.body.length > 1_000 ||
      !at ||
      !Number.isFinite(at.getTime()) ||
      at.getTime() <= now ||
      (item.taskId !== undefined &&
        (typeof item.taskId !== "string" || item.taskId.length > 200))
    ) {
      continue;
    }
    next.set(item.id, {
      id: item.id,
      kind: item.kind,
      title: item.title,
      body: item.body,
      at: at.toISOString(),
      taskId: item.taskId,
    });
  }

  clearScheduledNotifications();
  for (const notification of next.values()) {
    scheduledNotifications.set(notification.id, notification);
    armNotificationTimer(notification);
  }
}

function autoStartEnabled(): boolean {
  if (process.platform !== "win32" || !app.isPackaged) return false;
  return app.getLoginItemSettings({
    path: process.execPath,
  }).openAtLogin;
}

function setAutoStart(enabled: boolean): boolean {
  if (process.platform !== "win32" || !app.isPackaged) return false;
  app.setLoginItemSettings({
    enabled,
    openAtLogin: enabled,
    path: process.execPath,
    args: ["--background"],
  });
  return autoStartEnabled();
}

function quitApplication(): void {
  isQuitting = true;
  app.quit();
}

function refreshTrayMenu(): void {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "打开清记",
        click: () => showMainWindow(),
      },
      {
        label: `桌面便签（${visibleStickyCount()}）`,
        enabled: false,
      },
      { type: "separator" },
      {
        label: "退出清记",
        click: quitApplication,
      },
    ]),
  );
}

function visibleStickyCount(): number {
  return [...stickyWindows.values()].filter(
    (window) => !window.isDestroyed() && window.isVisible(),
  ).length;
}

function setupTray(): void {
  const icon = nativeImage.createFromDataURL(
    `data:image/png;base64,${TRAY_ICON}`,
  );
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip("清记");
  refreshTrayMenu();
  tray.on("click", () => showMainWindow());
}

ipcMain.handle(
  DESKTOP_CHANNELS.openSticky,
  (
    _event,
    taskId: string,
    options?: { alwaysOnTop?: boolean },
  ) => {
    createStickyWindow(taskId, options);
  },
);

ipcMain.handle(
  DESKTOP_CHANNELS.restoreVisibleSticky,
  (_event, request: Partial<StickyRestoreRequest>) => {
    const taskIds = Array.isArray(request?.taskIds)
      ? request.taskIds.filter(
          (taskId): taskId is string => typeof taskId === "string",
        )
      : [];
    return restoreVisibleStickyWindows({
      enabled: request?.enabled === true,
      taskIds,
    });
  },
);

ipcMain.handle(DESKTOP_CHANNELS.closeSticky, (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed()) return;

  const taskId = [...stickyWindows.entries()].find(
    ([, candidate]) => candidate === window,
  )?.[0];
  if (!taskId) {
    window.hide();
    window.destroy();
    return;
  }

  saveStickyLayoutState(taskId, window, false);

  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.focus();
  }

  const pendingClose = stickyCloseTimers.get(taskId);
  if (pendingClose) clearTimeout(pendingClose);
  stickyCloseTimers.set(
    taskId,
    setTimeout(() => {
      if (window.isDestroyed()) {
        stickyCloseTimers.delete(taskId);
        return;
      }

      window.setOpacity(0);
      window.hide();
      refreshTrayMenu();
      stickyCloseTimers.set(
        taskId,
        setTimeout(() => {
          stickyCloseTimers.delete(taskId);
          if (!window.isDestroyed()) window.close();
        }, 80),
      );
    }, 40),
  );
});

ipcMain.handle(
  DESKTOP_CHANNELS.resizeSticky,
  (event, size: { width: number; height: number }) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    window.setSize(
      clamp(size.width, STICKY_MIN_WIDTH, STICKY_MAX_WIDTH),
      clamp(size.height, STICKY_MIN_HEIGHT, STICKY_MAX_HEIGHT),
    );
  },
);

ipcMain.handle(DESKTOP_CHANNELS.getStickyAlwaysOnTop, (event) => {
  return (
    BrowserWindow.fromWebContents(event.sender)?.isAlwaysOnTop() ?? false
  );
});

ipcMain.handle(
  DESKTOP_CHANNELS.setStickyAlwaysOnTop,
  (event, alwaysOnTop: boolean) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    const taskId = [...stickyWindows.entries()].find(
      ([, candidate]) => candidate === window,
    )?.[0];
    if (!taskId) return;
    window.setAlwaysOnTop(alwaysOnTop === true);
    saveStickyLayoutState(taskId, window, true);
  },
);

ipcMain.handle(DESKTOP_CHANNELS.showMain, (_event, taskId?: string) => {
  showMainWindow(typeof taskId === "string" ? taskId : undefined);
});

ipcMain.handle(
  DESKTOP_CHANNELS.setCloseBehavior,
  (_event, behavior: unknown) => {
    mainCloseBehavior = behavior === "quit" ? "quit" : "tray";
  },
);

ipcMain.handle(
  DESKTOP_CHANNELS.resolveCloseHint,
  (_event, resolution: CloseHintResolution) => {
    if (!closeHintPending) return;
    closeHintPending = false;
    desktopUiState.closeToTrayHintShown =
      resolution?.dontShowAgain === true;
    persistDesktopUiState();
    if (resolution?.action === "quit") {
      quitApplication();
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  },
);

ipcMain.handle(
  DESKTOP_CHANNELS.replaceScheduledNotifications,
  (_event, notifications: unknown) => {
    replaceScheduledNotifications(notifications);
  },
);

ipcMain.handle(DESKTOP_CHANNELS.getAutoStart, () =>
  autoStartEnabled(),
);

ipcMain.handle(
  DESKTOP_CHANNELS.setAutoStart,
  (_event, enabled: unknown) => setAutoStart(enabled === true),
);

ipcMain.handle(DESKTOP_CHANNELS.openExternal, async (_event, value: unknown) => {
  if (typeof value !== "string") throw new Error("INVALID_EXTERNAL_URL");
  const url = new URL(value);
  const isGitHubRelease =
    url.protocol === "https:" &&
    (url.hostname === "github.com" || url.hostname === "www.github.com") &&
    /^\/[^/]+\/[^/]+\/releases(?:\/|$)/.test(url.pathname);
  if (!isGitHubRelease) throw new Error("EXTERNAL_URL_NOT_ALLOWED");
  await shell.openExternal(url.toString());
});

ipcMain.handle(DESKTOP_CHANNELS.readProfile, (_event, ownerKey: unknown) => {
  return readLocalProfile(ownerKey);
});

ipcMain.handle(
  DESKTOP_CHANNELS.writeProfile,
  (_event, request: WriteLocalProfileRequest) => {
    return writeLocalProfile(request);
  },
);

ipcMain.handle(DESKTOP_CHANNELS.readSession, () => readSession());

ipcMain.handle(
  DESKTOP_CHANNELS.writeSession,
  (_event, session: SessionSecret) => {
    return writeSession(session);
  },
);

ipcMain.handle(DESKTOP_CHANNELS.clearSession, () => clearSession());

ipcMain.handle(
  DESKTOP_CHANNELS.saveBackup,
  async (
    event,
    fileName: string,
    contents: string,
  ): Promise<boolean> => {
    if (
      typeof fileName !== "string" ||
      !fileName.toLowerCase().endsWith(".json") ||
      typeof contents !== "string" ||
      contents.length > 25 * 1024 * 1024
    ) {
      throw new Error("INVALID_BACKUP_EXPORT");
    }
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "导出清记备份",
      defaultPath: fileName,
      filters: [{ name: "清记备份", extensions: ["json"] }],
    };
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return false;
    await fs.promises.writeFile(result.filePath, contents, "utf8");
    return true;
  },
);

ipcMain.handle(DESKTOP_CHANNELS.openBackup, async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const options: Electron.OpenDialogOptions = {
    title: "导入清记备份",
    properties: ["openFile"],
    filters: [{ name: "清记备份", extensions: ["json"] }],
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  const filePath = result.filePaths[0];
  if (result.canceled || !filePath) return null;
  const stat = await fs.promises.stat(filePath);
  if (stat.size > 25 * 1024 * 1024) {
    throw new Error("备份文件超过 25 MB，无法导入");
  }
  return {
    name: path.basename(filePath),
    text: await fs.promises.readFile(filePath, "utf8"),
  };
});

const portableExecutableDir = process.env.PORTABLE_EXECUTABLE_DIR;
if (portableExecutableDir) {
  void app.whenReady().then(() => {
    dialog.showErrorBox(
      "请使用固定安装入口",
      [
        "检测到清记便携版正在从临时目录运行。",
        "",
        "便携版可能无法解密正式数据，也会占用正式客户端的单实例锁。",
        "请改用桌面“清记”快捷方式或 apps\\desktop\\release\\win-unpacked\\清记.exe。",
      ].join("\n"),
    );
    app.quit();
  });
} else {
  const hasLock = app.requestSingleInstanceLock();
  if (!hasLock) {
    app.quit();
  } else {
    app.on("second-instance", () => showMainWindow());
    app.on("before-quit", () => {
      isQuitting = true;
      clearScheduledNotifications();
      profileDatabase?.close();
      profileDatabase = null;
    });
    app.on("window-all-closed", () => {
      // Keep the tray process alive so desktop notes remain visible.
    });
    app.on("activate", () => showMainWindow());

    void app.whenReady().then(() => {
      app.setAppUserModelId("com.qingji.app");
      loadStickyLayouts();
      loadDesktopUiState();
      createMainWindow(!process.argv.includes("--background"));
      setupTray();
    });
  }
}
