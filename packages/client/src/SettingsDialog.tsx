import {
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject,
} from "react";
import type { AppReleaseInfo } from "@qingji/contracts";
import { DataSettingsSection } from "./DataSettingsSection";
import {
  getNotificationRuntimeSnapshot,
  openExactAlarmSettings,
  requestDeviceNotificationPermission,
  subscribeNotificationRuntime,
} from "./notificationService";
import type { AppSettings } from "./settingsStore";
import { APP_VERSION, openReleasePage } from "./updateService";

type SettingsCategory =
  | "appearance"
  | "completion"
  | "reminders"
  | "desktop"
  | "data"
  | "updates";

interface SettingsDialogProps {
  settings: AppSettings;
  isDesktop: boolean;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  updateRelease: AppReleaseInfo | null;
  updateChecking: boolean;
  updateMessage: string;
  onChange(patch: Partial<AppSettings>): void;
  onResetSettings(): void;
  onCheckForUpdate(): void;
  onClose(): void;
}

const CATEGORIES: Array<{
  id: SettingsCategory;
  label: string;
  hint: string;
  desktopOnly?: boolean;
}> = [
  { id: "appearance", label: "外观", hint: "主题与字号" },
  { id: "completion", label: "完成与反馈", hint: "手势、礼炮与撤销" },
  { id: "reminders", label: "提醒与摘要", hint: "到期、每日与免打扰" },
  {
    id: "desktop",
    label: "桌面窗口",
    hint: "托盘、关闭与便签",
    desktopOnly: true,
  },
  { id: "data", label: "数据与同步", hint: "备份、账号与冲突" },
  { id: "updates", label: "关于与更新", hint: "版本与 Release" },
];

