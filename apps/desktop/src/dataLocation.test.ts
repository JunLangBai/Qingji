import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  createUserDataFolderName,
  findBestLegacyDataDirectory,
  resolveUserDataLocation,
} from "./dataLocation";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "qingji-data-location-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function writeProfileDatabase(
  directory: string,
  updatedAt: string,
  rows = 1,
): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "Local State"), "{}");
  const database = new DatabaseSync(path.join(directory, "qingji.sqlite"));
  try {
    database.exec(`
      CREATE TABLE local_profiles (
        owner_key TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        profile_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    for (let index = 0; index < rows; index += 1) {
      database
        .prepare(
          `INSERT INTO local_profiles
             (owner_key, version, profile_json, updated_at)
           VALUES (?, 1, ?, ?)`,
        )
        .run(`owner-${index}`, `profile-${index}`, updatedAt);
    }
  } finally {
    database.close();
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("desktop data location", () => {
  it("creates a stable per-user folder name", () => {
    expect(createUserDataFolderName("an", "DESKTOP")).toBe(
      createUserDataFolderName("AN", "desktop"),
    );
    expect(createUserDataFolderName("an", "DESKTOP")).toMatch(
      /^an-[a-f0-9]{10}$/,
    );
  });

  it("selects and migrates the newest legacy data directory", () => {
    const root = temporaryDirectory();
    const executablePath = path.join(
      root,
      "Qingji",
      "@qingjidesktop",
      "清记.exe",
    );
    const legacyUserData = path.join(root, "AppData", "@qingji", "desktop");
    const localAppData = path.join(root, "LocalAppData");
    const userFolder = createUserDataFolderName("an", "DESKTOP");
    const nestedData = path.join(
      path.dirname(executablePath),
      "data",
      userFolder,
    );
    const previousInstallData = path.join(
      root,
      "Qingji",
      "data",
      userFolder,
    );
    const stableRoot = path.join(root, "StableQingjiData");
    writeProfileDatabase(nestedData, "2026-11-09T14:27:09.562Z");
    writeProfileDatabase(previousInstallData, "2026-11-10T14:51:44.400Z", 2);
    writeProfileDatabase(legacyUserData, "2026-11-09T19:10:34.388Z");

    const options = {
      executablePath,
      legacyUserData,
      localAppData,
      username: "an",
      userDomain: "DESKTOP",
      defaultDataRoot: stableRoot,
    };
    expect(findBestLegacyDataDirectory(options, userFolder, stableRoot)).toBe(
      previousInstallData,
    );

    const resolved = resolveUserDataLocation(options);
    expect(resolved.migratedFrom).toBe(previousInstallData);
    expect(resolved.userDataPath).toBe(path.join(stableRoot, userFolder));
    expect(
      fs.existsSync(path.join(resolved.userDataPath, "qingji.sqlite")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(previousInstallData, "qingji.sqlite")),
    ).toBe(true);
  });

  it("reuses the persisted location after the executable moves", () => {
    const root = temporaryDirectory();
    const localAppData = path.join(root, "LocalAppData");
    const firstExecutable = path.join(root, "First", "清记.exe");
    const secondExecutable = path.join(root, "Second", "清记.exe");
    const firstRoot = path.join(root, "FirstData");
    const secondRoot = path.join(root, "SecondData");
    const first = resolveUserDataLocation({
      executablePath: firstExecutable,
      legacyUserData: path.join(root, "legacy"),
      localAppData,
      username: "an",
      userDomain: "DESKTOP",
      defaultDataRoot: firstRoot,
    });
    fs.writeFileSync(
      path.join(first.userDataPath, "marker.txt"),
      "preserved",
    );

    const second = resolveUserDataLocation({
      executablePath: secondExecutable,
      legacyUserData: path.join(root, "legacy"),
      localAppData,
      username: "an",
      userDomain: "DESKTOP",
      defaultDataRoot: secondRoot,
    });

    expect(second.userDataPath).toBe(first.userDataPath);
    expect(
      fs.readFileSync(path.join(second.userDataPath, "marker.txt"), "utf8"),
    ).toBe("preserved");
  });
});
