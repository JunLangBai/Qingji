# 开发指南

本文说明如何从源码启动、测试和构建清记。用户安装与使用说明见根目录
[README](../README.md)。

## 1. 环境要求

客户端开发需要：

- Node.js 24（仓库当前使用该主版本验证）；
- npm（随 Node.js 安装）；
- Git。

本地同步服务还需要 Docker 与 Docker Compose。

平台构建还需要：

| 目标 | 额外依赖 |
| --- | --- |
| Windows 桌面 | Windows 10/11；Node.js 依赖会自动安装 Electron 与 electron-builder |
| Android | JDK 21、Android SDK 36、可用的 Android Build Tools |

项目是 npm workspaces 单仓库。根目录命令会按工作区调度各包，不需要分别安装依赖。

## 2. 首次初始化

在仓库根目录安装依赖：

```powershell
npm ci
```

只有需要运行本地数据库和同步服务时，再生成环境文件：

```powershell
npm run setup:local
```

`setup:local` 会：

1. 根据 `.env.example` 生成根目录 `.env`，用于 PostgreSQL 容器初始化；
2. 根据 `services/server/.env.example` 生成服务端 `.env`，用于本地 API；
3. 为管理员和应用数据库角色生成彼此独立的随机密码；
4. 不覆盖任何已有环境文件。

根 `.env` 和 `services/server/.env` 均被 Git 忽略。不要手工提交或粘贴其中的密码。
如果初始化提示文件已存在，请先确认现有配置是否仍可使用；需要重建时应先安全备份
或移走旧文件，而不是直接删除现有数据库密钥。

## 3. 启动开发环境

### 3.1 本机模式

只开发共享界面或桌面客户端时，不需要启动数据库和同步服务：

```powershell
npm run dev
```

该命令并行启动：

- `@qingji/client`：Vite 开发服务器，地址为 `http://127.0.0.1:5173`；
- `@qingji/desktop`：等待 Vite 就绪后启动 Electron。

也可以分开启动：

```powershell
npm run dev:client
```

另开终端：

```powershell
npm run dev:desktop
```

Vite 固定使用 `127.0.0.1:5173`，并开启严格端口检查。端口被占用时请先关闭占用
进程，避免桌面端连接到错误的开发服务器。

### 3.2 本地同步服务

终端 1 启动 PostgreSQL：

```powershell
npm run db:up
```

终端 2 启动 Fastify：

```powershell
npm run dev:server
```

本地 API 默认监听 `http://127.0.0.1:8787`。运行根目录 `npm run dev:server` 时，
npm 会将工作目录切换到 `services/server`，服务端因此会读取
`services/server/.env`。

检查健康状态：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

客户端设置页的服务器地址默认就是 `http://127.0.0.1:8787`。非回环地址必须使用
HTTPS；`localhost`、`127.0.0.1` 和 `::1` 才允许 HTTP。

停止本地数据库容器：

```powershell
npm run db:down
```

`db:down` 不删除命名卷。只有带 `-v` 的 Compose 清理命令才会删除数据，执行前务必
确认目标卷和环境。

## 4. 工作区与依赖方向

```text
apps/desktop ─┐
              ├─> packages/client ─> packages/contracts ─> packages/domain
apps/mobile ──┘

services/server ─> packages/contracts ─> packages/domain
```

| 工作区 | 职责 |
| --- | --- |
| `@qingji/domain` | 纯 TypeScript 领域规则、时间处理、排序和版本比较 |
| `@qingji/contracts` | 桌面 IPC、任务、认证、同步和更新协议类型 |
| `@qingji/client` | React UI、数据仓库、同步客户端、提醒计划和更新检查 |
| `@qingji/desktop` | Electron 主进程、preload、托盘、便签、本地 SQLite 和打包 |
| `@qingji/mobile` | Capacitor 配置与 Android 原生工程 |
| `@qingji/server` | Fastify API、认证、同步、审计、加密和 PostgreSQL 迁移 |

修改协议时，应同时检查 `packages/contracts`、客户端、桌面 preload 和服务端调用方。
修改领域规则时优先补充领域层测试，不要把同一规则复制到多个平台。

## 5. 测试与质量检查

基础检查：

```powershell
npm run typecheck
npm test
npm run build
```

各工作区测试由 `npm test` 汇总执行。涉及数据库的集成测试使用真实 PostgreSQL，
在本地数据库已启动且环境文件有效时运行：

