import { describe, expect, it } from "vitest";
import { createTaskFieldCipher } from "./taskCrypto.js";

const key = Buffer.alloc(32, 7).toString("base64");

describe("task field encryption", () => {
  it("round-trips private task text with authenticated encryption", () => {
    const cipher = createTaskFieldCipher({ secret: key, production: true });
    const encrypted = cipher.encryptText("不能出现在数据库明文中的备忘录");
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain("备忘录");
    expect(cipher.decryptText(encrypted)).toBe(
      "不能出现在数据库明文中的备忘录",
    );
    expect(cipher.encryptText("同一内容两次加密")).not.toBe(
      cipher.encryptText("同一内容两次加密"),
    );
  });

  it("keeps legacy plaintext readable while new writes are encrypted", () => {
    const cipher = createTaskFieldCipher({ secret: key, production: true });
    expect(cipher.decryptText("旧版明文标题")).toBe("旧版明文标题");
    expect(cipher.decryptNullableText(null)).toBeNull();
  });

  it("requires an explicit key in production", () => {
    expect(() =>
      createTaskFieldCipher({ secret: "", production: true }),
    ).toThrow("TASK_DATA_ENCRYPTION_KEY is required");
  });
});
