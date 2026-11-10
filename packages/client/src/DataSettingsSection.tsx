import { useEffect, useRef, useState } from "react";
import type { AppSettings } from "./settingsStore";
import { backupFileName } from "./data/backup";
import { isLoopbackServerUrl } from "./data/serverClient";
import { useTaskStoreState } from "./taskHooks";
import {
  connectAccount,
  disconnectAccount,
  exportCurrentProfile,
  getSyncConflicts,
  importBackupText,
  mergeLocalProfileIntoAccount,
  resolveConflict,
  syncNow,
} from "./taskStore";

interface DataSettingsSectionProps {
  settings: AppSettings;
  onChange(patch: Partial<AppSettings>): void;
}

function downloadText(filename: string, contents: string): void {
  const url = URL.createObjectURL(
    new Blob([contents], { type: "application/json;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function syncLabel(state: ReturnType<typeof useTaskStoreState>): string {
  if (state.ownerMode === "local") return "仅保存在本机";
  if (state.syncState === "syncing") return "正在自动同步";
  if (state.syncState === "synced") return "已自动同步";
  if (state.syncState === "offline") return "离线，改动已保存在本机";
  if (state.syncState === "connecting") return "正在连接";
  return state.syncMessage ?? "需要处理";
}

export function DataSettingsSection({
  settings,
  onChange,
}: DataSettingsSectionProps) {
  const data = useTaskStoreState();
  const [serverUrl, setServerUrl] = useState(settings.syncServerUrl);
  const [username, setUsername] = useState(settings.syncUsername);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setServerUrl(settings.syncServerUrl);
    setUsername(settings.syncUsername);
  }, [settings.syncServerUrl, settings.syncUsername]);

  async function authenticate(createAccount: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const result = await connectAccount({
        serverUrl,
        username,
        password,
        createAccount,
      });
      onChange({
        syncServerUrl: serverUrl.trim().replace(/\/+$/, ""),
        syncUsername: username.trim().toLowerCase(),
      });
      setPassword("");
      setMessage(
        result.mergeError
          ? `已连接服务器，但本机事项自动合入失败：${result.mergeError}`
          : result.mergedLocalTasks > 0
            ? `已连接服务器，并自动合入 ${result.mergedLocalTasks} 条本机事项`
            : createAccount
              ? "账号已创建，正在同步"
              : "已连接服务器，正在同步",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "连接失败");
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    await importText(await file.text());
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function importText(text: string) {
    setBusy(true);
    setMessage("");
    try {
      const result = await importBackupText(text);
      setMessage(
        [
          `导入 ${result.imported} 条`,
          result.copied > 0 ? `保留 ${result.copied} 条冲突副本` : "",
          result.skipped > 0 ? `跳过 ${result.skipped} 条重复事项` : "",
        ]
          .filter(Boolean)
          .join("，"),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败");
    } finally {
      setBusy(false);
    }
  }

  async function exportBackup() {
    setBusy(true);
    setMessage("");
    try {
      const contents = exportCurrentProfile();
      const fileName = backupFileName();
      if (window.qingjiDesktop) {
        const saved = await window.qingjiDesktop.saveBackup(
          fileName,
          contents,
        );
        if (saved) setMessage("备份已导出");
      } else {
        const { Capacitor } = await import("@capacitor/core");
        if (Capacitor.isNativePlatform()) {
          const [{ Filesystem, Directory, Encoding }, { Share }] =
            await Promise.all([
              import("@capacitor/filesystem"),
              import("@capacitor/share"),
            ]);
          const file = await Filesystem.writeFile({
            path: fileName,
            data: contents,
            directory: Directory.Cache,
            encoding: Encoding.UTF8,
          });
          await Share.share({
            title: "导出清记备份",
            text: "清记事项备份",
            url: file.uri,
            dialogTitle: "保存或分享清记备份",
          });
          setMessage("备份文件已生成");
        } else {
          downloadText(fileName, contents);
          setMessage("备份已导出");
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导出失败");
    } finally {
      setBusy(false);
    }
  }

  async function chooseImportFile() {
    if (!window.qingjiDesktop) {
      fileInputRef.current?.click();
      return;
    }
    setBusy(true);
    try {
      const backup = await window.qingjiDesktop.openBackup();
      if (backup) await importText(backup.text);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败");
    } finally {
      setBusy(false);
    }
  }

  async function mergeLocalData() {
    if (!window.confirm("将本机独立事项合并到当前账号？事项不会上传到其他账号。")) {
      return;
    }
    setBusy(true);
    try {
      const count = await mergeLocalProfileIntoAccount();
      setMessage(
        count > 0 ? `已加入 ${count} 条本机事项，正在同步` : "没有需要合并的本机事项",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "合并失败");
    } finally {
      setBusy(false);
    }
  }

  const conflicts = getSyncConflicts();
  const loopbackServer = isLoopbackServerUrl(serverUrl);
  const android = /Android/i.test(navigator.userAgent);
  const insecureHttp =
    serverUrl.startsWith("http://") &&
    !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(?:\/|$)/.test(serverUrl);

  return (
    <section className="data-settings" aria-labelledby="data-settings-title">
      <div className="settings-section-heading">
        <div>
          <p className="eyebrow">DATA</p>
          <h3 id="data-settings-title">事项数据</h3>
        </div>
        <span className={`sync-pill ${data.syncState}`}>
          {syncLabel(data)}
        </span>
      </div>

      <div className="data-block">
        <strong>导出与导入</strong>
        <p>
          备份文件包含事项标题、备注和时间，不包含登录令牌。文件为明文 JSON，
          请存放在可信位置。
        </p>
        <div className="data-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void exportBackup()}
          >
            导出备份
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void chooseImportFile()}
          >
            导入备份
          </button>
          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept=".json,application/json"
            onChange={(event) => void importFile(event.target.files?.[0])}
          />
        </div>
      </div>

      <div className="data-block">
        <strong>服务器实时同步</strong>
        {data.ownerMode === "account" ? (
          <>
            <div className="account-summary">
              <span>
                <b>{data.accountUsername}</b>
                <small>
                  {data.pendingCount > 0
                    ? `${data.pendingCount} 项等待上传`
                    : "本机改动自动上传，其他设备变更自动拉取"}
                </small>
              </span>
              <button
                className="secondary-button"
                type="button"
                disabled={data.syncState === "syncing"}
                onClick={() => void syncNow()}
              >
                立即刷新（可选）
              </button>
            </div>
            <div className="data-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => void mergeLocalData()}
              >
                手动合入本机事项
              </button>
              <button
                className="text-button danger-text"
                type="button"
                disabled={busy}
                onClick={() => {
                  const pendingWarning =
                    data.pendingCount > 0
                      ? `还有 ${data.pendingCount} 项本机改动等待上传；退出后会保留在该账号的本机缓存中。`
                      : "";
                  if (
                    !window.confirm(
                      `退出当前账号并切回本机数据？${pendingWarning}服务器数据不会被删除。`,
                    )
                  ) {
                    return;
                  }
                  setBusy(true);
                  void disconnectAccount()
                    .then(() => setMessage("已退出账号并切回本机数据"))
                    .catch((error: unknown) =>
                      setMessage(
                        error instanceof Error ? error.message : "退出失败",
                      ),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                退出账号并切回本机
              </button>
            </div>
            <p className="field-hint">
              退出后显示本机独立事项；服务器账号数据、完成记录和缓存不会被删除。
            </p>
          </>
        ) : (
          <div className="sync-form">
            <label className="edit-field">
              <span>服务器地址</span>
              <input
                value={serverUrl}
                inputMode="url"
                autoComplete="url"
                placeholder="https://qingji.example.com"
                onChange={(event) => setServerUrl(event.target.value)}
              />
            </label>
            <p className={loopbackServer && android ? "security-warning" : "field-hint"}>
              {loopbackServer
                ? android
                  ? "当前是本机地址。Android 上的 127.0.0.1 指向手机或模拟器自身，不是电脑；请改填 HTTPS 公网地址，或在开发电脑执行 adb reverse 后再连接。"
                  : "当前使用本机服务器。请确认清记服务已经在这台电脑启动。"
                : "公网服务器必须使用 HTTPS；连接失败时会显示具体网络错误。"}
            </p>
            <div className="sync-credentials">
              <label className="edit-field">
                <span>用户名</span>
                <input
                  value={username}
                  inputMode="text"
                  autoComplete="username"
                  placeholder="例如：xiaoming"
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
              <label className="edit-field">
                <span>密码（至少 10 位）</span>
                <input
                  value={password}
                  type="password"
                  minLength={10}
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            </div>
            {insecureHttp ? (
              <p className="security-warning">
                明文 HTTP 只允许 localhost/127.0.0.1 用于本机开发；
                局域网和公网服务器必须配置 HTTPS。
              </p>
            ) : null}
            <div className="data-actions">
              <button
                className="primary-button"
                type="button"
                disabled={
                  busy || !serverUrl || !username || password.length < 10
                }
                onClick={() => void authenticate(false)}
              >
                {busy ? "连接中" : "登录并同步"}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={
                  busy || !serverUrl || !username || password.length < 10
                }
                onClick={() => void authenticate(true)}
              >
                创建账号
              </button>
            </div>
          </div>
        )}
      </div>

      {conflicts.length > 0 ? (
        <div className="conflict-list">
          <strong>同步冲突</strong>
          <p>服务器和本机都修改了同一事项。两个版本都已保留。</p>
          {conflicts.map((conflict) => (
            <div className="conflict-row" key={conflict.taskId}>
              <span>{conflict.localTask.title}</span>
              <div>
                <button
                  className="text-button"
                  type="button"
                  onClick={() =>
                    void resolveConflict(conflict.taskId, "keep-local")
                  }
                >
                  保留本机
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() =>
                    void resolveConflict(conflict.taskId, "use-server")
                  }
                >
                  采用服务器
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {message ? (
        <p className="data-message" role="status">
          {message}
        </p>
      ) : null}
      {data.syncMessage && data.syncState !== "synced" ? (
        <p className="security-warning">{data.syncMessage}</p>
      ) : null}
      <p className="field-hint">
        首次连接服务器会自动合入本机事项。手机或电脑已绑定过其他账号时，
        为避免跨账号上传，需要手动确认“合入本机事项”。
      </p>
    </section>
  );
}
