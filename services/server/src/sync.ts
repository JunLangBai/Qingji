import type { FastifyInstance } from "fastify";
import type {
  SyncMutationResult,
  SyncRequest,
  SyncResponse,
  TaskMutation,
} from "@qingji/contracts";
import type { Task } from "@qingji/domain";
import {
  AuthError,
  authenticateRequest,
  sendAuthError,
  type AuthenticatedSession,
} from "./auth.js";
import {
  type DatabaseClient,
  type DatabasePool,
  withUserTransaction,
} from "./db.js";
import type { LiveHub } from "./live.js";
import { recordAuditEvent } from "./audit.js";
import { safeErrorDetails } from "./logging.js";
import type { TaskFieldCipher } from "./taskCrypto.js";
import {
  encodeMutationResult,
  readMutationResult,
} from "./taskMutationResults.js";

interface TaskRow {
  id: string;
  title: string;
  note: string | null;
  created_at: Date | string;
  created_on: Date | string;
  created_timezone: string;
  due_at: Date | string;
  completed_at: Date | string | null;
  status: "active" | "completed";
  updated_at: Date | string;
  revision: number;
  deleted_at: Date | string | null;
  last_modified_by: string;
  notification_lead_minutes: number | null;
  server_seq: string | number;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function dateOnly(value: Date | string): string {
  const text = value instanceof Date ? value.toISOString() : value;
  const date = /^(\d{4}-\d{2}-\d{2})/.exec(text)?.[1];
  if (!date) throw new Error("INVALID_CREATED_ON");
  return date;
}

function taskFromRow(row: TaskRow, cipher: TaskFieldCipher): Task {
  return {
    id: row.id,
    title: cipher.decryptText(row.title),
    note: cipher.decryptNullableText(row.note) ?? undefined,
    createdAt: iso(row.created_at),
    createdOn: dateOnly(row.created_on),
    createdTimezone: row.created_timezone,
    dueAt: iso(row.due_at),
    completedAt: row.completed_at ? iso(row.completed_at) : undefined,
    status: row.status,
    updatedAt: iso(row.updated_at),
    revision: row.revision,
    deletedAt: row.deleted_at ? iso(row.deleted_at) : undefined,
    lastModifiedBy: row.last_modified_by,
    notificationLeadMinutes:
      row.notification_lead_minutes === null
        ? null
        : (row.notification_lead_minutes as Task["notificationLeadMinutes"]),
  };
}

function validUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function validText(
  value: unknown,
  maxLength: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    (allowEmpty || value.trim().length > 0)
  );
}

function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(new Date(value).getTime())
  );
}

function validateMutationTask(mutation: TaskMutation): string | null {
  const task = mutation.task;
  if (!validUuid(mutation.mutationId)) return "同步操作标识无效";
  if (!validUuid(mutation.taskId)) return "事项标识无效";
  if (!validUuid(task?.id) || task.id !== mutation.taskId) {
    return "事项标识不一致";
  }
  if (!Number.isSafeInteger(mutation.baseRevision) || mutation.baseRevision < 0) {
    return "基础版本无效";
  }
  if (!validText(task.title, 500)) return "事项标题无效";
  if (task.note !== undefined && !validText(task.note, 5_000, true)) {
    return "事项备注过长";
  }
  if (!validDate(task.dueAt)) return "截止时间无效";
  if (!validDate(task.createdAt)) return "创建时间无效";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(task.createdOn)) {
    return "创建日期无效";
  }
  if (!validText(task.createdTimezone, 100)) return "创建时区无效";
  if (task.status !== "active" && task.status !== "completed") {
    return "事项状态无效";
  }
  if (task.completedAt !== undefined && !validDate(task.completedAt)) {
    return "完成时间无效";
  }
  if (task.deletedAt !== undefined && !validDate(task.deletedAt)) {
    return "删除时间无效";
  }
  if (
    task.notificationLeadMinutes !== undefined &&
    task.notificationLeadMinutes !== null &&
    !([-1, 0, 5, 15, 30, 60, 1_440] as const).includes(
      task.notificationLeadMinutes as -1 | 0 | 5 | 15 | 30 | 60 | 1_440,
    )
  ) {
    return "提醒提前量无效";
  }
  return null;
}

