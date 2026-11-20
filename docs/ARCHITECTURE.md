# 架构说明

本文描述当前源码的整体结构和关键数据流。产品功能范围以根目录
[README](../README.md) 为准，开发命令见 [开发指南](DEVELOPMENT.md)。

## 1. 总览

```text
┌───────────────────────────────┐
│ packages/client               │
│ React UI / task store / sync  │
└───────────┬───────────┬───────┘
            │           │
     Electron preload    Capacitor plugins
            │           │
┌───────────▼─────┐ ┌───▼────────────────┐
│ apps/desktop    │ │ apps/mobile/android │
│ windows / tray  │ │ SQLCipher / keystore│
│ local SQLite    │ │ local notifications │
└───────────┬─────┘ └───┬────────────────┘
            │ HTTP + WS │
            └─────┬─────┘
                  ▼
        ┌────────────────────┐
        │ services/server    │
        │ Fastify + auth     │
        │ sync + update API  │
        └─────────┬──────────┘
                  ▼
             PostgreSQL
```

`packages/client` 是两端共享的 React 应用。`apps/desktop` 和 `apps/mobile` 只负责
平台壳、原生能力和打包，不另建一套事项业务规则。

## 2. 模块边界

### 2.1 领域与协议

- `@qingji/domain` 保持为无浏览器、无 Node 原生依赖的纯 TypeScript 领域层。
- `@qingji/contracts` 定义跨进程和跨网络的稳定类型，包括任务、认证、同步 mutation、
  桌面 IPC、通知计划和更新状态。
- React 组件通过 data/store hooks 访问数据，不直接拼接同步协议。
- Electron 渲染进程不直接访问文件系统或 SQLite；所有本地持久化经 preload IPC
  交给主进程。

### 2.2 任务与时间

- `dueAt`、`createdAt` 和 `completedAt` 使用绝对时间。
- `createdOn` 是创建时的用户本地日期，用于稳定分组。
- `createdTimezone` 保存 IANA 时区，避免服务器或另一台设备用自己的时区重新解释
  创建日期。
- 逾期和今天到期按当前设备的本地时间及精确截止时刻计算。
- 删除使用软删除墓碑并同步，以便其他设备收敛。

### 2.3 本地数据

| 平台 | 持久化 | 加密 |
| --- | --- | --- |
| Windows | Electron 主进程管理的 SQLite profile | 使用 Electron `safeStorage` 处理敏感载荷；令牌同样受保护 |
| Android | Capacitor SQLite | SQLCipher；敏感令牌使用 Android Keystore 支持的存储 |
| 浏览器开发 | Web 存储回退 | 仅用于开发调试，不作为正式发布目标 |

Windows 数据位置按以下顺序尝试：显式 `QINGJI_DATA_DIR`、已记录的
`%LOCALAPPDATA%\Qingji\data-location.json`、安装盘 `QingjiData`、本地 AppData
回退目录。成功选择后会写回指针文件。

当目标用户目录没有有效数据库时，应用会检查旧安装目录、嵌套安装目录和旧 AppData。
候选数据按数据库更新时间和记录数量择优，迁移采用复制后再切换，不覆盖已有目标。

本地 profile 按“本机”或“服务器地址 + 用户 ID”隔离。账号缓存、本机数据和当前
会话不会混在同一个可见集合中。

## 3. 本地写入与多窗口收敛

桌面主窗口和便签窗口共享同一任务快照。写入采用以下原则：

- 以稳定快照对外发布，外部订阅者不会读到正在拼装的中间状态；
- 跨窗口写入通过浏览器锁串行化；
- 本机 SQLite profile 使用版本号做比较后写入，避免旧快照覆盖新数据；
- 多窗口收到更新后重新读取领域状态，保证主窗口和便签中的完成、删除和编辑一致。

便签布局、主窗口关闭行为和设备提醒偏好属于设备本地设置，不通过账号同步。

## 4. 账号与同步

### 4.1 认证

- 用户名在单个服务器内执行规范化后保持唯一。
- 账号密码至少 8 位，使用带随机盐的 scrypt 哈希，数据库不保存原始密码。
- 会话使用随机会话令牌，服务端只保存令牌摘要。
- 登录失败按 IP 与用户名执行限流，错误信息不披露账号是否存在。
- 会话有到期时间，并支持退出吊销。
- 已登录用户验证当前密码后可重置密码；当前会话保留，其他设备会话全部吊销。

### 4.2 同步模型

客户端调用 `POST /v1/sync` 提交带 `mutationId` 的任务变更，并通过账号内游标拉取
服务端变更。每个 mutation 在服务器端幂等：

1. 服务端在用户事务内设置当前账号上下文；
2. PostgreSQL RLS 限制任务和 mutation 结果只能访问当前账号；
3. 已处理的 `mutationId` 返回已保存结果，不重复应用；
4. 任务使用 revision 做乐观并发控制；
5. 接受或拒绝结果与服务器序号一起返回客户端。

同一事项的冲突不会静默丢弃其中一版。客户端保留服务器版本和本机版本，供用户决定。
软删除墓碑保证删除也能传播到其他设备。

### 4.3 实时与轮询

