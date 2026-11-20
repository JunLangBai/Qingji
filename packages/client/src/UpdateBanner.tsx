import type { AppReleaseInfo } from "@qingji/contracts";
import { openReleaseAction } from "./updateService";

interface UpdateBannerProps {
  release: AppReleaseInfo;
  onDismiss(): void;
}

export function UpdateBanner({ release, onDismiss }: UpdateBannerProps) {
  return (
    <section className="update-banner" aria-label="应用更新">
      <div>
        <strong>清记 {release.latestVersion} 已发布</strong>
        <p>
          {release.notes ||
            (release.downloadUrl
              ? "可直接从清记更新服务下载安装包。"
              : "查看更新说明并下载安装包。")}
        </p>
      </div>
      <div className="update-banner-actions">
        <button
          className="primary-button"
          type="button"
          onClick={() => void openReleaseAction(release)}
        >
          {release.downloadUrl ? "下载更新" : "查看更新"}
        </button>
        <button
          className="text-button"
          type="button"
          onClick={onDismiss}
        >
          稍后提醒
        </button>
      </div>
    </section>
  );
}