async function findTask(
  client: DatabaseClient,
  userId: string,
  taskId: string,
  cipher: TaskFieldCipher,
): Promise<Task | null> {
  const result = await client.query<TaskRow>(
    `SELECT id, title, note, created_at, created_on::text AS created_on,
            created_timezone,
            due_at, completed_at, status, updated_at, revision,
            deleted_at, last_modified_by, notification_lead_minutes,
            server_seq
     FROM tasks
     WHERE user_id = $1 AND id = $2`,
    [userId, taskId],
  );
  const row = result.rows[0];
  return row ? taskFromRow(row, cipher) : null;
}

function conflictResult(
  mutationId: string,
  task: Task | null,
  message = "事项已被其他设备修改",
): SyncMutationResult {
  return {
    mutationId,
    status: "conflict",
    task: task ?? undefined,
    message,
  };
}

async function applyMutation(
  client: DatabaseClient,
  session: { userId: string; deviceId: string },
  mutation: TaskMutation,
  nextSeq: number,
  cipher: TaskFieldCipher,
): Promise<{ result: SyncMutationResult; changed: boolean }> {
  const existing = await findTask(
    client,
    session.userId,
    mutation.taskId,
    cipher,
  );
  const now = new Date().toISOString();

  if (mutation.kind === "create") {
    if (existing) return { result: conflictResult(mutation.mutationId, existing), changed: false };
    if (mutation.baseRevision !== 0) {
      return {
        result: {
          mutationId: mutation.mutationId,
          status: "rejected",
          message: "新建事项的基础版本必须为 0",
        },
        changed: false,
      };
    }
    const task: Task = {
      ...structuredClone(mutation.task),
      updatedAt: now,
      revision: 1,
      lastModifiedBy: session.deviceId,
    };
    await insertTask(client, session.userId, task, nextSeq, cipher);
    return {
      result: {
        mutationId: mutation.mutationId,
        status: "applied",
        task,
      },
      changed: true,
    };
  }

  if (!existing) {
    return {
      result: {
        mutationId: mutation.mutationId,
        status: "conflict",
        message: "服务器上不存在该事项",
      },
      changed: false,
    };
  }
  if (existing.revision !== mutation.baseRevision) {
    return {
      result: conflictResult(mutation.mutationId, existing),
      changed: false,
    };
  }

  let nextTask: Task;
  if (mutation.kind === "update") {
    if (existing.deletedAt) {
      return {
        result: conflictResult(
          mutation.mutationId,
          existing,
          "事项已经删除",
        ),
        changed: false,
      };
    }
    nextTask = {
      ...existing,
      title: mutation.task.title.trim(),
      note: mutation.task.note,
      dueAt: iso(mutation.task.dueAt),
      notificationLeadMinutes:
        mutation.task.notificationLeadMinutes === undefined
          ? existing.notificationLeadMinutes
          : mutation.task.notificationLeadMinutes,
      status: mutation.task.status,
      completedAt:
        mutation.task.status === "completed"
          ? mutation.task.completedAt ?? existing.completedAt ?? now
          : undefined,
      updatedAt: now,
      revision: existing.revision + 1,
      lastModifiedBy: session.deviceId,
    };
  } else if (mutation.kind === "complete") {
    if (existing.status === "completed") {
      return {
        result: {
          mutationId: mutation.mutationId,
          status: "applied",
          task: existing,
        },
        changed: false,
      };
    }
    nextTask = {
      ...existing,
      status: "completed",
      completedAt: mutation.task.completedAt ?? now,
      updatedAt: now,
      revision: existing.revision + 1,
      lastModifiedBy: session.deviceId,
    };
  } else if (mutation.kind === "undo-complete") {
    if (existing.status === "active") {
      return {
        result: {
          mutationId: mutation.mutationId,
          status: "applied",
          task: existing,
        },
        changed: false,
      };
    }
    nextTask = {
      ...existing,
      status: "active",
      completedAt: undefined,
      updatedAt: now,
      revision: existing.revision + 1,
      lastModifiedBy: session.deviceId,
    };
  } else {
    if (existing.deletedAt) {
      return {
        result: {
          mutationId: mutation.mutationId,
          status: "applied",
          task: existing,
        },
        changed: false,
      };
    }
    nextTask = {
      ...existing,
      deletedAt: mutation.task.deletedAt ?? now,
      updatedAt: now,
      revision: existing.revision + 1,
      lastModifiedBy: session.deviceId,
    };
  }

  await updateTask(client, session.userId, nextTask, nextSeq, cipher);
  return {
    result: {
      mutationId: mutation.mutationId,
      status: "applied",
      task: nextTask,
    },
    changed: true,
  };
}

