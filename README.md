# 清记 / Qingji

清记是一款以精确截止时间为核心的个人事项工具。它按创建日期整理待办，帮助用户快速看见今天到期和已经逾期的事项，并在完成后长期保留历史记录。

Qingji is a deadline-first, local-first task app for Windows and Android.

> 当前状态：开发者预览。核心功能和同步链路已经实现，安装包签名、成品发布与完整真机验收仍在进行。

## 下载

当前预览版 `0.1.2-alpha.1`：

- [Windows x64 安装包](https://github.com/JunLangBai/Qingji/releases/download/v0.1.2-alpha.1/Qingji-0.1.2-alpha.1-Windows-Setup-x64.exe)
- [Android APK](https://github.com/JunLangBai/Qingji/releases/download/v0.1.2-alpha.1/Qingji-0.1.2-alpha.1-Android-Release.apk)
- [SHA-256 校验文件](https://github.com/JunLangBai/Qingji/releases/download/v0.1.2-alpha.1/SHA256SUMS.txt)
- [全部版本](https://github.com/JunLangBai/Qingji/releases)

GitHub 的 Releases 列表默认只展示版本标签；进入具体版本页面后，安装包位于
“Assets”区域。上面的直链可直接开始下载。

Windows 安装版可通过“设置 → 应用 → 已安装的应用 → 清记 → 卸载”卸载，
安装目录中也提供 `Uninstall 清记.exe`。本机数据默认位于安装目录的 `data`
文件夹，卸载前请先在应用内导出备份。

## 功能

- 创建、编辑、完成、撤销和恢复事项，所有事项都需要截止时间。
- 按创建日期分组，集中展示今天到期与已逾期数量。
- 保留完成历史，支持筛选、多选和批量操作。
- 到期提醒、每日摘要、免打扰与单事项提醒覆盖。
- Windows 主窗口、系统托盘和独立桌面便签。
- 本地优先数据，支持 JSON 导入导出和自建服务器同步。
- Windows 本地加密 SQLite，Android SQLCipher 与 Keystore。
- 账号隔离、增量同步、冲突保留和软删除。

## 客户端

### 电脑端

Windows 客户端使用 Electron，提供标准主窗口、托盘驻留和每个事项独立的桌面便签。

源码入口：[`apps/desktop`](apps/desktop)

### 手机端

Android 客户端使用 Capacitor，支持本地 SQLCipher、安全存储、文件分享和系统通知。

源码入口：[`apps/mobile`](apps/mobile)

两个客户端共享 React 界面、领域模型和同步协议。

Windows 安装版默认将本机数据保存在程序目录下的
`data/<Windows用户标识>/`，不会强制写入系统盘。可通过
`QINGJI_DATA_DIR` 环境变量指定其他数据根目录。

## 项目结构

```text
apps/
  desktop/       Windows 客户端
  mobile/        Android 客户端
packages/
  client/        两端共享的 React 界面
  contracts/     IPC 与同步协议类型
  domain/        事项、时间与状态规则
services/
  server/        Fastify + PostgreSQL 同步服务
scripts/         构建与集成测试脚本
```

## 开发

需要 Node.js 24、npm 和 Docker。Android 构建还需要 JDK 21 与 Android SDK 36。

```powershell
npm ci
npm run setup:local
npm run db:up
npm run dev:server
```

`setup:local` 会生成被忽略的根目录 `.env` 和 `services/server/.env`，并为本地数据库创建独立随机密码。已有这两个文件时不会覆盖。

另开终端启动 Web 与 Windows 桌面开发环境：

```powershell
npm run dev
```

仅启动共享 Web 界面：

```powershell
npm run dev:client
```

## 构建与测试

```powershell
npm run typecheck
npm test
npm run build
```

Windows 安装包：

```powershell
npm run desktop:dist
```

Android debug APK：

```powershell
npm run mobile:sync
npm run mobile:build:debug
```

Android release APK 需要先通过环境变量提供正式签名信息：

```powershell
$env:ANDROID_KEYSTORE_PATH = "C:\secure\qingji-release.keystore"
$env:ANDROID_KEYSTORE_PASSWORD = "<store-password>"
$env:ANDROID_KEY_ALIAS = "qingji"
$env:ANDROID_KEY_PASSWORD = "<key-password>"
npm run mobile:sync
npm run mobile:build:release
```

签名文件不得提交到仓库。以后安装升级必须继续使用同一份 keystore。

## 数据方式

清记默认将所有事项保存在当前设备。用户也可以填写自建服务器地址并登录账号，在 Windows 与 Android 之间同步数据。

服务器处理同步时可以解密事项内容，因此当前实现不是端到端加密。公网部署应使用 HTTPS、独立密钥和受控的数据库备份。

## 更新提示

新版客户端会在启动后及运行期间检查公开 GitHub Release，只在发布版本包含
`.exe` 或 `.apk` 安装包时提示更新。发现新版本后，应用打开 GitHub Release，
由用户手动下载并安装；当前不会静默下载或自动覆盖安装。

GitHub 的 Releases 列表不会在版本列表中直接列出安装包文件名，这是 GitHub
的界面行为；README 和每个版本页面的“Assets”都提供下载入口。完整发布步骤见
[`RELEASING.md`](RELEASING.md)。

## 当前限制

- 尚未完成 Windows 和 Android 的代码签名。
- Android 仍需在物理设备上完成通知、SQLCipher、Keystore 和后台行为验收。
- Windows 多显示器、混合 DPI、安装升级和系统通知仍需发布前回归。
- 更新只在应用启动或后台进程运行并完成检查后提示；应用完全关闭时没有推送通道。
- 已安装的 `0.1.1-alpha.1` 不包含本轮的独立 GitHub 更新检查，无法被追溯修复；
  用户需先手动安装之后发布的新版本，后续版本才会使用新的更新提示链路。
