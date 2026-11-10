import type { BackupEnvelope } from "@qingji/contracts";
import {
  TASK_NOTIFICATION_LEAD_MINUTES,
  type Task,
  type TaskNotificationSetting,
  type TaskStatus,
} from "@qingji/domain";

const MAX_BACKUP_CHARACTERS = 25 * 1024 * 1024;
const MAX_BACKUP_TASKS = 100_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(new Date(value).getTime())
  );
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = /^(\d{4}-\d{2}-\d{2})/.exec(value)?.[1];
  return date && isIsoDate(date) ? date : null;
}

function notificationLeadMinutes(
  value: unknown,
): TaskNotificationSetting {
  if (value === undefined || value === null) return null;
  if (value === -1) return -1;
  if (
    typeof value === "number" &&
    TASK_NOTIFICATION_LEAD_MINUTES.includes(
      value as (typeof TASK_NOTIFICATION_LEAD_MINUTES)[number],
    )
  ) {
    return value as TaskNotificationSetting;
  }
  throw new Error("备份中的事项提醒提前量无效");
}

export function validateTask(value: unknown): Task {
  if (!isRecord(value)) throw new Error("备份中的事项格式无效");
  const status = value.status;
  const createdOn = dateOnly(value.createdOn);
  if (status !== "active" && status !== "completed") {
    throw new Error("备份中的事项状态无效");
  }
  if (
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    value.title.length > 500 ||
    (value.note !== undefined &&
      (typeof value.note !== "string" || value.note.length > 5_000)) ||
    !createdOn ||
    typeof value.createdTimezone !== "string" ||
    !isIsoDate(value.createdAt) ||
    !isIsoDate(value.dueAt) ||
    !isIsoDate(value.updatedAt) ||
    (value.completedAt !== undefined && !isIsoDate(value.completedAt)) ||
    (value.deletedAt !== undefined && !isIsoDate(value.deletedAt)) ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    typeof value.lastModifiedBy !== "string"
  ) {
    throw new Error("备份中的事项字段不完整或超出限制");
  }
  const reminderLead = notificationLeadMinutes(
    value.notificationLeadMinutes,
  );

  return {
    id: value.id,
    title: value.title.trim(),
    note: typeof value.note === "string" ? value.note : undefined,
    createdAt: value.createdAt,
    createdOn,
    createdTimezone: value.createdTimezone,
    dueAt: value.dueAt,
    completedAt:
      typeof value.completedAt === "string" ? value.completedAt : undefined,
    status: status as TaskStatus,
    updatedAt: value.updatedAt,
    revision: value.revision,
    deletedAt:
      typeof value.deletedAt === "string" ? value.deletedAt : undefined,
    lastModifiedBy: value.lastModifiedBy,
    notificationLeadMinutes: reminderLead,
  };
}

export function createBackup(tasks: Task[], now = new Date()): BackupEnvelope {
  return {
    format: "qingji-backup",
    version: 1,
    exportedAt: now.toISOString(),
    tasks,
  };
}

export function serializeBackup(tasks: Task[], now = new Date()): string {
  return JSON.stringify(createBackup(tasks, now), null, 2);
}

export function parseBackup(text: string): BackupEnvelope {
  if (text.length > MAX_BACKUP_CHARACTERS) {
    throw new Error("备份文件超过 25 MB，无法导入");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("备份文件不是有效的 JSON");
  }
  if (!isRecord(parsed)) throw new Error("备份文件结构无效");
  if (parsed.format !== "qingji-backup" || parsed.version !== 1) {
    throw new Error("不支持的备份格式或版本");
  }
  if (!isIsoDate(parsed.exportedAt) || !Array.isArray(parsed.tasks)) {
    throw new Error("备份文件缺少导出时间或事项列表");
  }
  if (parsed.tasks.length > MAX_BACKUP_TASKS) {
    throw new Error("备份事项超过 100,000 条，无法导入");
  }

  return {
    format: "qingji-backup",
    version: 1,
    exportedAt: parsed.exportedAt,
    tasks: parsed.tasks.map(validateTask),
  };
}

export function backupFileName(now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  return `清记备份-${date}.json`;
}