async function insertTask(
  client: DatabaseClient,
  userId: string,
  task: Task,
  serverSeq: number,
  cipher: TaskFieldCipher,
): Promise<void> {
  await client.query(
    `INSERT INTO tasks (
       user_id, id, title, note, created_at, created_on,
       created_timezone, due_at, completed_at, status, updated_at,
       revision, deleted_at, last_modified_by, notification_lead_minutes,
       server_seq
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       $15, $16
     )`,
    [
      userId,
      task.id,
      cipher.encryptText(task.title),
      cipher.encryptNullableText(task.note ?? null),
      task.createdAt,
      task.createdOn,
      task.createdTimezone,
      task.dueAt,
      task.completedAt ?? null,
      task.status,
      task.updatedAt,
      task.revision,
      task.deletedAt ?? null,
      task.lastModifiedBy,
      task.notificationLeadMinutes ?? null,
      serverSeq,
    ],
  );
}

async function updateTask(
  client: DatabaseClient,
  userId: string,
  task: Task,
  serverSeq: number,
  cipher: TaskFieldCipher,
): Promise<void> {
  await client.query(
    `UPDATE tasks SET
       title = $3,
       note = $4,
       due_at = $5,
       completed_at = $6,
       status = $7,
       updated_at = $8,
       revision = $9,
       deleted_at = $10,
       last_modified_by = $11,
       notification_lead_minutes = $12,
       server_seq = $13
     WHERE user_id = $1 AND id = $2`,
    [
      userId,
      task.id,
      cipher.encryptText(task.title),
      cipher.encryptNullableText(task.note ?? null),
      task.dueAt,
      task.completedAt ?? null,
      task.status,
      task.updatedAt,
      task.revision,
      task.deletedAt ?? null,
      task.lastModifiedBy,
      task.notificationLeadMinutes ?? null,
      serverSeq,
    ],
  );
}

