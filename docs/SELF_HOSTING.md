# 自建同步服务

清记默认可以完全离线使用。自建服务器用于账号登录、多设备同步和应用更新回退。

现有 `compose.yaml` 只启动本地 PostgreSQL 开发容器；`Dockerfile.server` 用于构建
服务端镜像。生产部署需要自行提供容器编排、持久化卷、反向代理和备份策略。

## 1. 本地服务

从仓库根目录运行：

```powershell
npm ci
npm run setup:local
npm run db:up
npm run dev:server
```

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

典型响应：

```json
{
  "status": "ok",
  "database": "connected",
  "service": "qingji-server"
}
```

再看能力信息：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/v1/meta
```

客户端设置页填写 `http://127.0.0.1:8787`，即可注册账号并启用同步。

## 2. 环境文件

本地启动时涉及两个环境文件：

- 根目录 `.env`：仅供 Docker Compose 初始化 PostgreSQL；
- `services/server/.env`：Fastify 运行时配置。

完整变量说明如下。

### 2.1 数据库

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `POSTGRES_ADMIN_PASSWORD` | 根 `.env` 必需 | Compose 创建数据库管理员角色时使用 |
| `QINGJI_APP_DB_PASSWORD` | 根 `.env` 必需 | Compose 创建 `qingji_app` 业务角色时使用 |
| `DATABASE_URL` | 服务端必需 | 业务连接，使用 `qingji_app`，受 RLS 约束 |
| `DATABASE_ADMIN_URL` | 建议生产配置 | 启动迁移使用；缺失时回退到 `DATABASE_URL` |

业务连接不应使用 PostgreSQL 超级用户。管理员连接只在启动和迁移时使用，运行时代码
通过受限的 `qingji_app` 执行任务查询与写入。

### 2.2 网络

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | Fastify 监听端口 |
| `HOST` | `0.0.0.0` | 容器内通常保持不变；本地可改为 `127.0.0.1` |
| `CORS_ORIGIN` | 内置清记来源 | 逗号分隔的允许来源列表 |

默认来源包括 Electron、Capacitor 和本机 Vite 开发地址。公网部署若通过普通浏览器
访问额外域名，应显式设置 `CORS_ORIGIN`，不要使用通配符放开任意来源。

### 2.3 安全与审计

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `TASK_DATA_ENCRYPTION_KEY` | 生产必需 | 用于 AES-256-GCM 加密任务敏感字段 |
| `AUDIT_HUB_URL` | 可选 | 外部统一审计接收地址 |
| `AUDIT_HUB_PROJECT_KEY` | 可选 | 外部审计项目密钥 |

`TASK_DATA_ENCRYPTION_KEY` 应使用足够随机的独立密钥，例如：

```powershell
$bytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
```

将生成的密钥保存在密码管理器或专用密钥系统中，不要与数据库备份放在同一位置。
丢失密钥会导致服务端无法解密已有事项字段，即使数据库本身仍能连接。

生产环境（`NODE_ENV=production`）缺少该变量时，服务端会在启动阶段拒绝运行。不要
依赖非生产环境的开发回退密钥，也不要在示例、日志或提交中保留真实密钥。

外部审计服务不可用时，同步和认证不应因此失败；服务端仍保留本地追加式安全审计表。
`AUDIT_HUB_URL` 和 `AUDIT_HUB_PROJECT_KEY` 应同时配置；缺少任一项时不会启用外部
镜像。

### 2.4 更新

| 变量 | 说明 |
| --- | --- |
| `APP_UPDATE_VERSION` | 固定返回的最新版本，与 URL 必须同时设置 |
| `APP_UPDATE_URL` | 合法的 GitHub Release HTTPS 地址 |
| `APP_UPDATE_NOTES` | 可选更新说明，最多保留约 500 字符 |

未设置 `APP_UPDATE_VERSION` 和 `APP_UPDATE_URL` 时，服务端会从公开 Release feed
自动发现带 `.exe` 或 `.apk` 资产的最新版本。固定配置适合运维回滚或暂停自动发现。

`GET /v1/update` 会为当前平台返回同源代理下载地址，`GET /v1/update/download`
再由服务端流式获取并转发 GitHub Release 安装包。最终用户只访问自建服务器，不需要
直接连接 GitHub；服务端主机必须允许出站访问 GitHub。

