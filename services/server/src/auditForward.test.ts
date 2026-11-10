import { afterEach, describe, expect, it, vi } from "vitest";
import {
  auditHubPayload,
  forwardAuditEvent,
} from "./auditForward.js";

const originalUrl = process.env.AUDIT_HUB_URL;
const originalKey = process.env.AUDIT_HUB_PROJECT_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalUrl === undefined) delete process.env.AUDIT_HUB_URL;
  else process.env.AUDIT_HUB_URL = originalUrl;
  if (originalKey === undefined) delete process.env.AUDIT_HUB_PROJECT_KEY;
  else process.env.AUDIT_HUB_PROJECT_KEY = originalKey;
});

describe("unified audit forwarding", () => {
  it("maps Qingji audit fields to the hub event contract", () => {
    const payload = auditHubPayload(
      "event-1",
      {
        eventType: "auth.login-failed",
        outcome: "denied",
        actorUsername: "Tester",
        ipAddress: "203.0.113.10",
        deviceId: "device-1",
        metadata: { attempt: 2 },
      },
      new Date("2026-11-10T08:00:00.000Z"),
    );

    expect(payload.events[0]).toMatchObject({
      clientEventId: "event-1",
      occurredAt: "2026-11-10T08:00:00.000Z",
      action: "auth.login-failed",
      category: "auth",
      outcome: "denied",
      sourceIp: "203.0.113.10",
      deviceId: "device-1",
      details: { attempt: 2 },
    });
    expect(payload.events[0]?.actor?.id).toHaveLength(32);
  });

  it("does not call the audit hub when it is not configured", () => {
    delete process.env.AUDIT_HUB_URL;
    delete process.env.AUDIT_HUB_PROJECT_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    forwardAuditEvent("event-2", {
      eventType: "sync.mutations",
      outcome: "success",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts with a project-scoped bearer token", async () => {
    process.env.AUDIT_HUB_URL = "http://audit.test/";
    process.env.AUDIT_HUB_PROJECT_KEY = "project-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accepted: 1 }), { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    forwardAuditEvent("event-3", {
      eventType: "sync.failed",
      outcome: "failure",
      userId: "user-1",
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://audit.test/api/v1/events");
    expect(options.headers.Authorization).toBe("Bearer project-key");
    const payload = JSON.parse(options.body);
    expect(payload.events[0].actor.id).toBe("user-1");
  });
});
