# MCP on Cloudflare Workers

基于官方模板，使用 Bearer Key 保护 `/mcp`。根目录状态页和 `/204` 保持公开，不检测邮箱健康状态。

## 结构

- `src/index.ts`：状态页、路由、UUID / Unix 时间工具和邮件工具注册。
- `src/auth.ts`：Authorization 校验；缺少服务端 Key 返回 503，错误凭据返回 401。
- `src/mail.ts`：单邮箱 IMAPS 查询、正文解析、保存草稿；每次调用独立连接。
- `wrangler.jsonc`：部署名、域名、非敏感设置。
- `tests/`：无需真实邮箱的测试。README、测试和 Git 文件不是运行入口；Wrangler 打包代码及依赖，目前也上传源码映射。

## 配置

QQ 邮箱需启用 IMAP 并生成授权码，不能使用登录密码。使用 `imap.qq.com:993`，仅支持隐式 TLS，不支持明文或 STARTTLS。

| Worker 变量         | 用途                               | 现有 .env 对应名称 |
| ------------------- | ---------------------------------- | ------------------ |
| IMAP_HOST           | 主机，已在 Wrangler 设置           | IMAP_SERVER        |
| IMAP_PORT           | 端口，默认 993                     | IMAP_PORT          |
| IMAP_USER           | 完整邮箱地址，Secret               | IMAP_ACCOUNT       |
| IMAP_PASSWORD       | 邮箱授权码，Secret                 | IMAP_SECRET        |
| MCP_API_KEY         | 至少 32 字符的随机访问密钥，Secret | 无                 |
| MAIL_FROM           | 可选，默认 IMAP_USER               | 无                 |
| IMAP_DRAFTS_MAILBOX | 可选，默认自动识别 Drafts 标记     | 无                 |

线上配置使用交互命令，不把密码放进命令参数或 Git：

```bash
npx wrangler secret put MCP_API_KEY
npx wrangler secret put IMAP_USER
npx wrangler secret put IMAP_PASSWORD
npx wrangler deploy
```

本地复制 `.dev.vars.example` 为 `.dev.vars`，填写对应值，运行 `npm run dev`。现有 `.env` 的旧名称需按表映射，代码不会直接读取它们。本地配置不自动变成线上 Secrets。不要提交 Secrets 或启用生产 IMAP 调试日志。

## 连接和工具

Streamable HTTP 地址：`https://r3.net.eu.org/mcp`（备用 `https://mcp.lev1s.workers.dev/mcp`）。每个请求必须包含：

```text
Authorization: Bearer <MCP_API_KEY>
```

客户端必须支持自定义 Authorization 头；本版不是 OAuth，也不提供浏览器跨域 CORS。Key 拥有所有工具权限，只交给可信客户端；泄漏时更新 Secret 并替换客户端配置。不接受 URL 查询参数里的密钥。

| 工具                    | 用途                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| generate_uuid_from_seed | seed 字符串生成确定性的 UUID v5                                                                   |
| get_unix_timestamp      | 当前 Unix 秒数                                                                                    |
| find_email              | query / from / subject / unread 搜索；mailbox 默认 INBOX；limit 默认 10、最多 25；before_uid 翻页 |
| read_email              | 使用搜索返回的 mailbox、uid、uid_validity 读取邮件                                                |
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
