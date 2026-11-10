import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const localEnvPath = fileURLToPath(
  new URL("../services/server/.env", import.meta.url),
);

if (existsSync(localEnvPath)) {
  loadEnvFile(localEnvPath);
}

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const testDatabaseAdminUrl =
  process.env.TEST_DATABASE_ADMIN_URL ?? process.env.DATABASE_ADMIN_URL;

if (!testDatabaseUrl || !testDatabaseAdminUrl) {
  console.error(
    "Integration tests require TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL, or DATABASE_URL and DATABASE_ADMIN_URL in services/server/.env.",
  );
  process.exit(1);
}

const env = {
  ...process.env,
  TEST_DATABASE_URL: testDatabaseUrl,
  TEST_DATABASE_ADMIN_URL: testDatabaseAdminUrl,
};

const npmCli = process.env.npm_execpath;
const result = spawnSync(
  process.execPath,
  [...(npmCli ? [npmCli] : []), "run", "test", "-w", "@qingji/server"],
  {
    env,
    stdio: "inherit",
  },
);

if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
