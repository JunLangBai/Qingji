import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(".env");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const { buildApp } = await import("./app.js");
const { app } = await buildApp();
const port = Number(process.env.PORT ?? 8787);

await app.listen({
  port,
  host: process.env.HOST ?? "0.0.0.0",
});
