import { timingSafeEqual } from "node:crypto";

export async function authorizeMcp(request: Request, key?: string): Promise<Response | null> {
	const headers = { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" };
	if (!key || key.length < 32)
		return new Response("MCP authentication is not configured.", { status: 503, headers });
	const match = /^Bearer ([^\s]+)$/i.exec(request.headers.get("Authorization") ?? "");
	const digest = (value: string) =>
		crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	const [provided, expected] = await Promise.all([digest(match?.[1] ?? ""), digest(key)]);
	if (!match || !timingSafeEqual(new Uint8Array(provided), new Uint8Array(expected))) {
		return new Response("Unauthorized", {
			status: 401,
			headers: { ...headers, "WWW-Authenticate": 'Bearer realm="mcp"' },
		});
	}
	return null;
}
