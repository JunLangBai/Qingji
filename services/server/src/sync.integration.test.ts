import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AuthResponse,
  SyncMutationResult,
  SyncResponse,
  TaskMutation,
} from "@qingji/contracts";
import type { Task } from "@qingji/domain";
import { buildApp, type QingjiServer } from "./app.js";
import { createDatabasePool, type DatabasePool } from "./db.js";
import { createTaskFieldCipher } from "./taskCrypto.js";
import {
  encryptLegacyMutationResults,
  readMutationResult,
} from "./taskMutationResults.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const testTaskEncryptionKey = Buffer.alloc(32, 11).toString("base64");
const testTaskCipher = createTaskFieldCipher({
  secret: testTaskEncryptionKey,
  production: true,
});

function taskFixture(title = "并发测试事项"): Task {
  return {
    id: randomUUID(),
    title,
    note: "初始备注",
    createdAt: "2026-11-09T01:00:00.000Z",
    createdOn: "2026-11-09",
    createdTimezone: "Asia/Shanghai",
    dueAt: "2026-11-09T10:00:00.000Z",
    status: "active",
    updatedAt: "2026-11-09T01:00:00.000Z",
    revision: 0,
    lastModifiedBy: "client-device",
    notificationLeadMinutes: -1,
  };
}

