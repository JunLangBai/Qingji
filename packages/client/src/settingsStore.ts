export type ThemeSetting = "system" | "light" | "dark";
export type CompletionMode = "tap" | "hold";
export type MainCloseBehavior = "tray" | "quit";

export interface AppSettings {
  theme: ThemeSetting;
  fontScale: number;
  completionMode: CompletionMode;
  completionCelebration: boolean;
  mainCloseBehavior: MainCloseBehavior;
  stickyCloseOnComplete: boolean;
  stickyAlwaysOnTop: boolean;
  stickyAnimations: boolean;
  restoreStickyOnLaunch: boolean;
  defaultLeadMinutes: number;
  dueNotificationsEnabled: boolean;
  dailySummaryEnabled: boolean;
  dailySummaryTime: string;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  autoStart: boolean;
  syncServerUrl: string;
  syncUsername: string;
}

const SETTINGS_KEY = "qingji.settings.v1";
const listeners = new Set<() => void>();

let settingsSnapshot: AppSettings | undefined;
let lastStoredValue: string | null | undefined;
let notifyScheduled = false;

export const defaultSettings: AppSettings = {
  theme: "system",
  fontScale: 1.08,
  completionMode: "tap",
  completionCelebration: true,
  mainCloseBehavior: "tray",
  stickyCloseOnComplete: true,
  stickyAlwaysOnTop: true,
  stickyAnimations: true,
  restoreStickyOnLaunch: true,
  defaultLeadMinutes: 15,
  dueNotificationsEnabled: true,
  dailySummaryEnabled: true,
  dailySummaryTime: "20:00",
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
  autoStart: false,
  syncServerUrl: "http://127.0.0.1:8787",
  syncUsername: "",
};

function timeSetting(value: unknown, fallback: string): string {
  return typeof value === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? value
    : fallback;
}

function parseSettings(raw: string | null): AppSettings {
  if (!raw) return { ...defaultSettings };
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings> & {
      syncEmail?: unknown;
    };
    return {
      ...defaultSettings,
      ...parsed,
      syncUsername:
        typeof parsed.syncUsername === "string"
          ? parsed.syncUsername
          : typeof parsed.syncEmail === "string"
            ? parsed.syncEmail
            : "",
      fontScale:
        typeof parsed.fontScale === "number" &&
        Number.isFinite(parsed.fontScale)
          ? Math.min(1.4, Math.max(0.9, parsed.fontScale))
          : defaultSettings.fontScale,
      completionMode:
        parsed.completionMode === "hold" ? "hold" : "tap",
      completionCelebration:
        typeof parsed.completionCelebration === "boolean"
          ? parsed.completionCelebration
          : defaultSettings.completionCelebration,
      mainCloseBehavior:
        parsed.mainCloseBehavior === "quit" ? "quit" : "tray",
      defaultLeadMinutes:
        typeof parsed.defaultLeadMinutes === "number" &&
        [0, 5, 15, 30, 60, 1_440].includes(parsed.defaultLeadMinutes)
          ? parsed.defaultLeadMinutes
          : defaultSettings.defaultLeadMinutes,
      dueNotificationsEnabled:
        typeof parsed.dueNotificationsEnabled === "boolean"
          ? parsed.dueNotificationsEnabled
          : defaultSettings.dueNotificationsEnabled,
      dailySummaryEnabled:
        typeof parsed.dailySummaryEnabled === "boolean"
          ? parsed.dailySummaryEnabled
          : defaultSettings.dailySummaryEnabled,
      dailySummaryTime: timeSetting(
        parsed.dailySummaryTime,
        defaultSettings.dailySummaryTime,
      ),
      quietHoursEnabled:
        typeof parsed.quietHoursEnabled === "boolean"
          ? parsed.quietHoursEnabled
          : defaultSettings.quietHoursEnabled,
      quietHoursStart: timeSetting(
        parsed.quietHoursStart,
        defaultSettings.quietHoursStart,
      ),
      quietHoursEnd: timeSetting(
        parsed.quietHoursEnd,
        defaultSettings.quietHoursEnd,
      ),
      autoStart:
        typeof parsed.autoStart === "boolean"
          ? parsed.autoStart
          : defaultSettings.autoStart,
    };
  } catch {
    return { ...defaultSettings };
  }
}

function notifyListeners(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    for (const listener of listeners) listener();
  });
}

function readSettingsFromStorage(): AppSettings {
  const raw = localStorage.getItem(SETTINGS_KEY);
  lastStoredValue = raw;
  return parseSettings(raw);
}

function refreshFromStorage(): void {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (raw === lastStoredValue) return;
  lastStoredValue = raw;
  settingsSnapshot = parseSettings(raw);
  notifyListeners();
}

export function getSettingsSnapshot(): AppSettings {
  settingsSnapshot ??= readSettingsFromStorage();
  return settingsSnapshot;
}

export function loadSettings(): AppSettings {
  return getSettingsSnapshot();
}

export function saveSettings(settings: AppSettings): void {
  const normalized = {
    ...defaultSettings,
    ...settings,
    fontScale: Math.min(1.4, Math.max(0.9, settings.fontScale)),
    dailySummaryTime: timeSetting(
      settings.dailySummaryTime,
      defaultSettings.dailySummaryTime,
    ),
    quietHoursStart: timeSetting(
      settings.quietHoursStart,
      defaultSettings.quietHoursStart,
    ),
    quietHoursEnd: timeSetting(
      settings.quietHoursEnd,
      defaultSettings.quietHoursEnd,
    ),
  };
  const serialized = JSON.stringify(normalized);
  localStorage.setItem(SETTINGS_KEY, serialized);
  lastStoredValue = serialized;
  settingsSnapshot = normalized;
  notifyListeners();
}

export function resetPreferenceSettings(
  current: AppSettings,
): AppSettings {
  return {
    ...defaultSettings,
    syncServerUrl: current.syncServerUrl,
    syncUsername: current.syncUsername,
  };
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === SETTINGS_KEY) refreshFromStorage();
  });
}

export function resolveTheme(theme: ThemeSetting): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return theme;
}

export function applyTheme(theme: ThemeSetting): void {
  document.documentElement.dataset.theme = resolveTheme(theme);
}

export function applyFontScale(scale: number): void {
  const normalized = Number.isFinite(scale)
    ? Math.min(1.4, Math.max(0.9, scale))
    : defaultSettings.fontScale;
  document.documentElement.style.setProperty(
    "--font-scale",
    normalized.toString(),
  );
}
