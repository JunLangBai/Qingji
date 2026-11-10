import { randomUUID } from "node:crypto";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import type { AuthRequest, AuthResponse } from "@qingji/contracts";
import type { DatabasePool } from "./db.js";
import { recordAuditEvent } from "./audit.js";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  isValidUsername,
  normalizeUsername,
  validatePassword,
  verifyPassword,
} from "./security.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const dummyPasswordHash = hashPassword("invalid-password-placeholder");

export interface AuthenticatedSession {
  userId: string;
  username: string;
  sessionId: string;
  deviceId: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

class LoginRateLimiter {
  private readonly attempts = new Map<
    string,
    { count: number; resetAt: number }
  >();

  assertAllowed(key: string): void {
    const current = this.attempts.get(key);
    if (!current) return;
    if (current.resetAt <= Date.now()) {
      this.attempts.delete(key);
      return;
    }
    if (current.count >= 8) {
      throw new AuthError(
        "登录尝试过多，请稍后再试",
        429,
        "LOGIN_RATE_LIMITED",
      );
    }
  }

  failed(key: string): void {
    const current = this.attempts.get(key);
    if (!current || current.resetAt <= Date.now()) {
      this.attempts.set(key, {
        count: 1,
        resetAt: Date.now() + 15 * 60 * 1_000,
      });
      return;
    }
    current.count += 1;
  }

  succeeded(key: string): void {
    this.attempts.delete(key);
  }
}

function validateDevice(
  value: unknown,
  maxLength: number,
  label: string,
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maxLength
  ) {
    throw new AuthError(`${label}无效`, 400, "INVALID_DEVICE");
  }
  return value;
}

function authResponse(
  token: string,
  expiresAt: string,
  userId: string,
  username: string,
  deviceId: string,
): AuthResponse {
  return {
    token,
    expiresAt,
    user: { id: userId, username },
    deviceId,
  };
}

export async function authenticateRequest(
  request: FastifyRequest,
  pool: DatabasePool,
): Promise<AuthenticatedSession> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    throw new AuthError("需要登录", 401, "AUTH_REQUIRED");
  }
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) throw new AuthError("需要登录", 401, "AUTH_REQUIRED");
  return authenticateToken(token, pool);
}

export async function authenticateToken(
  token: string,
  pool: DatabasePool,
): Promise<AuthenticatedSession> {
  const result = await pool.query<{
    session_id: string;
    user_id: string;
    username: string;
    device_id: string;
  }>(
    `SELECT s.id AS session_id, s.user_id, u.username, s.device_id
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN devices d
       ON d.user_id = s.user_id AND d.id = s.device_id
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > now()
       AND d.revoked_at IS NULL`,
    [hashSessionToken(token)],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AuthError("登录已失效", 401, "SESSION_EXPIRED");
  }

  await Promise.all([
    pool.query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [
      row.session_id,
    ]),
    pool.query(
      `UPDATE devices SET last_seen_at = now()
       WHERE user_id = $1 AND id = $2`,
      [row.user_id, row.device_id],
    ),
  ]);

  return {
    userId: row.user_id,
    username: row.username,
    sessionId: row.session_id,
    deviceId: row.device_id,
  };
}

