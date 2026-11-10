import pg from "pg";

const { Pool } = pg;

export type DatabasePool = pg.Pool;
export type DatabaseClient = pg.PoolClient;

const MIGRATION_LOCK_ID = 7_230_011;

const migrations = [
  {
    name: "001_initial",
    sql: `
      CREATE TABLE users (
        id UUID PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE devices (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        revoked_at TIMESTAMPTZ,
        PRIMARY KEY (user_id, id)
      );

      CREATE TABLE sessions (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        revoked_at TIMESTAMPTZ,
        FOREIGN KEY (user_id, device_id)
          REFERENCES devices(user_id, id)
          ON DELETE CASCADE
      );

      CREATE INDEX sessions_user_active_idx
        ON sessions (user_id, expires_at)
        WHERE revoked_at IS NULL;

      CREATE TABLE user_sync_counters (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        last_seq BIGINT NOT NULL DEFAULT 0
      );

      CREATE TABLE tasks (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id UUID NOT NULL,
        title TEXT NOT NULL,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        created_on DATE NOT NULL,
        created_timezone TEXT NOT NULL,
        due_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        status TEXT NOT NULL CHECK (status IN ('active', 'completed')),
        updated_at TIMESTAMPTZ NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        deleted_at TIMESTAMPTZ,
        last_modified_by TEXT NOT NULL,
        server_seq BIGINT NOT NULL,
        PRIMARY KEY (user_id, id)
      );

      CREATE INDEX tasks_user_sync_idx
        ON tasks (user_id, server_seq);

      CREATE TABLE task_mutations (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mutation_id UUID NOT NULL,
        device_id TEXT NOT NULL,
        task_id UUID NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        result_json JSONB NOT NULL,
        PRIMARY KEY (user_id, mutation_id)
      );

      ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
      ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
      CREATE POLICY tasks_owner_policy ON tasks
        USING (
          user_id = nullif(current_setting('app.user_id', true), '')::uuid
        )
        WITH CHECK (
          user_id = nullif(current_setting('app.user_id', true), '')::uuid
        );

      ALTER TABLE task_mutations ENABLE ROW LEVEL SECURITY;
      ALTER TABLE task_mutations FORCE ROW LEVEL SECURITY;
      CREATE POLICY task_mutations_owner_policy ON task_mutations
        USING (
          user_id = nullif(current_setting('app.user_id', true), '')::uuid
        )
        WITH CHECK (
          user_id = nullif(current_setting('app.user_id', true), '')::uuid
        );
    `,
  },
  {
    name: "002_app_role_grants",
    sql: `
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_roles WHERE rolname = 'qingji_app'
        ) THEN
          GRANT USAGE ON SCHEMA public TO qingji_app;
          GRANT SELECT, INSERT ON users TO qingji_app;
          GRANT SELECT, INSERT, UPDATE ON devices TO qingji_app;
          GRANT SELECT, INSERT, UPDATE ON sessions TO qingji_app;
          GRANT SELECT, INSERT, UPDATE ON user_sync_counters TO qingji_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON tasks TO qingji_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON task_mutations TO qingji_app;
        END IF;
      END
      $$;
    `,
  },
  {
    name: "003_username_login",
    sql: `
      ALTER TABLE users RENAME COLUMN email TO username;
    `,
  },
  {
    name: "004_audit_events",
    sql: `
      CREATE TABLE audit_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        device_id TEXT,
        actor_ref TEXT,
        event_type TEXT NOT NULL CHECK (
          event_type IN (
            'auth.register',
            'auth.login',
            'auth.login-failed',
            'auth.logout',
            'auth.rate-limited',
            'realtime.auth-failed',
            'sync.mutations',
            'sync.failed'
          )
        ),
        outcome TEXT NOT NULL CHECK (
          outcome IN ('success', 'failure', 'denied', 'partial')
        ),
        ip_address INET,
        user_agent TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX audit_events_created_at_idx
        ON audit_events (created_at DESC);
      CREATE INDEX audit_events_user_created_idx
        ON audit_events (user_id, created_at DESC);

      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_roles WHERE rolname = 'qingji_app'
        ) THEN
          GRANT INSERT ON audit_events TO qingji_app;
        END IF;
      END
      $$;
    `,
  },
  {
    name: "005_audit_append_only",
    sql: `
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_roles WHERE rolname = 'qingji_app'
        ) THEN
          REVOKE SELECT, UPDATE, DELETE, TRUNCATE ON audit_events
            FROM qingji_app;
          GRANT INSERT ON audit_events TO qingji_app;
        END IF;
      END
      $$;
    `,
  },
  {
    name: "006_task_notification_lead",
    sql: `
      ALTER TABLE tasks
        ADD COLUMN notification_lead_minutes INTEGER
        CHECK (
          notification_lead_minutes IS NULL
          OR notification_lead_minutes IN (-1, 0, 5, 15, 30, 60, 1440)
        );
    `,
  },
] as const;

export function createDatabasePool(databaseUrl: string): DatabasePool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 20_000,
  });
}

export async function runMigrations(pool: DatabasePool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    for (const migration of migrations) {
      const applied = await client.query(
        "SELECT 1 FROM schema_migrations WHERE name = $1",
        [migration.name],
      );
      if (applied.rowCount) continue;

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations (name) VALUES ($1)",
          [migration.name],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [
      MIGRATION_LOCK_ID,
    ]);
    client.release();
  }
}

export async function withUserTransaction<T>(
  pool: DatabasePool,
  userId: string,
  operation: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [
      userId,
    ]);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