integration("multi-user sync integration", () => {
  let server: QingjiServer;
  let adminPool: DatabasePool;
  const usernames: string[] = [];

  beforeAll(async () => {
    server = await buildApp({
      databaseUrl,
      databaseAdminUrl:
        process.env.TEST_DATABASE_ADMIN_URL ?? databaseUrl,
      logger: false,
      taskDataEncryptionKey: testTaskEncryptionKey,
      appRelease: {
        latestVersion: "0.2.0",
        releaseUrl:
          "https://github.com/example/qingji/releases/tag/v0.2.0",
      },
    });
    adminPool = createDatabasePool(
      process.env.TEST_DATABASE_ADMIN_URL ?? databaseUrl!,
    );
  });

  afterAll(async () => {
    if (usernames.length > 0) {
      await adminPool.query("DELETE FROM users WHERE username = ANY($1)", [
        usernames,
      ]);
    }
    await adminPool.end();
    await server.app.close();
  });

  async function register(deviceId: string): Promise<{
    auth: AuthResponse;
    username: string;
  }> {
    const username = `u-${randomUUID().replaceAll("-", "").slice(0, 24)}`;
    usernames.push(username);
    const response = await server.app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        username,
        password: "integration-password",
        deviceId,
        deviceName: "集成测试设备",
        platform: "windows",
      },
    });
    expect(response.statusCode).toBe(200);
    return { auth: response.json<AuthResponse>(), username };
  }

  async function login(
    username: string,
    deviceId: string,
  ): Promise<AuthResponse> {
    const response = await server.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        username,
        password: "integration-password",
        deviceId,
        deviceName: "第二台设备",
        platform: "android",
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json<AuthResponse>();
  }

  async function sync(
    auth: AuthResponse,
    cursor: number,
    mutations: TaskMutation[],
  ): Promise<SyncResponse> {
    const response = await server.app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: {
        authorization: `Bearer ${auth.token}`,
      },
      payload: {
        cursor,
        deviceId: auth.deviceId,
        mutations,
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json<SyncResponse>();
  }

  it("isolates users, rejects stale revisions, and keeps mutations idempotent", async () => {
    const first = await register(`device-${randomUUID()}`);
    const second = await register(`device-${randomUUID()}`);
    const secondDevice = await login(
      first.username,
      `device-${randomUUID()}`,
    );
    const task = taskFixture();
    const createMutation: TaskMutation = {
      mutationId: randomUUID(),
      taskId: task.id,
      kind: "create",
      baseRevision: 0,
      task,
      createdAt: "2026-11-09T01:00:00.000Z",
    };

    const created = await sync(first.auth, 0, [createMutation]);
    expect(created.results[0]?.status).toBe("applied");
    expect(created.tasks[0]?.revision).toBe(1);
    expect(created.tasks[0]?.createdOn).toBe("2026-11-09");
    expect(created.tasks[0]?.notificationLeadMinutes).toBe(-1);

    const stored = await adminPool.query<{
      title: string;
      note: string | null;
      notification_lead_minutes: number | null;
    }>(
      `SELECT title, note, notification_lead_minutes
       FROM tasks
       WHERE user_id = $1 AND id = $2`,
      [first.auth.user.id, task.id],
    );
    expect(stored.rows[0]?.title).toMatch(/^enc:v1:/);
    expect(stored.rows[0]?.title).not.toContain(task.title);
    expect(stored.rows[0]?.note).toMatch(/^enc:v1:/);
    expect(stored.rows[0]?.notification_lead_minutes).toBe(-1);

    const storedMutation = await adminPool.query<{
      result_json: unknown;
    }>(
      `SELECT result_json
       FROM task_mutations
       WHERE user_id = $1 AND mutation_id = $2`,
      [first.auth.user.id, createMutation.mutationId],
    );
    const storedMutationResult = storedMutation.rows[0]?.result_json;
    expect(typeof storedMutationResult).toBe("string");
    expect(storedMutationResult).toMatch(/^enc:v1:/);
    expect(String(storedMutationResult)).not.toContain(task.title);
    expect(
      readMutationResult(storedMutationResult, testTaskCipher),
    ).toMatchObject({
      mutationId: createMutation.mutationId,
      status: "applied",
    });

    const auditRows = await adminPool.query<{
      event_type: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT event_type, metadata
       FROM audit_events
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [first.auth.user.id],
    );
    expect(auditRows.rows.map((row) => row.event_type)).toEqual(
      expect.arrayContaining(["auth.register", "sync.mutations"]),
    );
    expect(JSON.stringify(auditRows.rows)).not.toContain(task.title);
    await expect(
      server.pool!.query("SELECT id FROM audit_events LIMIT 1"),
    ).rejects.toThrow(/permission denied/i);

    const duplicate = await sync(first.auth, created.cursor, [createMutation]);
    expect(duplicate.results[0]?.status).toBe("applied");
    expect(duplicate.results[0]?.task?.revision).toBe(1);
    expect(duplicate.tasks).toHaveLength(0);

    const privatePull = await sync(second.auth, 0, []);
    expect(privatePull.tasks).toHaveLength(0);

    const firstUpdate: TaskMutation = {
      mutationId: randomUUID(),
      taskId: task.id,
      kind: "update",
      baseRevision: 1,
      task: {
        ...task,
        title: "第一台设备的新标题",
        revision: 2,
      },
      createdAt: "2026-11-09T02:00:00.000Z",
    };
    const updated = await sync(first.auth, created.cursor, [firstUpdate]);
    expect(updated.results[0]?.status).toBe("applied");
    expect(updated.results[0]?.task?.revision).toBe(2);

    const staleUpdate: TaskMutation = {
      mutationId: randomUUID(),
      taskId: task.id,
      kind: "update",
      baseRevision: 1,
      task: {
        ...task,
        note: "第二台设备的离线备注",
        revision: 2,
      },
      createdAt: "2026-11-09T02:01:00.000Z",
    };
    const conflicted = await sync(secondDevice, 0, [staleUpdate]);
    expect(conflicted.results[0]?.status).toBe("conflict");
    expect(conflicted.results[0]?.task?.title).toBe(
      "第一台设备的新标题",
    );
    expect(conflicted.results[0]?.task?.note).toBe("初始备注");

    const crossUserUpdate = await sync(second.auth, 0, [
      {
        ...staleUpdate,
        mutationId: randomUUID(),
      },
    ]);
    expect(crossUserUpdate.results[0]?.status).toBe("conflict");

    const noContext = await server.pool?.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM tasks",
    );
    expect(noContext?.rows[0]?.count).toBe("0");
  });

  it("encrypts legacy plaintext mutation results during startup migration", async () => {
    const account = await register(`device-${randomUUID()}`);
    const task = taskFixture("历史幂等结果中的明文标题");
    const mutationId = randomUUID();
    const legacyResult: SyncMutationResult = {
      mutationId,
      status: "applied",
      task,
    };

    await adminPool.query(
      `INSERT INTO task_mutations
         (user_id, mutation_id, device_id, task_id, result_json)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        account.auth.user.id,
        mutationId,
        account.auth.deviceId,
        task.id,
        JSON.stringify(legacyResult),
      ],
    );

    const migrated = await encryptLegacyMutationResults(
      adminPool,
      testTaskCipher,
    );
    expect(migrated).toBeGreaterThanOrEqual(1);

    const stored = await adminPool.query<{ result_json: unknown }>(
      `SELECT result_json
       FROM task_mutations
       WHERE user_id = $1 AND mutation_id = $2`,
      [account.auth.user.id, mutationId],
    );
    const storedResult = stored.rows[0]?.result_json;
    expect(typeof storedResult).toBe("string");
    expect(storedResult).toMatch(/^enc:v1:/);
    expect(String(storedResult)).not.toContain(task.title);
    expect(readMutationResult(storedResult, testTaskCipher)).toEqual(
      legacyResult,
    );
  });

  it("notifies the same user over the realtime channel", async () => {
    const account = await register(`device-${randomUUID()}`);
    const socket = await server.app.injectWS("/v1/sync/live");
    const messages: string[] = [];
    socket.on("message", (message: unknown) => {
      messages.push(String(message));
    });
    socket.send(
      JSON.stringify({ type: "authenticate", token: account.auth.token }),
    );

    await expect
      .poll(() => messages.some((message) => message.includes("authenticated")))
      .toBe(true);
    await expect
      .poll(() =>
        messages.some((message) =>
          message.includes("app-update-available"),
        ),
      )
      .toBe(true);

    const task = taskFixture("实时通知事项");
    await sync(account.auth, 0, [
      {
        mutationId: randomUUID(),
        taskId: task.id,
        kind: "create",
        baseRevision: 0,
        task,
        createdAt: new Date().toISOString(),
      },
    ]);

    await expect
      .poll(() =>
        messages.some((message) => message.includes("sync-available")),
      )
      .toBe(true);
    socket.close();
  });

  it("serializes simultaneous edits so one device receives a conflict", async () => {
    const first = await register(`device-${randomUUID()}`);
    const secondDevice = await login(
      first.username,
      `device-${randomUUID()}`,
    );
    const task = taskFixture("同时编辑事项");
    await sync(first.auth, 0, [
      {
        mutationId: randomUUID(),
        taskId: task.id,
        kind: "create",
        baseRevision: 0,
        task,
        createdAt: new Date().toISOString(),
      },
    ]);

    const [left, right] = await Promise.all([
      sync(first.auth, 0, [
        {
          mutationId: randomUUID(),
          taskId: task.id,
          kind: "update",
          baseRevision: 1,
          task: { ...task, title: "左侧标题", revision: 2 },
          createdAt: new Date().toISOString(),
        },
      ]),
      sync(secondDevice, 0, [
        {
          mutationId: randomUUID(),
          taskId: task.id,
          kind: "update",
          baseRevision: 1,
          task: { ...task, title: "右侧标题", revision: 2 },
          createdAt: new Date().toISOString(),
        },
      ]),
    ]);

    const statuses = [
      left.results[0]?.status,
      right.results[0]?.status,
    ].sort();
    expect(statuses).toEqual(["applied", "conflict"]);
  });
});
