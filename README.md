# 清记 / Qingji

清记是一款以精确截止时间为核心的个人事项工具。它按创建日期整理待办，帮助用户
快速看见今天到期和已经逾期的事项，并在完成后长期保留历史记录。

Qingji is a deadline-first, local-first task app for Windows and Android.

> 当前状态：开发者预览。Windows、Android 安装包和本地/账号同步链路已经可用；
> Windows 代码签名、Android 真机完整验收和更多发布质量工作仍在进行。

## 主要功能

- 创建、编辑、完成、撤销、恢复和删除事项，每个事项都必须有截止时间。
- 按创建日期分组，集中展示今天到期和已逾期事项。
- 保留完成历史，并支持筛选、多选及批量操作。
- 支持到期提醒、每日摘要、免打扰和单事项提醒覆盖。
- Windows 提供主窗口、系统托盘和每个事项独立的桌面便签。
- 默认本地优先，支持 JSON 备份、自建服务器和 Windows/Android 账号同步。
- 增量同步支持实时通知、轮询兜底、幂等重试、冲突保留和软删除。
- 账号设置支持验证当前密码后重置密码，并退出其他设备会话。
- 应用内更新检查默认使用可直连的更新服务，并通过该服务代理安装包下载。

## 下载

当前预览版为 `0.1.4-alpha.1`：

- [Windows x64 安装包](https://github.com/JunLangBai/Qingji/releases/download/v0.1.4-alpha.1/Qingji-0.1.4-alpha.1-Windows-Setup-x64.exe)
- [Android APK](https://github.com/JunLangBai/Qingji/releases/download/v0.1.4-alpha.1/Qingji-0.1.4-alpha.1-Android-Release.apk)
- [SHA-256 校验文件](https://github.com/JunLangBai/Qingji/releases/download/v0.1.4-alpha.1/SHA256SUMS.txt)
- [全部版本](https://github.com/JunLangBai/Qingji/releases)

Release 列表只显示版本标签；安装包位于具体版本页面的“Assets”区域。下载后建议先
核对 `SHA256SUMS.txt`。Windows 安装包当前尚未使用受信任的代码签名证书。

Windows 可通过“设置 → 应用 → 已安装的应用 → 清记 → 卸载”卸载，安装目录中也
提供 `Uninstall 清记.exe`。卸载程序不会删除本机数据，但仍建议卸载前先在应用内
导出备份。

## 本机数据

清记不要求登录。未连接服务器时，所有事项只保存在当前设备。

- Windows 使用本地 SQLite，敏感载荷通过 Electron `safeStorage` 加密；默认数据
  位于安装盘 `QingjiData/<Windows用户标识>/`。
- 实际数据根目录记录在 `%LOCALAPPDATA%\Qingji\data-location.json`。
- 可通过 `QINGJI_DATA_DIR` 环境变量指定其他数据根目录。
- 旧安装目录和 AppData 中的数据会在首次启动时择优复制迁移；迁移不会删除旧数据。
- Android 使用 SQLCipher，并将安全凭据保存在 Android Keystore 支持的存储中。
- JSON 导入会在发生同 ID 冲突时创建副本，不会静默覆盖现有事项。

账号同步需要用户填写自建服务器地址。服务器处理同步时能够读取事项内容，因此当前
实现不是端到端加密；公网部署应使用 HTTPS、独立密钥和受控备份。

## 本地开发

客户端开发需要 Node.js 24 和 npm。启动本地同步服务还需要 Docker Compose；构建
Android 客户端还需要 JDK 21 与 Android SDK 36。

首次安装依赖：

```powershell
npm ci
```

如果要运行本地同步服务，再生成数据库和服务端环境：

```powershell
npm run setup:local
```

`setup:local` 会生成被 Git 忽略的根目录 `.env` 和 `services/server/.env`，并为
数据库创建管理员密码和应用密码。已有任意一个环境文件时脚本会停止，不会覆盖。

启动本地数据库和服务端（终端 1）：

```powershell
npm run db:up
npm run dev:server
```

启动共享 Web 界面与 Windows 桌面开发环境（终端 2）：

```powershell
npm run dev
```

如果只想使用本机模式，可以跳过 `setup:local`、数据库和服务端，直接启动客户端。
更完整的工具链、构建和排错说明见 [开发指南](docs/DEVELOPMENT.md)。

## 项目结构

```text
apps/
  desktop/       Electron 主进程、托盘、便签与 Windows 打包
  mobile/        Capacitor 配置与 Android 原生工程
packages/
  client/        两端共享的 React 界面与客户端数据逻辑
  contracts/     IPC、认证、同步和更新协议类型
  domain/        事项、时间、排序与状态规则
services/
  server/        Fastify 同步服务与 PostgreSQL
scripts/         环境初始化、集成测试和平台构建脚本
```

共享 UI 同时被 Electron 和 Capacitor 使用；本地能力由各自的原生适配层提供。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 同时启动共享 Web 界面和 Windows 桌面开发环境 |
| `npm run dev:client` | 仅启动共享 Web 界面 |
| `npm run dev:server` | 启动本地 Fastify 服务 |
| `npm run typecheck` | 检查全部工作区 TypeScript 类型 |
| `npm test` | 运行全部工作区单元测试 |
| `npm run build` | 构建领域包、协议包、前端、桌面主进程和服务端 |
| `npm run desktop:dist` | 生成 Windows NSIS 与便携版安装包 |
| `npm run mobile:build:debug` | 生成 Android debug APK |

## 文档

- [开发指南](docs/DEVELOPMENT.md)：环境要求、启动方式、测试、平台构建和排错。
- [架构说明](docs/ARCHITECTURE.md)：模块边界、本地数据、同步、安全、通知和更新。
- [自建服务](docs/SELF_HOSTING.md)：服务端配置、部署边界、备份和运营注意事项。
- [发布流程](docs/RELEASING.md)：版本、安装包、签名、校验、GitHub Release 与更新。

## 当前限制

- Windows 安装包尚未代码签名，首次运行时可能出现系统安全提示。
- Android release APK 已有签名，但通知、SQLCipher、Keystore 和后台行为仍需完成
  更完整的物理真机验收。
- 更新提示不是后台推送。应用完全关闭时不会收到提醒，下次启动后才会检查。
- 当前腾讯云生产主机无法直接访问 GitHub，20 秒探测收到 0 字节，因此现有代理下载
  和自动 Release 发现均不可用；客户端仍会继续尝试 GitHub 备用检查。
- 无 VPN 更新需要先把安装包发布到国内对象存储/CDN，再由更新服务返回国内镜像；
  当前不会静默下载或自动安装。
- 提醒目前由各设备本地调度；多设备重复摘要去重和服务端推送尚未实现。
- 服务端同步不是端到端加密，部署者必须按敏感业务数据保护服务器和备份。
- 仓库当前未包含独立的 `LICENSE` 文件，复用或分发前请先与维护者确认授权范围。
