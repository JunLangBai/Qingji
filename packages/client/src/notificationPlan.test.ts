import { describe, expect, it } from "vitest";
import type { Task } from "@qingji/domain";
import {
  buildNotificationPlan,
  isWithinQuietHours,
  moveOutsideQuietHours,
  notificationIdForTask,
  type NotificationPreferences,
} from "./notificationPlan";

const preferences: NotificationPreferences = {
  dueNotificationsEnabled: true,
  defaultLeadMinutes: 15,
  dailySummaryEnabled: false,
  dailySummaryTime: "20:00",
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
};

function localIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "0f99e2f4-b97a-4cc2-bb68-cb41832f7314",
    title: "提交方案",
    createdAt: localIso(2026, 11, 10, 8, 0),
    createdOn: "2026-11-10",
    createdTimezone: "Asia/Shanghai",
    dueAt: localIso(2026, 11, 10, 12, 0),
    status: "active",
    updatedAt: localIso(2026, 11, 10, 8, 0),
    revision: 1,
    lastModifiedBy: "test-device",
    ...overrides,
  };
}

describe("notification planning", () => {
  it("uses the default lead and skips completed or deleted tasks", () => {
    const now = new Date(2026, 10, 10, 9, 0);
    const plan = buildNotificationPlan(
      [
        task(),
        task({ id: "completed", status: "completed" }),
        task({ id: "deleted", deletedAt: localIso(2026, 11, 10, 9, 0) }),
      ],
      preferences,
      now,
    );

    expect(plan).toHaveLength(1);
    expect(plan[0]?.at).toBe(
      localIso(2026, 11, 10, 11, 45),
    );
    expect(plan[0]?.taskId).toBe(task().id);
  });

  it("honors a task-specific lead and a disabled per-task reminder", () => {
    const now = new Date(2026, 10, 10, 9, 0);
    const plan = buildNotificationPlan(
      [
        task({ id: "custom", notificationLeadMinutes: 60 }),
        task({ id: "silent", notificationLeadMinutes: -1 }),
      ],
      preferences,
      now,
    );

    expect(plan).toHaveLength(1);
    expect(plan[0]?.at).toBe(localIso(2026, 11, 10, 11, 0));
  });

  it("detects and moves notifications out of overnight quiet hours", () => {
    const quiet = {
      ...preferences,
      quietHoursEnabled: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
    };
    const duringQuiet = new Date(2026, 10, 11, 6, 45);
    const afterQuiet = new Date(2026, 10, 11, 8, 0);

    expect(isWithinQuietHours(duringQuiet, quiet)).toBe(true);
    expect(isWithinQuietHours(afterQuiet, quiet)).toBe(false);
    expect(
      moveOutsideQuietHours(duringQuiet, quiet).toISOString(),
    ).toBe(localIso(2026, 11, 11, 8, 0));
  });

  it("supports same-day quiet ranges", () => {
    const quiet = {
      ...preferences,
      quietHoursEnabled: true,
      quietHoursStart: "12:00",
      quietHoursEnd: "14:00",
    };

    expect(
      isWithinQuietHours(new Date(2026, 10, 10, 13, 0), quiet),
    ).toBe(true);
    expect(
      moveOutsideQuietHours(
        new Date(2026, 10, 10, 13, 0),
        quiet,
      ).toISOString(),
    ).toBe(localIso(2026, 11, 10, 14, 0));
  });

  it("moves the daily summary to quiet-hours end and counts overdue items", () => {
    const now = new Date(2026, 10, 10, 21, 0);
    const summaryPreferences = {
      ...preferences,
      dueNotificationsEnabled: false,
      dailySummaryEnabled: true,
      dailySummaryTime: "23:00",
      quietHoursEnabled: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
    };
    const plan = buildNotificationPlan(
      [
        task({
          id: "overdue",
          dueAt: localIso(2026, 11, 10, 18, 0),
        }),
      ],
      summaryPreferences,
      now,
    );
    const firstSummary = plan.find(
      (notification) => notification.kind === "daily-summary",
    );

    expect(firstSummary?.at).toBe(localIso(2026, 11, 11, 8, 0));
    expect(firstSummary?.body).toContain("1 项已经逾期");
  });

  it("generates stable unsigned notification IDs", () => {
    const first = notificationIdForTask(task().id);
    expect(first).toBe(notificationIdForTask(task().id));
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(2_147_483_647);
  });
});
