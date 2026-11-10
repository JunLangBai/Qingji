import { createHash, randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { forwardAuditEvent } from "./auditForward.js";
import type { DatabasePool } from "./db.js";
import { normalizeUsername } from "./security.js";

export type AuditEventType =
  | "auth.register"
  | "auth.login"
  | "auth.login-failed"
  | "auth.logout"
  | "auth.rate-limited"
  | "realtime.auth-failed"
  | "sync.mutations"
  | "sync.failed";

export type AuditOutcome = "success" | "failure" | "denied" | "partial";

export interface AuditEventInput {
  eventType: AuditEventType;
  outcome: AuditOutcome;
  userId?: string;
  deviceId?: string;
  actorUsername?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, number | boolean | null>;
}

export function auditActorRef(username: string): string {
  return createHash("sha256")
    .update(normalizeUsername(username))
    .digest("hex")
    .slice(0, 32);
}

function safeIpAddress(value: string | undefined): string | null {
  if (!value) return null;
  return value.length <= 64 ? value : null;
}

export async function recordAuditEvent(
  pool: DatabasePool,
  event: AuditEventInput,
  logger?: FastifyBaseLogger,
): Promise<void> {
  const eventId = randomUUID();
  try {
    await pool.query(
      `INSERT INTO audit_events (
         id, user_id, device_id, actor_ref, event_type, outcome,
         ip_address, user_agent, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        eventId,
        event.userId ?? null,
        event.deviceId ?? null,
        event.actorUsername ? auditActorRef(event.actorUsername) : null,
        event.eventType,
        event.outcome,
        safeIpAddress(event.ipAddress),
        event.userAgent?.slice(0, 300) ?? null,
        JSON.stringify(event.metadata ?? {}),
      ],
    );
    forwardAuditEvent(eventId, event, logger);
  } catch (error) {
    logger?.warn({ err: error }, "audit event write failed");
  }
}
