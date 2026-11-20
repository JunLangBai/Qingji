import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("public app routes", () => {
  it("rejects untrusted CORS origins and exposes update metadata", async () => {
    const { app } = await buildApp({
      logger: false,
      corsOrigin: "https://allowed.example",
      appRelease: {
        latestVersion: "0.2.0",
        releaseUrl: "https://github.com/example/qingji/releases/tag/v0.2.0",
      },
      updateFetcher: async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": "3",
          },
        }),
    });
    try {
      const blocked = await app.inject({
        method: "OPTIONS",
        url: "/v1/sync",
        headers: {
          origin: "https://untrusted.example",
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,content-type",
        },
      });
      expect(
        blocked.headers["access-control-allow-origin"],
      ).toBeUndefined();

      const nativePreflight = await app.inject({
        method: "OPTIONS",
        url: "/v1/sync",
        headers: {
          origin: "https://allowed.example",
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,content-type",
        },
      });
      expect(
        nativePreflight.headers["access-control-allow-origin"],
      ).toBe("https://allowed.example");

      const update = await app.inject({
        method: "GET",
        url: "/v1/update?platform=windows&currentVersion=0.1.0",
      });
      expect(update.statusCode).toBe(200);
      expect(update.headers["cache-control"]).toBe("no-store");
      expect(update.headers["x-content-type-options"]).toBe("nosniff");
      expect(update.json()).toMatchObject({
        available: true,
        latestVersion: "0.2.0",
        downloadUrl: "v1/update/download?platform=windows",
      });

      const download = await app.inject({
        method: "GET",
        url: "/v1/update/download?platform=windows",
      });
      expect(download.statusCode).toBe(200);
      expect(download.headers["content-type"]).toBe(
        "application/octet-stream",
      );
      expect(download.headers["content-disposition"]).toContain(
        "Qingji-0.2.0-Windows-Setup-x64.exe",
      );
      expect([...download.rawPayload]).toEqual([1, 2, 3]);

      const invalidPlatform = await app.inject({
        method: "GET",
        url: "/v1/update/download?platform=linux",
      });
      expect(invalidPlatform.statusCode).toBe(400);
      expect(invalidPlatform.json()).toMatchObject({
        code: "INVALID_PLATFORM",
      });
    } finally {
      await app.close();
    }
  });
});
