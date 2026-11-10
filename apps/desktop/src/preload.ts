import { contextBridge, ipcRenderer } from "electron";
import {
  DESKTOP_CHANNELS,
  type QingjiDesktopApi,
} from "@qingji/contracts";

let stickyEnterSignalled = false;
const stickyEnterWaiters = new Set<() => void>();

ipcRenderer.on(DESKTOP_CHANNELS.animateStickyIn, () => {
  stickyEnterSignalled = true;
  for (const resolve of stickyEnterWaiters) resolve();
  stickyEnterWaiters.clear();
});

const desktopApi: QingjiDesktopApi = {
  isDesktop: true,
  openSticky: (taskId, options) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.openSticky, taskId, options),
  waitForStickyEnter: () =>
    stickyEnterSignalled
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          stickyEnterWaiters.add(resolve);
        }),
  restoreStickyWindows: (options) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.restoreVisibleSticky, options),
  closeSticky: () => ipcRenderer.invoke(DESKTOP_CHANNELS.closeSticky),
  resizeSticky: (width, height) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.resizeSticky, { width, height }),
  getStickyAlwaysOnTop: () =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.getStickyAlwaysOnTop),
  setStickyAlwaysOnTop: (alwaysOnTop) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.setStickyAlwaysOnTop, alwaysOnTop),
  showMain: (taskId) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.showMain, taskId),
  setCloseBehavior: (behavior) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.setCloseBehavior, behavior),
  onCloseHintRequested: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(DESKTOP_CHANNELS.showCloseHint, handler);
    return () =>
      ipcRenderer.removeListener(DESKTOP_CHANNELS.showCloseHint, handler);
  },
  resolveCloseHint: (resolution) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.resolveCloseHint, resolution),
  onShowTodo: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(DESKTOP_CHANNELS.showTodo, handler);
    return () =>
      ipcRenderer.removeListener(DESKTOP_CHANNELS.showTodo, handler);
  },
  replaceScheduledNotifications: (notifications) =>
    ipcRenderer.invoke(
      DESKTOP_CHANNELS.replaceScheduledNotifications,
      notifications,
    ),
  getAutoStart: () =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.getAutoStart),
  setAutoStart: (enabled) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.setAutoStart, enabled),
  openExternal: (url) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.openExternal, url),
  onFocusTask: (listener: (taskId: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, taskId: string) => {
      listener(taskId);
    };
    ipcRenderer.on(DESKTOP_CHANNELS.focusTask, handler);
    return () =>
      ipcRenderer.removeListener(DESKTOP_CHANNELS.focusTask, handler);
  },
  readProfile: (ownerKey) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.readProfile, ownerKey),
  writeProfile: (request) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.writeProfile, request),
  readSession: () => ipcRenderer.invoke(DESKTOP_CHANNELS.readSession),
  writeSession: (session) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.writeSession, session),
  clearSession: () => ipcRenderer.invoke(DESKTOP_CHANNELS.clearSession),
  saveBackup: (fileName, contents) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.saveBackup, fileName, contents),
  openBackup: () => ipcRenderer.invoke(DESKTOP_CHANNELS.openBackup),
};

contextBridge.exposeInMainWorld("qingjiDesktop", desktopApi);
