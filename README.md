# R3 MCP on Cloudflare Workers

单人自用的邮箱 MCP，采用 Cloudflare 官方 OAuth Provider。自己的极简口令授权页，无第三方登录。邮件功能仍只有搜索、读取、保存草稿，**不能发送**；UUID / Unix 时间工具保留。

## 连接

MCP 地址：`https://r3.net.eu.org/mcp`，选择 OAuth。客户端通过元数据发现和动态注册（DCR）连接，无需手动分配固定 API Key。授权页输入单独的 **R3 授权口令**，不是 QQ 邮箱密码。仅批准你主动发起的连接，并核对页面上的客户端及回调地址；客户端名称是自报的，不是认证标识。

当前保留 DCR 兼容接入。MCP 2026-07-28 已优先推荐 CIMD、弃用新实现的 DCR，但 OpenAI 仍支持 DCR。2026-09-13 再次在 workerd 实测读取 `https://chatgpt.com/oauth/client.json` 返回 HTTP 403，因此暂不宣告 CIMD 可用，也不硬编码或伪造该元数据。若授权链接的 client_id 仍是这个 URL，请在 ChatGPT 重新配置连接，选择 OAuth / DCR。这个网络兼容限制不影响口令的云端配置。

旧 `/mcp/<秘密路径>` 已停用，旧连接需要删除后重新添加。`workers.dev` 保留公开状态页与 `/204`，OAuth 仅在上述自定义域名提供，避免多个 issuer。

- `/authorize`：输入口令并明确同意，支持拒绝。
- `/token`：官方库处理授权码兑换、刷新和 RFC 7009 撤销。
- `/register`：动态注册；注册信息必须支持本服务器接受的认证方法。
- `/.well-known/oauth-authorization-server`：授权服务器元数据。
- `/.well-known/oauth-protected-resource/mcp`：MCP 资源元数据。
- `/`：公开 HTML / 纯文本状态页；`/204`：公开连通性检查，不检查邮箱健康。

使用授权码 + PKCE S256。访问令牌有效期 1 小时，刷新令牌 30 天；刷新与撤销由官方库处理。`mcp:access` 是一个简单的全工具权限，不做复杂权限体系。OAuth 访问令牌仍通过标准 Bearer 请求头传输，和以前的固定 API Key 是不同的机制。

## OAuth 实现依据

