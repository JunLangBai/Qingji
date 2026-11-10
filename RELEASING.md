# 清记发布说明

本文件描述 Windows 与 Android 安装包的发布步骤，以及用户会如何收到新版提示。

## 发布前

1. 更新所有 `package.json` 中的版本号。
2. 同步更新 `apps/mobile/android/app/build.gradle` 的 `versionName`，并递增
   `versionCode`。
3. 运行 `npm run typecheck`、`npm test` 和 `npm run build`。
4. 生成 Windows 安装包、签名 Android APK 和 SHA-256 校验文件。

构建命令：

```powershell
npm run desktop:dist
npm run mobile:sync
npm run mobile:build:release
```

Android release 必须继续使用同一份正式 keystore，否则旧版本不能覆盖升级。

## 发布 Release

1. 创建与安装包版本一致的标签，例如 `v0.1.2-alpha.1`。
2. 将 Windows `.exe`、Android `.apk` 和 `SHA256SUMS.txt` 作为 Release Assets
   上传，不要只发布源码归档。
3. 先保存为 Draft，确认文件名、版本号和下载链接后，再发布为 Pre-release 或
   Release。
4. 在 Release 说明中写明 Windows 与 Android 的直接下载方式。

客户端只会把带有 `.exe` 或 `.apk` 资产的公开版本视为可安装更新。

## 用户如何收到提示

包含新版更新检查的客户端会：

- 启动后立即检查一次；
- 运行期间每 6 小时检查一次；
- 优先读取公开 GitHub Release；
- GitHub API 暂时不可用时，回退到官方更新服务；
- 发现更高版本后显示应用内横幅，并打开经过校验的 GitHub Release 页面。

官方服务端在未设置 `APP_UPDATE_*` 时也会自动发现 GitHub 上最新的、带安装包的
公开版本。部署含此能力的新服务端后，日常发布不需要为每个版本手工修改服务器
环境变量。`APP_UPDATE_VERSION`、`APP_UPDATE_URL` 和可选的
`APP_UPDATE_NOTES` 仍可作为固定的运维覆盖。

## 边界

- 更新提示不是后台推送。应用完全关闭时不会收到提醒，用户下次启动时才会检查。
- 当前只提示并打开下载页，不静默下载、不自动覆盖安装。
- `0.1.1-alpha.1` 仍使用旧的本地服务器检查逻辑。若用户没有配置会返回更新信息
  的服务器，该版本不会自动发现 GitHub 新版本。
- 已经安装在用户设备上的旧版本无法被追溯修改。必须先手动升级到包含新更新链路
  的版本，之后的发布才能持续提示。
- GitHub Releases 列表只展示版本标签，不直接展开资产文件名；这是 GitHub 的界面
  行为。README 提供当前直链，具体版本页的“Assets”提供完整文件。

因此，“上传安装包后正确提醒所有用户”应表述为：所有已经安装新版、并且启动过
应用的用户会在检查后收到提示。完全未启动的用户和尚未升级的旧版用户不在自动
提示覆盖范围内。