export function sendAuthError(reply: FastifyReply, error: unknown) {
  if (error instanceof AuthError) {
    return reply.status(error.statusCode).send({
      code: error.code,
      message: error.message,
    });
  }
  if (error instanceof Error && error.message.startsWith("密码")) {
    return reply.status(400).send({
      code: "INVALID_PASSWORD",
      message: error.message,
    });
  }
  throw error;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  pool: DatabasePool,
): Promise<void> {
  const limiter = new LoginRateLimiter();

  app.post("/v1/auth/register", async (request, reply) => {
    try {
      const body = request.body as Partial<AuthRequest>;
      const username = normalizeUsername(String(body.username ?? ""));
      if (!isValidUsername(username)) {
        throw new AuthError(
          "用户名需为 2–32 个字符，可使用中英文、数字、点、横线、下划线或 @",
          400,
          "INVALID_USERNAME",
        );
      }
      const password = validatePassword(body.password);
      const deviceId = validateDevice(body.deviceId, 200, "设备标识");
      const deviceLabel = validateDevice(body.deviceName, 200, "设备名称");
      const platform = validateDevice(body.platform, 40, "平台");

      const existing = await pool.query(
        "SELECT 1 FROM users WHERE username = $1",
        [username],
      );
      if (existing.rowCount) {
        await recordAuditEvent(
          pool,
          {
            eventType: "auth.register",
            outcome: "failure",
            actorUsername: username,
            deviceId,
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
            metadata: { usernameExists: true },
          },
          request.log,
        );
        throw new AuthError("该用户名已被使用", 409, "USERNAME_EXISTS");
      }

      const passwordHash = await hashPassword(password);
      const userId = randomUUID();
      const sessionId = randomUUID();
      const token = createSessionToken();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)",
          [userId, username, passwordHash],
        );
        await client.query(
          "INSERT INTO user_sync_counters (user_id) VALUES ($1)",
          [userId],
        );
        await client.query(
          `INSERT INTO devices (user_id, id, name, platform)
           VALUES ($1, $2, $3, $4)`,
          [userId, deviceId, deviceLabel, platform],
        );
        await client.query(
          `INSERT INTO sessions
             (id, user_id, device_id, token_hash, expires_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [sessionId, userId, deviceId, hashSessionToken(token), expiresAt],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "23505"
        ) {
          throw new AuthError("该用户名已被使用", 409, "USERNAME_EXISTS");
        }
        throw error;
      } finally {
        client.release();
      }

      await recordAuditEvent(
        pool,
        {
          eventType: "auth.register",
          outcome: "success",
          userId,
          actorUsername: username,
          deviceId,
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
        },
        request.log,
      );

      return authResponse(token, expiresAt, userId, username, deviceId);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post("/v1/auth/login", async (request, reply) => {
    const body = request.body as Partial<AuthRequest>;
    const username = normalizeUsername(String(body.username ?? ""));
    const rateKey = `${request.ip}:${username}`;
    try {
      limiter.assertAllowed(rateKey);
      if (!isValidUsername(username)) {
        throw new AuthError(
          "用户名或密码错误",
          401,
          "INVALID_CREDENTIALS",
        );
      }
      const password = validatePassword(body.password);
      const deviceId = validateDevice(body.deviceId, 200, "设备标识");
      const deviceLabel = validateDevice(body.deviceName, 200, "设备名称");
      const platform = validateDevice(body.platform, 40, "平台");

      const result = await pool.query<{
        id: string;
        username: string;
        password_hash: string;
      }>(
        "SELECT id, username, password_hash FROM users WHERE username = $1",
        [username],
      );
      const user = result.rows[0];
      const validPassword = await verifyPassword(
        password,
        user?.password_hash ?? (await dummyPasswordHash),
      );
      if (!user || !validPassword) {
        limiter.failed(rateKey);
        await recordAuditEvent(
          pool,
          {
            eventType: "auth.login-failed",
            outcome: "denied",
            actorUsername: username,
            deviceId,
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
          },
          request.log,
        );
        throw new AuthError(
          "用户名或密码错误",
          401,
          "INVALID_CREDENTIALS",
        );
      }

      limiter.succeeded(rateKey);
      const sessionId = randomUUID();
      const token = createSessionToken();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO devices (user_id, id, name, platform)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, id) DO UPDATE SET
             name = EXCLUDED.name,
             platform = EXCLUDED.platform,
             last_seen_at = now(),
             revoked_at = NULL`,
          [user.id, deviceId, deviceLabel, platform],
        );
        await client.query(
          `INSERT INTO sessions
             (id, user_id, device_id, token_hash, expires_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [sessionId, user.id, deviceId, hashSessionToken(token), expiresAt],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      await recordAuditEvent(
        pool,
        {
          eventType: "auth.login",
          outcome: "success",
          userId: user.id,
          actorUsername: username,
          deviceId,
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
        },
        request.log,
      );

      return authResponse(
        token,
        expiresAt,
        user.id,
        user.username,
        deviceId,
      );
    } catch (error) {
      if (
        error instanceof AuthError &&
        error.code === "LOGIN_RATE_LIMITED"
      ) {
        await recordAuditEvent(
          pool,
          {
            eventType: "auth.rate-limited",
            outcome: "denied",
            actorUsername: username,
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
          },
          request.log,
        );
      }
      if (
        error instanceof AuthError &&
        error.code === "INVALID_CREDENTIALS"
      ) {
        return sendAuthError(reply, error);
      }
      return sendAuthError(reply, error);
    }
  });

  app.get("/v1/auth/me", async (request, reply) => {
    try {
      const session = await authenticateRequest(request, pool);
      return {
        user: { id: session.userId, username: session.username },
      };
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    try {
      const session = await authenticateRequest(request, pool);
      await pool.query(
        "UPDATE sessions SET revoked_at = now() WHERE id = $1",
        [session.sessionId],
      );
      await recordAuditEvent(
        pool,
        {
          eventType: "auth.logout",
          outcome: "success",
          userId: session.userId,
          actorUsername: session.username,
          deviceId: session.deviceId,
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
        },
        request.log,
      );
      return { ok: true };
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });
}