export function SettingsDialog({
  settings,
  isDesktop,
  closeButtonRef,
  updateRelease,
  updateChecking,
  updateMessage,
  onChange,
  onResetSettings,
  onCheckForUpdate,
  onClose,
}: SettingsDialogProps) {
  const [activeCategory, setActiveCategory] =
    useState<SettingsCategory>("appearance");
  const notificationRuntime = useSyncExternalStore(
    subscribeNotificationRuntime,
    getNotificationRuntimeSnapshot,
    getNotificationRuntimeSnapshot,
  );
  const [autoStartMessage, setAutoStartMessage] = useState("");
  const categories = CATEGORIES.filter(
    (category) => !category.desktopOnly || isDesktop,
  );

  useEffect(() => {
    if (
      !isDesktop &&
      !categories.some((category) => category.id === activeCategory)
    ) {
      setActiveCategory("appearance");
    }
  }, [activeCategory, categories, isDesktop]);

  useEffect(() => {
    const desktop = window.qingjiDesktop;
    if (!isDesktop || !desktop) return;
    void desktop
      .getAutoStart()
      .then((enabled) => {
        if (enabled !== settings.autoStart) {
          onChange({ autoStart: enabled });
        }
      })
      .catch(() => setAutoStartMessage("无法读取系统自启动状态。"));
  }, []);

  async function updateAutoStart(enabled: boolean): Promise<void> {
    onChange({ autoStart: enabled });
    setAutoStartMessage("");
    const desktop = window.qingjiDesktop;
    if (!desktop) return;
    try {
      const actual = await desktop.setAutoStart(enabled);
      if (actual !== enabled) {
        onChange({ autoStart: actual });
        setAutoStartMessage(
          actual
            ? "系统已启用自启动，但状态与设置不一致。"
            : "Windows 未接受开机自启动设置，请检查系统启动应用权限。",
        );
      }
    } catch {
      onChange({ autoStart: false });
      setAutoStartMessage("无法修改 Windows 开机自启动设置。");
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">PREFERENCES</p>
            <h2 id="settings-title">设置</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            ref={closeButtonRef}
            aria-label="关闭设置"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="settings-layout">
          <nav
            className="settings-tabs"
            role="tablist"
            aria-label="设置分类"
          >
            {categories.map((category) => (
              <button
                className={`settings-tab ${activeCategory === category.id ? "active" : ""}`}
                type="button"
                role="tab"
                aria-selected={activeCategory === category.id}
                key={category.id}
                onClick={() => setActiveCategory(category.id)}
              >
                <strong>{category.label}</strong>
                <small>{category.hint}</small>
              </button>
            ))}
          </nav>

          <div
            className="settings-category"
            role="tabpanel"
            aria-label={
              categories.find((category) => category.id === activeCategory)
                ?.label ?? "设置"
            }
          >
            {activeCategory === "appearance" ? (
              <>
                <label className="setting-row">
                  <span>
                    界面字体大小
                    <small>同时调整主窗口和桌面便签文字。</small>
                  </span>
                  <div className="font-scale-control">
                    <input
                      type="range"
                      min="90"
                      max="140"
                      step="5"
                      value={Math.round(settings.fontScale * 100)}
                      aria-label="界面字体大小"
                      aria-valuetext={`${Math.round(settings.fontScale * 100)}%`}
                      style={
                        {
                          "--range-progress": `${
                            ((Math.round(settings.fontScale * 100) - 90) /
                              50) *
                            100
                          }%`,
                        } as CSSProperties
                      }
                      onChange={(event) =>
                        onChange({
                          fontScale: Number(event.target.value) / 100,
                        })
                      }
                    />
                    <output>{Math.round(settings.fontScale * 100)}%</output>
                  </div>
                </label>
                <label className="setting-row">
                  <span>
                    主题
                    <small>跟随系统或手动选择。</small>
                  </span>
                  <select
                    value={settings.theme}
                    onChange={(event) =>
                      onChange({
                        theme: event.target.value as AppSettings["theme"],
                      })
                    }
                  >
                    <option value="system">跟随系统</option>
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                  </select>
                </label>
                <div className="settings-note settings-reset-note">
                  <div>
                    <strong>恢复默认设置</strong>
                    <small>
                      恢复主题、字号、完成方式、提醒、自启动和桌面便签偏好；
                      不会删除事项、完成记录或退出当前账号。
                    </small>
                  </div>
                  <button
                    className="text-button danger-text"
                    type="button"
                    onClick={onResetSettings}
                  >
                    恢复默认
                  </button>
                </div>
              </>
            ) : null}

            {activeCategory === "completion" ? (
              <>
                <label className="setting-row">
                  <span>
                    完成方式
                    <small>
                      短按更适合快速收尾；长按可减少误触。键盘始终直接完成。
                    </small>
                  </span>
                  <select
                    value={settings.completionMode}
                    onChange={(event) =>
                      onChange({
                        completionMode:
                          event.target.value as AppSettings["completionMode"],
                      })
                    }
                  >
                    <option value="tap">短按完成</option>
                    <option value="hold">长按 0.6 秒完成</option>
                  </select>
                </label>
                <label className="setting-row">
                  <span>
                    完成礼炮
                    <small>
                      从完成按钮位置迸发短促纸屑；系统减少动态效果时自动关闭。
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.completionCelebration}
                    onChange={(event) =>
                      onChange({
                        completionCelebration: event.target.checked,
                      })
                    }
                  />
                </label>
                <div className="settings-note">
                  完成操作会立即写入本地数据库并进入完成记录。礼炮和撤销提示
                  只是反馈，不阻塞数据保存。
                </div>
              </>
            ) : null}

            {activeCategory === "reminders" ? (
              <>
                <div className="settings-note reminder-scope-note">
                  提醒规则和免打扰按当前设备保存。单个事项可以覆盖默认提前量，
                  或选择“不提醒”。
                </div>
                <label className="setting-row">
                  <span>
                    到期提醒
                    <small>未完成事项按下方提前量提醒；完成后自动取消。</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.dueNotificationsEnabled}
                    onChange={(event) =>
                      onChange({
                        dueNotificationsEnabled: event.target.checked,
                      })
                    }
                  />
                </label>
                <label className="setting-row">
                  <span>
                    默认提前量
                    <small>事项没有单独选择时使用；默认提前 15 分钟。</small>
                  </span>
                  <select
                    value={settings.defaultLeadMinutes}
                    disabled={!settings.dueNotificationsEnabled}
                    onChange={(event) =>
                      onChange({
                        defaultLeadMinutes: Number(event.target.value),
                      })
                    }
                  >
                    <option value="0">到期时</option>
                    <option value="5">提前 5 分钟</option>
                    <option value="15">提前 15 分钟</option>
                    <option value="30">提前 30 分钟</option>
                    <option value="60">提前 1 小时</option>
                    <option value="1440">提前 1 天</option>
                  </select>
                </label>
                <label className="setting-row">
                  <span>
                    此设备发送每日摘要
                    <small>
                      分别显示今天到期和已经逾期的未完成数量。多台设备都开启时，
                      会分别发送。
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.dailySummaryEnabled}
                    onChange={(event) =>
                      onChange({
                        dailySummaryEnabled: event.target.checked,
                      })
                    }
                  />
                </label>
                <label className="setting-row">
                  <span>
                    每日摘要时间
                    <small>使用当前设备时区；默认 20:00。</small>
                  </span>
                  <input
                    className="time-input"
                    type="time"
                    value={settings.dailySummaryTime}
                    disabled={!settings.dailySummaryEnabled}
                    onChange={(event) =>
                      onChange({ dailySummaryTime: event.target.value })
                    }
                  />
                </label>
                <label className="setting-row">
                  <span>
                    免打扰
                    <small>
                      时段内的提醒和摘要会顺延到结束时间，而不是丢弃。
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.quietHoursEnabled}
                    onChange={(event) =>
                      onChange({
                        quietHoursEnabled: event.target.checked,
                      })
                    }
                  />
                </label>
                {settings.quietHoursEnabled ? (
                  <div className="setting-row">
                    <span>
                      免打扰时段
                      <small>跨越午夜也可使用，例如 22:00 到次日 08:00。</small>
                    </span>
                    <div className="time-range-control">
                      <input
                        className="time-input"
                        type="time"
                        aria-label="免打扰开始时间"
                        value={settings.quietHoursStart}
                        onChange={(event) =>
                          onChange({
                            quietHoursStart: event.target.value,
                          })
                        }
                      />
                      <span>到</span>
                      <input
                        className="time-input"
                        type="time"
                        aria-label="免打扰结束时间"
                        value={settings.quietHoursEnd}
                        onChange={(event) =>
                          onChange({
                            quietHoursEnd: event.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                ) : null}
                <div className="settings-note notification-status">
                  <div className="notification-status-copy">
                    <strong>
                      {notificationRuntime.supported
                        ? `本机已安排 ${notificationRuntime.scheduledCount} 条通知`
                        : "当前平台不支持系统通知"}
                    </strong>
                    <small>{notificationRuntime.message}</small>
                  </div>
                  {notificationRuntime.supported &&
                  (settings.dueNotificationsEnabled ||
                    settings.dailySummaryEnabled) ? (
                    <div className="notification-status-actions">
                      {notificationRuntime.permission !== "granted" ? (
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() =>
                            void requestDeviceNotificationPermission()
                          }
                        >
                          请求通知权限
                        </button>
                      ) : null}
                      {notificationRuntime.exactAlarm === "denied" ? (
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => void openExactAlarmSettings()}
                        >
                          允许精确提醒
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}

            {activeCategory === "desktop" && isDesktop ? (
              <>
                <label className="setting-row">
                  <span>
                    关闭主窗口时
                    <small>
                      留在托盘可继续显示便签；完全退出会结束所有便签和后台进程。
                    </small>
                  </span>
                  <select
                    value={settings.mainCloseBehavior}
                    onChange={(event) =>
                      onChange({
                        mainCloseBehavior:
                          event.target.value as AppSettings["mainCloseBehavior"],
                      })
                    }
                  >
                    <option value="tray">留在托盘</option>
                    <option value="quit">完全退出</option>
                  </select>
                </label>
                <label className="setting-row">
                  <span>
                    开机自动启动清记
                    <small>
                      登录 Windows 后自动启动到托盘，继续执行提醒和便签恢复。
                      默认关闭。
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.autoStart}
                    onChange={(event) =>
                      void updateAutoStart(event.target.checked)
                    }
                  />
                </label>
                {autoStartMessage ? (
                  <p className="form-error">{autoStartMessage}</p>
                ) : null}
                <label className="setting-row">
                  <span>
                    事项完成后收起便签
                    <small>关闭后会停留在桌面，直到手动收起。</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.stickyCloseOnComplete}
                    onChange={(event) =>
                      onChange({
                        stickyCloseOnComplete: event.target.checked,
                      })
                    }
                  />
                </label>
                <label className="setting-row">
                  <span>
                    重启后恢复便签
                    <small>重新打开清记时，恢复上次仍在桌面的便签。</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.restoreStickyOnLaunch}
                    onChange={(event) =>
                      onChange({
                        restoreStickyOnLaunch: event.target.checked,
                      })
                    }
                  />
                </label>
                <label className="setting-row">
                  <span>
                    便签默认置顶
                    <small>新建便签使用该设置，每张便签仍可单独切换。</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.stickyAlwaysOnTop}
                    onChange={(event) =>
                      onChange({
                        stickyAlwaysOnTop: event.target.checked,
                      })
                    }
                  />
                </label>
                <label className="setting-row">
                  <span>
                    便签动效
                    <small>从右上角卷起纸页，再以翻页方式贴上或收起。</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.stickyAnimations}
                    onChange={(event) =>
                      onChange({
                        stickyAnimations: event.target.checked,
                      })
                    }
                  />
                </label>
              </>
            ) : null}

            {activeCategory === "data" ? (
              <DataSettingsSection
                settings={settings}
                onChange={onChange}
              />
            ) : null}

            {activeCategory === "updates" ? (
              <>
                <div className="update-settings-card">
                  <div>
                    <p className="eyebrow">CURRENT VERSION</p>
                    <strong>清记 {APP_VERSION}</strong>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={updateChecking}
                    onClick={onCheckForUpdate}
                  >
                    {updateChecking ? "检查中" : "检查更新"}
                  </button>
                </div>
                {updateRelease ? (
                  <div className="update-available-card">
                    <strong>
                      新版本 {updateRelease.latestVersion} 已发布
                    </strong>
                    <p>
                      {updateRelease.notes ||
                        "前往 GitHub Release 查看更新说明并下载安装包。"}
                    </p>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() =>
                        void openReleasePage(updateRelease.releaseUrl)
                      }
                    >
                      打开 GitHub Release
                    </button>
                  </div>
                ) : (
                  <p className="field-hint">
                    服务器发现新版本时会通知客户端，并只提供 GitHub Release
                    跳转链接，不直接注入代码。
                  </p>
                )}
                {updateMessage ? (
                  <p className="data-message" role="status">
                    {updateMessage}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
