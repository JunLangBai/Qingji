import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { CloseBehaviorHint } from "./CloseBehaviorHint";
import { MainView } from "./MainView";
import { syncDeviceNotifications } from "./notificationService";
import {
  applyFontScale,
  applyTheme,
  getSettingsSnapshot,
  subscribeSettings,
} from "./settingsStore";
import { StickyView } from "./StickyView";
import { useTaskStoreState } from "./taskHooks";
import { initializeTaskStore } from "./taskStore";

export function App() {
  const settings = useSyncExternalStore(
    subscribeSettings,
    getSettingsSnapshot,
    getSettingsSnapshot,
  );
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view") === "sticky" ? "sticky" : "main";
  const taskId = params.get("taskId") ?? "";
  const stickyRestoreRequested = useRef(false);
  const [showCloseHint, setShowCloseHint] = useState(false);
  const data = useTaskStoreState();

  useEffect(() => {
    void initializeTaskStore();
  }, []);

  useEffect(() => {
    applyFontScale(settings.fontScale);
    applyTheme(settings.theme);
    if (settings.theme !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [settings.fontScale, settings.theme]);

  useEffect(() => {
    void window.qingjiDesktop?.setCloseBehavior(
      settings.mainCloseBehavior,
    );
  }, [settings.mainCloseBehavior]);

  useEffect(() => {
    if (view !== "main" || !data.ready) return;
    const syncNotifications = () => {
      void syncDeviceNotifications(data.tasks, {
        dueNotificationsEnabled: settings.dueNotificationsEnabled,
        defaultLeadMinutes: settings.defaultLeadMinutes,
        dailySummaryEnabled: settings.dailySummaryEnabled,
        dailySummaryTime: settings.dailySummaryTime,
        quietHoursEnabled: settings.quietHoursEnabled,
        quietHoursStart: settings.quietHoursStart,
        quietHoursEnd: settings.quietHoursEnd,
      });
    };
    const initialTimer = window.setTimeout(syncNotifications, 180);
    const refreshTimer = window.setInterval(
      syncNotifications,
      24 * 60 * 60 * 1_000,
    );
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(refreshTimer);
    };
  }, [
    data.ready,
    data.tasks,
    settings.dailySummaryEnabled,
    settings.dailySummaryTime,
    settings.defaultLeadMinutes,
    settings.dueNotificationsEnabled,
    settings.quietHoursEnabled,
    settings.quietHoursEnd,
    settings.quietHoursStart,
    view,
  ]);

  useEffect(() => {
    if (view !== "main") return;
    return window.qingjiDesktop?.onCloseHintRequested(() => {
      setShowCloseHint(true);
    });
  }, [view]);

  useEffect(() => {
    if (
      view !== "main" ||
      stickyRestoreRequested.current ||
      !data.ready ||
      !window.qingjiDesktop
    ) {
      return;
    }

    stickyRestoreRequested.current = true;
    const existingTaskIds = data.tasks
      .filter((task) => !task.deletedAt)
      .map((task) => task.id);
    void window.qingjiDesktop
      .restoreStickyWindows({
        enabled: settings.restoreStickyOnLaunch,
        taskIds: existingTaskIds,
      })
      .catch((error: unknown) => {
        console.error("Unable to restore sticky windows", error);
      });
  }, [data.ready, data.tasks, settings.restoreStickyOnLaunch, view]);

  if (!data.ready) {
    return (
      <main className="loading-screen" role="status">
        <div className={data.initializationError ? "loading-card error" : "loading-card"}>
          <strong>
            {data.initializationError ? "无法打开本机数据" : "正在打开清记…"}
          </strong>
          {data.initializationError ? (
            <>
              <p>{data.initializationError}</p>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void initializeTaskStore()}
              >
                重试
              </button>
            </>
          ) : null}
        </div>
      </main>
    );
  }

  if (view === "sticky") {
    return <StickyView taskId={taskId} settings={settings} />;
  }

  return (
    <>
      <MainView settings={settings} />
      <CloseBehaviorHint
        open={showCloseHint}
        onResolved={() => setShowCloseHint(false)}
      />
    </>
  );
}
