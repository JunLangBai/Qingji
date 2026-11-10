import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppReleaseInfo } from "@qingji/contracts";
import { recordAuditEvent } from "./audit.js";
import { safeErrorDetails } from "./logging.js";
import {
  authenticateToken,
  AuthError,
  registerAuthRoutes,
} from "./auth.js";
import {
  createDatabasePool,
  runMigrations,
  type DatabasePool,
} from "./db.js";
import { LiveHub, type LiveSocket } from "./live.js";
import { registerSyncRoutes } from "./sync.js";
import {
  createTaskFieldCipher,
  encryptExistingTaskFields,
} from "./taskCrypto.js";
import { encryptLegacyMutationResults } from "./taskMutationResults.js";
import {
  createReleaseDiscovery,
  readConfiguredRelease,
  registerUpdateRoutes,
} from "./updates.js";

export interface BuildAppOptions {
  databaseUrl?: string;
  databaseAdminUrl?: string;
  logger?: boolean;
  corsOrigin?: string;
  taskDataEncryptionKey?: string;
  appRelease?: AppReleaseInfo | null;
}

export interface QingjiServer {
  app: FastifyInstance;
  pool: DatabasePool | null;
}

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<QingjiServer> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  const pool = databaseUrl ? createDatabasePool(databaseUrl) : null;
  const app = Fastify({
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
    logger:
      options.logger === false
        ? false
        : {
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                "res.headers.set-cookie",
              ],
              censor: "[redacted]",
            },
          },
  });
  const liveHub = new LiveHub();
  const corsOrigin = options.corsOrigin ?? process.env.CORS_ORIGIN;
  const allowedOrigins = corsOrigin
    ? corsOrigin
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    : [
        "null",
        "https://localhost",
        "capacitor://localhost",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
      ];

  await app.register(cors, {
    origin: allowedOrigins,
  });
  await app.register(websocket, {
    options: {
      maxPayload: 2 * 1024 * 1024,
    },
  });
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    if (request.url.startsWith("/v1/")) {
      reply.header("Cache-Control", "no-store");
    }
    return payload;
  });
  const configuredRelease =
    options.appRelease === undefined
      ? readConfiguredRelease()
      : options.appRelease;
  const releaseDiscovery =
    options.appRelease === undefined && !configuredRelease
      ? createReleaseDiscovery()
      : undefined;

  app.get("/health", async () => {
    if (!pool) {
      return {
        status: "ok",
        database: "not-configured",
        service: "qingji-server",
        time: new Date().toISOString(),
      };
    }

    await pool.query("select 1");
    return {
      status: "ok",
      database: "connected",
      service: "qingji-server",
      time: new Date().toISOString(),
    };
  });

  app.get("/v1/meta", async () => ({
    product: "清记",
    apiVersion: "v1",
    syncProtocolVersion: 1,
    capabilities: {
      accounts: Boolean(pool),
      realtimeSync: Boolean(pool),
      backupExport: true,
      appUpdates: Boolean(configuredRelease || releaseDiscovery),
      auditLog: Boolean(pool),
      encryptedTaskFields:
        Boolean(process.env.TASK_DATA_ENCRYPTION_KEY) ||
        process.env.NODE_ENV !== "production",
    },
  }));

  await registerUpdateRoutes(
    app,
    configuredRelease,
    releaseDiscovery,
  );

  if (pool) {
    const cipher = createTaskFieldCipher({
      secret: options.taskDataEncryptionKey,
    });
    const adminUrl =
      options.databaseAdminUrl ?? process.env.DATABASE_ADMIN_URL;
    const adminPool = adminUrl ? createDatabasePool(adminUrl) : pool;
    try {
      await runMigrations(adminPool);
      await encryptExistingTaskFields(adminPool, cipher);
      await encryptLegacyMutationResults(adminPool, cipher);
    } finally {
      if (adminPool !== pool) await adminPool.end();
    }
    await registerAuthRoutes(app, pool);
    await registerSyncRoutes(app, pool, liveHub, cipher);

    app.get("/v1/sync/live", { websocket: true }, (socket, request) => {
      let userId: string | null = null;
      const liveSocket = socket as unknown as LiveSocket;
      const timeout = setTimeout(() => {
        if (!userId) socket.close(4401, "authentication timeout");
      }, 5_000);

      socket.on("message", async (raw: unknown) => {
        if (userId) return;
        try {
          const message = JSON.parse(String(raw)) as {
            type?: string;
            token?: string;
          };
          if (
            message.type !== "authenticate" ||
            typeof message.token !== "string"
          ) {
            socket.close(4401, "authentication required");
            return;
          }
          const session = await authenticateToken(message.token, pool);
          clearTimeout(timeout);
          userId = session.userId;
          liveHub.add(userId, liveSocket);
          socket.send(JSON.stringify({ type: "authenticated" }));
          const availableRelease =
            configuredRelease ??
            (await releaseDiscovery?.().catch(() => null));
          if (availableRelease) {
            socket.send(
              JSON.stringify({
                type: "app-update-available",
                release: availableRelease,
              }),
            );
          }
        } catch (error) {
          if (error instanceof AuthError) {
            await recordAuditEvent(
              pool,
              {
                eventType: "realtime.auth-failed",
                outcome: "denied",
                ipAddress: request.ip,
                userAgent: request.headers["user-agent"],
              },
              request.log,
            );
            socket.close(4401, "authentication failed");
            return;
          }
          request.log.warn(
            { err: safeErrorDetails(error) },
            "realtime authentication failed",
          );
          socket.close(1011, "authentication error");
        }
      });

      socket.on("close", () => {
        clearTimeout(timeout);
        if (userId) liveHub.remove(userId, liveSocket);
      });
    });
  }

  app.addHook("onClose", async () => {
    await pool?.end();
  });

  return { app, pool };
}
