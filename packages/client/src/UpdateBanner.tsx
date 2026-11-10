import type { AppReleaseInfo } from "@qingji/contracts";
import { openReleasePage } from "./updateService";

interface UpdateBannerProps {
  release: AppReleaseInfo;
  onDismiss(): void;
}

export function UpdateBanner({ release, onDismiss }: UpdateBannerProps) {
  return (
    <section className="update-banner" aria-label="应用更新">
      <div>
        <strong>清记 {release.latestVersion} 已发布</strong>
        <p>{release.notes || "前往 GitHub Release 查看更新内容。"}</p>
      </div>
      <div className="update-banner-actions">
        <button
          className="primary-button"
          type="button"
          onClick={() => void openReleasePage(release.releaseUrl)}
        >
          前往 Release
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
