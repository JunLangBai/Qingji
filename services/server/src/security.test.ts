import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  isValidUsername,
  normalizeUsername,
  validatePassword,
  verifyPassword,
} from "./security.js";

describe("account security", () => {
  it("hashes passwords with a unique salt and verifies safely", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");
    expect(first).not.toBe(second);
    await expect(
      verifyPassword("correct horse battery staple", first),
    ).resolves.toBe(true);
    await expect(verifyPassword("wrong password", first)).resolves.toBe(
      false,
    );
  });

  it("normalizes usernames and enforces minimum account rules", () => {
    expect(normalizeUsername("  UserName ")).toBe("username");
    expect(normalizeUsername("  清记用户  ")).toBe("清记用户");
    expect(isValidUsername("user_name")).toBe(true);
    expect(isValidUsername("清记用户")).toBe(true);
    expect(isValidUsername("not valid")).toBe(false);
    expect(() => validatePassword("short")).toThrow("至少需要 10 位");
  });

  it("stores only a stable hash of each random session token", () => {
    const first = createSessionToken();
    const second = createSessionToken();
    expect(first).not.toBe(second);
    expect(hashSessionToken(first)).toBe(hashSessionToken(first));
    expect(hashSessionToken(first)).not.toBe(hashSessionToken(second));
  });

});