遵循 [MCP 授权规范](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)、[Cloudflare 官方自托管方案](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/#4-your-mcp-server-handles-authorization-and-authentication-itself)和 [OpenAI 接入要求](https://developers.openai.com/plugins/build/auth)。协议层使用 `@cloudflare/workers-oauth-provider`，没有自写授权码、令牌格式或刷新协议。

| 职责 | 实现 |
| --- | --- |
| 资源与授权服务器发现（RFC 9728 / 8414） | 官方 Provider；固定 issuer 和 `/mcp` resource |
| 客户端、回调、PKCE、resource 校验 | 官方 `parseAuthRequest`，应用限制 S256 和 `mcp:access` |
| 授权码、访问/刷新令牌、过期与撤销 | 官方 `completeAuthorization` 和 `/token`，状态存于 KV |
| 受保护请求 | 官方 Provider 验证令牌与 audience；应用检查 owner、口令版本及 scope；未认证 401，权限不足 403 |
| 用户登录和同意 | 本应用的单人口令页；Runtime Secret、CSRF Cookie、显式同意、限速和 CSP |

上面最后一行是 Cloudflare 文档明确交给应用实现的认证步骤。口令只提交给本站 `/authorize`，不是把口令交给 ChatGPT，也不是 OAuth 的 password grant。OpenAI 更推荐成熟的身份服务；这里根据“单人自用、不接第三方登录”的要求选择自托管口令页，不宣称它具备完整身份平台的账户恢复或 MFA 能力。

## 配置与安全边界

| 配置                                | 存放位置                  | 用途                                             |
| ----------------------------------- | ------------------------- | ------------------------------------------------ |
| `IMAP_SERVER` / `IMAP_PORT`         | `wrangler.jsonc`          | 当前 `imap.qq.com:993`，仅 IMAPS TLS             |
| `IMAP_ACCOUNT`                      | Worker Runtime Secret     | 完整邮箱地址                                     |
| `IMAP_SECRET`                       | Worker Runtime Secret     | QQ IMAP 授权码，不是登录密码                     |
| `AUTH_PASSWORD`                     | Worker Runtime Secret     | 在 Dashboard 自行设置的非空授权口令 |
| `OAUTH_KV`                          | Worker KV binding         | 客户端、授权和令牌状态；由官方库管理             |
| `AUTH_LIMITER`                      | Worker Rate Limit binding | 每 IP / 每类操作 10 次每分钟；非全球严格计数     |
| `MAIL_FROM` / `IMAP_DRAFTS_MAILBOX` | 可选 Runtime 设置         | 默认邮箱账户 / 自动识别草稿目录                  |

生产 Secrets 在 Cloudflare 的 Worker Runtime 配置中设置，不放 GitHub 或 Build variables。`wrangler.jsonc` 的 `secrets.required` 只声明必需的名称，不包含值；类型生成不再依赖本地 `.env`。代码部署不会把本机 `.env` 上传为 Secrets，也不会覆盖 Dashboard 已有的 Secret 值。KV ID 不是凭据，可以放 Git；KV 内的数据不放 Git。Provider 保存令牌哈希并加密授权 props，不把 IMAP 密码发给客户端。

授权页使用 Secure / HttpOnly / SameSite Cookie、绑定原始 OAuth 请求的 CSRF 校验、CSP 和限速。口令代表唯一的 owner，不是多人账户系统。拿到口令仍然可以授权自己的客户端，请保存在密码管理器里。

授权页的 `form-action` 只允许本站与本次已验证的客户端回调 origin。Chrome 也会检查表单提交后的 303 跳转；如果只写 `'self'`，回调会被拦截，再次提交已清除 Cookie 的旧表单就会显示“授权页面已失效”。测试 OAuth 时要在浏览器实际点击并确认回到客户端，不能只检查服务端返回 303。

## 在 Cloudflare 修改授权口令

1. 打开 Cloudflare **Workers & Pages → mcp → Settings → Variables and Secrets**。
2. 编辑已有的 `AUTH_PASSWORD`；没有则添加同名配置。类型选择 **Secret**，不要选明文 Text。
3. 输入你自己的新口令，建议使用独立的强口令，不复用邮箱密码或 IMAP 授权码。
4. 点击 **Deploy**，将这个 Runtime Secret 的修改应用到 Worker。
5. 回到 ChatGPT 重新发起授权，在新授权页输入刚设置的口令。

无需修改代码、GitHub Secrets、本地文件或运行 Wrangler。这里是 **Worker Settings**，不是 **Build Settings**。[Cloudflare 官方配置步骤](https://developers.cloudflare.com/workers/configuration/secrets/#via-the-dashboard)。Cloudflare 不再展示保存后的 Secret 原值，但允许替换；请在自己的密码管理器中保存口令。

`env.AUTH_PASSWORD` 中的 `env` 是 Cloudflare 注入的运行环境，不是本机 `.env` 文件。程序每次请求读取它，不设置口令长度或字符规则，只在口令未配置或为空时拒绝登录。通用请求大小限制及限速仍保留。公开页面仅显示“授权服务暂时不可用”，不展示配置名称、后台操作说明或内部排错信息；管理说明仅保留在本文档中。

更换口令会使旧访问令牌及旧授权刷新出来的令牌无法使用 MCP，所有客户端都需重新授权。授权里保存的口令指纹只是云端口令版本标记，与本地文件无关。不要恢复旧口令；旧授权记录会随生命周期过期，也可向 `/token` 发送标准撤销请求。Cloudflare KV 最终一致，撤销传播不保证瞬时全球完成。

已移除生成口令并上传、落盘的 `auth:rotate` 脚本。历史 `.env` / `.private/` 仍受 Git 忽略，不参与线上鉴权，也不会自动同步到 Cloudflare；本轮未删除你的旧备份。旧 `MCP_URL_TOKEN` / `MCP_API_KEY` 已废弃。

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

每个工具都有 `title`、`inputSchema`、具体的 `outputSchema`、行为 annotations 和 `_meta.securitySchemes`。成功结果提供 `structuredContent`，并保留同一 JSON 的 `content` 文本以兼容旧客户端；不是只返回 stringify 后的文本。邮箱错误使用 `isError: true`，不伪装成成功 schema。

UUID 输出为 `{ "uuid": "..." }`，时间输出为 `{ "timestamp": 1789093457 }`；邮件结果保持原有字段。测试校验全部邮件成功结果符合各自输出 schema，并在真实 workerd 的 tools/list 检查 5 个输出 schema。参考：[OpenAI 工具返回结构](https://developers.openai.com/plugins/reference#tool-results)、[OpenAI OAuth / DCR](https://developers.openai.com/plugins/build/auth#client-registration)。

草稿目录自动识别 `\Drafts`，必要时配置已有目录名，程序不创建目录。保存不是幂等操作：超时后先检查草稿箱，避免重复写入。

参考：[Cloudflare MCP Authorization](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/)、[官方 OAuth Provider](https://github.com/cloudflare/workers-oauth-provider)、[Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)。
