# 发布流程

本文描述 Windows 与 Android 安装包的发布、校验和更新提示流程。旧链接
`/RELEASING.md` 已保留兼容入口。

## 1. 发布前检查

1. 确认工作区没有意外改动，所有必要变更已提交。
2. 选择完整 SemVer 版本，例如 `0.1.4-alpha.1`。
3. 更新以下位置的版本：
   - 根 `package.json`；
   - `apps/desktop/package.json`；
   - `apps/mobile/package.json`；
   - `packages/client/package.json`；
   - `packages/contracts/package.json`；
   - `packages/domain/package.json`；
   - `services/server/package.json`；
   - `apps/mobile/android/app/build.gradle` 中的 `versionName`。
4. 递增 Android `versionCode`。每次发布都必须增加，不能复用。
5. 同步更新 `package-lock.json` 中的工作区版本，可执行
   `npm install --package-lock-only` 后检查差异。
6. 在隔离环境验证升级、备份恢复和同步兼容性。

发布版本不得跳过完整测试：

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

本地数据库已启动时还应运行：

```powershell
npm run test:integration
```

## 2. Windows 安装包

在 Windows 环境运行：

```powershell
npm run desktop:dist
```

确认 `apps/desktop/release/` 中至少生成：

- NSIS 安装包 `.exe`；
- 便携版 `.exe`；
- 安装包对应的 blockmap 或 electron-builder 元数据（如启用）。

上传前将用户安装包重命名为
`Qingji-<version>-Windows-Setup-x64.exe`。随后从构建记录整理 ABI、构建时间和
校验信息到 `BUILD-INFO.txt`，不要把整个 `release/` 目录或中间产物上传到 Release。

发布前必须在一台干净 Windows 用户环境中验证：

- 安装、启动和卸载；
- 关闭主窗口后托盘仍工作；
- 主窗口、便签和系统通知可交互；
- 多显示器与混合 DPI；
- 首次安装的数据目录；
- 覆盖安装和跨目录安装后的数据恢复；
- 旧数据迁移不会覆盖已有稳定目录。

当前构建未使用受信任 Windows 代码签名。发布说明必须明确这一点，不能让用户误以为
安装包已通过 Windows 信任链验证。

## 3. Android 安装包

先构建共享前端，再同步 Capacitor 工程：

```powershell
npm run build -w @qingji/client
npm run mobile:sync
```

准备签名环境。Release 构建要求以下四个变量同时存在：

```powershell
$env:ANDROID_KEYSTORE_PATH = "C:\secure\qingji-release.keystore"
$env:ANDROID_KEYSTORE_PASSWORD = "<store-password>"
$env:ANDROID_KEY_ALIAS = "qingji"
$env:ANDROID_KEY_PASSWORD = "<key-password>"
npm run mobile:build:release
```

生成的签名 APK 通常位于：

```text
apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

上传前重命名为 `Qingji-<version>-Android-Release.apk`。

`mobile:build:release` 会调用 `apksigner verify`。不要只凭构建成功判断签名有效，
还要检查输出中的 v2/v3 验证结果、应用 ID、`versionName` 和 `versionCode`。

同一应用 ID 的后续安装必须继续使用同一份 keystore。密钥丢失后，用户不能直接覆盖
升级到新签名版本。keystore、store 密码和 key 密码必须离线或放入受控密钥系统备份，
不得提交到仓库。

至少验证：

- 冷启动、登录和退出；
- SQLCipher 数据在重启后仍可读取；
- 通知权限、精确提醒、免打扰和每日摘要；
- 进程关闭后由系统调度的本地提醒；
- 文件导入导出与分享；
- 与 Windows 的双设备同步、冲突和断线恢复；
- 从上一签名版本覆盖安装。

Android release 的完整物理真机验收是当前发布前仍应补齐的工作。

## 4. 生成校验文件

在准备上传的目录中使用 PowerShell：

```powershell
$version = "0.1.4-alpha.1"
$windowsPackage = "Qingji-$version-Windows-Setup-x64.exe"
$androidPackage = "Qingji-$version-Android-Release.apk"
$windowsPackage = (Resolve-Path $windowsPackage).Path
$androidPackage = (Resolve-Path $androidPackage).Path

Get-FileHash -Algorithm SHA256 $windowsPackage |
  ForEach-Object { "$($_.Hash)  $(Split-Path $windowsPackage -Leaf)" } |
  Set-Content -Encoding ascii SHA256SUMS.txt
Get-FileHash -Algorithm SHA256 $androidPackage |
  ForEach-Object { "$($_.Hash)  $(Split-Path $androidPackage -Leaf)" } |
  Add-Content -Encoding ascii SHA256SUMS.txt
