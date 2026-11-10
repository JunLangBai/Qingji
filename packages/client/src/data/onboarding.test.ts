import { describe, expect, it, vi } from "vitest";
import type { Task } from "@qingji/domain";
import {
  WELCOME_TASK_TITLE,
  createWelcomeTask,
  replaceLegacyDemoTasks,
} from "./onboarding";

const deviceId = "test-device";
const now = new Date("2026-11-10T08:00:00.000Z");

function task(title: string): Task {
  return {
    id: crypto.randomUUID(),
    title,
    createdAt: now.toISOString(),
    createdOn: "2026-11-10",
    createdTimezone: "Asia/Shanghai",
    dueAt: "2026-11-11T08:00:00.000Z",
    status: "active",
    updatedAt: now.toISOString(),
    revision: 0,
    lastModifiedBy: deviceId,
    notificationLeadMinutes: null,
  };
}

describe("onboarding tasks", () => {
  it("creates one concise welcome example", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "welcome-id" });
    const welcome = createWelcomeTask(deviceId, now);
    expect(welcome).toMatchObject({
      id: "welcome-id",
      title: WELCOME_TASK_TITLE,
      status: "active",
    });
    expect(welcome.dueAt).toBe("2026-11-11T08:00:00.000Z");
    vi.unstubAllGlobals();
  });

  it("replaces the four legacy demo records with one example", () => {
    const result = replaceLegacyDemoTasks(
      [
        task("整理明天的汇报材料"),
        task("回复合作方的确认邮件"),
        task("下班路上取快递"),
        task("续订常用软件"),
      ],
      deviceId,
      now,
    );
    expect(result.changed).toBe(true);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.title).toBe(WELCOME_TASK_TITLE);
  });

  it("preserves user tasks while removing the known demo set", () => {
    const result = replaceLegacyDemoTasks(
      [
        task("整理明天的汇报材料"),
        task("回复合作方的确认邮件"),
        task("下班路上取快递"),
        task("续订常用软件"),
        task("真正需要保留的事项"),
      ],
      deviceId,
      now,
    );
    expect(result.tasks.map((item) => item.title)).toEqual([
      "真正需要保留的事项",
    ]);
  });
});