这种方式只解决客户端直连 GitHub 的问题，不能消除服务端到 GitHub 的跨境链路风险。
高并发、大文件或需要稳定下载 SLA 时，应先把安装包发布到腾讯云 COS、阿里云 OSS
或其他国内 CDN，再让更新接口返回国内镜像地址和 SHA-256。当前代码尚未实现该镜像
链路，GitHub 实时代理应视为过渡方案。

2026-11-20 在腾讯云上海主机实测，GitHub Release feed 和安装包下载均在 20 秒后
超时、收到 0 字节。没有国内镜像时，该主机的代理下载和自动 Release 发现不能用于
正式更新分发。

客户端优先使用编译期的官方更新服务，服务不可达时再尝试用户配置的服务器，最后才
尝试 GitHub。若要替换客户端默认更新服务，可在构建 `@qingji/client` 时设置
`VITE_QINGJI_UPDATE_SERVER_URL`；Vite 变量会固化到前端产物中，不含秘密信息。

## 3. 构建服务端镜像

在仓库根目录：

```powershell
docker build -f Dockerfile.server -t qingji-server:local .
```

镜像使用多阶段构建，运行时以非 root 用户执行，并暴露 `8787`。容器启动时必须注入
服务端环境变量。容器内的数据库主机名不能沿用开发文件中的 `127.0.0.1`，应改为
数据库在编排网络中的服务名。

生产容器至少需要：

- 可访问 PostgreSQL 的私有网络；
- `DATABASE_URL`，以及用于最小权限迁移的 `DATABASE_ADMIN_URL`；
- 持久、随机且已备份的 `TASK_DATA_ENCRYPTION_KEY`；
- 正确的 `CORS_ORIGIN`；
- 健康检查 `/health`；
- 退出时允许完成连接清理的时间。

服务端启动会自动执行迁移。滚动升级时应先验证迁移与旧客户端兼容，再扩大新版本实例。
不使用 `DATABASE_ADMIN_URL` 时迁移会尝试使用业务角色；该角色应具备迁移所需权限，
否则启动会失败。

## 4. 反向代理与 HTTPS

公网和局域网客户端会拒绝非回环 HTTP 地址。生产必须由反向代理终止 TLS：

- 使用受信任证书；
- 将 HTTPS 请求转发到 Fastify；
- 保留正确的 Host、X-Forwarded-* 头；
- 为 `/v1/sync/live` 配置 WebSocket 升级；
- 不缓存 `/v1/*` 响应；
- 不要把 PostgreSQL 端口暴露到公网。

客户端可以填写带固定路径的服务器地址；WebSocket 会在同一路径下追加
`/v1/sync/live`。反向代理必须保持这一前缀。

## 5. 备份与恢复

账号数据在 PostgreSQL，字段另有应用层加密。备份至少应覆盖：

- PostgreSQL 数据；
- `TASK_DATA_ENCRYPTION_KEY`；
- 部署与反向代理配置。

备份文件必须加密，并放在与原系统隔离的位置。只备份数据库而不备份字段密钥，无法
恢复可读事项；只备份密钥而不备份数据库，同样无法恢复历史。

建议定期执行完整恢复演练：

1. 在隔离环境启动空 PostgreSQL；
2. 恢复数据库；
3. 注入备份时的密钥和完整服务端配置；
4. 启动对应版本服务端；
5. 检查 `/health`、`/v1/meta`、登录、拉取和实时同步；
6. 对比恢复前后账号、任务和软删除计数。

备份成功不等于恢复可用，恢复演练结果应保留可审计记录。

## 6. 安全边界

- 服务端同步不是端到端加密，服务器能够访问解密后的事项；
- 应用层日志不记录正文，但数据库管理员、备份管理员和主机管理员仍属于受信主体；
- 账号注册当前不依赖真实邮箱，身份安全依赖用户名、密码、限流和服务器运营；
- 已登录用户可以验证当前密码后重置密码；未登录的忘记密码恢复仍需额外身份机制；
- 登录限流使用进程内状态，多实例部署不能视为全局限流；
- 当前未提供完整账号删除、密钥轮换和多区域备份工作流；
- 生产前应配置主机防火墙、最小权限数据库角色、日志留存和监控告警。

## 7. 发布后检查

每次升级至少检查：

```powershell
Invoke-RestMethod https://your-server.example/health
Invoke-RestMethod https://your-server.example/v1/meta
```

然后使用两个隔离账号/设备验证注册、登录、推送、拉取、冲突、删除同步和断线恢复。
应用更新检查还需确认版本、说明和安装包正确，并分别验证更新服务可达时可直接下载，
以及更新服务不可用时能够回退到 GitHub Release。
