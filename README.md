# R3 MCP on Cloudflare Workers

单人自用的邮箱 MCP，采用 Cloudflare 官方 OAuth Provider。自己的极简口令授权页，无第三方登录。邮件功能仍只有搜索、读取、保存草稿，**不能发送**；UUID / Unix 时间工具保留。

## 连接

MCP 地址：`https://r3.net.eu.org/mcp`，选择 OAuth。客户端通过元数据发现、CIMD 或动态注册（DCR）连接，无需手动分配固定 API Key。授权页输入单独的 **R3 授权口令**，不是 QQ 邮箱密码。仅批准你主动发起的连接，并核对页面上的客户端及回调地址；客户端名称是自报的，不是认证标识。

旧 `/mcp/<秘密路径>` 已停用，旧连接需要删除后重新添加。`workers.dev` 保留公开状态页与 `/204`，OAuth 仅在上述自定义域名提供，避免多个 issuer。

- `/authorize`：输入口令并明确同意，支持拒绝。
- `/token`：官方库处理授权码兑换、刷新和 RFC 7009 撤销。
- `/register`：动态注册；也支持客户端 HTTPS metadata document。
- `/.well-known/oauth-authorization-server`：授权服务器元数据。
- `/.well-known/oauth-protected-resource/mcp`：MCP 资源元数据。
- `/`：公开 HTML / 纯文本状态页；`/204`：公开连通性检查，不检查邮箱健康。

使用授权码 + PKCE S256。访问令牌有效期 1 小时，刷新令牌 30 天；刷新与撤销由官方库处理。`mcp:access` 是一个简单的全工具权限，不做复杂权限体系。OAuth 访问令牌仍通过标准 Bearer 请求头传输，和以前的固定 API Key 是不同的机制。

## 配置与安全边界

| 配置                                | 存放位置                  | 用途                                             |
| ----------------------------------- | ------------------------- | ------------------------------------------------ |
| `IMAP_SERVER` / `IMAP_PORT`         | `wrangler.jsonc`          | 当前 `imap.qq.com:993`，仅 IMAPS TLS             |
| `IMAP_ACCOUNT`                      | Worker Runtime Secret     | 完整邮箱地址                                     |
| `IMAP_SECRET`                       | Worker Runtime Secret     | QQ IMAP 授权码，不是登录密码                     |
| `AUTH_PASSWORD`                     | Worker Runtime Secret     | 独立随机授权口令，至少 32 字符，建议 32 随机字节 |
| `OAUTH_KV`                          | Worker KV binding         | 客户端、授权和令牌状态；由官方库管理             |
| `AUTH_LIMITER`                      | Worker Rate Limit binding | 每 IP / 每类操作 10 次每分钟；非全球严格计数     |
| `MAIL_FROM` / `IMAP_DRAFTS_MAILBOX` | 可选 Runtime 设置         | 默认邮箱账户 / 自动识别草稿目录                  |

生产 Secrets 只在 Cloudflare 的 Worker Runtime 配置中设置，不放 GitHub 或 Build variables。代码部署不会把本机 `.env` 上传为 Secrets。KV ID 不是凭据，可以放 Git；KV 内的数据不放 Git。Provider 保存令牌哈希并加密授权 props，不把 IMAP 密码发给客户端。

授权页使用 Secure / HttpOnly / SameSite Cookie、绑定原始 OAuth 请求的 CSRF 校验、Origin 校验、CSP 和限速。CIMD 使用 `global_fetch_strictly_public` 防止读取内网地址。口令代表唯一的 owner，不是多人账户系统。拿到口令仍然可以授权自己的客户端，请保存在密码管理器里。

更新线上口令可在 Dashboard 修改 `AUTH_PASSWORD`，或交互输入（不要把值放命令行）：

```bash
npx wrangler secret put AUTH_PASSWORD
```

使用新的随机口令，不复用旧口令。代码会在每次 MCP 请求检查授权时的口令指纹，因此更换后旧访问令牌和旧授权刷新出来的令牌均不能再使用 MCP，所有客户端需要重新授权。旧授权记录会随生命周期过期；客户端可向 `/token` 发送标准撤销请求主动撤销。Cloudflare KV 是最终一致存储，撤销传播不保证瞬时全球完成。

