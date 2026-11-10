import { describe, expect, it } from "vitest";
import {
  compareVersions,
  completedTasksNewestFirst,
  getDateKey,
  getDueState,
  groupActiveTasksByCreatedOn,
  summarizeActiveTasks,
  type Task,
} from "./index";

const timezone = "Asia/Shanghai";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    title: "测试事项",
    createdAt: "2026-11-09T00:00:00.000Z",
    createdOn: "2026-11-09",
    createdTimezone: timezone,
    dueAt: "2026-11-09T10:00:00.000Z",
    status: "active",
    updatedAt: "2026-11-09T00:00:00.000Z",
    revision: 1,
    lastModifiedBy: "test-device",
    ...overrides,
  };
}

describe("deadline rules", () => {
  const now = new Date("2026-11-09T04:00:00.000Z");

  it("distinguishes today, upcoming, and previous-day overdue", () => {
    expect(getDueState(task({ dueAt: "2026-11-09T10:00:00.000Z" }), now)).toBe(
      "due-today",
    );
    expect(getDueState(task({ dueAt: "2026-11-09T03:30:00.000Z" }), now)).toBe(
      "overdue",
    );
    expect(getDueState(task({ dueAt: "2026-11-10T10:00:00.000Z" }), now)).toBe(
      "upcoming",
    );
    expect(getDueState(task({ dueAt: "2026-11-08T10:00:00.000Z" }), now)).toBe(
      "overdue",
    );
  });

  it("does not count previous-day overdue tasks as today's remaining tasks", () => {
    const summary = summarizeActiveTasks(
      [
        task({ dueAt: "2026-11-09T10:00:00.000Z" }),
        task({ dueAt: "2026-11-08T10:00:00.000Z" }),
        task({
          dueAt: "2026-11-10T10:00:00.000Z",
          status: "completed",
          completedAt: "2026-11-09T03:00:00.000Z",
        }),
      ],
      now,
    );

    expect(summary).toEqual({
      todayRemaining: 1,
      overdue: 1,
      activeTotal: 2,
    });
  });
});

describe("release versions", () => {
  it("orders stable and prerelease versions using semantic version rules", () => {
    expect(compareVersions("v0.1.2", "0.1.1")).toBeGreaterThan(0);
    expect(compareVersions("0.1.2-alpha.1", "0.1.1")).toBeGreaterThan(0);
    expect(compareVersions("0.1.2-alpha.2", "0.1.2-alpha.1")).toBeGreaterThan(
      0,
    );
    expect(compareVersions("0.1.2", "0.1.2-alpha.2")).toBeGreaterThan(0);
    expect(compareVersions("v0.1.2+build.4", "0.1.2")).toBe(0);
  });
});

describe("task organization", () => {
  it("groups active tasks by creation day and sorts by deadline", () => {
    const groups = groupActiveTasksByCreatedOn([
      task({ id: "b", createdOn: "2026-11-09", dueAt: "2026-11-10T10:00:00.000Z" }),
      task({ id: "a", createdOn: "2026-11-09", dueAt: "2026-11-09T10:00:00.000Z" }),
      task({ id: "c", createdOn: "2026-11-08", dueAt: "2026-11-09T12:00:00.000Z" }),
      task({ id: "deleted", createdOn: "2026-11-08", deletedAt: "2026-11-09T01:00:00.000Z" }),
    ]);

    expect(groups.map((group) => group.createdOn)).toEqual([
      "2026-11-09",
      "2026-11-08",
    ]);
    expect(groups[0]?.tasks.map((item) => item.id)).toEqual(["a", "b"]);
    expect(groups[1]?.tasks.map((item) => item.id)).toEqual(["c"]);
  });

  it("orders completed tasks by completion time", () => {
    const completed = completedTasksNewestFirst([
      task({ id: "old", status: "completed", completedAt: "2026-11-08T01:00:00.000Z" }),
      task({ id: "new", status: "completed", completedAt: "2026-11-09T01:00:00.000Z" }),
      task({ id: "active" }),
    ]);

    expect(completed.map((item) => item.id)).toEqual(["new", "old"]);
  });
});

describe("time zone and calendar boundaries", () => {
  it("keeps creation dates stable across a year boundary in the device zone", () => {
    expect(
      getDateKey(new Date("2026-12-31T15:59:59.000Z"), "Asia/Shanghai"),
    ).toBe("2026-12-31");
    expect(
      getDateKey(new Date("2026-12-31T16:00:00.000Z"), "Asia/Shanghai"),
    ).toBe("2027-01-01");
  });

  it("handles both sides of a daylight-saving transition", () => {
    expect(
      getDateKey(
        new Date("2026-03-08T06:59:59.000Z"),
        "America/New_York",
      ),
    ).toBe("2026-03-08");
    expect(
      getDateKey(
        new Date("2026-03-08T07:00:00.000Z"),
        "America/New_York",
      ),
    ).toBe("2026-03-08");
    expect(
      getDateKey(
        new Date("2026-11-01T05:30:00.000Z"),
        "America/New_York",
      ),
    ).toBe("2026-11-01");
    expect(
      getDateKey(
        new Date("2026-11-01T06:30:00.000Z"),
        "America/New_York",
      ),
    ).toBe("2026-11-01");
  });

  it("recomputes deadline state after a task is rescheduled or completed", () => {
    const now = new Date("2026-11-09T12:00:00.000Z");
    expect(
      getDueState(
        task({ dueAt: "2026-11-10T12:00:00.000Z" }),
        now,
      ),
    ).toBe("upcoming");
    expect(
      getDueState(
        task({ dueAt: "2026-11-09T11:00:00.000Z" }),
        now,
      ),
    ).toBe("overdue");
    expect(
      getDueState(
        task({
          dueAt: "2026-11-09T11:00:00.000Z",
          status: "completed",
          completedAt: "2026-11-09T11:30:00.000Z",
        }),
        now,
      ),
    ).toBe("completed");
  });
});
