import { useCallback, useEffect, useState } from "react";
import type { AppReleaseInfo } from "@qingji/contracts";
import {
  fetchAvailableUpdate,
  getLatestRelease,
  subscribeLatestRelease,
} from "./updateService";

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

export function useAppUpdate(serverUrl: string) {
  const [release, setRelease] = useState<AppReleaseInfo | null>(
    getLatestRelease,
  );
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => subscribeLatestRelease(setRelease), []);

  const checkForUpdate = useCallback(
    async (manual = false) => {
      if (manual) {
        setChecking(true);
        setMessage("");
      }
      try {
        const next = await fetchAvailableUpdate(serverUrl);
        if (manual) {
          setMessage(next ? "发现新版本" : "当前已是最新版本");
        }
      } catch {
        if (manual) setMessage("暂时无法检查更新");
      } finally {
        if (manual) setChecking(false);
      }
    },
    [serverUrl],
  );

  useEffect(() => {
    void checkForUpdate();
    const timer = window.setInterval(
      () => void checkForUpdate(),
      UPDATE_CHECK_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [checkForUpdate]);

  return {
    release,
    checking,
    message,
    checkForUpdate,
    dismissRelease: () => setRelease(null),
  };
}
