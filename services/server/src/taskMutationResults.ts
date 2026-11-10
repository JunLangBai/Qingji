import type { SyncMutationResult } from "@qingji/contracts";
import type { DatabasePool } from "./db.js";
import type { TaskFieldCipher } from "./taskCrypto.js";

const MIGRATION_BATCH_SIZE = 500;

interface StoredMutationResultRow {
  user_id: string;
  mutation_id: string;
  result_json: unknown;
}

function decodeJson(value: string): SyncMutationResult {
  const parsed = JSON.parse(value) as unknown;
  return validateMutationResult(parsed);
}

function validateMutationResult(value: unknown): SyncMutationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_MUTATION_RESULT");
  }
  const result = value as Partial<SyncMutationResult>;
  if (
    typeof result.mutationId !== "string" ||
    (result.status !== "applied" &&
      result.status !== "conflict" &&
      result.status !== "rejected")
  ) {
    throw new Error("INVALID_MUTATION_RESULT");
  }
  return value as SyncMutationResult;
}

export function encodeMutationResult(
  result: SyncMutationResult,
  cipher: TaskFieldCipher,
): string {
  return cipher.encryptText(JSON.stringify(result));
}

export function readMutationResult(
  value: unknown,
  cipher: TaskFieldCipher,
): SyncMutationResult {
  if (typeof value === "string") {
    return decodeJson(cipher.decryptText(value));
  }
  return validateMutationResult(value);
}

export async function encryptLegacyMutationResults(
  pool: DatabasePool,
  cipher: TaskFieldCipher,
): Promise<number> {
  let migrated = 0;

  while (true) {
    const rows = await pool.query<StoredMutationResultRow>(
      `SELECT user_id, mutation_id, result_json
       FROM task_mutations
       WHERE jsonb_typeof(result_json) <> 'string'
          OR left(result_json #>> '{}', 7) <> 'enc:v1:'
       ORDER BY applied_at
       LIMIT $1`,
      [MIGRATION_BATCH_SIZE],
    );
    if (rows.rowCount === 0) break;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const row of rows.rows) {
        const encrypted = encodeMutationResult(
          readMutationResult(row.result_json, cipher),
          cipher,
        );
        await client.query(
          `UPDATE task_mutations
           SET result_json = to_jsonb($3::text)
           WHERE user_id = $1 AND mutation_id = $2`,
          [row.user_id, row.mutation_id, encrypted],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    migrated += rows.rowCount ?? 0;
    if ((rows.rowCount ?? 0) < MIGRATION_BATCH_SIZE) break;
  }

  return migrated;
}
