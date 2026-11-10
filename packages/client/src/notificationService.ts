import { Capacitor, type PermissionState } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { ScheduledNotification } from "@qingji/contracts";
import type { Task } from "@qingji/domain";
import {
  buildNotificationPlan,
  type NotificationPreferences,
} from "./notificationPlan";

export type NotificationPermission =
  | "unknown"
  | "granted"
  | "denied"
  | "prompt";

export interface NotificationRuntimeSnapshot {
  supported: boolean;
  permission: NotificationPermission;
  exactAlarm: NotificationPermission;
  scheduledCount: number;
  message: string;
}

export interface NotificationAction {
  kind?: string;
  taskId?: string;
}

const CHANNEL_ID = "qingji-reminders";
const DAILY_SUMMARY_ID_BASE = 1_900_000_000;
const TASK_ID_RANGE = 1_000_000_000;
const listeners = new Set<() => void>();
const actionListeners = new Set<(action: NotificationAction) => void>();

let actionListenerPromise: Promise<void> | null = null;
let scheduleQueue: Promise<void> = Promise.resolve();
let lastInput:
  | {
      tasks: Task[];
      preferences: NotificationPreferences;
    }
  | undefined;

let snapshot: NotificationRuntimeSnapshot = Object.freeze({
  supported:
    Boolean(globalThis.window?.qingjiDesktop) ||
    (typeof Capacitor !== "undefined" &&
      Capacitor.isNativePlatform() &&
      Capacitor.getPlatform() === "android"),
  permission: "unknown",
  exactAlarm: "unknown",
  scheduledCount: 0,
  message: "尚未检查通知权限。",
});

function emit(patch: Partial<NotificationRuntimeSnapshot>): void {
  snapshot = Object.freeze({ ...snapshot, ...patch });
  for (const listener of listeners) listener();
}

function permissionState(value: PermissionState): NotificationPermission {
  if (value === "granted") return "granted";
  if (value === "denied") return "denied";
  return "prompt";
}

function isQingjiNotificationId(id: number): boolean {
  return (
    (id >= 1 && id <= TASK_ID_RANGE) ||
    (id >= DAILY_SUMMARY_ID_BASE &&
      id <= DAILY_SUMMARY_ID_BASE + 30)
  );
}

async function cancelAndroidNotifications(): Promise<void> {
  const pending = await LocalNotifications.getPending();
  const ids = pending.notifications
    .map((notification) => notification.id)
    .filter(isQingjiNotificationId);
  if (ids.length === 0) return;
  await LocalNotifications.cancel({
    notifications: ids.map((id) => ({ id })),
  });
}

function androidNotification(
  notification: ScheduledNotification,
) {
  return {
    id: notification.id,
    title: notification.title,
    body: notification.body,
    channelId: CHANNEL_ID,
    schedule: {
      at: new Date(notification.at),
      allowWhileIdle: true,
    },
    extra: {
      kind: notification.kind,
      taskId: notification.taskId,
    },
  };
}

async function scheduleOnDesktop(
  notifications: ScheduledNotification[],
): Promise<void> {
  const desktop = globalThis.window?.qingjiDesktop;
  if (!desktop) {
    emit({
      supported: false,
      permission: "unknown",
      exactAlarm: "unknown",
      scheduledCount: 0,
      message: "浏览器调试模式不发送系统通知。",
    });
    return;
  }

  await desktop.replaceScheduledNotifications(notifications);
  emit({
    supported: true,
    permission: "granted",
    exactAlarm: "granted",
    scheduledCount: notifications.length,
    message:
      notifications.length > 0
        ? "Windows 将按当前设备设置在后台提醒。"
        : "当前没有需要安排的通知。",
  });
}

async function scheduleOnAndroid(
  notifications: ScheduledNotification[],
  enabled: boolean,
): Promise<void> {
  await cancelAndroidNotifications();
  if (!enabled) {
    emit({
      supported: true,
      exactAlarm: "unknown",
      scheduledCount: 0,
      message: "本机提醒与每日摘要均已关闭。",
    });
    return;
  }

  await LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: "到期提醒与每日摘要",
    description: "清记的到期事项提醒和每日剩余事项摘要",
    importance: 4,
    visibility: 0,
    lights: true,
    lightColor: "#2D5A3D",
  });

  let permission = permissionState(
    (await LocalNotifications.checkPermissions()).display,
  );
  if (permission === "prompt") {
    permission = permissionState(
      (await LocalNotifications.requestPermissions()).display,
    );
  }
  if (permission !== "granted") {
    emit({
      supported: true,
      permission,
      exactAlarm: "unknown",
      scheduledCount: 0,
      message:
        permission === "denied"
          ? "通知权限已被系统拒绝，请到 Android 系统设置中允许清记发送通知。"
          : "需要通知权限后才能安排提醒。",
    });
    return;
  }

  if (notifications.length > 0) {
    await LocalNotifications.schedule({
      notifications: notifications.map(androidNotification),
    });
  }

  let exactAlarmGranted = true;
  try {
    exactAlarmGranted =
      (await LocalNotifications.checkExactNotificationSetting())
        .exact_alarm === "granted";
  } catch {
    exactAlarmGranted = false;
  }

  emit({
    supported: true,
    permission,
    exactAlarm: exactAlarmGranted ? "granted" : "denied",
    scheduledCount: notifications.length,
    message:
      notifications.length === 0
        ? "当前没有需要安排的通知。"
        : exactAlarmGranted
          ? "提醒已交给 Android 系统，可能在省电限制下略有延迟。"
          : "提醒已安排，但 Android 未允许精确闹钟，触发时间可能延后。",
  });
}

