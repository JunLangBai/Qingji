import { describe, expect, it } from "vitest";
import type { Task } from "@qingji/domain";
import {
  createBackup,
  parseBackup,
  serializeBackup,
  validateTask,
} from "./backup";

const task: Task = {
  id: "0f99e2f4-b97a-4cc2-bb68-cb41832f7314",
  title: "导出事项",
  note: "仅用于测试",
  createdAt: "2026-11-09T01:00:00.000Z",
  createdOn: "2026-11-09",
  createdTimezone: "Asia/Shanghai",
  dueAt: "2026-11-09T10:00:00.000Z",
  status: "active",
  updatedAt: "2026-11-09T01:00:00.000Z",
  revision: 1,
  lastModifiedBy: "test-device",
  notificationLeadMinutes: null,
};

describe("Qingji backup format", () => {
  it("round-trips a valid task without credentials", () => {
    const parsed = parseBackup(serializeBackup([task]));
    expect(parsed.format).toBe("qingji-backup");
    expect(parsed.version).toBe(1);
    expect(parsed.tasks).toEqual([task]);
    expect(serializeBackup([task])).not.toContain("token");
  });

  it("rejects unsupported or malformed backups before import", () => {
    expect(() =>
      parseBackup(
        JSON.stringify(createBackup([task]).valueOf()).replace(
          '"qingji-backup"',
          '"other-backup"',
        ),
      ),
    ).toThrow("不支持的备份格式");
    expect(() =>
      parseBackup(
        JSON.stringify({
          ...createBackup([task]),
          tasks: [{ ...task, dueAt: "not-a-date" }],
        }),
      ),
    ).toThrow("字段不完整");
  });

  it("normalizes legacy PostgreSQL timestamps for the archive date", () => {
    expect(
      validateTask({
        ...task,
        createdOn: "2026-11-09T00:00:00.000Z",
      }).createdOn,
    ).toBe("2026-11-09");
  });

  it("preserves a per-task reminder override and rejects invalid values", () => {
    const withOverride: Task = {
      ...task,
      notificationLeadMinutes: -1,
    };
    expect(
      parseBackup(serializeBackup([withOverride])).tasks[0]
        ?.notificationLeadMinutes,
    ).toBe(-1);
    expect(() =>
      validateTask({
        ...task,
        notificationLeadMinutes: 7,
      }),
    ).toThrow("提醒提前量无效");
  });
});