export async function registerSyncRoutes(
  app: FastifyInstance,
  pool: DatabasePool,
  liveHub: LiveHub,
  cipher: TaskFieldCipher,
): Promise<void> {
  app.post("/v1/sync", async (request, reply) => {
    let auditSession: AuthenticatedSession | null = null;
    try {
      const session = await authenticateRequest(request, pool);
      auditSession = session;
      const body = request.body as Partial<SyncRequest>;
      const cursor = Number(body.cursor ?? 0);
      if (!Number.isSafeInteger(cursor) || cursor < 0) {
        return reply
          .status(400)
          .send({ code: "INVALID_CURSOR", message: "同步游标无效" });
      }
      if (!Array.isArray(body.mutations)) {
        return reply
          .status(400)
          .send({ code: "INVALID_MUTATIONS", message: "同步变更格式无效" });
      }
      if (body.mutations.length > 100) {
        return reply
          .status(400)
          .send({ code: "TOO_MANY_MUTATIONS", message: "单次最多同步 100 项变更" });
      }

      let changed = false;
      let response: SyncResponse = {
        cursor,
        tasks: [],
        results: [],
        serverTime: new Date().toISOString(),
      };

      await withUserTransaction(pool, session.userId, async (client) => {
        const counter = await client.query<{ last_seq: string }>(
          `SELECT last_seq
           FROM user_sync_counters
           WHERE user_id = $1
           FOR UPDATE`,
          [session.userId],
        );
        let lastSeq = Number(counter.rows[0]?.last_seq ?? 0);
        const results: SyncMutationResult[] = [];

        for (const mutation of body.mutations as TaskMutation[]) {
          const existingMutation = await client.query<{
            result_json: unknown;
          }>(
            `SELECT result_json
             FROM task_mutations
             WHERE user_id = $1 AND mutation_id = $2`,
            [session.userId, mutation?.mutationId],
          );
          const previous = existingMutation.rows[0]?.result_json;
          if (previous !== undefined) {
            results.push(readMutationResult(previous, cipher));
            continue;
          }

          const validationError = validateMutationTask(mutation);
          let result: SyncMutationResult;
          let mutationChanged = false;
          if (validationError) {
            result = {
              mutationId: String(mutation?.mutationId ?? ""),
              status: "rejected",
              message: validationError,
            };
          } else {
            const applied = await applyMutation(
              client,
              session,
              mutation,
              lastSeq + 1,
              cipher,
            );
            result = applied.result;
            mutationChanged = applied.changed;
            if (mutationChanged) lastSeq += 1;
          }

          if (mutationChanged) changed = true;
          results.push(result);
          await client.query(
            `INSERT INTO task_mutations
               (user_id, mutation_id, device_id, task_id, result_json)
             VALUES ($1, $2, $3, $4, to_jsonb($5::text))
             ON CONFLICT (user_id, mutation_id) DO NOTHING`,
            [
              session.userId,
              mutation.mutationId,
              session.deviceId,
              mutation.taskId,
              encodeMutationResult(result, cipher),
            ],
          );
        }
        await client.query(
          `INSERT INTO user_sync_counters (user_id, last_seq)
           VALUES ($1, $2)
           ON CONFLICT (user_id) DO UPDATE
           SET last_seq = EXCLUDED.last_seq`,
          [session.userId, lastSeq],
        );

        const tasks = await client.query<TaskRow>(
          `SELECT id, title, note, created_at, created_on::text AS created_on,
                  created_timezone, due_at, completed_at, status,
                  updated_at, revision, deleted_at, last_modified_by,
                  notification_lead_minutes, server_seq
           FROM tasks
           WHERE user_id = $1 AND server_seq > $2
           ORDER BY server_seq ASC
           LIMIT 1000`,
          [session.userId, cursor],
        );
        const nextCursor =
          tasks.rows.length > 0
            ? Number(tasks.rows[tasks.rows.length - 1]?.server_seq)
            : cursor;
        response = {
          cursor: nextCursor,
          tasks: tasks.rows.map((row) => taskFromRow(row, cipher)),
          results,
          serverTime: new Date().toISOString(),
        };
      });

      if (changed) liveHub.notify(session.userId);
      if (body.mutations.length > 0) {
        const applied = response.results.filter(
          (result) => result.status === "applied",
        ).length;
        const conflicts = response.results.filter(
          (result) => result.status === "conflict",
        ).length;
        const rejected = response.results.filter(
          (result) => result.status === "rejected",
        ).length;
        await recordAuditEvent(
          pool,
          {
            eventType: "sync.mutations",
            outcome:
              conflicts > 0 || rejected > 0 ? "partial" : "success",
            userId: session.userId,
            actorUsername: session.username,
            deviceId: session.deviceId,
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
            metadata: {
              mutationCount: body.mutations.length,
              applied,
              conflicts,
              rejected,
              pulledTasks: response.tasks.length,
            },
          },
          request.log,
        );
      }
      return response;
    } catch (error) {
      await recordAuditEvent(
        pool,
        {
          eventType: "sync.failed",
          outcome: error instanceof AuthError ? "denied" : "failure",
          userId: auditSession?.userId,
          actorUsername: auditSession?.username,
          deviceId: auditSession?.deviceId,
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
        },
        request.log,
      );
      if (error instanceof AuthError) return sendAuthError(reply, error);
      request.log.error(
        { err: safeErrorDetails(error) },
        "sync request failed",
      );
      return reply
        .status(500)
        .send({ code: "SYNC_FAILED", message: "同步暂时失败" });
    }
  });
}
