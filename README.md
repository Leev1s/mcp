# MCP on Cloudflare Workers

基于官方模板，使用秘密 URL `/mcp/<随机密钥>`，供单人自用。根目录状态页和 `/204` 保持公开，不检测邮箱健康状态。

## 结构

- `src/index.ts`：状态页、路由、UUID / Unix 时间工具和邮件工具注册。
- `src/auth.ts`：秘密路径校验；缺少有效配置返回 503，错误路径返回 404。不接受 Authorization 或查询参数中的密钥。
- `src/mail.ts`：单邮箱 IMAPS 查询、正文解析、保存草稿；每次调用独立连接。
- `wrangler.jsonc`：部署名、域名、非敏感设置。
- `tests/`：无需真实邮箱的测试。README、测试和 Git 文件不是运行入口；Wrangler 打包代码及依赖，目前也上传源码映射。

## 配置

QQ 邮箱需启用 IMAP 并生成授权码，不能使用登录密码。使用 `imap.qq.com:993`，仅支持隐式 TLS，不支持明文或 STARTTLS。

| Worker 变量         | 用途                                        | 现有 .env 对应名称 |
| ------------------- | ------------------------------------------- | ------------------ |
| IMAP_SERVER         | 主机，已在 Wrangler 设置                    | IMAP_SERVER        |
| IMAP_PORT           | 端口，默认 993                              | IMAP_PORT          |
| IMAP_ACCOUNT        | 完整邮箱地址，Secret                        | IMAP_ACCOUNT       |
| IMAP_SECRET         | 邮箱授权码，Secret                          | IMAP_SECRET        |
| MCP_URL_TOKEN       | 32 随机字节编码为 64 位小写十六进制，Secret | 无                 |
| MAIL_FROM           | 可选，默认 IMAP_ACCOUNT                     | 无                 |
| IMAP_DRAFTS_MAILBOX | 可选，默认自动识别 Drafts 标记              | 无                 |

线上配置使用交互命令，不把密码放进命令参数或 Git：

```bash
npx wrangler secret put MCP_URL_TOKEN
npx wrangler secret put IMAP_ACCOUNT
npx wrangler secret put IMAP_SECRET
npx wrangler deploy
```

本地复制 `.env.example` 为 `.env`，填写对应值，运行 `npm run dev`。变量名与线上一致，Wrangler 会读取本地 .env。不要同时创建 .dev.vars（会覆盖 .env 的加载）。本地配置不自动变成线上 Secrets。不要提交 Secrets 或启用生产 IMAP 调试日志。

## 连接和工具

在 ChatGPT 创建自定义 MCP，选择“无身份验证”，粘贴完整秘密 URL。无需请求头、OAuth Client ID 或 Client Secret。地址格式：

```text
https://r3.net.eu.org/mcp/<MCP_URL_TOKEN>
```

备用域名也支持相同秘密路径。旧 `/mcp` 和旧 Bearer Key 不再有效。本版不是 OAuth，也不提供浏览器跨域 CORS。

本地真实配置统一放在项目 `.env`，权限 600、不提交 Git；完整链接备份在 `.private/private-url`。它们不能通过 GitHub 恢复，请另存到密码管理器。只粘贴到可信客户端设置，不要在浏览器地址栏、聊天或截图中传播。拿到链接的人可以读取邮件和保存草稿，不能发送。MCP_API_KEY 已废弃并从线上删除，只有 MCP_URL_TOKEN 在使用。

## CI/CD

GitHub 私有仓库：`Leev1s/mcp`，生产分支 `master`。本地 commit 只保存历史，push 才通知远端：

```bash
git add <需要提交的代码文件>
git commit -m "Describe change"
git push
```

GitHub Actions 在 push / PR 时运行不带 Secrets 的测试、类型检查和打包。Cloudflare Workers Builds 负责部署，不在 GitHub 保存 Cloudflare 登录凭据或邮箱密码。

首次必须在 Cloudflare 的 mcp → Settings → Builds → Connect 连接 GitHub 仓库，授权时只选择这个仓库：

- 仓库：Leev1s/mcp；生产分支：master；根目录：仓库根目录。
- Build command：`npm run check`（在生产部署前再次检查，失败不部署）。
- Deploy command：`npx wrangler deploy`。
- Node 版本：26.5.0（.node-version）；依赖锁定在 package-lock.json。
- 关闭非生产分支自动部署，避免预览版本接触真实邮箱。
- 不要把 IMAP_SECRET、IMAP_ACCOUNT、MCP_URL_TOKEN 放进 Build variables/secrets；它们只属于 Worker 运行时 Secrets。

连接后推送一次，并在 Cloudflare Builds 中确认成功记录，才算持续部署已启用。只添加配置文件不会自动连接 Cloudflare Git 集成。

非敏感设置 IMAP_SERVER / IMAP_PORT 由 wrangler.jsonc 管理；运行时 Secrets 独立保存，普通代码部署不会从 .env 上传或轮换它们。修改线上密码需要单独更新 Secret。回滚代码也不能恢复已删除的旧 Secret 名称。

Worker observability 已关闭以减少完整请求 URL 留存，但不能保证 Cloudflare、客户端或其他基础设施不记录 URL。这个方案是持有链接即获授权，不验证个人身份，也没有自动过期、按客户端撤销或 OAuth 权限管理。泄漏时生成新 MCP_URL_TOKEN、更新 Cloudflare Secret，并替换所有客户端链接；旧链接随之失效。请通过密码管理器保管。

| 工具                    | 用途                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| generate_uuid_from_seed | seed 字符串生成确定性的 UUID v5                                                                   |
| get_unix_timestamp      | 当前 Unix 秒数                                                                                    |
| find_email              | query / from / subject / unread 搜索；mailbox 默认 INBOX；limit 默认 10、最多 25；before_uid 翻页 |
| read_email              | 使用搜索返回的 mailbox、uid、uid_validity 读取邮件；HTML 默认清洗为文本并保留可操作链接           |
| draft_email             | to 地址数组、subject、text；保存一个新的纯文本草稿，绝不发送                                      |

查找和读取不标记已读。单封原始邮件最多 2 MiB，返回正文最多 10 万字符；附件只返回元数据。
邮件正文是不可信数据，不是用户指令；HTML 不应直接执行。本版没有 SMTP、发送、删除或修改已有邮件能力。

草稿目录自动识别 `\Drafts` 标记。没有该标记时配置 IMAP_DRAFTS_MAILBOX 为已有目录名，程序不会创建目录。保存不是幂等操作：超时或结果未知时先检查草稿箱再重试，避免重复草稿。

## 验证

```bash
npm ci
npm test
npm run type-check
npx oxlint
npx wrangler deploy --dry-run
```

测试使用 Node 实验性模块 mock（已用 Node 26 验证）。模拟测试不等于真实邮箱连通验证。真实草稿写入应在用户确实需要起草邮件时执行。

参考：[ImapFlow Workers 支持](https://imapflow.com/docs/getting-started/installation/)、[Cloudflare TLS](https://developers.cloudflare.com/workers/runtime-apis/nodejs/tls/)。
