import { describe, expect, it } from "vitest";
import {
  isLoopbackServerUrl,
  normalizeServerUrl,
} from "./serverClient";

describe("server address privacy rules", () => {
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
});