- 认证后的设备连接 `GET /v1/sync/live` WebSocket；
- 某一设备写入后，服务端向同一账号的其他在线连接发送 `sync-available`；
- 收到通知后客户端拉取，不把 WebSocket 消息本身当作权威数据；
- 客户端每 15 秒轮询一次，作为断线和后台恢复的兜底。

这种设计的权威数据始终是 PostgreSQL 中的事务结果；实时消息只负责提示“需要拉取”。

## 5. 服务端边界

Fastify 服务提供：

| 路径 | 作用 |
| --- | --- |
| `GET /health` | 服务和数据库健康状态 |
| `GET /v1/meta` | API、同步协议和已启用能力 |
| `POST /v1/auth/register` | 注册 |
| `POST /v1/auth/login` | 登录 |
| `GET /v1/auth/me` | 当前会话用户 |
| `POST /v1/auth/logout` | 退出并吊销会话 |
| `POST /v1/auth/password/reset` | 验证当前密码并重置账号密码 |
| `POST /v1/sync` | 推送 mutation 并拉取账号变更 |
| `GET /v1/sync/live` | 认证 WebSocket |
| `GET /v1/update` | 当前平台版本状态 |
| `GET /v1/update/download` | 通过更新服务代理当前平台安装包 |

数据库迁移在服务启动时执行。管理员连接负责结构与旧数据迁移；业务运行时使用非
超级用户角色，`tasks` 和 `task_mutations` 强制行级安全。

详细环境变量、HTTPS 和备份要求见 [自建服务](SELF_HOSTING.md)。

## 6. 安全模型

- 密码至少 8 位并使用 scrypt；会话数据库只保存摘要。
- 服务端事项标题、备注和 mutation 幂等结果使用 AES-256-GCM 应用层加密。
- API 日志不记录请求正文，并脱敏认证头、Cookie 和 Set-Cookie。
- CORS 默认只允许 Capacitor、Electron 和本机开发来源；生产可配置白名单。
- API 响应设置 `no-store`、`nosniff`、`no-referrer` 和受限 Permissions Policy。
- Electron 页面使用严格 CSP，外部打开只允许经过校验的 GitHub Release 或更新
  下载地址。
- 审计表仅追加，只记录认证与同步安全元数据，不记录事项正文、密码或令牌。

服务端在同步时必须解密事项载荷，因此不是端到端加密（E2EE）。这表示服务器管理员
或具备数据库密钥和连接权限的主体在理论上可以访问事项内容。部署者必须据此配置
访问控制、备份加密和密钥保管。

## 7. 提醒与摘要

提醒由客户端生成统一计划，再由平台适配层调度：

- 到期提醒时间 = `dueAt - 提前量`；
- 单事项提前量为 `null` 时跟随设备默认值，`-1` 表示不提醒；
- 落入免打扰时段的提醒顺延到免打扰结束；
- 完成、撤销、删除、改期和同步更新后重新计算；
- 每日摘要一次生成未来 31 天计划，并滚动刷新。

Windows 由 Electron 托盘主进程持有定时器；Android 使用 Local Notifications。
这是设备本地调度，不是服务端推送，因此应用彻底停止或最后一次同步之后发生的变化
可能无法立即反映到已安排的提醒中。

## 8. 应用更新

客户端依次尝试官方更新服务、当前配置的服务器和公开 GitHub Releases。只接受：

- 合法 SemVer 版本标签；
- 非草稿版本；
- 指向 GitHub Release 的 HTTPS 地址；
- 至少包含一个 `.exe` 或 `.apk` 资产。

如果更新服务可达，客户端会直接采用它的结果，不再等待 GitHub 请求。服务端在未设置
`APP_UPDATE_*` 时会自动发现带安装包的最新公开 Release；显式配置可覆盖自动发现。

更新状态中的 `downloadUrl` 会被解析为与报告服务同源的
`/v1/update/download` 地址。Windows 与 Android 安装包由服务端代理下载，客户端
只需要访问清记更新服务，不需要直接连接 GitHub。服务端必须能够出站访问 GitHub。

当前代理是临时过渡方案：每个冷下载仍然从 GitHub 实时获取文件，因此可能受到跨境
链路波动、GitHub 限流、服务器出站带宽和并发压力的影响。生产级方案应在发布时把
安装包预上传到国内对象存储或 CDN，由更新服务返回静态镜像地址和 SHA-256；GitHub
代理仅作为应急兜底。

2026-11-20 在生产服务器实测：GitHub Release feed 和 Release 安装包均在 20 秒后
超时，收到 0 字节。该主机上的自动 Release 发现和代理下载因此不可用。客户端不能
把服务端返回的 `available: false` 单独视为 GitHub 无新版本，必须继续尝试其他来源。

如果更新服务没有提供代理下载地址，客户端会回退到经过校验的 GitHub Release 页面。
客户端不会执行服务器返回的远程代码，也不会静默安装。应用完全关闭时没有推送通道，
下次启动才会检查。

## 9. 修改指南

- 新功能优先放在共享 `packages/client`，只有平台专属能力才进入 Electron 或
  Capacitor 壳。
- 新网络字段先改 `packages/contracts`，再同步服务端、客户端和迁移。
- 新持久化字段必须考虑旧 profile、JSON 导入和账号同步的兼容性。
- 新安全敏感日志不得包含事项正文、认证令牌、密码、密钥或备份内容。
- 修改同步语义时，同时更新服务端集成测试、客户端冲突处理和本文档。
