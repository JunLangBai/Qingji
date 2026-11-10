import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { DatabasePool } from "./db.js";

const FIELD_PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface TaskFieldCipher {
  encryptText(value: string): string;
  encryptNullableText(value: string | null): string | null;
  decryptText(value: string): string;
  decryptNullableText(value: string | null): string | null;
  isEncrypted(value: string): boolean;
}

function decodeKey(secret: string): Buffer {
  const decoded = Buffer.from(secret, "base64");
  if (decoded.length !== 32) {
    throw new Error(
      "TASK_DATA_ENCRYPTION_KEY must be a base64 encoded 32-byte key",
    );
  }
  return decoded;
}

function developmentKey(): Buffer {
  return createHash("sha256")
    .update("qingji-development-task-field-key-v1")
    .digest();
}

export function createTaskFieldCipher(options: {
  secret?: string;
  production?: boolean;
} = {}): TaskFieldCipher {
  const secret =
    options.secret ?? process.env.TASK_DATA_ENCRYPTION_KEY;
  const production =
    options.production ?? process.env.NODE_ENV === "production";
  if (!secret && production) {
    throw new Error(
      "TASK_DATA_ENCRYPTION_KEY is required in production",
    );
  }
  const key = secret ? decodeKey(secret) : developmentKey();

  return {
    encryptText(value) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      return `${FIELD_PREFIX}${Buffer.concat([iv, tag, encrypted]).toString(
        "base64url",
      )}`;
    },
    encryptNullableText(value) {
      return value === null ? null : this.encryptText(value);
    },
    decryptText(value) {
      if (!value.startsWith(FIELD_PREFIX)) return value;
      try {
        const payload = Buffer.from(value.slice(FIELD_PREFIX.length), "base64url");
        if (payload.length <= IV_BYTES + TAG_BYTES) {
          throw new Error("payload too short");
        }
        const iv = payload.subarray(0, IV_BYTES);
        const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
        const encrypted = payload.subarray(IV_BYTES + TAG_BYTES);
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([
          decipher.update(encrypted),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        throw new Error("TASK_FIELD_DECRYPTION_FAILED");
      }
    },
    decryptNullableText(value) {
      return value === null ? null : this.decryptText(value);
    },
    isEncrypted(value) {
      return value.startsWith(FIELD_PREFIX);
    },
  };
}

export async function encryptExistingTaskFields(
  pool: DatabasePool,
  cipher: TaskFieldCipher,
): Promise<number> {
  const rows = await pool.query<{
    user_id: string;
    id: string;
    title: string;
    note: string | null;
  }>(
    `SELECT user_id, id, title, note
     FROM tasks
     WHERE title NOT LIKE 'enc:v1:%'
        OR (note IS NOT NULL AND note NOT LIKE 'enc:v1:%')`,
  );
  if (rows.rowCount === 0) return 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of rows.rows) {
      await client.query(
        `UPDATE tasks
         SET title = $3, note = $4
         WHERE user_id = $1 AND id = $2`,
        [
          row.user_id,
          row.id,
          cipher.isEncrypted(row.title)
            ? row.title
            : cipher.encryptText(row.title),
          cipher.decryptNullableText(row.note) === null
            ? null
            : cipher.isEncrypted(row.note!)
              ? row.note
              : cipher.encryptText(row.note!),
        ],
      );
    }
    await client.query("COMMIT");
    return rows.rowCount ?? 0;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
