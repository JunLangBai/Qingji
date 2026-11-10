import type { QingjiDesktopApi } from "@qingji/contracts";

declare global {
  interface Window {
    qingjiDesktop?: QingjiDesktopApi;
  }
}

export {};