```powershell
npm run test:integration
```

集成测试会读取以下环境变量，优先使用测试专用变量：

| 测试变量 | 本地回退变量 |
| --- | --- |
| `TEST_DATABASE_URL` | `DATABASE_URL` |
| `TEST_DATABASE_ADMIN_URL` | `DATABASE_ADMIN_URL` |

服务端启动时会自动执行数据库迁移。若需要完全隔离的测试环境，应在专用的测试
PostgreSQL 实例上运行，不要指向生产数据库。

提交前至少应完成与改动范围对应的：

1. `npm run typecheck`；
2. 受影响的单元测试；
3. 涉及同步时运行 `npm run test:integration`；
4. 修改构建入口或原生配置时执行对应平台构建。

## 6. Windows 桌面构建

开发构建由 esbuild 打包 Electron 主进程和 preload。生成安装包：

```powershell
npm run desktop:dist
```

该命令先打包桌面主进程，再由 electron-builder 生成 `nsis` 和 `portable` 两种
Windows 目标。输出目录为 `apps/desktop/release/`，并已被 Git 忽略。

默认数据目录规则涉及安装盘、`%LOCALAPPDATA%` 和旧数据迁移。修改相关逻辑时至少
运行：

```powershell
npm run test -w @qingji/desktop
```

并手工验证：

- 首次启动创建正确的用户数据目录；
- 已有 `data-location.json` 时复用已保存的位置；
- `QINGJI_DATA_DIR` 可用且优先级明确；
- 迁移只复制、不覆盖已有数据库；
- 卸载后稳定数据目录仍然存在。

## 7. Android 构建

Android 使用 Capacitor 同步 `packages/client/dist` 到原生工程。干净检出后必须先
构建共享前端，否则同步目录不存在：

```powershell
npm run build -w @qingji/client
npm run mobile:sync
npm run mobile:build:debug
```

Debug APK 位于：

```text
apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Release 构建必须提供四个签名变量：

```powershell
$env:ANDROID_KEYSTORE_PATH = "C:\secure\qingji-release.keystore"
$env:ANDROID_KEYSTORE_PASSWORD = "<store-password>"
$env:ANDROID_KEY_ALIAS = "qingji"
$env:ANDROID_KEY_PASSWORD = "<key-password>"
npm run mobile:sync
npm run mobile:build:release
```

也可以在本机 JDK 目录符合脚本约定时运行 `npm run mobile:signing:init`。该命令只在
被 Git 忽略的本地目录中创建新密钥和配置文件；脚本不会覆盖已有密钥。

Release 脚本会检查签名是否就绪，并使用 `apksigner` 验证 APK。keystore 和口令不得
进入仓库、构建日志或 Release 资产。后续安装升级必须继续使用同一份 keystore。

修改 Web 代码后，每次生成 APK 前都要重新构建前端并执行 `mobile:sync`。

## 8. 常见问题

### `setup:local` 提示文件已存在

这是保护机制。两个环境文件不会按“存在哪个就跳过哪个”的方式部分重建。检查现有
配置、数据库连接和密码来源，确认无价值后再安全移走旧文件。

### 桌面端启动后一直等待

确认 Vite 已监听 `http://127.0.0.1:5173`。`npm run dev` 会同时启动两端；
手动运行 `dev:desktop` 时必须先启动 `dev:client`。

### `mobile:sync` 找不到 `webDir`

先执行 `npm run build -w @qingji/client`，再运行 `npm run mobile:sync`。

### 服务端没有读取环境变量

从仓库根目录使用 `npm run dev:server` 或 `npm run start -w @qingji/server`。直接
执行编译后的 `node services/server/dist/index.js` 时，进程只会在当前工作目录读取
`.env`；生产环境应显式注入环境变量。

### 修改数据库密码后无法连接

PostgreSQL 初始化脚本通常只在空数据卷首次启动时执行。已有卷不会因为 `.env` 改了
密码就自动修改数据库角色。应在数据库内同步轮换凭据，或在确认无需保留数据时重建
专用开发卷。

### 同步服务在另一台设备或局域网不可访问

本地开发默认只适合回环地址。局域网访问需要服务端监听可达接口、配置允许的 CORS
来源并使用 HTTPS；客户端会拒绝非回环 HTTP 地址。
