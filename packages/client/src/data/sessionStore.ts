import type { SessionSecret } from "@qingji/contracts";

const WEB_SESSION_KEY = "qingji.session.v1";
const NATIVE_SESSION_KEY = "qingji.session.v1";
const SECURE_STORAGE_PREFIX = "qingji_";

function validateSession(value: unknown): SessionSecret | null {
  if (!value || typeof value !== "object") return null;
  const session = value as Partial<SessionSecret> & { email?: unknown };
  const username =
    typeof session.username === "string"
      ? session.username
      : typeof session.email === "string"
        ? session.email
        : null;
  if (
    typeof session.token !== "string" ||
    typeof session.serverUrl !== "string" ||
    typeof session.userId !== "string" ||
    !username ||
    typeof session.expiresAt !== "string"
  ) {
    return null;
  }
  return {
    token: session.token,
    serverUrl: session.serverUrl,
    userId: session.userId,
    username,
    expiresAt: session.expiresAt,
  };
}

async function isNativePlatform(): Promise<boolean> {
  const { Capacitor } = await import("@capacitor/core");
  return Capacitor.isNativePlatform();
}

let secureStorageReady: Promise<void> | undefined;

function prepareSecureStorage(): Promise<void> {
  secureStorageReady ??= (async () => {
    const { SecureStorage } = await import(
      "@aparajita/capacitor-secure-storage"
    );
    await SecureStorage.setKeyPrefix(SECURE_STORAGE_PREFIX);
  })();
  return secureStorageReady;
}

async function withSecureStorage<T>(
  operation: (
    storage: typeof import("@aparajita/capacitor-secure-storage").SecureStorage,
  ) => Promise<T>,
): Promise<T> {
  await prepareSecureStorage();
  const { SecureStorage } = await import(
    "@aparajita/capacitor-secure-storage"
  );
  return operation(SecureStorage);
}

export async function readSession(): Promise<SessionSecret | null> {
  if (window.qingjiDesktop) {
    return validateSession(await window.qingjiDesktop.readSession());
  }

  if (await isNativePlatform()) {
    const raw = await withSecureStorage((storage) =>
      storage.getItem(NATIVE_SESSION_KEY),
    );
    if (!raw) return null;
    try {
      return validateSession(JSON.parse(raw));
    } catch {
      await withSecureStorage((storage) =>
        storage.removeItem(NATIVE_SESSION_KEY),
      );
      return null;
    }
  }

  const raw = sessionStorage.getItem(WEB_SESSION_KEY);
  if (!raw) return null;
  try {
    return validateSession(JSON.parse(raw));
  } catch {
    sessionStorage.removeItem(WEB_SESSION_KEY);
    return null;
  }
}

export async function writeSession(session: SessionSecret): Promise<void> {
  const validated = validateSession(session);
  if (!validated) throw new Error("INVALID_SESSION");

  if (window.qingjiDesktop) {
    await window.qingjiDesktop.writeSession(validated);
    return;
  }

  if (await isNativePlatform()) {
    await withSecureStorage((storage) =>
      storage.setItem(NATIVE_SESSION_KEY, JSON.stringify(validated)),
    );
    return;
  }

  sessionStorage.setItem(WEB_SESSION_KEY, JSON.stringify(validated));
}

export async function clearStoredSession(): Promise<void> {
  if (window.qingjiDesktop) {
    await window.qingjiDesktop.clearSession();
    return;
  }

  if (await isNativePlatform()) {
    await withSecureStorage((storage) =>
      storage.removeItem(NATIVE_SESSION_KEY),
    );
    return;
  }

  sessionStorage.removeItem(WEB_SESSION_KEY);
}
