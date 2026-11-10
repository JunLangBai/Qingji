import { describe, expect, it } from "vitest";
import {
  defaultSettings,
  resetPreferenceSettings,
} from "./settingsStore";

describe("settings reset", () => {
  it("uses safe notification and startup defaults", () => {
    expect(defaultSettings.defaultLeadMinutes).toBe(15);
    expect(defaultSettings.dueNotificationsEnabled).toBe(true);
    expect(defaultSettings.dailySummaryEnabled).toBe(true);
    expect(defaultSettings.dailySummaryTime).toBe("20:00");
    expect(defaultSettings.quietHoursEnabled).toBe(false);
    expect(defaultSettings.autoStart).toBe(false);
  });

  it("restores preferences without changing account connection fields", () => {
    const current = {
      ...defaultSettings,
      theme: "dark" as const,
      fontScale: 1.35,
      completionMode: "hold" as const,
      completionCelebration: false,
      stickyAnimations: false,
      syncServerUrl: "https://qingji.example.com",
      syncUsername: "account-user",
    };

    expect(resetPreferenceSettings(current)).toEqual({
      ...defaultSettings,
      syncServerUrl: current.syncServerUrl,
      syncUsername: current.syncUsername,
    });
  });
});
