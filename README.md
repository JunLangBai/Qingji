# 清记 / Qingji

清记是一款以精确截止时间为核心的个人事项工具。它按创建日期整理待办，帮助用户快速看见今天到期和已经逾期的事项，并在完成后长期保留历史记录。

Qingji is a deadline-first, local-first task app for Windows and Android.

> 当前状态：开发者预览。核心功能和同步链路已经实现，安装包签名、成品发布与完整真机验收仍在进行。

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

## 数据方式

清记默认将所有事项保存在当前设备。用户也可以填写自建服务器地址并登录账号，在 Windows 与 Android 之间同步数据。

服务器处理同步时可以解密事项内容，因此当前实现不是端到端加密。公网部署应使用 HTTPS、独立密钥和受控的数据库备份。

## 当前限制

- 尚未完成 Windows 和 Android 的代码签名。
- Android 仍需在物理设备上完成通知、SQLCipher、Keystore 和后台行为验收。
- Windows 多显示器、混合 DPI、安装升级和系统通知仍需发布前回归。
- 正式 GitHub Release 与自动更新地址尚未配置。
