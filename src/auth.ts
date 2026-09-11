import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export const OAUTH_ORIGIN = "https://r3.net.eu.org";
export const MCP_SCOPE = "mcp:access";
export interface AuthEnv {
	AUTH_PASSWORD?: string;
	OAUTH_PROVIDER: OAuthHelpers;
	AUTH_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
}
const COOKIE = "__Host-r3-consent";
const headers = {
	"Cache-Control": "no-store",
	"Referrer-Policy": "no-referrer",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"Content-Type": "text/html; charset=utf-8",
	"Content-Security-Policy":
		"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
const escape = (value: string) =>
	value.replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
	);
export const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");
function equal(a: string, b: string) {
	return timingSafeEqual(Buffer.from(fingerprint(a), "hex"), Buffer.from(fingerprint(b), "hex"));
}
function signature(value: string, key: string) {
	return createHmac("sha256", key)
		.update("r3-consent:" + value)
		.digest("base64url");
}
export function createConsent(query: string, key: string, now = Date.now()) {
	const nonce = randomBytes(32).toString("base64url");
	const payload = `${nonce}.${now + 600_000}.${fingerprint(query)}`;
	return { nonce, cookie: `${payload}.${signature(payload, key)}` };
}
export function validConsent(
	cookie: string,
	nonce: string,
	query: string,
	key: string,
	now = Date.now(),
) {
	const parts = cookie.split(".");
	if (parts.length !== 4 || !/^[\w-]{43}$/.test(nonce)) return false;
	const [storedNonce, expires, queryHash, mac] = parts;
	return (
		Number(expires) > now &&
		Number(expires) <= now + 600_000 &&
		equal(storedNonce, nonce) &&
		equal(queryHash, fingerprint(query)) &&
		equal(mac, signature(parts.slice(0, 3).join("."), key))
	);
}
function reply(text: string, status: number) {
	return new Response(text, { status, headers });
}

export async function handleAuthorize(request: Request, env: AuthEnv): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname !== "/authorize") return reply("Not Found", 404);
	if (request.method !== "GET" && request.method !== "POST")
		return reply("Method not allowed", 405);
	// Generated high-entropy owner passphrase, never the email password.
	if (!env.AUTH_PASSWORD || env.AUTH_PASSWORD.length < 32)
		return reply("Authorization is not configured.", 503);
	if (url.href.length > 8192) return reply("Request too large", 414);
	if (url.searchParams.get("client_id")?.startsWith("https://"))
		return reply(
			"此连接仍在使用旧 CIMD 配置。请在 ChatGPT 删除并重新添加 MCP 连接，使用 OAuth 动态客户端注册（DCR），再重新授权。",
			400,
		);
	if (request.method === "POST") {
		if (request.headers.get("origin") !== OAUTH_ORIGIN) return reply("Invalid origin", 403);
		if (
			!(
				await env.AUTH_LIMITER.limit({
					key: "login:" + (request.headers.get("cf-connecting-ip") ?? "unknown"),
				})
			).success
		)
			return reply("尝试次数过多，请稍后重试。", 429);
	}
	try {
		const auth = await env.OAUTH_PROVIDER.parseAuthRequest(request);
		if (
			auth.responseType !== "code" ||
			!auth.codeChallenge ||
			auth.codeChallengeMethod !== "S256"
		)
			return reply("PKCE S256 is required.", 400);
		if (auth.scope.some((scope) => scope !== MCP_SCOPE)) return reply("Unsupported scope", 400);
		const client = await env.OAUTH_PROVIDER.lookupClient(auth.clientId);
		if (!client) return reply("Unknown client", 400);
		if (request.method === "GET") {
			const { nonce, cookie } = createConsent(url.search, env.AUTH_PASSWORD);
			return new Response(
				`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>R3 · 授权</title>
<style>body{background:#101512;color:#e4eee7;font:16px/1.7 system-ui;max-width:480px;margin:12vh auto;padding:24px}small,p{color:#aebfb4}code{overflow-wrap:anywhere}input,button{box-sizing:border-box;font:inherit;padding:12px;border:1px solid #65786c;border-radius:6px}input{width:100%;background:#17221b;color:inherit}button{margin:20px 8px 0 0;cursor:pointer}button[value=approve]{background:#b8f4c8}h1{font-weight:500}</style>
<small>R3 / MCP / OWNER ACCESS</small><h1>连接你的邮箱工具</h1>
<p>客户端自报名称（未经验证）：<strong>${escape(client.clientName ?? "Unnamed client")}</strong></p>
<p>授权后返回：<br><code>${escape(auth.redirectUri)}</code></p>
<p>允许读取、搜索邮件和保存草稿，以及 UUID / 时间工具。<strong>不能发送邮件。</strong>仅在你主动连接且认可上方客户端与回调地址时授权。</p>
<form method="post" action="${escape(url.pathname + url.search)}"><input type="hidden" name="csrf" value="${nonce}"><label for="password">你的 R3 授权口令（不是邮箱密码）</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="256" required><button name="decision" value="approve">授权连接</button><button name="decision" value="deny" formnovalidate>拒绝</button></form></html>`,
				{
					headers: {
						...headers,
						"Set-Cookie": `${COOKIE}=${cookie}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
					},
				},
			);
		}
		if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded"))
			return reply("Invalid form", 400);
		// Bound the streamed body, not only caller-controlled Content-Length.
		let body = "";
		const reader = request.body?.getReader();
		if (!reader) return reply("Missing form", 400);
		const decoder = new TextDecoder();
		let size = 0;
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > 8192) {
				await reader.cancel();
				return reply("Request too large", 413);
			}
			body += decoder.decode(value, { stream: true });
		}
		body += decoder.decode();
		const form = new URLSearchParams(body);
		const cookie =
			request.headers
				.get("cookie")
				?.split(";")
				.map((v) => v.trim())
				.find((v) => v.startsWith(COOKIE + "="))
				?.slice(COOKIE.length + 1) ?? "";
		if (!validConsent(cookie, form.get("csrf") ?? "", url.search, env.AUTH_PASSWORD))
			return reply("授权页面已失效，请从客户端重新连接。", 403);
		let redirectTo: string;
		if (form.get("decision") === "deny") {
			const redirect = new URL(auth.redirectUri);
			redirect.searchParams.set("error", "access_denied");
			if (auth.state) redirect.searchParams.set("state", auth.state);
			redirect.searchParams.set("iss", OAUTH_ORIGIN);
			redirectTo = redirect.href;
		} else {
			if (
				form.get("decision") !== "approve" ||
				!equal(form.get("password") ?? "", env.AUTH_PASSWORD)
			)
				return reply("口令不正确，请返回后重试。", 403);
			({ redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
				request: auth,
				userId: "owner",
				scope: [MCP_SCOPE],
				metadata: {},
				props: { userId: "owner", credentialVersion: fingerprint(env.AUTH_PASSWORD) },
			}));
		}
		return new Response(null, {
			status: 303,
			headers: {
				...headers,
				Location: redirectTo,
				"Set-Cookie": `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
			},
		});
	} catch {
		// Never echo authorization parameters, passwords or provider exceptions.
		return reply("无法处理授权请求，请从客户端重新连接。", 400);
	}
}
