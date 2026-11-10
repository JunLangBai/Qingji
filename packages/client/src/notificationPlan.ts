import type { ScheduledNotification } from "@qingji/contracts";
import { summarizeActiveTasks, type Task } from "@qingji/domain";
import { formatDue } from "./formatters";

export interface NotificationPreferences {
  dueNotificationsEnabled: boolean;
  defaultLeadMinutes: number;
  dailySummaryEnabled: boolean;
  dailySummaryTime: string;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}

const MAX_TASK_REMINDERS = 450;
const DAILY_SUMMARY_DAYS = 31;
const DAILY_SUMMARY_ID_BASE = 1_900_000_000;
const TASK_ID_RANGE = 1_000_000_000;

function parseClock(value: string): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return { hour: 0, minute: 0 };
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

function minuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function atLocalTime(
  date: Date,
  time: string,
  dayOffset = 0,
): Date {
  const { hour, minute } = parseClock(time);
  const result = new Date(date);
  result.setDate(result.getDate() + dayOffset);
  result.setHours(hour, minute, 0, 0);
  return result;
}

export function isWithinQuietHours(
  date: Date,
  preferences: Pick<
    NotificationPreferences,
    "quietHoursEnabled" | "quietHoursStart" | "quietHoursEnd"
  >,
): boolean {
  if (!preferences.quietHoursEnabled) return false;
  const start = parseClock(preferences.quietHoursStart);
  const end = parseClock(preferences.quietHoursEnd);
  const startMinute = start.hour * 60 + start.minute;
  const endMinute = end.hour * 60 + end.minute;
  if (startMinute === endMinute) return false;

  const current = minuteOfDay(date);
  return startMinute < endMinute
    ? current >= startMinute && current < endMinute
    : current >= startMinute || current < endMinute;
}

export function moveOutsideQuietHours(
  date: Date,
  preferences: Pick<
    NotificationPreferences,
    "quietHoursEnabled" | "quietHoursStart" | "quietHoursEnd"
  >,
): Date {
  if (!isWithinQuietHours(date, preferences)) return new Date(date);

  const start = parseClock(preferences.quietHoursStart);
  const end = parseClock(preferences.quietHoursEnd);
  const startMinute = start.hour * 60 + start.minute;
  const endMinute = end.hour * 60 + end.minute;
  const current = minuteOfDay(date);
  const crossesMidnight = startMinute > endMinute;
  const endsTomorrow = crossesMidnight && current >= startMinute;
  return atLocalTime(date, preferences.quietHoursEnd, endsTomorrow ? 1 : 0);
}

/**
 * Stable, positive 31-bit notification ID. Task IDs stay below the reserved
 * range used by daily summary notifications.
 */
export function notificationIdForTask(taskId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < taskId.length; index += 1) {
    hash ^= taskId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % TASK_ID_RANGE + 1;
}

function taskReminder(
  task: Task,
  preferences: NotificationPreferences,
  now: Date,
): ScheduledNotification | null {
  const leadMinutes =
    task.notificationLeadMinutes === undefined ||
    task.notificationLeadMinutes === null
      ? preferences.defaultLeadMinutes
      : task.notificationLeadMinutes;
  if (leadMinutes === -1) return null;

  const dueAt = new Date(task.dueAt);
  const originalAt = new Date(
    dueAt.getTime() - leadMinutes * 60_000,
  );
  if (!Number.isFinite(originalAt.getTime())) return null;

  const scheduledAt = moveOutsideQuietHours(originalAt, preferences);
  if (scheduledAt.getTime() <= now.getTime()) return null;

  return {
    id: notificationIdForTask(task.id),
    kind: "task-due",
    title:
      leadMinutes === 0
        ? "清记 · 事项到期"
        : "清记 · 即将到期",
    body: `${task.title} · 截止 ${formatDue(task.dueAt)}`,
    at: scheduledAt.toISOString(),
    taskId: task.id,
  };
}

function dailySummaryNotification(
  taskList: Task[],
  preferences: NotificationPreferences,
  now: Date,
  dayOffset: number,
): ScheduledNotification | null {
  const target = atLocalTime(
    now,
    preferences.dailySummaryTime,
    dayOffset,
  );
  const scheduledAt = moveOutsideQuietHours(target, preferences);
  if (scheduledAt.getTime() <= now.getTime()) return null;

  const summary = summarizeActiveTasks(taskList, scheduledAt);
  const body =
    summary.todayRemaining > 0
      ? `今天还有 ${summary.todayRemaining} 项到期，另有 ${summary.overdue} 项已经逾期。`
      : summary.overdue > 0
        ? `今天没有剩余事项，另有 ${summary.overdue} 项已经逾期。`
        : "今天和逾期的待办都已经清空。";

  return {
    id: DAILY_SUMMARY_ID_BASE + dayOffset,
    kind: "daily-summary",
    title: "清记 · 今日摘要",
    body,
    at: scheduledAt.toISOString(),
  };
}

export function buildNotificationPlan(
  tasks: Task[],
  preferences: NotificationPreferences,
  now = new Date(),
): ScheduledNotification[] {
  const notifications: ScheduledNotification[] = [];

  if (preferences.dueNotificationsEnabled) {
    const reminders = tasks
      .filter((task) => task.status === "active" && !task.deletedAt)
      .map((task) => taskReminder(task, preferences, now))
      .filter(
        (notification): notification is ScheduledNotification =>
          notification !== null,
      )
      .sort(
        (left, right) =>
          new Date(left.at).getTime() - new Date(right.at).getTime(),
      )
      .slice(0, MAX_TASK_REMINDERS);
    notifications.push(...reminders);
  }

  if (preferences.dailySummaryEnabled) {
    for (
      let dayOffset = 0;
      dayOffset < DAILY_SUMMARY_DAYS;
      dayOffset += 1
    ) {
      const summary = dailySummaryNotification(
        tasks,
        preferences,
        now,
        dayOffset,
      );
      if (summary) notifications.push(summary);
    }
  }

  return notifications.sort(
    (left, right) =>
      new Date(left.at).getTime() - new Date(right.at).getTime(),
  );
}

