import { createHash } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { normalizeUsername } from "./security.js";

export interface ForwardableAuditEvent {
  eventType: string;
  outcome: string;
  userId?: string;
  deviceId?: string;
  actorUsername?: string;
  ipAddress?: string;
  metadata?: Record<string, number | boolean | null>;
}

interface ForwardedEvent {
  clientEventId: string;
  occurredAt: string;
  action: string;
  category: string;
  outcome: string;
  actor?: { id?: string };
  sourceIp?: string;
  deviceId?: string;
  details?: Record<string, number | boolean | null>;
}

function categoryForEvent(eventType: string): string {
  return eventType.split(".")[0] || "general";
}

export function auditHubPayload(
  eventId: string,
  event: ForwardableAuditEvent,
  occurredAt = new Date(),
): { events: ForwardedEvent[] } {
  const actorId =
    event.userId ||
    (event.actorUsername
      ? createHash("sha256")
          .update(normalizeUsername(event.actorUsername))
          .digest("hex")
          .slice(0, 32)
      : undefined);
  const forwarded: ForwardedEvent = {
    clientEventId: eventId,
    occurredAt: occurredAt.toISOString(),
    action: event.eventType,
    category: categoryForEvent(event.eventType),
    outcome: event.outcome,
    details: event.metadata ?? {},
  };
  if (actorId) forwarded.actor = { id: actorId };
  if (event.ipAddress) forwarded.sourceIp = event.ipAddress.slice(0, 64);
  if (event.deviceId) forwarded.deviceId = event.deviceId.slice(0, 160);
  return { events: [forwarded] };
}

export function forwardAuditEvent(
  eventId: string,
  event: ForwardableAuditEvent,
  logger?: FastifyBaseLogger,
): void {
  const baseUrl = process.env.AUDIT_HUB_URL?.trim().replace(/\/+$/, "");
  const projectKey = process.env.AUDIT_HUB_PROJECT_KEY?.trim();
  if (!baseUrl || !projectKey) return;

  void fetch(`${baseUrl}/api/v1/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${projectKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(auditHubPayload(eventId, event)),
    signal: AbortSignal.timeout(2_500),
  })
    .then(async (response) => {
      if (!response.ok) {
        logger?.warn(
          { statusCode: response.status },
          "unified audit event delivery failed",
        );
      }
    })
    .catch((error: unknown) => {
      logger?.warn({ err: error }, "unified audit event delivery failed");
    });
}
