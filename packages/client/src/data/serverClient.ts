import type {
  AuthRequest,
  AuthResponse,
  AuthUser,
  SyncRequest,
  SyncResponse,
} from "@qingji/contracts";
import { notifyRelease } from "../updateService";

export class ServerRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ServerRequestError";
  }
}

export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("请输入服务器地址");

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("服务器地址格式无效");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("服务器地址必须使用 http:// 或 https://");
  }
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (
    parsed.protocol === "http:" &&
    !loopbackHosts.has(parsed.hostname.toLowerCase())
  ) {
    throw new Error("局域网或公网服务器必须使用 HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new Error("服务器地址不能包含用户名或密码");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("服务器地址不能包含查询参数或片段");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

export function isLoopbackServerUrl(input: string): boolean {
  try {
    const hostname = new URL(input.trim()).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

async function requestJson<T>(
  serverUrl: string,
  path: string,
  init: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${serverUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new ServerRequestError(
      timedOut
        ? "连接服务器超时，请检查服务器地址和网络"
        : "无法连接服务器，请确认服务已启动、地址可访问且 HTTPS 证书有效",
      0,
      "NETWORK_ERROR",
    );
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // A non-JSON response is reported with the HTTP status below.
  }
  if (!response.ok) {
    const body =
      payload && typeof payload === "object"
        ? (payload as { message?: unknown; code?: unknown })
        : {};
    throw new ServerRequestError(
      typeof body.message === "string"
        ? body.message
        : `服务器请求失败（${response.status}）`,
      response.status,
      typeof body.code === "string" ? body.code : undefined,
    );
  }
  return payload as T;
}

export async function registerAccount(
  serverUrl: string,
  input: AuthRequest,
): Promise<AuthResponse> {
  return requestJson<AuthResponse>(serverUrl, "/v1/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function loginAccount(
  serverUrl: string,
  input: AuthRequest,
): Promise<AuthResponse> {
  return requestJson<AuthResponse>(serverUrl, "/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function fetchCurrentUser(
  serverUrl: string,
  token: string,
): Promise<AuthUser> {
  const response = await requestJson<{ user: AuthUser }>(
    serverUrl,
    "/v1/auth/me",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  return response.user;
}

export async function logoutFromServer(
  serverUrl: string,
  token: string,
): Promise<void> {
  await requestJson<{ ok: true }>(serverUrl, "/v1/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: "{}",
  });
}

export async function pushAndPullSync(
  serverUrl: string,
  token: string,
  request: SyncRequest,
): Promise<SyncResponse> {
  return requestJson<SyncResponse>(serverUrl, "/v1/sync", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(request),
  });
}

interface SyncSocketOptions {
  serverUrl: string;
  token: string;
  onSyncAvailable(): void;
  onStatus?(status: "connecting" | "connected" | "offline"): void;
}

export function openSyncSocket(options: SyncSocketOptions): () => void {
  let closed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | undefined;
  let retry = 0;

  const connect = () => {
    if (closed) return;
    options.onStatus?.("connecting");
    const url = new URL(options.serverUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/sync/live`;
    url.search = "";
    url.hash = "";

    socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      retry = 0;
      options.onStatus?.("connected");
      socket?.send(
        JSON.stringify({
          type: "authenticate",
          token: options.token,
        }),
      );
    });
    socket.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(String(event.data)) as {
          type?: string;
          release?: unknown;
        };
        if (data.type === "sync-available") options.onSyncAvailable();
        if (
          data.type === "app-update-available" &&
          data.release &&
          typeof data.release === "object"
        ) {
          const release = data.release as {
            latestVersion?: unknown;
            releaseUrl?: unknown;
            notes?: unknown;
          };
          if (
            typeof release.latestVersion === "string" &&
            typeof release.releaseUrl === "string"
          ) {
            notifyRelease({
              latestVersion: release.latestVersion,
              releaseUrl: release.releaseUrl,
              notes:
                typeof release.notes === "string"
                  ? release.notes
                  : undefined,
            });
          }
        }
      } catch {
        // Ignore malformed realtime messages and keep the socket alive.
      }
    });
    socket.addEventListener("close", () => {
      socket = null;
      options.onStatus?.("offline");
      if (closed) return;
      retry += 1;
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(retry, 5));
      reconnectTimer = window.setTimeout(connect, delay);
    });
    socket.addEventListener("error", () => {
      socket?.close();
    });
  };

  connect();
  return () => {
    closed = true;
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    socket?.close();
  };
}
