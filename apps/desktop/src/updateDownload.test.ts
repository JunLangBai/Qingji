import { describe, expect, it } from "vitest";
import { isAllowedUpdateDownloadUrl } from "./updateDownload";

describe("update download URL validation", () => {
  it("accepts HTTPS update endpoints and local development", () => {
    expect(
      isAllowedUpdateDownloadUrl(
        "https://updates.example/qingji-api/v1/update/download?platform=windows",
      ),
    ).toBe(true);
    expect(
      isAllowedUpdateDownloadUrl(
        "http://127.0.0.1:8787/v1/update/download?platform=android",
      ),
    ).toBe(true);
  });

  it("rejects remote HTTP, unrelated paths, and credentials", () => {
    expect(
      isAllowedUpdateDownloadUrl(
        "http://updates.example/v1/update/download",
      ),
    ).toBe(false);
    expect(
      isAllowedUpdateDownloadUrl(
        "https://updates.example/not-an-update",
      ),
    ).toBe(false);
    expect(
      isAllowedUpdateDownloadUrl(
        "https://user:secret@updates.example/v1/update/download",
      ),
    ).toBe(false);
  });
});