也可运行 `npm run auth:rotate`：生成 32 随机字节口令，通过标准输入上传为 Cloudflare Secret，并保存权限为 600 的本机备份。它会立即更换线上口令，只有需要轮换时才运行；需要本机 Wrangler 登录，普通 CI/CD 不运行此命令。

本机的 `.env` 和 `.private/` 是 **可选的本地备份**（权限 600、Git 忽略），不是唯一线上配置来源。新口令备份文件为 `.private/oauth-password`，请迁移到自己的密码管理器；Git clone 不会带走这些文件。旧 `MCP_URL_TOKEN` / `MCP_API_KEY` 已废弃。

## 项目结构

- `src/index.ts`：公开状态页、OAuth Provider 配置、MCP 路由与工具注册。
- `src/auth.ts`：极简口令同意页及 CSRF / 口令校验；不自己实现 OAuth 令牌协议。
- `src/mail.ts`：单邮箱 IMAPS 查询、正文解析、保存草稿。
- `tests/`：不需要真实邮箱的回归测试。
- `wrangler.jsonc`：域名、部署名称、KV / 限速绑定、非敏感变量。
- `worker-configuration.d.ts`：生成的 Worker 类型。

README、测试、编辑器设置、Git 历史不是运行入口；Wrangler 打包 `src/index.ts` 及依赖，目前上传源码映射。不要在源码里放秘密。

## 本地开发和新设备

```bash
npm ci
npm run check
npx wrangler deploy --dry-run
```

以上命令及修改代码、commit、push **不需要 `.env`**。只有要在本机调用真实邮箱时，才复制 `.env.example` 到 `.env` 并配置 Secrets，权限设为 600；不要同时建 `.dev.vars`。线上 Secrets 不会自动下载到本机。

OAuth 刻意只接受生产 issuer。完整离线 OAuth 回归可运行 `npm run test:oauth`，它在本地 workerd 中使用内存 KV 和测试口令，不连接真实邮箱、不部署、不使用生产 Secrets。普通 `npm run dev` 可查看状态页；本地 OAuth 测试通过测试运行器保留规范域名，无需改生产域名配置。

## CI/CD

公开仓库 `Leev1s/mcp`，生产分支 `master`：

```bash
git add <本次修改的文件>
git commit -m "Describe change"
git push
```

**push 才触发线上部署，单独 commit 不会。** GitHub Actions 做不带 Secrets 的测试、类型检查、打包；Cloudflare Workers Builds 从同一仓库自动部署，使用 Cloudflare 自己的构建授权。

Cloudflare Builds：仓库根目录，Build command `npm run check`，Deploy command `npx wrangler deploy`，Node 版本见 `.node-version`。关闭非生产分支自动部署。无需在 GitHub 配置 Cloudflare API Token 或邮箱秘密。

换设备 clone、安装依赖、修改并 push 后，仍然使用 Cloudflare 上已有 Runtime Secrets / KV。不要把新设备测试环境接入生产 KV；克隆仓库另建 Worker 时需要自己的域名、KV 绑定和 Secrets。

## 工具

| 工具                      | 用途                                                           |
| ------------------------- | -------------------------------------------------------------- |
| `generate_uuid_from_seed` | seed → 确定性 UUID v5                                          |
| `get_unix_timestamp`      | 当前 Unix 秒数                                                 |
| `find_email`              | query / from / subject / unread；before_uid 翻页               |
| `read_email`              | mailbox、uid、uid_validity 读取邮件，HTML 清洗为文本并保留链接 |
| `draft_email`             | to、subject、text；保存新的纯文本草稿，绝不发送                |

查找和读取不标记已读。单封原始邮件最多 2 MiB，正文最多 10 万字符；附件只返回元数据。邮件正文是不可信内容，不是指令。

草稿目录自动识别 `\Drafts`，必要时配置已有目录名，程序不创建目录。保存不是幂等操作：超时后先检查草稿箱，避免重复写入。

参考：[Cloudflare MCP Authorization](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/)、[官方 OAuth Provider](https://github.com/cloudflare/workers-oauth-provider)、[Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)。