async function performSchedule(
  tasks: Task[],
  preferences: NotificationPreferences,
): Promise<void> {
  lastInput = {
    tasks: structuredClone(tasks),
    preferences: { ...preferences },
  };
  const notifications = buildNotificationPlan(tasks, preferences);
  const enabled =
    preferences.dueNotificationsEnabled ||
    preferences.dailySummaryEnabled;

  if (globalThis.window?.qingjiDesktop) {
    await scheduleOnDesktop(notifications);
    return;
  }

  if (
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === "android"
  ) {
    await scheduleOnAndroid(notifications, enabled);
    return;
  }

  emit({
    supported: false,
    permission: "unknown",
    exactAlarm: "unknown",
    scheduledCount: 0,
    message: "浏览器调试模式不发送系统通知。",
  });
}

export function syncDeviceNotifications(
  tasks: Task[],
  preferences: NotificationPreferences,
): Promise<void> {
  scheduleQueue = scheduleQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        await performSchedule(tasks, preferences);
      } catch (error) {
        emit({
          scheduledCount: 0,
          message:
            error instanceof Error
              ? `通知安排失败：${error.message}`
              : "通知安排失败，请稍后重试。",
        });
      }
    });
  return scheduleQueue;
}

export async function requestDeviceNotificationPermission(): Promise<void> {
  if (
    !Capacitor.isNativePlatform() ||
    Capacitor.getPlatform() !== "android"
  ) {
    return;
  }

  try {
    const permission = permissionState(
      (await LocalNotifications.requestPermissions()).display,
    );
    emit({
      permission,
      message:
        permission === "granted"
          ? "通知权限已允许，正在重新安排提醒。"
          : "通知权限未允许，请到 Android 系统设置中调整。",
    });
    if (permission === "granted" && lastInput) {
      await syncDeviceNotifications(
        lastInput.tasks,
        lastInput.preferences,
      );
    }
  } catch (error) {
    emit({
      permission: "denied",
      message:
        error instanceof Error
          ? `无法请求通知权限：${error.message}`
          : "无法请求通知权限。",
    });
  }
}

export async function openExactAlarmSettings(): Promise<void> {
  if (
    !Capacitor.isNativePlatform() ||
    Capacitor.getPlatform() !== "android"
  ) {
    return;
  }
  try {
    const exactAlarm = await LocalNotifications.changeExactNotificationSetting();
    emit({
      exactAlarm:
        exactAlarm.exact_alarm === "granted" ? "granted" : "denied",
      message:
        exactAlarm.exact_alarm === "granted"
          ? "精确提醒已允许，正在重新安排通知。"
          : "精确提醒仍未允许，系统可能延后触发通知。",
    });
    if (exactAlarm.exact_alarm === "granted" && lastInput) {
      await syncDeviceNotifications(
        lastInput.tasks,
        lastInput.preferences,
      );
    }
  } catch (error) {
    emit({
      exactAlarm: "denied",
      message:
        error instanceof Error
          ? `无法打开精确提醒设置：${error.message}`
          : "无法打开精确提醒设置。",
    });
  }
}

async function ensureAndroidActionListener(): Promise<void> {
  if (
    actionListenerPromise ||
    !Capacitor.isNativePlatform() ||
    Capacitor.getPlatform() !== "android"
  ) {
    return actionListenerPromise ?? Promise.resolve();
  }

  actionListenerPromise = LocalNotifications.addListener(
    "localNotificationActionPerformed",
    (event) => {
      const extra =
        event.notification.extra &&
        typeof event.notification.extra === "object"
          ? (event.notification.extra as Record<string, unknown>)
          : {};
      const action: NotificationAction = {
        kind:
          typeof extra.kind === "string" ? extra.kind : undefined,
        taskId:
          typeof extra.taskId === "string" ? extra.taskId : undefined,
      };
      for (const listener of actionListeners) listener(action);
    },
  ).then(() => undefined);
  return actionListenerPromise;
}

export function subscribeNotificationActions(
  listener: (action: NotificationAction) => void,
): () => void {
  actionListeners.add(listener);
  void ensureAndroidActionListener();
  return () => {
    actionListeners.delete(listener);
  };
}

export function getNotificationRuntimeSnapshot(): NotificationRuntimeSnapshot {
  return snapshot;
}

export function subscribeNotificationRuntime(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
