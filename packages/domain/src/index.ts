export type TaskStatus = "active" | "completed";

export const TASK_NOTIFICATION_LEAD_MINUTES = [
  0,
  5,
  15,
  30,
  60,
  1_440,
] as const;

export type TaskNotificationLeadMinutes =
  (typeof TASK_NOTIFICATION_LEAD_MINUTES)[number];

export type TaskNotificationSetting =
  | TaskNotificationLeadMinutes
  | -1
  | null;

export interface Task {
  id: string;
  title: string;
  note?: string;
  createdAt: string;
  createdOn: string;
  createdTimezone: string;
  dueAt: string;
  completedAt?: string;
  status: TaskStatus;
  updatedAt: string;
  revision: number;
  deletedAt?: string;
  lastModifiedBy: string;
  /**
   * `null` follows the current device default, `-1` disables the reminder,
   * and a supported number schedules a task-specific reminder. `undefined`
   * exists only for backward compatibility with legacy snapshots.
   */
  notificationLeadMinutes?: TaskNotificationSetting;
}

export type DueState =
  | "completed"
  | "overdue"
  | "due-today"
  | "upcoming";

export interface TaskSummary {
  todayRemaining: number;
  overdue: number;
  activeTotal: number;
}

export interface TaskGroup {
  createdOn: string;
  tasks: Task[];
}

function dateParts(date: Date, timeZone?: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    year: values.year ?? "0000",
    month: values.month ?? "00",
    day: values.day ?? "00",
  };
}

export function getDateKey(date: Date, timeZone?: string): string {
  const parts = dateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getLocalDateKey(date: Date): string {
  return getDateKey(date);
}

export function getDueState(task: Task, now: Date): DueState {
  if (task.status === "completed" || task.deletedAt) return "completed";

  const dueDate = new Date(task.dueAt);
  if (dueDate.getTime() < now.getTime()) return "overdue";

  const today = getLocalDateKey(now);
  const dueOn = getLocalDateKey(dueDate);

  if (dueOn === today) return "due-today";
  return "upcoming";
}

export function isPastDue(task: Task, now: Date): boolean {
  return task.status === "active" && !task.deletedAt && new Date(task.dueAt) < now;
}

export function summarizeActiveTasks(tasks: Task[], now: Date): TaskSummary {
  const active = tasks.filter(
    (task) => task.status === "active" && !task.deletedAt,
  );
  let todayRemaining = 0;
  let overdue = 0;

  for (const task of active) {
    const state = getDueState(task, now);
    if (state === "overdue") overdue += 1;
    else if (state === "due-today") todayRemaining += 1;
  }

  return {
    todayRemaining,
    overdue,
    activeTotal: active.length,
  };
}

export function groupActiveTasksByCreatedOn(tasks: Task[]): TaskGroup[] {
  const groups = new Map<string, Task[]>();

  for (const task of tasks) {
    if (task.status !== "active" || task.deletedAt) continue;
    const group = groups.get(task.createdOn) ?? [];
    group.push(task);
    groups.set(task.createdOn, group);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([createdOn, groupedTasks]) => ({
      createdOn,
      tasks: groupedTasks.sort(
        (left, right) =>
          new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime(),
      ),
    }));
}

export function completedTasksNewestFirst(tasks: Task[]): Task[] {
  return tasks
    .filter((task) => task.status === "completed" && !task.deletedAt)
    .sort(
      (left, right) =>
        new Date(right.completedAt ?? 0).getTime() -
        new Date(left.completedAt ?? 0).getTime(),
    );
}
