import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isLoopbackServerUrl,
  normalizeServerUrl,
  resetAccountPassword,
} from "./serverClient";

describe("server address privacy rules", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("permits loopback development and HTTPS servers", () => {
    expect(normalizeServerUrl("http://127.0.0.1:8787/")).toBe(
      "http://127.0.0.1:8787",
    );
    expect(normalizeServerUrl("https://qingji.example.com/")).toBe(
      "https://qingji.example.com",
    );
  });

  it("rejects plaintext credentials for remote servers", () => {
    expect(() => normalizeServerUrl("http://192.168.1.5:8787")).toThrow(
      "必须使用 HTTPS",
    );
    expect(() =>
      normalizeServerUrl("http://qingji.example.com"),
    ).toThrow("必须使用 HTTPS");
  });

  it("identifies local server addresses and their platform-specific meaning", () => {
    expect(isLoopbackServerUrl("http://127.0.0.1:8787")).toBe(true);
    expect(isLoopbackServerUrl("https://localhost/qingji-api")).toBe(true);
    expect(isLoopbackServerUrl("https://203.0.113.10/qingji-api")).toBe(
      false,
    );
  });

  it("sends authenticated password reset requests", async () => {
    const fetchMock = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) =>
      new Response(JSON.stringify({ ok: true, revokedSessions: 2 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resetAccountPassword("https://qingji.example.com", "session-token", {
        currentPassword: "old-password",
        newPassword: "new-password",
      }),
    ).resolves.toEqual({ ok: true, revokedSessions: 2 });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://qingji.example.com/v1/auth/password/reset",
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer session-token",
      }),
    });
  });
});
