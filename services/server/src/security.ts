import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;

export function normalizeUsername(username: string): string {
  return username.trim().normalize("NFKC").toLowerCase();
}

export function isValidUsername(username: string): boolean {
  return (
    username.length >= 2 &&
    username.length <= 32 &&
    /^[\p{L}\p{N}_.@-]+$/u.test(username)
  );
}

export function validatePassword(password: unknown): string {
  if (typeof password !== "string" || password.length < 10) {
    throw new Error("密码至少需要 10 位");
  }
  if (password.length > 128) {
    throw new Error("密码不能超过 128 位");
  }
  return password;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(
    password,
    salt,
    PASSWORD_KEY_LENGTH,
  )) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [algorithm, saltValue, hashValue] = storedHash.split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  const salt = Buffer.from(saltValue, "base64url");
  const expected = Buffer.from(hashValue, "base64url");
  const actual = (await scrypt(
    password,
    salt,
    expected.length,
  )) as Buffer;
  return (
    expected.length === actual.length &&
    timingSafeEqual(expected, actual)
  );
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
