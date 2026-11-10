#!/bin/sh
set -eu

: "${QINGJI_APP_DB_PASSWORD:?QINGJI_APP_DB_PASSWORD must be set}"

psql \
  --set ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set app_password="$QINGJI_APP_DB_PASSWORD" <<'SQL'
SELECT format(
  'CREATE ROLE qingji_app LOGIN PASSWORD %L',
  :'app_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'qingji_app'
)
\gexec

SELECT format(
  'ALTER ROLE qingji_app WITH LOGIN PASSWORD %L',
  :'app_password'
);
\gexec

GRANT CONNECT ON DATABASE qingji TO qingji_app;
GRANT USAGE ON SCHEMA public TO qingji_app;

ALTER DEFAULT PRIVILEGES FOR ROLE qingji IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO qingji_app;
SQL