```

保存 Windows 与 Android 各自 SHA-256 值到构建记录或 `BUILD-INFO.txt`。上传前在一台
独立机器重新计算并比对，防止传输或重命名过程出错。

## 5. GitHub Release

1. 创建与安装包一致的标签，例如 `v0.1.4-alpha.1`。
2. 创建 Draft Release。
3. 上传 Windows `.exe`、Android `.apk` 和 `SHA256SUMS.txt`。
4. 将版本、变更、已知限制、校验方式和安装升级说明写入 Release 正文。
5. 确认文件名、版本号和下载链接后，再发布为 Pre-release 或 Release。

客户端只把“非草稿、合法 SemVer、包含 `.exe` 或 `.apk` 资产、链接指向 GitHub
Release”的版本视为可安装更新。只上传源码归档不会触发现有更新提示。

发布后手动打开两个安装包链接和校验文件链接，确认无需登录即可下载。

## 6. 更新发现链路

客户端：

1. 启动后立即检查；
2. 运行期间每 6 小时检查一次；
3. 优先读取可直连的官方更新服务；
4. 官方服务不可用时尝试当前配置的服务器，最后回退到公开 GitHub Releases；
5. 更新服务可达时通过 `/v1/update/download` 代理下载安装包；
6. 发现更高版本后显示应用内横幅。

服务端在未设置 `APP_UPDATE_VERSION` 和 `APP_UPDATE_URL` 时，会尝试自动发现公开
Release。`APP_UPDATE_NOTES` 是可选的固定说明覆盖。

服务端按照约定文件名构造 Release 资产地址，并将安装包流式转发给客户端。发布资产
必须继续使用以下命名，否则代理下载会返回不可用：

- `Qingji-<version>-Windows-Setup-x64.exe`
- `Qingji-<version>-Android-Release.apk`

推荐发布顺序：

1. 先部署包含 `/v1/update/download` 的更新服务；
2. 创建包含标准命名资产的 GitHub Release；
3. 等待服务端 Release 自动发现生效，或在服务端设置固定覆盖；
4. 分别检查 `/v1/update` 和两个平台的代理下载；
5. 发布客户端版本。

如果服务端仍运行旧版本，客户端只能获得 GitHub 跳转，无法完成无 VPN 代理下载。

### 当前分发限制

服务端代理下载会在用户请求时实时连接 GitHub。跨境网络抖动、GitHub 限流、服务器
出站带宽和多个用户同时下载都可能导致下载很慢或失败。当前版本保留这一过渡方案，
但不作为高并发或强 SLA 的最终发布架构。

2026-11-20 的腾讯云上海生产环境验证结果为：GitHub Release feed 与安装包请求均在
20 秒后超时、收到 0 字节，代理下载返回 404。因此当前环境不具备无 VPN 更新下载
能力，必须先准备国内镜像后才能继续验证该功能。

后续发布架构应增加国内对象存储/CDN：

1. 发布时先把安装包上传到国内对象存储；
2. 更新接口返回国内镜像地址和 SHA-256；
3. 客户端优先下载镜像并校验哈希；
4. 多个镜像失败后才回退 GitHub 代理；
5. 监控下载失败率、耗时和源站流量。

发布后应使用上一版本客户端验证：

- 版本比较正确；
- Release 页面和更新正文正确；
- 无 VPN 环境可以通过更新服务直接下载；
- GitHub 不可用但更新服务可达时仍能完成检查和下载；
- 更新服务与 GitHub 都不可用时会显示可理解的失败状态；
- 不是更高版本时不显示提示；
- 先发布 Draft 时不会提前提示。

## 7. 发布说明模板

```markdown
# 清记 X.Y.Z

本次版本摘要。

## 变更

- ...

## 安装与升级

- Windows: ...
- Android: ...
- 校验值见 SHA256SUMS.txt。

## 已知限制

- ...
```

Release 正文应面向用户，不写入内部主机名、用户名、密钥、数据库内容或未脱敏日志。

## 8. 更新边界

- 当前更新可下载安装包，但不会静默下载和自动覆盖安装；
- 应用完全关闭时没有推送通道，下次启动后才会检查；
- 已安装的旧版本无法追溯获得后续客户端逻辑；
- 更新服务不可用时会回退到 GitHub，此时仍可能受到网络环境影响；
- Windows 代码签名和自动安装回滚尚未完成；
- Android AAB 和商店分发流程尚未纳入当前脚本。

因此，“发布后提醒所有用户”的准确表述是：已经安装支持当前更新检查的版本，并且
在发布后启动或持续运行清记的设备，会在一次检查后收到提示。
