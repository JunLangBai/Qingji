import { getLocalDateKey, type Task } from "@qingji/domain";

export const WELCOME_TASK_TITLE =
  "欢迎使用清记，点“标记完成”试试看";

const LEGACY_DEMO_TITLES = [
  "整理明天的汇报材料",
  "回复合作方的确认邮件",
  "下班路上取快递",
  "续订常用软件",
] as const;

const LEGACY_DEMO_TITLE_SET = new Set<string>(LEGACY_DEMO_TITLES);

export function createWelcomeTask(
  deviceId: string,
  now = new Date(),
): Task {
  const dueAt = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
  return {
    id: crypto.randomUUID(),
    title: WELCOME_TASK_TITLE,
    createdAt: now.toISOString(),
    createdOn: getLocalDateKey(now),
    createdTimezone:
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    dueAt: dueAt.toISOString(),
    status: "active",
    updatedAt: now.toISOString(),
    revision: 0,
    lastModifiedBy: deviceId,
    notificationLeadMinutes: null,
  };
}

export function replaceLegacyDemoTasks(
  tasks: Task[],
  deviceId: string,
  now = new Date(),
): { tasks: Task[]; changed: boolean } {
  const presentTitles = new Set(
    tasks
      .map((task) => task.title.trim())
      .filter((title) => LEGACY_DEMO_TITLE_SET.has(title)),
  );
  if (presentTitles.size !== LEGACY_DEMO_TITLES.length) {
    return { tasks, changed: false };
  }

  const remaining = tasks.filter(
    (task) => !LEGACY_DEMO_TITLE_SET.has(task.title.trim()),
  );
  return {
    tasks:
      remaining.length > 0
        ? remaining
        : [createWelcomeTask(deviceId, now)],
    changed: true,
  };
}
