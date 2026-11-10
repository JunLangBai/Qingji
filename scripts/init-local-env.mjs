import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootExamplePath = resolve(root, ".env.example");
const serverExamplePath = resolve(root, "services/server/.env.example");
const rootTargetPath = resolve(root, ".env");
const serverTargetPath = resolve(root, "services/server/.env");

if (existsSync(rootTargetPath) || existsSync(serverTargetPath)) {
  console.error(
    "Local environment files already exist. Move or remove both before regenerating them.",
  );
  process.exit(1);
}

const adminPassword = randomBytes(32).toString("base64url");
const appPassword = randomBytes(32).toString("base64url");

function render(templatePath) {
  return readFileSync(templatePath, "utf8")
    .replaceAll("__POSTGRES_ADMIN_PASSWORD__", adminPassword)
    .replaceAll("__QINGJI_APP_DB_PASSWORD__", appPassword);
}

function writePrivateFile(path, contents) {
  writeFileSync(path, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
  if (process.platform !== "win32") {
    chmodSync(path, 0o600);
  }
}

try {
  writePrivateFile(rootTargetPath, render(rootExamplePath));
  writePrivateFile(serverTargetPath, render(serverExamplePath));
} catch (error) {
  console.error("Unable to create local environment files.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

console.log("Created ignored local environment files:");
console.log("- .env");
console.log("- services/server/.env");
